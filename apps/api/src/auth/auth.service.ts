import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAddress, recoverMessageAddress, type Hex } from 'viem';
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from 'viem/siwe';
import { BASE_SEPOLIA_CHAIN_ID } from '@boundra/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { DatabaseService } from '../database.service';
import { ApiError } from '../common/errors';
import type { AuthenticatedOwner, SessionKind } from '../common/request';

export const SESSION_COOKIE = '__Host-boundra_session';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Who the session is for: the web app, or an app or AI assistant using the API directly. */
export type SignInClient = 'browser' | 'token';

// The statement is part of what the owner signs, so it decides which kind of session they get.
export const SIGN_IN_STATEMENTS: Record<SignInClient, string> = {
  browser:
    'Sign in to Boundra. This signature only starts an app session; it does not approve any mandate or transaction.',
  token:
    'Give an app or AI assistant an API token for your Boundra account. It can read your account and prepare mandates for you to review; it does not approve any mandate or transaction, and it cannot sign transactions or move funds.',
};
const KIND_OF: Record<SignInClient, SessionKind> = { browser: 'COOKIE', token: 'TOKEN' };

export interface SessionGrant {
  token: string;
  /** Only for browser sessions; a browser never attaches a bearer token on its own. */
  csrfToken: string | null;
  kind: SessionKind;
  address: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly domain: string;
  private readonly uri: string;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    const origin = new URL(config.WEB_ORIGIN);
    this.domain = origin.host;
    this.uri = origin.origin;
  }

  /** EIP-4361 challenge bound to this origin, Base Sepolia and a single-use nonce. */
  async createChallenge(addressInput: string, client: SignInClient = 'browser') {
    const address = getAddress(addressInput);
    const nonce = generateSiweNonce();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + this.config.CHALLENGE_TTL_SECONDS * 1000);
    const message = createSiweMessage({
      address,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      domain: this.domain,
      uri: this.uri,
      version: '1',
      nonce,
      issuedAt,
      expirationTime: expiresAt,
      statement: SIGN_IN_STATEMENTS[client],
    });
    await this.database.client.authChallenge.create({
      data: {
        nonceHash: sha256(nonce),
        address: address.toLowerCase(),
        domain: this.domain,
        uri: this.uri,
        chainId: BASE_SEPOLIA_CHAIN_ID,
        issuedAt,
        expiresAt,
      },
    });
    return { message, expiresAt: expiresAt.toISOString() };
  }

  async verify(message: string, signature: Hex): Promise<SessionGrant> {
    const invalid = () =>
      new ApiError(
        HttpStatus.UNAUTHORIZED,
        'CHALLENGE_INVALID',
        'Sign-in challenge is invalid, expired or already used',
        'Request a new challenge and sign it again.',
      );
    let fields: ReturnType<typeof parseSiweMessage>;
    try {
      fields = parseSiweMessage(message);
    } catch {
      throw invalid();
    }
    if (!fields.address || !fields.nonce || !fields.expirationTime) throw invalid();
    if (fields.chainId !== BASE_SEPOLIA_CHAIN_ID)
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'WRONG_CHAIN', 'Sign in on Base Sepolia (84532)');
    if (fields.domain !== this.domain || fields.uri !== this.uri || fields.version !== '1')
      throw invalid();
    const client = (Object.keys(SIGN_IN_STATEMENTS) as SignInClient[]).find(
      (key) => SIGN_IN_STATEMENTS[key] === fields.statement,
    );
    if (!client) throw invalid();
    const kind = KIND_OF[client];
    let signer: string;
    try {
      signer = await recoverMessageAddress({ message, signature });
    } catch {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'SIGNATURE_INVALID', 'Signature is invalid');
    }
    if (signer.toLowerCase() !== fields.address.toLowerCase())
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'SIGNATURE_INVALID', 'Signature is invalid');
    const address = fields.address.toLowerCase();

    // Single use: the nonce is consumed atomically with every field it was issued for.
    const consumed = await this.database.client.$executeRaw`
      UPDATE "AuthChallenge" SET "consumedAt" = now()
      WHERE "nonceHash" = ${sha256(fields.nonce)} AND "consumedAt" IS NULL AND "expiresAt" > now()
        AND "address" = ${address} AND "domain" = ${this.domain} AND "uri" = ${this.uri}
        AND "chainId" = ${BASE_SEPOLIA_CHAIN_ID}`;
    if (consumed !== 1) throw invalid();

    const owner = await this.database.client.walletIdentity.upsert({
      where: { address },
      create: { address },
      update: {},
    });
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_HOURS * 3_600_000);
    const session = await this.database.client.authSession.create({
      data: { tokenHash: sha256(token), csrfTokenHash: '', kind, ownerId: owner.id, expiresAt },
    });
    if (kind === 'TOKEN') return { token, csrfToken: null, kind, address, expiresAt };
    const csrfToken = this.csrfFor(session.id);
    await this.database.client.authSession.update({
      where: { id: session.id },
      data: { csrfTokenHash: sha256(csrfToken) },
    });
    return { token, csrfToken, kind, address, expiresAt };
  }

  /** CSRF token derived from the session ID so it can be re-issued without being stored. */
  csrfFor(sessionId: string): string {
    return createHmac('sha256', this.config.SESSION_SECRET)
      .update(`csrf:${sessionId}`)
      .digest('base64url');
  }

  csrfMatches(sessionId: string, presented: string | undefined): boolean {
    if (!presented) return false;
    const expected = Buffer.from(this.csrfFor(sessionId));
    const actual = Buffer.from(presented);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** A cookie only resolves browser sessions, and a bearer token only API tokens. */
  async resolveSession(
    token: string | undefined,
    kind: SessionKind,
  ): Promise<AuthenticatedOwner | null> {
    if (!token || token.length > 100) return null;
    const session = await this.database.client.authSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { owner: true },
    });
    if (!session || session.kind !== kind || session.revokedAt || session.expiresAt <= new Date())
      return null;
    if (Date.now() - session.lastSeenAt.getTime() > 60_000)
      await this.database.client.authSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    return {
      id: session.ownerId,
      address: session.owner.address,
      sessionId: session.id,
      kind: session.kind,
    };
  }

  async revoke(sessionId: string) {
    await this.database.client.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  isAdmin(address: string) {
    return this.config.ADMIN_ADDRESSES.includes(address.toLowerCase());
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name)
      return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

/** The token from `Authorization: Bearer <token>`: undefined without the header, '' if malformed. */
export function readBearer(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer (\S+)$/.exec(header.trim());
  return match ? match[1]! : '';
}

export function sessionCookie(token: string, maxAgeSeconds: number) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}
