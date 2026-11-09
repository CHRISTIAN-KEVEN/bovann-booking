import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { MAILER, SmtpMailer, type Mailer } from './mailer';
import { NotificationService } from './notification.service';

/** Sends queued emails every NOTIFICATION_INTERVAL_SEC (15 s by default). */
@Injectable()
export class NotificationWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly notifications: NotificationService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.mailer.enabled) {
      this.logger.warn('Email sending is disabled: notifications stay queued');
      return;
    }
    if (this.mailer instanceof SmtpMailer) void this.mailer.checkConnection();
    const seconds = this.env.NOTIFICATION_INTERVAL_SEC;
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
      const { sent, failed } = await this.notifications.processDue();
      if (sent || failed) this.logger.log(`Emails: ${sent} sent, ${failed} failed`);
    } catch (error) {
      this.logger.error(`Notification run failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
