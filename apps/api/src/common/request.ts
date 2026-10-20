import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { z } from 'zod';

export type SessionKind = 'COOKIE' | 'TOKEN';

export interface AuthenticatedOwner {
  id: string;
  address: string;
  sessionId: string;
  /** COOKIE for the web app, TOKEN for an SDK or MCP client's bearer token. */
  kind: SessionKind;
}

export type OwnerRequest = Request & { owner?: AuthenticatedOwner };

export const IS_PUBLIC = 'boundra:isPublic';
/** Routes reachable without a session (health, public config, login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const AUTH_THROTTLE = 'boundra:authThrottle';
/** Applies the stricter login rate limit (AUTH_RATE_LIMIT_PER_MINUTE) in addition to the default. */
export const AuthThrottle = () => SetMetadata(AUTH_THROTTLE, true);

export const IS_ADMIN = 'boundra:isAdmin';
/** Routes restricted to demo-admin wallets (ADMIN_ADDRESSES). */
export const AdminOnly = () => SetMetadata(IS_ADMIN, true);

/** The authenticated owner from the session; never from the request body. */
export const CurrentOwner = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const owner = ctx.switchToHttp().getRequest<OwnerRequest>().owner;
  if (!owner) throw new Error('CurrentOwner used on a public route');
  return owner;
});

/** Parses with a Zod schema; failures become 400 VALIDATION_FAILED in the exception filter. */
export const parse = <T extends z.ZodType>(schema: T, value: unknown): z.infer<T> =>
  schema.parse(value);

export const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
