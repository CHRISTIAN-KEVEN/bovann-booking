import { HttpStatus } from '@nestjs/common';
import type { Clock } from '../common/clock';
import { ApiError } from '../common/errors';

/**
 * Fixed window of requests per client connection, in memory (fine for one API instance;
 * move to the database or Redis if the API ever runs on several machines).
 */
export class ConnectionLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly clock: Clock,
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly error: () => ApiError,
  ) {}

  hit(key: string): void {
    const now = this.clock.now().getTime();
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
    }
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return;
    }
    window.count += 1;
    if (window.count > this.limit) throw this.error();
  }
}

export const tooManyFromConnection = () =>
  new ApiError(
    HttpStatus.TOO_MANY_REQUESTS,
    'TOO_MANY_REQUESTS',
    'Trop de demandes depuis cette connexion. Réessayez plus tard.',
  );
