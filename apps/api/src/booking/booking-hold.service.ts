import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { CreateBookingRequest, CreateBookingResponse } from '@bovann/shared';
import type { Kysely } from 'kysely';
import { AvailabilityService } from '../availability/availability.service';
import { CatalogRepository } from '../availability/catalog.repository';
import { utcToLocalDate } from '../availability/domain/time';
import { CLOCK, type Clock } from '../common/clock';
import { ApiError, notFound } from '../common/errors';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../payment/payment-gateway';
import { inTransaction, isDuplicateOn, releaseSlots } from './booking-tx';
import { insertBooking, lockSlots, reclaimExpiredHolds, upsertCustomer } from './booking-writes';
import { BookingLifecycleService } from './booking-lifecycle.service';
import { BookingQueryService } from './booking-query.service';
import { generateAccessToken, paymentIdempotencyKey } from './domain/identifiers';
import { BookingRuleError, resolveSelection, slotUnavailable } from './domain/selection';

/**
 * Creates a booking hold when the customer presses "Payer":
 * validates the selection against live availability, then in ONE transaction saves the customer, replaces their previous
 * unpaid hold, reclaims expired holds on the requested slots, creates the
 * booking and locks its slots (the UNIQUE index makes a race impossible),
 * and records the payment attempt. The payment is started right after commit.
 */
