import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_CSRF_HEADER, type AdminRole } from '@bovann/shared';
import type { Request } from 'express';
import { ApiError } from '../../common/errors';
import { AdminAuthService, type AdminPrincipal } from './admin-auth.service';

export const ADMIN_SESSION_COOKIE = 'bovann_admin_session';

const PUBLIC_KEY = 'admin:public';
const ROLES_KEY = 'admin:roles';
const PASSWORD_CHANGE_KEY = 'admin:allow-pending-password-change';

/** Reachable without a session (sign-in). The CSRF header is still required. */
export const AdminPublic = () => SetMetadata(PUBLIC_KEY, true);
/** Restricts an endpoint to the given roles (default: any signed-in admin). */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);
/** Still reachable while the admin must replace a temporary password. */
export const AllowPendingPasswordChange = () => SetMetadata(PASSWORD_CHANGE_KEY, true);

type AdminRequest = Request & { admin?: AdminPrincipal };

/** The signed-in admin of the current request. */
export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminPrincipal => {
    const admin = ctx.switchToHttp().getRequest<AdminRequest>().admin;
    if (!admin) throw new Error('CurrentAdmin used on a route without AdminAuthGuard');
    return admin;
  },
);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Protects every /admin route:
 * 1. CSRF: state-changing requests must carry the X-Bovann-Admin header. A
 *    page on another site can't add custom headers to a cross-site request
 *    without passing CORS, which only allows our own web origins. The cookie
 *    is also SameSite=Lax.
 * 2. Session: the httpOnly cookie must match a live session of an active admin.
 * 3. Temporary password: everything except "me", logout and password change is
 *    refused until it is replaced.
 * 4. Role: OWNER-only endpoints refuse STAFF.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const targets = [context.getHandler(), context.getClass()];

    if (!SAFE_METHODS.has(req.method) && !req.get(ADMIN_CSRF_HEADER)) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'CSRF_HEADER_MISSING',
        'Requête refusée : rechargez la page et réessayez.',
      );
    }
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const token = (req.cookies as Record<string, string> | undefined)?.[ADMIN_SESSION_COOKIE];
    const admin = token ? await this.auth.authenticate(token) : null;
    if (!admin) {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'NOT_AUTHENTICATED',
        'Votre session a expiré. Connectez-vous à nouveau.',
      );
    }
    req.admin = admin;

    if (
      admin.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(PASSWORD_CHANGE_KEY, targets)
    ) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'PASSWORD_CHANGE_REQUIRED',
        'Choisissez votre propre mot de passe pour continuer.',
      );
    }

    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(admin.role)) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN_ROLE',
        'Cette action est réservée aux administrateurs.',
      );
    }
    return true;
  }
}
