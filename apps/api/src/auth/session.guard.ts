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
import { AuthService, readCookie, SESSION_COOKIE } from './auth.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard (PRD §10.1): a valid session cookie for every non-public route, and for state
 * changes an allowed Origin plus the session's CSRF token. Admin routes also need an admin wallet.
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
    const owner = await this.auth.resolveSession(
      readCookie(request.headers.cookie, SESSION_COOKIE),
    );
    if (!owner)
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHENTICATED',
        'Sign in with your wallet first',
      );
    if (!SAFE_METHODS.has(request.method)) {
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
      !this.auth.isAdmin(owner.address)
    )
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Demo-admin access required');
    request.owner = owner;
    return true;
  }
}
