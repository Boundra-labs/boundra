import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../config';
import { ApiError } from '../common/errors';
import { IS_ADMIN, IS_PUBLIC, type OwnerRequest } from '../common/request';
import { AuthService, readBearer, readCookie, SESSION_COOKIE } from './auth.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard (PRD §10.1): a valid session for every non-public route. Browser sessions use the
 * cookie, and their state changes also need an allowed Origin plus the session's CSRF token. SDK
 * and MCP clients send an API token as `Authorization: Bearer`; a browser never attaches it on its
 * own, so it needs no CSRF token. Admin routes need an admin wallet signed in through the web app.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const request = context.switchToHttp().getRequest<OwnerRequest>();
    const bearer = readBearer(request.headers.authorization);
    // A presented bearer token is never silently replaced by the cookie.
    const owner =
      bearer === undefined
        ? await this.auth.resolveSession(
            readCookie(request.headers.cookie, SESSION_COOKIE),
            'COOKIE',
          )
        : await this.auth.resolveSession(bearer, 'TOKEN');
    if (!owner)
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Sign in with your wallet first',
      );
    if (owner.kind === 'COOKIE' && !SAFE_METHODS.has(request.method)) {
      const origin = request.headers.origin;
      const csrf = request.headers['x-csrf-token'];
      if (
        origin !== new URL(this.config.WEB_ORIGIN).origin ||
        !this.auth.csrfMatches(owner.sessionId, typeof csrf === 'string' ? csrf : undefined)
      )
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          'CSRF_REJECTED',
          'Request origin or CSRF token rejected',
          'Reload the app and try again.',
        );
    }
    if (
      this.reflector.getAllAndOverride<boolean>(IS_ADMIN, targets) &&
      (owner.kind !== 'COOKIE' || !this.auth.isAdmin(owner.address))
    )
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Demo-admin access required');
    request.owner = owner;
    return true;
  }
}
