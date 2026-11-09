import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { SESSION_MODE_LABELS_FR } from '@bovann/shared';
import type { Kysely, Transaction } from 'kysely';
import { utcToLocalDate, utcToLocalTime } from '../availability/domain/time';
import { CLOCK, type Clock } from '../common/clock';
import { ApiError } from '../common/errors';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { inTransaction, releaseSlots } from './booking-tx';

export type ConfirmOutcome = 'CONFIRMED' | 'ALREADY_CONFIRMED' | 'LATE_PAYMENT_REFUND_REQUIRED';

/**
 * State transitions of a booking after its hold was created.
 *
 *   PENDING_PAYMENT ──paid──────────────▶ CONFIRMED   (owner emails queued, same transaction)
 *        │ ├─ customer cancels ────────▶ CANCELLED   (slots freed immediately)
 *        │ ├─ payment fails ───────────▶ CANCELLED   (slots freed immediately)
 *        │ └─ hold expires (5 min) ────▶ EXPIRED     (slots freed by the expiry job)
 *   EXPIRED ──paid late, slots still free──▶ CONFIRMED
 *   EXPIRED/CANCELLED ──paid late, slots taken──▶ unchanged + refund flagged to owners
 *
 * Every transition is idempotent: replaying a provider notification is harmless.
 */
