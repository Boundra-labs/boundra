import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { toHex } from 'viem';
import { createDatabaseClient, type PrismaClient } from '@boundra/database';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.factory';
import { readConfig } from '../src/config';
import { CHAIN_GATEWAY, type ChainGateway } from '../src/chain/chain.gateway';

const ORIGIN = 'http://localhost:3000';
const newAccount = () => privateKeyToAccount(toHex(randomBytes(32)));
const randomAddress = () => `0x${randomBytes(20).toString('hex')}`;

class FakeGateway implements ChainGateway {
  configured = true;
  /** False: this deployment runs no Boundra agent (OPERATOR_ADDRESS unset). */
  boundraAgent = true;
  executors = new Map<string, string>();
  balances = new Map<string, bigint>();
  readonly manifest = {
    chainId: 84532 as const,
    factory: '0x00000000000000000000000000000000000000f1',
    mockUsdc: '0x00000000000000000000000000000000000000a1',
    faucet: '0x00000000000000000000000000000000000000a2',
    liquidVault: '0x00000000000000000000000000000000000000b1',
    timedVault: '0x00000000000000000000000000000000000000b2',
    riskAdmin: '0x00000000000000000000000000000000000000c1',
    deploymentBlock: '1',
    codeHashes: {
      factory: `0x${'1'.repeat(64)}`,
      mockUsdc: `0x${'2'.repeat(64)}`,
      faucet: `0x${'3'.repeat(64)}`,
      liquidVault: `0x${'4'.repeat(64)}`,
      timedVault: `0x${'5'.repeat(64)}`,
    },
  };
  readonly operator = '0x00000000000000000000000000000000000000d1';
  deployment() {
    return this.configured
      ? { manifest: this.manifest, operator: this.boundraAgent ? this.operator : null }
      : null;
  }
  async findExecutor(owner: string) {
    const address = this.executors.get(owner.toLowerCase());
    return address ? { address, blockNumber: 100n } : null;
  }
  async fundableBalance(owner: string) {
    return this.balances.get(owner.toLowerCase()) ?? 1_000_000_000n;
  }
  async snapshot(): Promise<never> {
    throw new Error('not used');
  }
}

interface Session {
  account: PrivateKeyAccount;
  address: string;
  cookie: string;
  csrf: string;
}

async function startApp(env: Record<string, string>, gateway: ChainGateway) {
  Object.assign(process.env, env);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CHAIN_GATEWAY)
    .useValue(gateway)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app, readConfig());
  await app.init();
  return app;
}

