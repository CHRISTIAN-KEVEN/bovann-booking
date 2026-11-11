import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { SELLER_CSRF_HEADER } from '@bovann/shared';
import type { Request } from 'express';
import { ApiError } from '../common/errors';
import { SellerAuthService, type SellerPrincipal } from './seller-auth.service';

export const SELLER_SESSION_COOKIE = 'bovann_seller_session';

type SellerRequest = Request & { seller?: SellerPrincipal };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Refuses a state-changing request without the seller CSRF header (see AdminAuthGuard). */
export function requireSellerCsrfHeader(req: Request): void {
  if (!SAFE_METHODS.has(req.method) && !req.get(SELLER_CSRF_HEADER)) {
    throw new ApiError(
      HttpStatus.FORBIDDEN,
      'CSRF_HEADER_MISSING',
      'Requête refusée : rechargez la page et réessayez.',
    );
  }
}

/** The signed-in seller of the current request. */
export const CurrentSeller = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SellerPrincipal => {
    const seller = ctx.switchToHttp().getRequest<SellerRequest>().seller;
    if (!seller) throw new Error('CurrentSeller used on a route without SellerAuthGuard');
    return seller;
  },
);

/**
 * Seller routes: CSRF header on changes (custom header + CORS limited to our origins, cookie
 * SameSite=Lax), then a live session in the httpOnly cookie, for a seller who isn't blocked.
 */
@Injectable()
export class SellerAuthGuard implements CanActivate {
  constructor(private readonly auth: SellerAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SellerRequest>();
    requireSellerCsrfHeader(req);
    const token = (req.cookies as Record<string, string> | undefined)?.[SELLER_SESSION_COOKIE];
    const seller = token ? await this.auth.authenticate(token) : null;
    if (!seller) {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        'NOT_AUTHENTICATED',
        'Connectez-vous avec votre numéro pour continuer.',
      );
    }
    req.seller = seller;
    return true;
  }
}
