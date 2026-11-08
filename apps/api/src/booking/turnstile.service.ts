import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../common/errors';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Optional Cloudflare Turnstile bot check on the "Payer" step, invisible for
 * most real customers. Active only when TURNSTILE_SECRET_KEY is configured.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled(): boolean {
    return Boolean(this.env.TURNSTILE_SECRET_KEY);
  }

  async assertHuman(token: string | undefined, ip: string | undefined): Promise<void> {
    if (!this.enabled) return;
    if (!token) throw this.refused();
    try {
      const body = new URLSearchParams({ secret: this.env.TURNSTILE_SECRET_KEY!, response: token });
      if (ip) body.set('remoteip', ip);
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(5000),
      });
      const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
      if (!data.success) {
        this.logger.warn(`Turnstile refused: ${(data['error-codes'] ?? []).join(',')}`);
        throw this.refused();
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Cloudflare unreachable: fail closed (no hold) rather than let bots through.
      this.logger.error(`Turnstile verification failed: ${String(error)}`);
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'CAPTCHA_UNAVAILABLE',
        'La vérification de sécurité est momentanément indisponible. Réessayez dans un instant.',
      );
    }
  }

  private refused(): ApiError {
    return new ApiError(
      HttpStatus.BAD_REQUEST,
      'CAPTCHA_FAILED',
      'La vérification de sécurité a échoué. Rechargez la page et réessayez.',
    );
  }
}
