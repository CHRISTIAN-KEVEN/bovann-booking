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
import { OTP_CHANNELS, OTP_LENGTH, type SellerCodeResponse, type SellerMe } from '@bovann/shared';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { CLOCK, type Clock } from '../common/clock';
import { parseOrThrow } from '../common/errors';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { ConnectionLimiter, tooManyFromConnection } from './connection-limiter';
import {
  CurrentSeller,
  requireSellerCsrfHeader,
  SELLER_SESSION_COOKIE,
  SellerAuthGuard,
} from './seller-auth.guard';
import { SellerAuthService, type SellerPrincipal } from './seller-auth.service';

const phone = z
  .string({ message: 'Indiquez votre numéro de téléphone.' })
  .transform((v) => v.replace(/[\s.-]/g, ''))
  .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/, 'Numéro de téléphone invalide.'));

const codeSchema = z
  .object({
    phone,
    channel: z.enum(OTP_CHANNELS, { message: 'Choisissez WhatsApp ou SMS.' }).default('WHATSAPP'),
  })
  .strict();

const verifySchema = z
  .object({
    phone,
    code: z
      .string({ message: 'Entrez le code reçu.' })
      .transform((v) => v.replace(/\s/g, ''))
      .pipe(z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), 'Le code a 6 chiffres.')),
  })
  .strict();

/** Seller sign-in with a code sent to the phone. */
@Controller('seller')
export class SellerAuthController {
  private readonly codeLimiter: ConnectionLimiter;
  private readonly verifyLimiter: ConnectionLimiter;

  constructor(
    private readonly auth: SellerAuthService,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) clock: Clock,
  ) {
    this.codeLimiter = new ConnectionLimiter(
      clock,
      env.OTP_RATE_LIMIT_PER_HOUR,
      3_600_000,
      tooManyFromConnection,
    );
    // Tries across many phones from one connection (each code also allows only 5).
    this.verifyLimiter = new ConnectionLimiter(clock, 30, 60_000, tooManyFromConnection);
  }

  /** Is seller sign-in open? (Closed until a WhatsApp/SMS provider is set up.) */
  @Get('auth/status')
  status(): { available: boolean } {
    return { available: this.auth.available };
  }

  @Post('auth/code')
  @HttpCode(HttpStatus.OK)
  code(@Body() body: unknown, @Req() req: Request): Promise<SellerCodeResponse> {
    requireSellerCsrfHeader(req);
    const input = parseOrThrow(codeSchema, body ?? {});
    this.codeLimiter.hit(req.ip ?? 'unknown');
    return this.auth.requestCode(input.phone, input.channel);
  }

  @Post('auth/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SellerMe> {
    requireSellerCsrfHeader(req);
    this.verifyLimiter.hit(req.ip ?? 'unknown');
    const input = parseOrThrow(verifySchema, body ?? {});
    const session = await this.auth.verify(input.phone, input.code, {
      userAgent: req.get('user-agent') ?? null,
    });
    res.cookie(SELLER_SESSION_COOKIE, session.token, {
      ...this.cookieOptions(),
      expires: session.expiresAt,
    });
    return session.me;
  }

  @Get('me')
  @UseGuards(SellerAuthGuard)
  me(@CurrentSeller() seller: SellerPrincipal): SellerMe {
    return { id: seller.id, phone: seller.phone };
  }

  @Post('auth/logout')
  @UseGuards(SellerAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentSeller() seller: SellerPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(seller.sessionId);
    res.clearCookie(SELLER_SESSION_COOKIE, this.cookieOptions());
  }

  /** httpOnly, SameSite=Lax, Secure in production (same as the admin cookie). */
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.ADMIN_COOKIE_SECURE ?? this.env.NODE_ENV === 'production',
      path: '/',
    };
  }
}
