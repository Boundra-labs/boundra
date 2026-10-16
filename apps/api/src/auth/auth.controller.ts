import { Body, Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { addressSchema } from '@boundra/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import {
  AuthThrottle,
  CurrentOwner,
  parse,
  Public,
  type AuthenticatedOwner,
} from '../common/request';
import { AuthService, SESSION_COOKIE, sessionCookie } from './auth.service';

const challengeSchema = z.object({ address: addressSchema }).strict();
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
  @ApiOperation({ summary: 'Issue a single-use SIWE (EIP-4361) challenge for an EOA' })
  @ApiBody({ schema: z.toJSONSchema(challengeSchema) as object })
  challenge(@Body() body: unknown) {
    return this.auth.createChallenge(parse(challengeSchema, body).address);
  }

  @Public()
  @Post('verify')
  @HttpCode(200)
  @AuthThrottle()
  @ApiOperation({
    summary: 'Verify a signed challenge and start a session (not a mandate approval)',
  })
  @ApiBody({ schema: z.toJSONSchema(verifySchema) as object })
  async verify(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = parse(verifySchema, body);
    const grant = await this.auth.verify(input.message, input.signature as `0x${string}`);
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
  @ApiOperation({ summary: 'Current session and its CSRF token' })
  session(@CurrentOwner() owner: AuthenticatedOwner) {
    return {
      address: owner.address,
      csrfToken: this.auth.csrfFor(owner.sessionId),
      admin: this.auth.isAdmin(owner.address),
    };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth(SESSION_COOKIE)
  async logout(
    @CurrentOwner() owner: AuthenticatedOwner,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.revoke(owner.sessionId);
    response.setHeader('Set-Cookie', sessionCookie('', 0));
  }
}