@Injectable()
export class BookingLifecycleService {
  private readonly logger = new Logger(BookingLifecycleService.name);

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The customer abandons before paying: slots are freed at once. */
  async cancelByCustomer(bookingId: number): Promise<void> {
    const now = this.clock.now();
    await inTransaction(this.db, async (trx) => {
      const booking = await trx
        .selectFrom('t_bookings')
        .select(['status'])
        .where('id', '=', bookingId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') return;
      if (booking.status !== 'PENDING_PAYMENT') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'BOOKING_NOT_CANCELLABLE',
          'Cette réservation est déjà confirmée : contactez le studio pour toute modification.',
        );
      }
      await releaseSlots(trx, [bookingId]);
      await trx
        .updateTable('t_bookings')
        .set({ status: 'CANCELLED', cancel_reason: 'CUSTOMER_CANCELLED', cancelled_at: now })
        .where('id', '=', bookingId)
        .execute();
      await trx
        .updateTable('t_payments')
        .set({ status: 'CANCELLED' })
        .where('booking_id', '=', bookingId)
        .where('status', 'in', ['INITIATED', 'PENDING'])
        .execute();
      await audit(trx, 'CUSTOMER', null, 'BOOKING_CANCELLED_BY_CUSTOMER', bookingId);
    });
  }

  /**
   * Marks unpaid holds past their expiry as EXPIRED and frees their slots.
   * Safe to run concurrently (SKIP LOCKED) and repeatedly. Returns the count.
   * Their payment stays PENDING: a late success is still handled by confirmPayment.
   */
  async expireDueHolds(batchSize = 200): Promise<number> {
    const now = this.clock.now();
    return inTransaction(this.db, async (trx) => {
      const due = await trx
        .selectFrom('t_bookings')
        .select('id')
        .where('status', '=', 'PENDING_PAYMENT')
        .where('hold_expires_at', '<=', now)
        .orderBy('hold_expires_at')
        .limit(batchSize)
        .forUpdate()
        .skipLocked()
        .execute();
      const ids = due.map((d) => d.id);
      if (ids.length === 0) return 0;
      await releaseSlots(trx, ids);
      await trx
        .updateTable('t_bookings')
        .set({ status: 'EXPIRED' })
        .where('id', 'in', ids)
        .execute();
      await trx
        .insertInto('t_audit_log')
        .values(
          ids.map((id) => ({
            actor_type: 'SYSTEM' as const,
            action: 'BOOKING_HOLD_EXPIRED',
            entity: 'booking',
            entity_id: String(id),
          })),
        )
        .execute();
      return ids.length;
    });
  }

  /** The provider reports a successful payment. */
  async confirmPayment(paymentId: number, providerPayload?: unknown): Promise<ConfirmOutcome> {
    const now = this.clock.now();
    return inTransaction(this.db, async (trx) => {
      const payment = await trx
        .selectFrom('t_payments')
        .select(['id', 'booking_id', 'status'])
        .where('id', '=', paymentId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const booking = await trx
        .selectFrom('t_bookings')
        .select(['id', 'status', 'space_id'])
        .where('id', '=', payment.booking_id)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (payment.status === 'SUCCEEDED') {
        return booking.status === 'CONFIRMED'
          ? 'ALREADY_CONFIRMED'
          : 'LATE_PAYMENT_REFUND_REQUIRED';
      }

      await trx
        .updateTable('t_payments')
        .set({
          status: 'SUCCEEDED',
          succeeded_at: now,
          ...(providerPayload === undefined
            ? {}
            : { last_payload: JSON.stringify(providerPayload) }),
        })
        .where('id', '=', paymentId)
        .execute();

      let canConfirm = booking.status === 'PENDING_PAYMENT';
      if (booking.status === 'EXPIRED') {
        // Paid after the hold expired: take the slots back if nobody took them.
        const slots = await trx
          .selectFrom('t_booking_slots')
          .select('slot_start')
          .where('booking_id', '=', booking.id)
          .execute();
        try {
          await trx
            .insertInto('t_slot_occupancies')
            .values(
              slots.map((s) => ({
                space_id: booking.space_id,
                slot_start: s.slot_start,
                booking_id: booking.id,
              })),
            )
            .execute();
          canConfirm = true;
        } catch (error) {
          if ((error as { errno?: number }).errno !== 1062) throw error;
        }
      }

      if (!canConfirm) {
        // The money must go back: it appears in the admin's "refunds to handle".
        const paid = await trx
          .selectFrom('t_payments')
          .select('amount_xof')
          .where('id', '=', paymentId)
          .executeTakeFirstOrThrow();
        await trx
          .updateTable('t_bookings')
          .set({ refund_status: 'DUE', refund_amount_xof: paid.amount_xof })
          .where('id', '=', booking.id)
          .where('refund_status', '=', 'NONE')
          .execute();
        await audit(trx, 'PROVIDER', null, 'LATE_PAYMENT_REFUND_REQUIRED', booking.id);
        await this.queueOwnerNotifications(trx, booking.id, 'owner_late_payment_refund');
        this.logger.warn(
          `Booking ${booking.id}: payment succeeded after its slots were taken: refund required`,
        );
        return 'LATE_PAYMENT_REFUND_REQUIRED';
      }

      await trx
        .updateTable('t_bookings')
        .set((eb) => ({ status: 'CONFIRMED', confirmed_at: now, version: eb('version', '+', 1) }))
        .where('id', '=', booking.id)
        .execute();
      await audit(trx, 'PROVIDER', null, 'BOOKING_CONFIRMED', booking.id);
      await this.queueConfirmationNotifications(trx, booking.id);
      return 'CONFIRMED';
    });
  }

  /** The provider reports a failed or declined payment: the hold ends at once. */
  async failPayment(paymentId: number, reason: string): Promise<void> {
    const now = this.clock.now();
    await inTransaction(this.db, async (trx) => {
      const payment = await trx
        .selectFrom('t_payments')
        .select(['booking_id', 'status'])
        .where('id', '=', paymentId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (payment.status !== 'INITIATED' && payment.status !== 'PENDING') return;
      await trx
        .updateTable('t_payments')
        .set({ status: 'FAILED', failure_reason: reason.slice(0, 255) })
        .where('id', '=', paymentId)
        .execute();
      const booking = await trx
        .selectFrom('t_bookings')
        .select('status')
        .where('id', '=', payment.booking_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (booking.status !== 'PENDING_PAYMENT') return;
      await releaseSlots(trx, [payment.booking_id]);
      await trx
        .updateTable('t_bookings')
        .set({ status: 'CANCELLED', cancel_reason: 'PAYMENT_FAILED', cancelled_at: now })
        .where('id', '=', payment.booking_id)
        .execute();
      await audit(trx, 'PROVIDER', null, 'BOOKING_PAYMENT_FAILED', payment.booking_id);
    });
  }

  /**
   * The provider could not even start the payment (our side or theirs).
   * Slots are freed.
   */
  async failInitiation(paymentId: number): Promise<void> {
    const now = this.clock.now();
    await inTransaction(this.db, async (trx) => {
      const payment = await trx
        .selectFrom('t_payments')
        .select(['booking_id'])
        .where('id', '=', paymentId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('t_payments')
        .set({ status: 'FAILED', failure_reason: 'PROVIDER_UNAVAILABLE' })
        .where('id', '=', paymentId)
        .execute();
      await releaseSlots(trx, [payment.booking_id]);
      await trx
        .updateTable('t_bookings')
        .set({ status: 'CANCELLED', cancel_reason: 'PAYMENT_INIT_FAILED', cancelled_at: now })
        .where('id', '=', payment.booking_id)
        .where('status', '=', 'PENDING_PAYMENT')
        .execute();
    });
  }

  /**
   * Owner and customer confirmation emails, written to the outbox in the
   * caller's transaction (Phase 6's worker sends them). Used for online and
   * studio bookings alike.
   */
  async queueConfirmationNotifications(
    trx: Transaction<Database>,
    bookingId: number,
  ): Promise<void> {
    await this.queueOwnerNotifications(trx, bookingId, 'owner_booking_confirmed');
    await this.queueCustomerEmail(trx, bookingId, 'customer_booking_confirmed');
  }

  /** Tells the customer (if they gave an email) that the studio cancelled their booking. */
  async queueCancellationNotification(
    trx: Transaction<Database>,
    bookingId: number,
  ): Promise<void> {
    await this.queueCustomerEmail(trx, bookingId, 'customer_booking_cancelled');
  }

  /** Writes the owner emails to the outbox; Phase 6's worker sends them. */
  private async queueOwnerNotifications(
    trx: Transaction<Database>,
    bookingId: number,
    template: 'owner_booking_confirmed' | 'owner_late_payment_refund',
  ): Promise<void> {
    const payload = await notificationPayload(trx, bookingId);
    const recipients = await trx
      .selectFrom('t_space_owner_recipients')
      .select('email')
      .where('space_id', '=', payload.spaceId)
      .where('is_active', '=', true)
      .execute();
    if (recipients.length === 0) {
      this.logger.warn(
        `Space ${payload.spaceId} has no active owner recipient: ${template} not queued`,
      );
      return;
    }
    await trx
      .insertInto('t_notifications')
      .values(
        recipients.map((r) => ({
          booking_id: bookingId,
          channel: 'EMAIL' as const,
          template,
          recipient: r.email,
          payload: JSON.stringify(payload),
        })),
      )
      .onDuplicateKeyUpdate((eb) => ({ id: eb.ref('t_notifications.id') }))
      .execute();
  }

  private async queueCustomerEmail(
    trx: Transaction<Database>,
    bookingId: number,
    template: 'customer_booking_confirmed' | 'customer_booking_cancelled',
  ): Promise<void> {
    const payload = await notificationPayload(trx, bookingId);
    if (!payload.customer.email) return;
    await trx
      .insertInto('t_notifications')
      .values({
        booking_id: bookingId,
        channel: 'EMAIL',
        template,
        recipient: payload.customer.email,
        payload: JSON.stringify(payload),
      })
      .onDuplicateKeyUpdate((eb) => ({ id: eb.ref('t_notifications.id') }))
      .execute();
  }
}

/** Snapshot of everything an email needs, frozen at confirmation time. */
async function notificationPayload(trx: Transaction<Database>, bookingId: number) {
  const row = await trx
    .selectFrom('t_bookings as b')
    .innerJoin('t_customers as c', 'c.id', 'b.customer_id')
    .innerJoin('t_spaces as s', 's.id', 'b.space_id')
    .select([
      'b.reference',
      'b.mode',
      'b.starts_at',
      'b.ends_at',
      'b.package_name',
      'b.slot_count',
      'b.total_xof',
      'b.live_description',
      's.id as space_id',
      's.name as space_name',
      's.timezone',
      'c.full_name',
      'c.phone_e164',
      'c.email',
      'c.business_name',
      'c.business_sector',
    ])
    .where('b.id', '=', bookingId)
    .executeTakeFirstOrThrow();
  return {
    reference: row.reference,
    spaceId: row.space_id,
    spaceName: row.space_name,
    mode: row.mode,
    modeLabel: SESSION_MODE_LABELS_FR[row.mode],
    date: utcToLocalDate(row.starts_at, row.timezone),
    startTime: utcToLocalTime(row.starts_at, row.timezone),
    endTime: utcToLocalTime(row.ends_at, row.timezone),
    packageName: row.package_name,
    slotCount: row.slot_count,
    totalXof: row.total_xof,
    liveDescription: row.live_description,
    customer: {
      fullName: row.full_name,
      phone: row.phone_e164,
      email: row.email,
      businessName: row.business_name,
      businessSector: row.business_sector,
    },
  };
}

async function audit(
  trx: Transaction<Database>,
  actorType: 'CUSTOMER' | 'PROVIDER' | 'SYSTEM',
  actorId: number | null,
  action: string,
  bookingId: number,
): Promise<void> {
  await trx
    .insertInto('t_audit_log')
    .values({
      actor_type: actorType,
      actor_id: actorId,
      action,
      entity: 'booking',
      entity_id: String(bookingId),
    })
    .execute();
}
