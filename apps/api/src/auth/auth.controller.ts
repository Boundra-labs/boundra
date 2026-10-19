import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { addressSchema } from '@boundra/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { ApiError, notFound } from '../common/errors';
import {
  AuthThrottle,
  CurrentOwner,
  parse,
  Public,
  type AuthenticatedOwner,
} from '../common/request';
import { AuthService, SESSION_COOKIE, sessionCookie } from './auth.service';

const challengeSchema = z
  .object({ address: addressSchema, client: z.enum(['browser', 'token']).default('browser') })
  .strict();
/** API tokens are managed by the owner in the web app, never by another token. */
function browserOnly(owner: AuthenticatedOwner) {
  if (owner.kind !== 'COOKIE')
    throw new ApiError(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'API tokens are managed in the Boundra app',
      'Open the app, sign in with your wallet and use “Connect an app or AI assistant”.',
    );
}

const verifySchema = z
  .object({
    message: z.string().min(1).max(2000),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  })
  .strict();

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('challenge')
  @AuthThrottle()
  @ApiOperation({
    summary:
      'Issue a single-use SIWE (EIP-4361) challenge for an EOA; client "token" is for SDK and MCP clients',
  })
  @ApiBody({ schema: z.toJSONSchema(challengeSchema, { io: 'input' }) as object })
  challenge(@Body() body: unknown) {
    const input = parse(challengeSchema, body);
    return this.auth.createChallenge(input.address, input.client);
  }

  @Public()
  @Post('verify')
  @HttpCode(200)
  @AuthThrottle()
  @ApiOperation({
    summary:
      'Verify a signed challenge and start a session (not a mandate approval): a cookie, or an API token for a "token" challenge',
  })
  @ApiBody({ schema: z.toJSONSchema(verifySchema) as object })
  async verify(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = parse(verifySchema, body);
    const grant = await this.auth.verify(input.message, input.signature as `0x${string}`);
    if (grant.kind === 'TOKEN')
      return {
        address: grant.address,
        token: grant.token,
        expiresAt: grant.expiresAt.toISOString(),
      };
    response.setHeader(
      'Set-Cookie',
      sessionCookie(grant.token, this.config.SESSION_TTL_HOURS * 3600),
    );
    return {
      address: grant.address,
      csrfToken: grant.csrfToken,
      expiresAt: grant.expiresAt.toISOString(),
    };
  }

  @Get('session')
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current session and, for the web app, its CSRF token' })
  session(@CurrentOwner() owner: AuthenticatedOwner) {
    const browser = owner.kind === 'COOKIE';
    return {
      address: owner.address,
      kind: browser ? 'browser' : 'token',
      csrfToken: browser ? this.auth.csrfFor(owner.sessionId) : null,
      admin: browser && this.auth.isAdmin(owner.address),
    };
  }

  @Get('tokens')
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiOperation({ summary: 'Live API tokens this owner gave to apps and AI assistants (web app)' })
  async tokens(@CurrentOwner() owner: AuthenticatedOwner) {
    browserOnly(owner);
    const items = await this.auth.listTokens(owner.id);
    return {
      items: items.map((t) => ({
        id: t.id,
        createdAt: t.createdAt.toISOString(),
        expiresAt: t.expiresAt.toISOString(),
        lastSeenAt: t.lastSeenAt.toISOString(),
      })),
    };
  }

  @Post('tokens/:id/revoke')
  @HttpCode(204)
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiOperation({ summary: 'Revoke one of your API tokens at once (web app)' })
  async revokeToken(@CurrentOwner() owner: AuthenticatedOwner, @Param('id') id: string) {
    browserOnly(owner);
    if (!(await this.auth.revokeToken(owner.id, id))) throw notFound('API token');
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End this session, or revoke this API token' })
  async logout(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.revoke(owner.sessionId);
    if (owner.kind === 'COOKIE') response.setHeader('Set-Cookie', sessionCookie('', 0));
  }
}