describe('Boundra API (PostgreSQL)', () => {
  const gateway = new FakeGateway();
  const admin = newAccount();
  let app: NestExpressApplication;
  let db: PrismaClient;
  const addresses: string[] = [];

  beforeAll(async () => {
    db = createDatabaseClient(process.env.DATABASE_URL!);
    app = await startApp(
      {
        NODE_ENV: 'test',
        WEB_ORIGIN: ORIGIN,
        SESSION_SECRET: randomBytes(32).toString('base64url'),
        ADMIN_ADDRESSES: admin.address,
        AUTH_RATE_LIMIT_PER_MINUTE: '1000',
        RATE_LIMIT_PER_MINUTE: '10000',
      },
      gateway,
    );
  });

  afterAll(async () => {
    const owners = await db.walletIdentity.findMany({ where: { address: { in: addresses } } });
    const ownerIds = owners.map((o) => o.id);
    const mandates = await db.mandate.findMany({ where: { ownerId: { in: ownerIds } } });
    for (const m of mandates)
      await db.job.deleteMany({ where: { key: { startsWith: `verify-authorization:${m.id}:` } } });
    await db.activityEvent.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await db.mandate.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await db.question.deleteMany({ where: { intent: { ownerId: { in: ownerIds } } } });
    await db.preferenceRecord.deleteMany({ where: { intent: { ownerId: { in: ownerIds } } } });
    await db.intent.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await db.executor.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await db.authSession.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await db.authChallenge.deleteMany({ where: { address: { in: addresses } } });
    await db.walletIdentity.deleteMany({ where: { id: { in: ownerIds } } });
    await app.close();
    await db.$disconnect();
  });

  const http = () => request(app.getHttpServer());

  async function login(account: PrivateKeyAccount = newAccount()): Promise<Session> {
    addresses.push(account.address.toLowerCase());
    const challenge = await http()
      .post('/api/v1/auth/challenge')
      .send({ address: account.address });
    expect(challenge.status).toBe(201);
    const signature = await account.signMessage({ message: challenge.body.message });
    const verified = await http()
      .post('/api/v1/auth/verify')
      .send({ message: challenge.body.message, signature });
    expect(verified.status).toBe(200);
    const cookie = String(verified.headers['set-cookie']).split(';')[0]!;
    return {
      account,
      address: account.address.toLowerCase(),
      cookie,
      csrf: verified.body.csrfToken,
    };
  }

  const as = (s: Session) => ({
    get: (path: string) => http().get(`/api/v1${path}`).set('Cookie', s.cookie),
    post: (path: string, body: object = {}) =>
      http()
        .post(`/api/v1${path}`)
        .set('Cookie', s.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', s.csrf)
        .send(body),
    patch: (path: string, body: object = {}) =>
      http()
        .patch(`/api/v1${path}`)
        .set('Cookie', s.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', s.csrf)
        .send(body),
  });

  const intentBody = {
    objective: 'Manage 300 MockUSDC safely',
    amount: '300000000',
    chainId: 84532,
  };

  describe('SIWE authentication', () => {
    it('issues a hardened session cookie and a CSRF token', async () => {
      const account = newAccount();
      addresses.push(account.address.toLowerCase());
      const challenge = await http()
        .post('/api/v1/auth/challenge')
        .send({ address: account.address });
      expect(challenge.body.message).toContain('Chain ID: 84532');
      expect(challenge.body.message).toContain('does not approve any mandate');
      const signature = await account.signMessage({ message: challenge.body.message });
      const verified = await http()
        .post('/api/v1/auth/verify')
        .send({ message: challenge.body.message, signature });
      const cookie = String(verified.headers['set-cookie']);
      expect(cookie).toMatch(/^__Host-boundra_session=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/SameSite=Strict/);
      const session = await http().get('/api/v1/auth/session').set('Cookie', cookie.split(';')[0]!);
      expect(session.body).toMatchObject({
        address: account.address.toLowerCase(),
        csrfToken: verified.body.csrfToken,
        admin: false,
      });
      // Replay of the same signed challenge is rejected.
      const replay = await http()
        .post('/api/v1/auth/verify')
        .send({ message: challenge.body.message, signature });
      expect(replay.status).toBe(401);
      expect(replay.body.error.code).toBe('CHALLENGE_INVALID');
    });

    it('rejects a signature from another wallet, a foreign domain and an expired challenge', async () => {
      const account = newAccount();
      addresses.push(account.address.toLowerCase());
      const challenge = await http()
        .post('/api/v1/auth/challenge')
        .send({ address: account.address });
      const forged = await newAccount().signMessage({ message: challenge.body.message });
      const bad = await http()
        .post('/api/v1/auth/verify')
        .send({ message: challenge.body.message, signature: forged });
      expect(bad.body.error.code).toBe('SIGNATURE_INVALID');

      const phishing = createSiweMessage({
        address: account.address,
        chainId: 84532,
        domain: 'evil.example',
        uri: 'https://evil.example',
        version: '1',
        nonce: 'abcdefgh12345678',
        expirationTime: new Date(Date.now() + 60_000),
      });
      const foreign = await http()
        .post('/api/v1/auth/verify')
        .send({ message: phishing, signature: await account.signMessage({ message: phishing }) });
      expect(foreign.body.error.code).toBe('CHALLENGE_INVALID');

      // Well in the past: the database compares with its own clock, which may lag this host's.
      await db.authChallenge.updateMany({
        where: { address: account.address.toLowerCase() },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      const expired = await http()
        .post('/api/v1/auth/verify')
        .send({
          message: challenge.body.message,
          signature: await account.signMessage({ message: challenge.body.message }),
        });
      expect(expired.body.error.code).toBe('CHALLENGE_INVALID');
    });

    it('issues an API token for a token challenge, with its own consent wording', async () => {
      const account = newAccount();
      addresses.push(account.address.toLowerCase());
      const challenge = await http()
        .post('/api/v1/auth/challenge')
        .send({ address: account.address, client: 'token' });
      expect(challenge.status).toBe(201);
      expect(challenge.body.message).toContain('API token');
      expect(challenge.body.message).toContain('cannot sign transactions or move funds');
      const verified = await http()
        .post('/api/v1/auth/verify')
        .send({
          message: challenge.body.message,
          signature: await account.signMessage({ message: challenge.body.message }),
        });
      expect(verified.status).toBe(200);
      expect(verified.headers['set-cookie']).toBeUndefined();
      expect(verified.body).toMatchObject({ address: account.address.toLowerCase() });
      expect(verified.body.csrfToken).toBeUndefined();
      const bearer = `Bearer ${verified.body.token}`;
      // No Origin or CSRF token: a browser never attaches this header on its own.
      const created = await http()
        .post('/api/v1/intents')
        .set('Authorization', bearer)
        .send(intentBody);
      expect(created.status).toBe(201);
      const session = await http().get('/api/v1/auth/session').set('Authorization', bearer);
      expect(session.body).toEqual({
        address: account.address.toLowerCase(),
        kind: 'token',
        csrfToken: null,
        admin: false,
      });
      // The token is not a cookie, and the cookie is not a token.
      const asCookie = await http()
        .get('/api/v1/dashboard')
        .set('Cookie', `__Host-boundra_session=${verified.body.token}`);
      expect(asCookie.status).toBe(401);
      const browser = await login();
      const cookieToken = browser.cookie.split('=')[1]!;
      const asBearer = await http()
        .get('/api/v1/dashboard')
        .set('Authorization', `Bearer ${cookieToken}`);
      expect(asBearer.status).toBe(401);
      // The owner sees and revokes tokens from the web app only, and only their own.
      const listed = await as(browser).get('/auth/tokens');
      expect(listed.body.items).toEqual([]);
      const own = await http().get('/api/v1/auth/tokens').set('Authorization', bearer);
      expect(own.status).toBe(403);
      // A bad bearer token is rejected even next to a valid cookie.
      const mixed = await http()
        .get('/api/v1/dashboard')
        .set('Cookie', browser.cookie)
        .set('Authorization', 'Bearer not-a-token');
      expect(mixed.status).toBe(401);
      expect((await http().post('/api/v1/auth/logout').set('Authorization', bearer)).status).toBe(
        204,
      );
      expect((await http().get('/api/v1/dashboard').set('Authorization', bearer)).status).toBe(401);
    });

    it('lets the owner list and revoke the tokens they gave out, and nobody else’s', async () => {
      const s = await login();
      const challenge = await http()
        .post('/api/v1/auth/challenge')
        .send({ address: s.account.address, client: 'token' });
      const { token } = (
        await http()
          .post('/api/v1/auth/verify')
          .send({
            message: challenge.body.message,
            signature: await s.account.signMessage({ message: challenge.body.message }),
          })
      ).body;
      const listed = await as(s).get('/auth/tokens');
      expect(listed.body.items).toHaveLength(1);
      expect(Object.keys(listed.body.items[0]).sort()).toEqual([
        'createdAt',
        'expiresAt',
        'id',
        'lastSeenAt',
      ]);
      const id = listed.body.items[0].id;
      const other = await login();
      expect((await as(other).post(`/auth/tokens/${id}/revoke`)).status).toBe(404);
      expect((await as(s).post('/auth/tokens/not-a-uuid/revoke')).status).toBe(404);
      // The browser session itself is not a token and cannot be revoked here.
      const self = await db.authSession.findFirstOrThrow({
        where: { owner: { address: s.address }, kind: 'COOKIE' },
      });
      expect((await as(s).post(`/auth/tokens/${self.id}/revoke`)).status).toBe(404);
      expect(
        (await http().get('/api/v1/dashboard').set('Authorization', `Bearer ${token}`)).status,
      ).toBe(200);
      expect((await as(s).post(`/auth/tokens/${id}/revoke`)).status).toBe(204);
      expect(
        (await http().get('/api/v1/dashboard').set('Authorization', `Bearer ${token}`)).status,
      ).toBe(401);
      expect((await as(s).get('/auth/tokens')).body.items).toEqual([]);
    });

    it('rejects a signed statement that is not one of ours', async () => {
      const account = newAccount();
      addresses.push(account.address.toLowerCase());
      const challenge = await http()
        .post('/api/v1/auth/challenge')
        .send({ address: account.address, client: 'token' });
      const altered = challenge.body.message.replace(
        /^Give an app.*$/m,
        'Sign in to Boundra. Totally harmless.',
      );
      expect(altered).not.toBe(challenge.body.message);
      const verified = await http()
        .post('/api/v1/auth/verify')
        .send({ message: altered, signature: await account.signMessage({ message: altered }) });
      expect(verified.status).toBe(401);
      expect(verified.body.error.code).toBe('CHALLENGE_INVALID');
    });

    it('requires a session, and logout revokes it', async () => {
      expect((await http().get('/api/v1/dashboard')).body.error.code).toBe('UNAUTHENTICATED');
      const s = await login();
      expect((await as(s).get('/dashboard')).status).toBe(200);
      expect((await as(s).post('/auth/logout')).status).toBe(204);
      expect((await as(s).get('/dashboard')).status).toBe(401);
    });
  });

  describe('CSRF and owner isolation', () => {
    it('rejects state changes without the CSRF token or from another origin', async () => {
      const s = await login();
      const noToken = await http()
        .post('/api/v1/intents')
        .set('Cookie', s.cookie)
        .set('Origin', ORIGIN)
        .send(intentBody);
      expect(noToken.status).toBe(403);
      expect(noToken.body.error.code).toBe('CSRF_REJECTED');
      const otherOrigin = await http()
        .post('/api/v1/intents')
        .set('Cookie', s.cookie)
        .set('Origin', 'https://evil.example')
        .set('X-CSRF-Token', s.csrf)
        .send(intentBody);
      expect(otherOrigin.body.error.code).toBe('CSRF_REJECTED');
      const other = await login();
      const crossSession = await http()
        .post('/api/v1/intents')
        .set('Cookie', s.cookie)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', other.csrf)
        .send(intentBody);
      expect(crossSession.body.error.code).toBe('CSRF_REJECTED');
    });

    it('never exposes or mutates another owner’s intent', async () => {
      const alice = await login();
      const bob = await login();
      const created = await as(alice).post('/intents', intentBody);
      expect(created.status).toBe(201);
      expect((await as(bob).get(`/intents/${created.body.id}`)).status).toBe(404);
      const answer = await as(bob).post(`/intents/${created.body.id}/answers`, {
        questionId: created.body.question.questionId,
        alternativeId: 'up_to_30_days',
      });
      expect(answer.status).toBe(404);
    });
  });

  describe('intent validation', () => {
    it.each([
      [{ ...intentBody, amount: '0' }, 400],
      [{ ...intentBody, amount: '1.5' }, 400],
      [{ ...intentBody, chainId: 1 }, 400],
      [{ ...intentBody, target: '0x00000000000000000000000000000000000000ee' }, 400],
    ])('rejects %j', async (body, status) => {
      const s = await login();
      const response = await as(s).post('/intents', body);
      expect(response.status).toBe(status);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an amount above the fundable balance before any authorization', async () => {
      const s = await login();
      gateway.balances.set(s.address, 100_000_000n);
      const response = await as(s).post('/intents', intentBody);
      expect(response.status).toBe(422);
      expect(response.body.error).toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
      expect(response.body.error.recovery).toMatch(/faucet/);
    });

    it('rejects oversized bodies', async () => {
      const s = await login();
      const response = await as(s).post('/intents', {
        ...intentBody,
        objective: 'x'.repeat(20_000),
      });
      expect(response.status).toBe(413);
    });
  });

  describe('clarification → draft → approval', () => {
    /** A signed-in owner with a registered executor and an intent ready for a draft. */
    async function readyForDraft() {
      const s = await login();
      gateway.executors.set(s.address, randomAddress());
      expect((await as(s).post('/executors/register')).status).toBe(200);
      const created = await as(s).post('/intents', intentBody);
      await as(s).post(`/intents/${created.body.id}/answers`, {
        questionId: created.body.question.questionId,
        alternativeId: 'no_lockup',
      });
      return { s, intentId: created.body.id as string };
    }

    it('lets the owner name their own agent, marks it in the preview and keeps it across edits', async () => {
      const { s, intentId } = await readyForDraft();
      const agent = randomAddress();
      const own = await as(s).post(`/intents/${intentId}/mandate-drafts`, { operator: agent });
      expect(own.status).toBe(201);
      expect(own.body.tuple.operator).toBe(agent);
      expect(own.body.preview.operatorSource).toBe('OWNER');
      expect(own.body.preview.notices[0]).toMatch(/You chose the agent/);
      const edited = await as(s).patch(`/mandate-drafts/${own.body.id}`, { expiryDays: 6 });
      expect(edited.body.tuple.operator).toBe(agent);
      expect(edited.body.preview.operatorSource).toBe('OWNER');
      const back = await as(s).patch(`/mandate-drafts/${edited.body.id}`, {
        operator: gateway.operator,
      });
      expect(back.body.tuple.operator).toBe(gateway.operator);
      expect(back.body.preview.operatorSource).toBeUndefined();

      for (const operator of [
        gateway.manifest.riskAdmin,
        gateway.manifest.liquidVault,
        s.address,
      ]) {
        const refused = await as(s).post(`/intents/${intentId}/mandate-drafts`, { operator });
        expect(refused.status).toBe(400);
        expect(refused.body.error.code).toBe('VALIDATION_FAILED');
      }
      const executor = gateway.executors.get(s.address)!;
      const asExecutor = await as(s).post(`/intents/${intentId}/mandate-drafts`, {
        operator: executor,
      });
      expect(asExecutor.body.error.message).toBe('Invalid mandate: OPERATOR_IS_EXECUTOR');
    });

    it('needs the owner’s own agent when the deployment runs no Boundra agent', async () => {
      const { s, intentId } = await readyForDraft();
      gateway.boundraAgent = false;
      try {
        expect((await http().get('/api/v1/config/public')).body).toMatchObject({
          configured: true,
          operator: null,
        });
        const missing = await as(s).post(`/intents/${intentId}/mandate-drafts`);
        expect(missing.status).toBe(400);
        expect(missing.body.error.message).toMatch(/runs no Boundra agent/);
        const agent = randomAddress();
        const own = await as(s).post(`/intents/${intentId}/mandate-drafts`, { operator: agent });
        expect(own.status).toBe(201);
        expect(own.body.preview.operatorSource).toBe('OWNER');
      } finally {
        gateway.boundraAgent = true;
      }
    });

    it('persona A: one question, LiquidVault draft, stale and superseded approvals rejected', async () => {
      const s = await login();
      const created = await as(s).post('/intents', intentBody);
      expect(created.body).toMatchObject({
        state: 'CLARIFYING',
        question: { dimension: 'max_lockup_seconds' },
      });
      expect(created.body.question.alternatives.map((a: { id: string }) => a.id)).toEqual([
        'no_lockup',
        'up_to_30_days',
        'unsure',
      ]);
      const id = created.body.id;
      const answered = await as(s).post(`/intents/${id}/answers`, {
        questionId: created.body.question.questionId,
        alternativeId: 'no_lockup',
      });
      expect(answered.body).toMatchObject({
        state: 'MANDATE_PENDING',
        question: null,
        selection: { action: 'DEPOSIT', vault: 'LIQUID' },
      });

      const noExecutor = await as(s).post(`/intents/${id}/mandate-drafts`);
      expect(noExecutor.body.error.code).toBe('EXECUTOR_NOT_REGISTERED');
      expect((await as(s).post('/executors/register')).body.error.code).toBe(
        'EXECUTOR_NOT_REGISTERED',
      );
      gateway.executors.set(s.address, randomAddress());
      expect((await as(s).post('/executors/register')).status).toBe(200);

      const first = await as(s).post(`/intents/${id}/mandate-drafts`);
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ revision: 1, status: 'PREVIEWED' });
      expect(first.body.tuple).toMatchObject({
        allowedVaults: 1,
        maxLockupSeconds: '0',
        beneficiary: s.address,
        operator: gateway.operator,
      });
      const stale = await as(s).post(`/mandate-drafts/${first.body.id}/approve`, {
        previewHash: `0x${'0'.repeat(64)}`,
      });
      expect(stale.body.error.code).toBe('STALE_PREVIEW');

      const second = await as(s).patch(`/mandate-drafts/${first.body.id}`, { expiryDays: 6 });
      expect(second.body.revision).toBe(2);
      expect(second.body.previewHash).not.toBe(first.body.previewHash);
      const superseded = await as(s).post(`/mandate-drafts/${first.body.id}/approve`, {
        previewHash: first.body.previewHash,
      });
      expect(superseded.body.error.code).toBe('INVALID_STATE');

      const approved = await as(s).post(`/mandate-drafts/${second.body.id}/approve`, {
        previewHash: second.body.previewHash,
      });
      expect(approved.status).toBe(200);
      expect(approved.body.status).toBe('APPROVED');
      expect(approved.body.mandateHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(approved.body.ownerTransactions.setMandate.args[0]).toEqual(second.body.tuple);
      expect(approved.body.ownerTransactions.fund.args).toEqual(['300000000']);

      const check = await as(s).post(`/mandate-drafts/${second.body.id}/authorization-check`, {
        txHash: `0x${'a'.repeat(64)}`,
      });
      expect(check.status).toBe(202);
      expect(
        await db.job.count({
          where: { key: { startsWith: `verify-authorization:${second.body.id}:` } },
        }),
      ).toBe(1);
      const after = await as(s).get(`/mandate-drafts/${second.body.id}`);
      expect(after.body.status).toBe('APPROVED');

      const activity = await as(s).get('/activity');
      expect(activity.body.items.map((i: { type: string }) => i.type)).toEqual([
        'AUTHORIZATION_CHECK_REQUESTED',
        'MANDATE_APPROVED',
        'MANDATE_PREVIEWED',
        'MANDATE_PREVIEWED',
        'QUESTION_ANSWERED',
        'INTENT_CREATED',
      ]);
      expect(
        activity.body.items.filter((i: { txHash: string | null }) => i.txHash !== null).length,
      ).toBe(1);
    });

    it('persona B: accepting a lockup leads to the liquidity question and a TimedVault draft', async () => {
      const s = await login();
      gateway.executors.set(s.address, randomAddress());
      await as(s).post('/executors/register');
      const created = await as(s).post('/intents', intentBody);
      const second = await as(s).post(`/intents/${created.body.id}/answers`, {
        questionId: created.body.question.questionId,
        alternativeId: 'up_to_30_days',
      });
      expect(second.body.question.dimension).toBe('withdrawal_latency_seconds');
      const done = await as(s).post(`/intents/${created.body.id}/answers`, {
        questionId: second.body.question.questionId,
        alternativeId: 'not_for_30_days',
      });
      expect(done.body.selection).toMatchObject({ vault: 'TIMED' });
      const draft = await as(s).post(`/intents/${created.body.id}/mandate-drafts`);
      expect(draft.body.tuple).toMatchObject({ allowedVaults: 2, maxLockupSeconds: '2592000' });
      const tooShort = await as(s).post(`/intents/${created.body.id}/mandate-drafts`, {
        expiryDays: 7,
      });
      expect(tooShort.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('answers are validated and concurrent answers cannot both apply', async () => {
      const s = await login();
      const created = await as(s).post('/intents', intentBody);
      const path = `/intents/${created.body.id}/answers`;
      const qid = created.body.question.questionId;
      expect((await as(s).post(path, { questionId: qid, alternativeId: 'forever' })).status).toBe(
        400,
      );
      expect(
        (await as(s).post(path, { questionId: 'stale', alternativeId: 'no_lockup' })).body.error
          .code,
      ).toBe('QUESTION_NOT_ACTIVE');
      const results = await Promise.all([
        as(s).post(path, { questionId: qid, alternativeId: 'up_to_30_days' }),
        as(s).post(path, { questionId: qid, alternativeId: 'no_lockup' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const records = await db.preferenceRecord.count({ where: { intentId: created.body.id } });
      expect(records).toBe(1);
    });
  });

  describe('admin and public configuration', () => {
    it('restricts the demo reset to admin wallets and keeps history', async () => {
      const user = await login();
      const created = await as(user).post('/intents', intentBody);
      const denied = await as(user).post('/admin/demo/reset', { ownerAddress: user.address });
      expect(denied.status).toBe(403);
      const root = await login(admin);
      expect((await as(root).get('/auth/session')).body.admin).toBe(true);
      // Admin actions need the admin's browser session, not an API token.
      const challenge = await http()
        .post('/api/v1/auth/challenge')
        .send({ address: admin.address, client: 'token' });
      const { token } = (
        await http()
          .post('/api/v1/auth/verify')
          .send({
            message: challenge.body.message,
            signature: await admin.signMessage({ message: challenge.body.message }),
          })
      ).body;
      const viaToken = await http()
        .post('/api/v1/admin/demo/reset')
        .set('Authorization', `Bearer ${token}`)
        .send({ ownerAddress: user.address });
      expect(viaToken.status).toBe(403);
      const reset = await as(root).post('/admin/demo/reset', { ownerAddress: user.address });
      expect(reset.body).toEqual({ intents: 1, mandates: 0 });
      expect((await as(user).get(`/intents/${created.body.id}`)).body.state).toBe('REJECTED');
      const activity = await as(user).get('/activity');
      expect(activity.body.items[0].type).toBe('DEMO_RESET');
    });

    it('publishes reviewed configuration and reports an unconfigured chain honestly', async () => {
      const config = await http().get('/api/v1/config/public');
      expect(config.body).toMatchObject({
        chainId: 84532,
        configured: true,
        operator: gateway.operator,
      });
      expect(
        config.body.vaults.map((v: { illustrativeYieldBps: number }) => v.illustrativeYieldBps),
      ).toEqual([300, 600]);
      gateway.configured = false;
      try {
        expect((await http().get('/api/v1/config/public')).body.configured).toBe(false);
        const s = await login();
        const dashboard = await as(s).get('/dashboard');
        expect(dashboard.body.chainStatus).toBe('unconfigured');
      } finally {
        gateway.configured = true;
      }
    });
  });
});

describe('login rate limit', () => {
  it('limits challenge requests per client', async () => {
    const app = await startApp(
      { AUTH_RATE_LIMIT_PER_MINUTE: '3', RATE_LIMIT_PER_MINUTE: '10000', WEB_ORIGIN: ORIGIN },
      new FakeGateway(),
    );
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const response = await request(app.getHttpServer())
          .post('/api/v1/auth/challenge')
          .send({ address: '0x00000000000000000000000000000000000000e1' });
        statuses.push(response.status);
        if (response.status === 429) expect(response.body.error.code).toBe('RATE_LIMITED');
      }
      expect(statuses).toEqual([201, 201, 201, 429]);
      // Other routes are not affected by the stricter login limit.
      expect((await request(app.getHttpServer()).get('/api/v1/config/public')).status).toBe(200);
    } finally {
      const db = createDatabaseClient(process.env.DATABASE_URL!);
      await db.authChallenge.deleteMany({
        where: { address: '0x00000000000000000000000000000000000000e1' },
      });
      await db.$disconnect();
      await app.close();
    }
  });
});

describe('malformed input', () => {
  it('answers malformed JSON with a 400 error envelope', async () => {
    const app = await startApp({ WEB_ORIGIN: ORIGIN }, new FakeGateway());
    try {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/challenge')
        .set('Content-Type', 'application/json')
        .send('{"address":');
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    } finally {
      await app.close();
    }
  });
});

describe('model wording through the provider port', () => {
  it('labels validated model wording and falls back with a recorded reason', async () => {
    const { LLM_PROVIDER } = await import('../src/intents/wording.provider');
    const gateway = new FakeGateway();
    const calls: string[] = [];
    const fakeLlm = {
      name: 'anthropic' as const,
      model: 'fake-model',
      async generate(request: { purpose: string; prompt: string }) {
        calls.push(request.purpose);
        const usage = { inputTokens: 10, outputTokens: 5 };
        if (request.purpose === 'acce-question-wording') {
          const { alternatives } = JSON.parse(request.prompt);
          return {
            ok: true as const,
            value: {
              text: 'Is it fine if these funds stay locked for 30 days for a higher illustrative yield?',
              alternatives,
            },
            usage,
            model: 'fake-model',
            latencyMs: 1,
          };
        }
        // An invented fact must never reach the owner.
        return {
          ok: true as const,
          value: { summary: 'Guaranteed 12% returns.' },
          usage,
          model: 'fake-model',
          latencyMs: 1,
        };
      },
    };
    Object.assign(process.env, { WEB_ORIGIN: ORIGIN, RATE_LIMIT_PER_MINUTE: '10000' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CHAIN_GATEWAY)
      .useValue(gateway)
      .overrideProvider(LLM_PROVIDER)
      .useValue(fakeLlm)
      .compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureApp(app, readConfig());
    await app.init();
    const db = createDatabaseClient(process.env.DATABASE_URL!);
    const account = newAccount();
    try {
      const challenge = await request(app.getHttpServer())
        .post('/api/v1/auth/challenge')
        .send({ address: account.address });
      const signature = await account.signMessage({ message: challenge.body.message });
      const verified = await request(app.getHttpServer())
        .post('/api/v1/auth/verify')
        .send({ message: challenge.body.message, signature });
      const cookie = String(verified.headers['set-cookie']).split(';')[0]!;
      const post = (path: string, body: object = {}) =>
        request(app.getHttpServer())
          .post(`/api/v1${path}`)
          .set('Cookie', cookie)
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', verified.body.csrfToken)
          .send(body);
      const created = await post('/intents', {
        objective: 'Manage 300 MockUSDC safely',
        amount: '300000000',
        chainId: 84532,
      });
      expect(created.body.question).toMatchObject({
        wordingSource: 'LLM',
        text: 'Is it fine if these funds stay locked for 30 days for a higher illustrative yield?',
      });
      expect(created.body.question.alternatives.map((a: { id: string }) => a.id)).toEqual([
        'no_lockup',
        'up_to_30_days',
        'unsure',
      ]);
      await post(`/intents/${created.body.id}/answers`, {
        questionId: created.body.question.questionId,
        alternativeId: 'no_lockup',
      });
      gateway.executors.set(account.address.toLowerCase(), randomAddress());
      await post('/executors/register');
      const draft = await post(`/intents/${created.body.id}/mandate-drafts`);
      expect(draft.body.preview.plainSummary.source).toBe('TEMPLATE');
      expect(draft.body.preview.plainSummary.text).not.toMatch(/12%/);
      const previewed = await db.activityEvent.findFirstOrThrow({
        where: { mandateId: draft.body.id, type: 'MANDATE_PREVIEWED' },
      });
      expect(previewed.payload).toMatchObject({
        summary: { source: 'TEMPLATE', fallbackReason: 'GUARANTEE_CLAIM' },
      });
      expect(calls).toEqual(['acce-question-wording', 'mandate-summary']);
    } finally {
      const ownerRow = await db.walletIdentity.findUnique({
        where: { address: account.address.toLowerCase() },
      });
      if (ownerRow) {
        await db.activityEvent.deleteMany({ where: { ownerId: ownerRow.id } });
        await db.mandate.deleteMany({ where: { ownerId: ownerRow.id } });
        await db.question.deleteMany({ where: { intent: { ownerId: ownerRow.id } } });
        await db.preferenceRecord.deleteMany({ where: { intent: { ownerId: ownerRow.id } } });
        await db.intent.deleteMany({ where: { ownerId: ownerRow.id } });
        await db.executor.deleteMany({ where: { ownerId: ownerRow.id } });
        await db.authSession.deleteMany({ where: { ownerId: ownerRow.id } });
        await db.walletIdentity.delete({ where: { id: ownerRow.id } });
      }
      await db.authChallenge.deleteMany({ where: { address: account.address.toLowerCase() } });
      await db.$disconnect();
      await app.close();
    }
  });
});