@Injectable()
export class BookingHoldService {
  private readonly logger = new Logger(BookingHoldService.name);

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly availability: AvailabilityService,
    private readonly catalog: CatalogRepository,
    private readonly lifecycle: BookingLifecycleService,
    private readonly query: BookingQueryService,
  ) {}

  async create(input: CreateBookingRequest): Promise<CreateBookingResponse> {
    const now = this.clock.now();
    const phone = input.customer.phone;

    const space = await this.catalog.findActiveSpace(input.spaceSlug);
    if (!space) throw notFound('SPACE_NOT_FOUND', 'Cet espace est introuvable.');

    const firstStart =
      input.selection.type === 'SLOTS' ? input.selection.slotStarts[0]! : input.selection.start;
    const date = utcToLocalDate(new Date(firstStart), space.timezone);

    // The customer's own unpaid hold is replaced, so its slots count as free for them.
    const ownHolds = await this.db
      .selectFrom('t_bookings as b')
      .innerJoin('t_customers as c', 'c.id', 'b.customer_id')
      .select('b.id')
      .where('c.phone_e164', '=', phone)
      .where('b.status', '=', 'PENDING_PAYMENT')
      .execute();

    const { day, packages, unitPriceXof } = await this.availability.getBookableDay(
      input.spaceSlug,
      date,
      input.mode,
      ownHolds.map((h) => h.id),
    );

    let resolved;
    try {
      resolved = resolveSelection(day, input.selection, packages, unitPriceXof);
    } catch (error) {
      throw toApiError(error);
    }

    const access = generateAccessToken();
    const idempotencyKey = paymentIdempotencyKey();
    const holdExpiresAt = new Date(now.getTime() + space.hold_duration_min * 60_000);
    const slotStarts = resolved.slots.map((s) => s.start);

    let created: { bookingId: number; paymentId: number; reference: string };
    try {
      created = await inTransaction(this.db, async (trx) => {
        // 1. Customer: one record per phone, latest details win (email kept if not given).
        const customer = { id: await upsertCustomer(trx, { ...input.customer, phone }) };

        // 2. One active hold per phone: replace the previous unpaid hold.
        // Lock the customer row (a real record) to serialise this customer's
        // holds; locking "no rows" ranges instead would cause deadlocks.
        await trx
          .selectFrom('t_customers')
          .select('id')
          .where('id', '=', customer.id)
          .forUpdate()
          .execute();
        const previous = await trx
          .selectFrom('t_bookings')
          .select('id')
          .where('customer_id', '=', customer.id)
          .where('status', '=', 'PENDING_PAYMENT')
          .execute();
        const previousIds = previous.map((p) => p.id);
        if (previousIds.length > 0) {
          await releaseSlots(trx, previousIds);
          await trx
            .updateTable('t_bookings')
            .set({ status: 'CANCELLED', cancel_reason: 'SUPERSEDED', cancelled_at: now })
            .where('id', 'in', previousIds)
            .where('status', '=', 'PENDING_PAYMENT')
            .execute();
          await trx
            .updateTable('t_payments')
            .set({ status: 'CANCELLED' })
            .where('booking_id', 'in', previousIds)
            .where('status', 'in', ['INITIATED', 'PENDING'])
            .execute();
        }

        // 3. Reclaim expired holds sitting on the requested slots.
        const expiredIds = await reclaimExpiredHolds(trx, space.id, slotStarts, now);

        // 4. The booking itself.
        const first = resolved.slots[0]!;
        const last = resolved.slots[resolved.slots.length - 1]!;
        const { id: bookingId, reference } = await insertBooking(
          trx,
          {
            space_id: space.id,
            customer_id: customer.id,
            mode: input.mode,
            booking_type: resolved.bookingType,
            package_id: resolved.packageId,
            package_name: resolved.packageName,
            slot_count: resolved.slots.length,
            starts_at: first.start,
            ends_at: last.end,
            unit_price_xof: unitPriceXof,
            list_price_xof: resolved.quote.listPriceXof,
            discount_xof: resolved.quote.discountXof,
            total_xof: resolved.quote.totalXof,
            status: 'PENDING_PAYMENT',
            hold_expires_at: holdExpiresAt,
            live_description: input.liveDescription ?? null,
            access_token_hash: access.hash,
          },
          date,
        );

        // 5. Lock the slots. A slot taken meanwhile raises a duplicate key → 409.
        await lockSlots(trx, bookingId, space.id, slotStarts);

        // 6. The payment attempt.
        const payment = await trx
          .insertInto('t_payments')
          .values({
            booking_id: bookingId,
            provider: this.gateway.name,
            idempotency_key: idempotencyKey,
            method: input.payment.method,
            channel: input.payment.method === 'MOBILE_MONEY' ? input.payment.channel : null,
            payer_phone: input.payment.method === 'MOBILE_MONEY' ? input.payment.payerPhone : null,
            amount_xof: resolved.quote.totalXof,
            status: 'INITIATED',
          })
          .executeTakeFirstOrThrow();

        await trx
          .insertInto('t_audit_log')
          .values({
            actor_type: 'CUSTOMER',
            actor_id: customer.id,
            action: 'BOOKING_HOLD_CREATED',
            entity: 'booking',
            entity_id: String(bookingId),
            data: JSON.stringify({
              reference,
              slots: slotStarts.length,
              superseded: previousIds,
              reclaimed: expiredIds,
            }),
          })
          .execute();

        return { bookingId, paymentId: Number(payment.insertId), reference };
      });
    } catch (error) {
      if (isDuplicateOn(error, 'uq_slot_occupancies_slot')) throw toApiError(slotUnavailable());
      throw error;
    }

    // Start the payment outside the transaction: never hold DB locks during a network call.
    const customerRow = {
      fullName: input.customer.fullName,
      email: input.customer.email ?? null,
      phone,
    };
    try {
      const started = await this.gateway.initiate({
        paymentId: created.paymentId,
        idempotencyKey,
        amountXof: resolved.quote.totalXof,
        method: input.payment.method,
        channel: input.payment.method === 'MOBILE_MONEY' ? input.payment.channel : null,
        payerPhone: input.payment.method === 'MOBILE_MONEY' ? input.payment.payerPhone : null,
        bookingReference: created.reference,
        description: `Réservation ${created.reference} — ${space.name}`,
        customer: customerRow,
      });
      await this.db
        .updateTable('t_payments')
        .set({ provider_ref: started.providerRef, status: 'PENDING' })
        .where('id', '=', created.paymentId)
        .execute();

      return {
        booking: await this.query.byId(created.bookingId),
        accessToken: access.token,
        payment: {
          status: 'PENDING',
          instructions: started.instructions,
          redirectUrl: started.redirectUrl,
        },
      };
    } catch (error) {
      this.logger.error(`Payment initiation failed for ${created.reference}: ${String(error)}`);
      await this.lifecycle.failInitiation(created.paymentId);
      throw new ApiError(
        HttpStatus.BAD_GATEWAY,
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'Le service de paiement ne répond pas. Vos créneaux ont été libérés ; réessayez dans un instant.',
      );
    }
  }
}

function toApiError(error: unknown): unknown {
  if (!(error instanceof BookingRuleError)) return error;
  const status =
    error.code === 'SLOT_UNAVAILABLE' || error.code === 'PACKAGE_DOES_NOT_FIT'
      ? HttpStatus.CONFLICT
      : HttpStatus.BAD_REQUEST;
  return new ApiError(status, error.code, error.message);
}
