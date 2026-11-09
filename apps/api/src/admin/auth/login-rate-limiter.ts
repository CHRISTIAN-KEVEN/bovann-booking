import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { ApiError } from '../../common/errors';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';

const WINDOW_MS = 60_000;

/**
 * Fixed one-minute window of sign-in attempts per client IP, in memory.
 * Complements the per-account lockout: it slows down someone trying many
 * accounts from one connection. In memory is enough for one API instance;
 * move to the database or Redis if the API ever runs on several machines.
 */
@Injectable()
export class LoginRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  hit(ip: string): void {
    const now = this.clock.now().getTime();
    if (this.windows.size > 10_000) this.prune(now);
    const window = this.windows.get(ip);
    if (!window || now - window.start >= WINDOW_MS) {
      this.windows.set(ip, { start: now, count: 1 });
      return;
    }
    window.count += 1;
    if (window.count > this.env.ADMIN_LOGIN_RATE_LIMIT_PER_MIN) {
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        'TOO_MANY_LOGIN_ATTEMPTS',
        'Trop de tentatives de connexion. Patientez une minute avant de réessayer.',
      );
    }
  }

  private prune(now: number): void {
    for (const [ip, window] of this.windows) {
      if (now - window.start >= WINDOW_MS) this.windows.delete(ip);
    }
  }
}
