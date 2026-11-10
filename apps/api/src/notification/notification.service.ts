import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { AdminNotificationDto, NotificationSettingsDto } from '@bovann/shared';
import { sql, type Kysely } from 'kysely';
import { CLOCK, type Clock } from '../common/clock';
import { ApiError, notFound } from '../common/errors';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { describeSendError, isPermanentSendError, MAILER, type Mailer } from './mailer';
import type { NotificationPayload } from './payload';
import {
  renderEmail,
  renderTestEmail,
  TEMPLATE_LABELS_EN,
  TEMPLATE_LABELS_FR,
  type TemplateContext,
} from './templates';
import { currentLocale } from '../common/request-context';

/** Wait before each retry, in minutes: about 8 hours of attempts in total. */
export const RETRY_DELAYS_MIN = [1, 2, 5, 15, 30, 60, 120, 240];
export const MAX_ATTEMPTS = RETRY_DELAYS_MIN.length;
/** A notification stuck in SENDING this long (the API stopped mid-send) is picked up again. */
const STALE_SENDING_MS = 10 * 60_000;
const BATCH_SIZE = 20;

/**
 * Sends the emails queued in the outbox (t_notifications). Each email is
 * written in the same transaction as the booking change it reports, so none is
 * lost; this service delivers them, retries failures with growing delays, and
 * gives up after MAX_ATTEMPTS (visible in the admin, with a "Renvoyer" button).
 * Safe with several API instances: rows are claimed with SKIP LOCKED.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get context(): TemplateContext {
    return {
      webUrl: this.env.PUBLIC_WEB_URL.replace(/\/+$/, ''),
      contactPhone: this.env.STUDIO_CONTACT_PHONE,
    };
  }

  /** Sends what is due now. Returns how many were sent and how many failed this round. */
  async processDue(): Promise<{ sent: number; failed: number }> {
    if (!this.mailer.enabled) return { sent: 0, failed: 0 };
    const claimed = await this.claimBatch();
    let sent = 0;
    let failed = 0;
    for (const n of claimed) {
      try {
        const payload = (
          typeof n.payload === 'string' ? JSON.parse(n.payload) : n.payload
        ) as NotificationPayload;
        const email = renderEmail(n.template, payload, this.context);
        await this.mailer.send({ to: n.recipient, ...email });
        await this.db
          .updateTable('t_notifications')
          .set({ status: 'SENT', sent_at: this.clock.now(), last_error: null })
          .where('id', '=', n.id)
          .execute();
        sent += 1;
      } catch (error) {
        failed += 1;
        await this.recordFailure(n.id, n.attempts, error);
      }
    }
    return { sent, failed };
  }

  private async claimBatch() {
    const now = this.clock.now();
    return this.db.transaction().execute(async (trx) => {
      const rows = await trx
        .selectFrom('t_notifications')
        .select(['id', 'template', 'recipient', 'payload', 'attempts'])
        .where('channel', '=', 'EMAIL')
        .where((eb) =>
          eb.or([
            eb.and([eb('status', '=', 'PENDING'), eb('next_attempt_at', '<=', now)]),
            eb.and([
              eb('status', '=', 'SENDING'),
              // While SENDING, next_attempt_at holds the moment it was claimed.
              eb('next_attempt_at', '<', new Date(now.getTime() - STALE_SENDING_MS)),
            ]),
          ]),
        )
        .orderBy('id')
        .limit(BATCH_SIZE)
        .forUpdate()
        .skipLocked()
        .execute();
      if (rows.length === 0) return [];
      await trx
        .updateTable('t_notifications')
        .set({ status: 'SENDING', attempts: sql`attempts + 1`, next_attempt_at: now })
        .where(
          'id',
          'in',
          rows.map((r) => r.id),
        )
        .execute();
      return rows.map((r) => ({ ...r, attempts: r.attempts + 1 }));
    });
  }

  private async recordFailure(id: number, attempts: number, error: unknown): Promise<void> {
    const permanent = isPermanentSendError(error) || attempts >= MAX_ATTEMPTS;
    const message = describeSendError(error);
    const delay = RETRY_DELAYS_MIN[Math.min(attempts, RETRY_DELAYS_MIN.length) - 1]!;
    await this.db
      .updateTable('t_notifications')
      .set({
        status: permanent ? 'FAILED' : 'PENDING',
        last_error: message,
        next_attempt_at: new Date(this.clock.now().getTime() + delay * 60_000),
      })
      .where('id', '=', id)
      .execute();
    // The template and id are enough to investigate; recipients stay out of the logs.
    this.logger.warn(
      `Notification ${id} ${permanent ? 'failed for good' : `will be retried in ${delay} min`}: ${message}`,
    );
  }

  /** Puts a failed (or still pending) email back at the front of the queue. */
  async retry(id: number): Promise<void> {
    const row = await this.db
      .selectFrom('t_notifications')
      .select(['status'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound('NOTIFICATION_NOT_FOUND', 'Cet e-mail est introuvable.');
    if (row.status === 'SENT' || row.status === 'SENDING') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'NOTIFICATION_NOT_RETRYABLE',
        'Cet e-mail est déjà envoyé.',
      );
    }
    await this.db
      .updateTable('t_notifications')
      .set({ status: 'PENDING', attempts: 0, next_attempt_at: this.clock.now() })
      .where('id', '=', id)
      .execute();
  }

  async forBooking(bookingId: number): Promise<AdminNotificationDto[]> {
    const rows = await this.db
      .selectFrom('t_notifications')
      .select([
        'id',
        'template',
        'recipient',
        'status',
        'attempts',
        'sent_at',
        'last_error',
        'created_at',
      ])
      .where('booking_id', '=', bookingId)
      .orderBy('id')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      template: r.template,
      label:
        (currentLocale() === 'en' ? TEMPLATE_LABELS_EN : TEMPLATE_LABELS_FR)[r.template] ??
        r.template,
      recipient: r.recipient,
      status: r.status,
      attempts: r.attempts,
      sentAt: r.sent_at?.toISOString() ?? null,
      lastError: r.last_error,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async settings(): Promise<NotificationSettingsDto> {
    const counts = await this.db
      .selectFrom('t_notifications')
      .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
      .where('status', 'in', ['PENDING', 'FAILED'])
      .groupBy('status')
      .execute();
    const count = (s: string) => Number(counts.find((c) => c.status === s)?.n ?? 0);
    return {
      enabled: this.mailer.enabled,
      from: this.mailer.from,
      pending: count('PENDING'),
      failed: count('FAILED'),
    };
  }

  /** Sends a test email now (not through the queue) and reports the provider's answer. */
  async sendTest(to: string): Promise<void> {
    if (!this.mailer.enabled) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'EMAIL_DISABLED',
        'L’envoi des e-mails n’est pas encore configuré sur le serveur.',
      );
    }
    try {
      await this.mailer.send({ to, ...renderTestEmail(to, this.context) });
    } catch (error) {
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'EMAIL_SEND_FAILED', {
        fr: `L’e-mail de test n’a pas pu partir. Réponse du serveur d’envoi : ${describeSendError(error)}`,
        en: `The test email couldn’t be sent. The sending server answered: ${describeSendError(error)}`,
      });
    }
  }
}
