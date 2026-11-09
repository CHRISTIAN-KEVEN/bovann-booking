import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { AdminMe } from '@bovann/shared';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { parseOrThrow } from '../../common/errors';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import {
  ADMIN_SESSION_COOKIE,
  AdminAuthGuard,
  AdminPublic,
  AllowPendingPasswordChange,
  CurrentAdmin,
} from './admin-auth.guard';
import { AdminAuthService, type AdminPrincipal } from './admin-auth.service';
import { LoginRateLimiter } from './login-rate-limiter';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Indiquez votre adresse e-mail.').max(254),
  password: z.string().min(1, 'Indiquez votre mot de passe.').max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Indiquez votre mot de passe actuel.').max(200),
  newPassword: z.string().max(200),
});

@Controller('admin/auth')
@UseGuards(AdminAuthGuard)
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly limiter: LoginRateLimiter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('login')
  @AdminPublic()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminMe> {
    this.limiter.hit(req.ip ?? 'unknown');
    const input = parseOrThrow(loginSchema, body);
    const session = await this.auth.login(input.email, input.password, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.cookie(ADMIN_SESSION_COOKIE, session.token, {
      ...this.cookieOptions(),
      expires: session.expiresAt,
    });
    return session.me;
  }

  @Post('logout')
  @AllowPendingPasswordChange()
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentAdmin() admin: AdminPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(admin.sessionId);
    res.clearCookie(ADMIN_SESSION_COOKIE, this.cookieOptions());
  }

  @Get('me')
  @AllowPendingPasswordChange()
  me(@CurrentAdmin() admin: AdminPrincipal): AdminMe {
    return {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      role: admin.role,
      mustChangePassword: admin.mustChangePassword,
    };
  }

  @Post('password')
  @AllowPendingPasswordChange()
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentAdmin() admin: AdminPrincipal, @Body() body: unknown): Promise<AdminMe> {
    const input = parseOrThrow(changePasswordSchema, body);
    return this.auth.changePassword(admin, input.currentPassword, input.newPassword);
  }

  /**
   * httpOnly: page scripts can't read the token (limits the damage of an XSS).
   * SameSite=Lax: not sent on cross-site sub-requests. Secure in production.
   */
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.ADMIN_COOKIE_SECURE ?? this.env.NODE_ENV === 'production',
      path: '/',
    };
  }
}
