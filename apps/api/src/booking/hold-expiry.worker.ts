import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { BookingLifecycleService } from './booking-lifecycle.service';

/**
 * Frees the slots of unpaid holds shortly after they expire (every 30 s by
 * default). Availability already treats expired holds as free, so this job is
 * housekeeping, not a correctness requirement: a missed run causes no double
 * booking. Safe with several API instances (SKIP LOCKED).
 */
@Injectable()
export class HoldExpiryWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HoldExpiryWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly lifecycle: BookingLifecycleService,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.env.HOLD_EXPIRY_INTERVAL_SEC;
    if (seconds === 0) return;
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.lifecycle.expireDueHolds();
      if (expired > 0) this.logger.log(`Released ${expired} expired hold(s)`);
    } catch (error) {
      this.logger.error(`Hold expiry run failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
