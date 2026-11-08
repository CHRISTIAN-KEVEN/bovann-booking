import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { ApiError } from '../common/errors';
import { DB } from '../database/database.module';
import type { BookingPolicy, Database } from '../database/schema';

/**
 * Reasons a booking ends without payment that count as an "unpaid hold" for
 * the anti-abuse rules. A provider failure on our side (PAYMENT_INIT_FAILED)
 * never penalises the customer.
 */
export const UNPAID_CANCEL_REASONS = [
  'SUPERSEDED',
  'CUSTOMER_CANCELLED',
  'PAYMENT_FAILED',
] as const;

/**
 * Anti-abuse rules approved on 2026-11-08 (limits editable in t_booking_policy):
 * 1. One active unpaid hold per phone number (enforced by the hold service, which
 *    replaces the previous hold).
 * 2. At most N active unpaid holds per client connection (default 2).
 * 3. After N unpaid holds in a window (default 3 in 24 h), by phone OR connection,
 *    no new hold until the cooldown (default 24 h after the last one) has passed.
 */
@Injectable()
export class AbusePolicyService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async policy(): Promise<BookingPolicy> {
    return this.db
      .selectFrom('t_booking_policy')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
  }

  /** Throws a 429 with a French message when the client must wait. */
  async assertMayHold(params: {
    phone: string;
    fingerprint: string | null;
    now: Date;
  }): Promise<void> {
    const { phone, fingerprint, now } = params;
    const policy = await this.policy();

    // Rule 3: repeated unpaid holds → cooldown.
    // When the unpaid hold ended: cancellation time, or hold expiry for expired holds.
    // Both are set from the application clock, like every other booking time rule.
    const endedAt = sql<Date>`COALESCE(b.cancelled_at, b.hold_expires_at)`;
    const windowStart = new Date(now.getTime() - policy.unpaid_window_hours * 3_600_000);
    const strikes = await this.db
      .selectFrom('t_bookings as b')
      .innerJoin('t_customers as c', 'c.id', 'b.customer_id')
      .select([sql<number>`COUNT(*)`.as('count'), sql<Date | null>`MAX(${endedAt})`.as('last')])
      .where(endedAt, '>=', windowStart)
      .where(endedAt, '<=', now)
      .where('b.confirmed_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('b.status', '=', 'EXPIRED'),
          eb.and([
            eb('b.status', '=', 'CANCELLED'),
            eb('b.cancel_reason', 'in', [...UNPAID_CANCEL_REASONS]),
          ]),
        ]),
      )
      .where((eb) =>
        fingerprint
          ? eb.or([eb('c.phone_e164', '=', phone), eb('b.client_fingerprint', '=', fingerprint)])
          : eb('c.phone_e164', '=', phone),
      )
      .executeTakeFirstOrThrow();

    if (Number(strikes.count) >= policy.unpaid_hold_limit && strikes.last) {
      const blockedUntil = new Date(
        new Date(strikes.last).getTime() + policy.cooldown_hours * 3_600_000,
      );
      if (now < blockedUntil) {
        const hours = Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 3_600_000));
        throw new ApiError(
          HttpStatus.TOO_MANY_REQUESTS,
          'TOO_MANY_UNPAID_HOLDS',
          `Plusieurs réservations récentes n’ont pas été payées. Vous pourrez réserver à nouveau dans environ ${hours} h.`,
          { retryAfterSeconds: Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000) },
        );
      }
    }

    // Rule 2: active holds from the same connection (other phone numbers; the
    // same phone's hold is replaced, so it does not count).
    if (fingerprint) {
      const active = await this.db
        .selectFrom('t_bookings as b')
        .innerJoin('t_customers as c', 'c.id', 'b.customer_id')
        .select(sql<number>`COUNT(*)`.as('count'))
        .where('b.client_fingerprint', '=', fingerprint)
        .where('b.status', '=', 'PENDING_PAYMENT')
        .where('b.hold_expires_at', '>', now)
        .where('c.phone_e164', '!=', phone)
        .executeTakeFirstOrThrow();
      if (Number(active.count) >= policy.max_active_holds_per_client) {
        throw new ApiError(
          HttpStatus.TOO_MANY_REQUESTS,
          'TOO_MANY_ACTIVE_HOLDS',
          'Trop de réservations sont en attente de paiement depuis cette connexion. Finalisez-en une ou réessayez dans quelques minutes.',
        );
      }
    }
  }
}
