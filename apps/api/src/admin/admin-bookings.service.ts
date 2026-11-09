import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminBookingDetail,
  AdminBookingListResponse,
  AdminBookingTab,
  AdminCancelRequest,
  AdminCreateBookingRequest,
  AdminDayOptionsResponse,
  AdminHistoryEntry,
  AdminMarkRefundedRequest,
  AdminRecordPaymentRequest,
  CustomerLookupDto,
  SessionMode,
} from '@bovann/shared';
import { sql, type Kysely } from 'kysely';
import { AvailabilityService } from '../availability/availability.service';
import { fullDayOption, packageStartOptions, quotePackage } from '../availability/domain/pricing';
import { addDays, localToUtc, utcToLocalDate, utcToLocalTime } from '../availability/domain/time';
import { inTransaction, isDuplicateOn, releaseSlots } from '../booking/booking-tx';
import { BookingLifecycleService } from '../booking/booking-lifecycle.service';
import {
  insertBooking,
  lockSlots,
  reclaimExpiredHolds,
  upsertCustomer,
} from '../booking/booking-writes';
import { paymentIdempotencyKey } from '../booking/domain/identifiers';
import { BookingRuleError, resolveSelection, slotUnavailable } from '../booking/domain/selection';
import { CLOCK, type Clock } from '../common/clock';
import { ApiError, badRequest, notFound } from '../common/errors';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import {
  BOOKING_ROW_COLUMNS,
  loadSpace,
  NO_PAYMENTS,
  paymentSummaries,
  toListItem,
  type BookingRow,
} from './admin-common';
import { auditAdmin } from './admin-audit';
import type { AdminPrincipal } from './auth/admin-auth.service';

export interface BookingListQuery {
  spaceId?: number;
  tab: AdminBookingTab | 'ABANDONED';
  q?: string;
  when: 'upcoming' | 'past' | 'all';
  from?: string;
  to?: string;
  customerId?: number;
  page: number;
  pageSize: number;
}

const HISTORY_LABELS: Record<string, string> = {
  BOOKING_HOLD_CREATED: 'Réservation commencée en ligne, paiement en attente',
  BOOKING_CONFIRMED: 'Paiement reçu, réservation confirmée',
  BOOKING_PAYMENT_FAILED: 'Paiement échoué, créneaux libérés',
  BOOKING_HOLD_EXPIRED: 'Délai de paiement dépassé, créneaux libérés',
  BOOKING_CANCELLED_BY_CUSTOMER: 'Abandonnée par le client avant paiement',
  LATE_PAYMENT_REFUND_REQUIRED:
    'Paiement reçu après la libération des créneaux : remboursement à faire',
  ADMIN_BOOKING_CREATED: 'Réservation ajoutée par le studio',
  ADMIN_BOOKING_CANCELLED: 'Annulée par le studio',
  ADMIN_PAYMENT_RECORDED: 'Paiement enregistré',
  ADMIN_REFUND_DONE: 'Remboursement effectué',
  ADMIN_BOOKING_NOTE_UPDATED: 'Note interne modifiée',
};

const ACTOR_LABELS = { CUSTOMER: 'Client', SYSTEM: 'Système', PROVIDER: 'Paiement' } as const;

/**
 * Admin side of bookings. Studio bookings go through the same slot locks as
 * online ones (shared write helpers), so the calendar can never be double-booked.
 */
@Injectable()
export class AdminBookingsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly availability: AvailabilityService,
    private readonly lifecycle: BookingLifecycleService,
  ) {}

  // ------------------------------------------------------------------ reads

  async list(query: BookingListQuery): Promise<AdminBookingListResponse> {
    const now = this.clock.now();
    const tz = await this.timezoneFor(query.spaceId);

    let base = this.db
      .selectFrom('t_bookings as b')
      .innerJoin('t_customers as c', 'c.id', 'b.customer_id')
      .innerJoin('t_spaces as s', 's.id', 'b.space_id');

    if (query.spaceId) base = base.where('b.space_id', '=', query.spaceId);
    if (query.customerId) base = base.where('b.customer_id', '=', query.customerId);
    if (query.when === 'upcoming') base = base.where('b.ends_at', '>', now);
    if (query.when === 'past') base = base.where('b.ends_at', '<=', now);
    if (query.from) base = base.where('b.starts_at', '>=', localToUtc(query.from, 0, tz));
    if (query.to) base = base.where('b.starts_at', '<', localToUtc(addDays(query.to, 1), 0, tz));

    const abandoned = sql<boolean>`(b.status = 'EXPIRED'
      OR (b.status = 'CANCELLED' AND b.cancelled_by_admin_id IS NULL AND b.refund_status = 'NONE')
      OR (b.status = 'PENDING_PAYMENT' AND b.hold_expires_at <= ${now}))`;
    const paid = sql<boolean>`EXISTS (SELECT 1 FROM t_payments p
      WHERE p.booking_id = b.id AND p.status = 'SUCCEEDED')`;
    switch (query.tab) {
      case 'ALL':
        base = base.where(sql<boolean>`NOT ${abandoned}`);
        break;
      case 'CONFIRMED':
        base = base.where('b.status', '=', 'CONFIRMED');
        break;
      case 'PENDING':
        base = base.where('b.status', '=', 'PENDING_PAYMENT').where('b.hold_expires_at', '>', now);
        break;
      case 'CANCELLED':
        base = base
          .where('b.status', 'in', ['CANCELLED', 'EXPIRED', 'REFUNDED'])
          .where(sql<boolean>`NOT ${abandoned}`);
        break;
      case 'UNPAID':
        base = base
          .where('b.status', '=', 'CONFIRMED')
          .where('b.total_xof', '>', 0)
          .where(sql<boolean>`NOT ${paid}`);
        break;
      case 'REFUND_DUE':
        base = base.where('b.refund_status', '=', 'DUE');
        break;
      case 'ABANDONED':
        base = base.where(abandoned);
        break;
    }

    const q = query.q?.trim();
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const digits = q.replace(/\D/g, '');
      base = base.where((eb) =>
        eb.or([
          eb('b.reference', 'like', like),
          eb('c.full_name', 'like', like),
          eb('c.business_name', 'like', like),
          ...(digits.length >= 3 ? [eb('c.phone_e164', 'like', `%${digits}%`)] : []),
        ]),
      );
    }

    const [countRow, rows] = await Promise.all([
      base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
      base
        .select(BOOKING_ROW_COLUMNS)
        .orderBy('b.starts_at', query.when === 'upcoming' ? 'asc' : 'desc')
        .orderBy('b.id', 'desc')
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)
        .execute(),
    ]);
    const payments = await paymentSummaries(
      this.db,
      rows.map((r) => r.id),
    );
    return {
      items: rows.map((r) => toListItem(r as BookingRow, payments.get(r.id) ?? NO_PAYMENTS, now)),
      total: Number(countRow.n),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(bookingId: number, admin: AdminPrincipal): Promise<AdminBookingDetail> {
    const now = this.clock.now();
    const b = await this.db
      .selectFrom('t_bookings as b')
      .innerJoin('t_customers as c', 'c.id', 'b.customer_id')
      .innerJoin('t_spaces as s', 's.id', 'b.space_id')
      .leftJoin('t_admin_users as cb', 'cb.id', 'b.created_by_admin_id')
      .leftJoin('t_admin_users as xb', 'xb.id', 'b.cancelled_by_admin_id')
      .select([
        ...BOOKING_ROW_COLUMNS,
        's.name as space_name',
        's.slot_duration_min',
        'b.list_price_xof',
        'b.discount_xof',
        'b.live_description',
        'b.admin_note',
        'b.confirmed_at',
        'b.cancelled_at',
        'b.cancel_reason',
        'b.refund_amount_xof',
        'b.refunded_at',
        'b.refund_note',
        'c.email',
        'c.business_sector',
        'cb.full_name as created_by_name',
        'xb.full_name as cancelled_by_name',
      ])
      .where('b.id', '=', bookingId)
      .executeTakeFirst();
    if (!b) throw notFound('BOOKING_NOT_FOUND', 'Réservation introuvable.');

    const [slots, payments, audit, summaries] = await Promise.all([
      this.db
        .selectFrom('t_booking_slots')
        .select('slot_start')
        .where('booking_id', '=', bookingId)
        .orderBy('slot_start')
        .execute(),
      this.db
        .selectFrom('t_payments as p')
        .leftJoin('t_admin_users as a', 'a.id', 'p.recorded_by_admin_id')
        .select([
          'p.id',
          'p.provider',
          'p.method',
          'p.channel',
          'p.amount_xof',
          'p.status',
          'p.note',
          'p.created_at',
          'p.succeeded_at',
          'a.full_name as recorded_by',
        ])
        .where('p.booking_id', '=', bookingId)
        .orderBy('p.id')
        .execute(),
      this.db
        .selectFrom('t_audit_log as l')
        .leftJoin('t_admin_users as a', (join) =>
          join.onRef('a.id', '=', 'l.actor_id').on('l.actor_type', '=', 'ADMIN'),
        )
        .select(['l.created_at', 'l.action', 'l.actor_type', 'a.full_name'])
        .where('l.entity', '=', 'booking')
        .where('l.entity_id', '=', String(bookingId))
        .orderBy('l.id')
        .execute(),
      paymentSummaries(this.db, [bookingId]),
    ]);

    const item = toListItem(b as BookingRow, summaries.get(bookingId) ?? NO_PAYMENTS, now);
    const tz = b.timezone;
    const liveHold =
      b.status === 'PENDING_PAYMENT' && b.hold_expires_at !== null && b.hold_expires_at > now;
    const isOwner = admin.role === 'OWNER';
    const history: AdminHistoryEntry[] = audit.map((l) => ({
      at: l.created_at.toISOString(),
      action: l.action,
      label: HISTORY_LABELS[l.action] ?? l.action,
      actor: l.actor_type === 'ADMIN' ? (l.full_name ?? 'Studio') : ACTOR_LABELS[l.actor_type],
    }));

    return {
      ...item,
      spaceName: b.space_name,
      slots: slots.map(({ slot_start }) => ({
        start: slot_start.toISOString(),
        startTime: utcToLocalTime(slot_start, tz),
        endTime: utcToLocalTime(new Date(slot_start.getTime() + b.slot_duration_min * 60_000), tz),
      })),
      listPriceXof: b.list_price_xof,
      discountXof: b.discount_xof,
      customer: { ...item.customer, email: b.email, businessSector: b.business_sector },
      liveDescription: b.live_description,
      adminNote: b.admin_note,
      holdExpiresAt: liveHold ? b.hold_expires_at!.toISOString() : null,
      confirmedAt: b.confirmed_at?.toISOString() ?? null,
      cancelledAt: b.cancelled_at?.toISOString() ?? null,
      cancelReason: b.cancel_reason,
      createdBy: b.created_by_name,
      cancelledBy: b.cancelled_by_name,
      refund: {
        status: b.refund_status,
        amountXof: b.refund_amount_xof,
        refundedAt: b.refunded_at?.toISOString() ?? null,
        note: b.refund_note,
      },
      payments: payments.map((p) => ({
        id: p.id,
        provider: p.provider,
        method: p.method,
        channel: p.channel,
        amountXof: p.amount_xof,
        status: p.status,
        note: p.note,
        createdAt: p.created_at.toISOString(),
        succeededAt: p.succeeded_at?.toISOString() ?? null,
        recordedBy: p.recorded_by,
      })),
      history,
      can: {
        cancel: isOwner && (b.status === 'CONFIRMED' || liveHold),
        recordPayment: item.paymentState === 'UNPAID',
        markRefunded: isOwner && b.refund_status === 'DUE',
      },
    };
  }

  /** Slots and packages a studio booking can use on one day. */
  async dayOptions(
    spaceId: number,
    date: string,
    mode: SessionMode,
  ): Promise<AdminDayOptionsResponse> {
    const space = await loadSpace(this.db, spaceId);
    const { day, packages, unitPriceXof } = await this.availability.getAdminBookableDay(
      space,
      date,
      mode,
    );
    const tz = space.timezone;
    const option = (o: { start: Date; end: Date }) => ({
      start: o.start.toISOString(),
      startTime: utcToLocalTime(o.start, tz),
      endTime: utcToLocalTime(o.end, tz),
    });
    return {
      date,
      mode,
      unitPriceXof,
      slots: day.slots.map((s) => ({
        ...option(s),
        end: s.end.toISOString(),
        available: s.status === 'AVAILABLE',
      })),
      packages: packages.flatMap((p): AdminDayOptionsResponse['packages'] => {
        if (p.isFullDay) {
          const fit = fullDayOption(day);
          if (!fit) return [];
          const quote = quotePackage(p.priceXof, unitPriceXof, fit.slotCount);
          return [
            {
              code: p.code,
              name: p.name,
              isFullDay: true,
              slotCount: fit.slotCount,
              listPriceXof: quote.listPriceXof,
              totalXof: quote.totalXof,
              startOptions: [option(fit.option)],
            },
          ];
        }
        const count = p.slotCount ?? 0;
        if (count === 0) return [];
        const quote = quotePackage(p.priceXof, unitPriceXof, count);
        return [
          {
            code: p.code,
            name: p.name,
            isFullDay: false,
            slotCount: count,
            listPriceXof: quote.listPriceXof,
            totalXof: quote.totalXof,
            startOptions: packageStartOptions(day, count).map(option),
          },
        ];
      }),
    };
  }

  async lookupCustomer(phone: string): Promise<CustomerLookupDto | null> {
    const c = await this.db
      .selectFrom('t_customers')
      .selectAll()
      .where('phone_e164', '=', phone)
      .executeTakeFirst();
    return c
      ? {
          id: c.id,
          fullName: c.full_name,
          phone: c.phone_e164,
          email: c.email,
          businessName: c.business_name,
          businessSector: c.business_sector,
        }
      : null;
  }

  // ------------------------------------------------------------------ writes

  /** A booking the studio takes itself (phone, walk-in): confirmed at once. */
  async create(
    input: AdminCreateBookingRequest,
    admin: AdminPrincipal,
  ): Promise<AdminBookingDetail> {
    const now = this.clock.now();
    const space = await loadSpace(this.db, input.spaceId);
    if (!space.is_active) {
      throw badRequest('SPACE_INACTIVE', 'Cet espace est désactivé : réactivez-le pour réserver.');
    }
    const firstStart =
      input.selection.type === 'SLOTS' ? input.selection.slotStarts[0]! : input.selection.start;
    const date = utcToLocalDate(new Date(firstStart), space.timezone);
    const { day, packages, unitPriceXof } = await this.availability.getAdminBookableDay(
      space,
      date,
      input.mode,
    );

    let resolved;
    try {
      resolved = resolveSelection(day, input.selection, packages, unitPriceXof);
    } catch (error) {
      throw toApiError(error);
    }

    const listPrice = resolved.quote.listPriceXof;
    const total = input.totalXof ?? resolved.quote.totalXof;
    if (total > listPrice) {
      throw badRequest(
        'PRICE_ABOVE_LIST',
        `Le prix ne peut pas dépasser le prix des créneaux à l’unité (${listPrice} FCFA).`,
      );
    }
    const paidNow = total > 0 && input.payment.status === 'PAID';
    const slotStarts = resolved.slots.map((s) => s.start);

    let bookingId: number;
    try {
      bookingId = await inTransaction(this.db, async (trx) => {
        const customerId = await upsertCustomer(trx, input.customer);
        const reclaimed = await reclaimExpiredHolds(trx, space.id, slotStarts, now);
        const first = resolved.slots[0]!;
        const last = resolved.slots[resolved.slots.length - 1]!;
        const { id, reference } = await insertBooking(
          trx,
          {
            space_id: space.id,
            customer_id: customerId,
            mode: input.mode,
            booking_type: resolved.bookingType,
            package_id: resolved.packageId,
            package_name: resolved.packageName,
            slot_count: resolved.slots.length,
            starts_at: first.start,
            ends_at: last.end,
            unit_price_xof: unitPriceXof,
            list_price_xof: listPrice,
            discount_xof: listPrice - total,
            total_xof: total,
            status: 'CONFIRMED',
            source: 'ADMIN',
            created_by_admin_id: admin.id,
            confirmed_at: now,
            live_description: input.liveDescription ?? null,
            admin_note: input.adminNote ?? null,
          },
          date,
        );
        await lockSlots(trx, id, space.id, slotStarts);
        if (paidNow && input.payment.status === 'PAID') {
          await trx
            .insertInto('t_payments')
            .values({
              booking_id: id,
              provider: 'manual',
              idempotency_key: paymentIdempotencyKey(),
              method: input.payment.method,
              channel: input.payment.channel ?? null,
              amount_xof: total,
              status: 'SUCCEEDED',
              succeeded_at: now,
              recorded_by_admin_id: admin.id,
              note: input.payment.note ?? null,
            })
            .execute();
        }
        await auditAdmin(trx, admin.id, 'ADMIN_BOOKING_CREATED', 'booking', id, {
          reference,
          slots: slotStarts.length,
          totalXof: total,
          catalogTotalXof: resolved.quote.totalXof,
          payment: total === 0 ? 'FREE' : input.payment.status,
          reclaimed,
        });
        await this.lifecycle.queueConfirmationNotifications(trx, id);
        return id;
      });
    } catch (error) {
      if (isDuplicateOn(error, 'uq_slot_occupancies_slot')) throw toApiError(slotUnavailable());
      throw error;
    }
    return this.detail(bookingId, admin);
  }

  /** Money received for a confirmed booking that was marked unpaid. */
  async recordPayment(
    bookingId: number,
    input: AdminRecordPaymentRequest,
    admin: AdminPrincipal,
  ): Promise<AdminBookingDetail> {
    const now = this.clock.now();
    try {
      await inTransaction(this.db, async (trx) => {
        const b = await trx
          .selectFrom('t_bookings')
          .select(['status', 'total_xof'])
          .where('id', '=', bookingId)
          .forUpdate()
          .executeTakeFirst();
        if (!b) throw notFound('BOOKING_NOT_FOUND', 'Réservation introuvable.');
        if (b.status !== 'CONFIRMED' || b.total_xof === 0) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'PAYMENT_NOT_EXPECTED',
            'Aucun paiement n’est attendu pour cette réservation.',
          );
        }
        const already = await trx
          .selectFrom('t_payments')
          .select('id')
          .where('booking_id', '=', bookingId)
          .where('status', '=', 'SUCCEEDED')
          .executeTakeFirst();
        if (already) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            'ALREADY_PAID',
            'Cette réservation est déjà payée.',
          );
        }
        await trx
          .insertInto('t_payments')
          .values({
            booking_id: bookingId,
            provider: 'manual',
            idempotency_key: paymentIdempotencyKey(),
            method: input.method,
            channel: input.channel ?? null,
            amount_xof: b.total_xof,
            status: 'SUCCEEDED',
            succeeded_at: now,
            recorded_by_admin_id: admin.id,
            note: input.note ?? null,
          })
          .execute();
        await auditAdmin(trx, admin.id, 'ADMIN_PAYMENT_RECORDED', 'booking', bookingId, {
          method: input.method,
          amountXof: b.total_xof,
        });
      });
    } catch (error) {
      if (isDuplicateOn(error, 'uq_payments_one_success')) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'ALREADY_PAID',
          'Cette réservation est déjà payée.',
        );
      }
      throw error;
    }
    return this.detail(bookingId, admin);
  }

  /**
   * The studio cancels a booking: slots are freed at once. If money was
   * received, the refund is marked "to handle" (done by hand until Phase 4).
   */
  async cancel(
    bookingId: number,
    input: AdminCancelRequest,
    admin: AdminPrincipal,
  ): Promise<AdminBookingDetail> {
    const now = this.clock.now();
    await inTransaction(this.db, async (trx) => {
      const b = await trx
        .selectFrom('t_bookings')
        .select(['status', 'hold_expires_at', 'refund_status'])
        .where('id', '=', bookingId)
        .forUpdate()
        .executeTakeFirst();
      if (!b) throw notFound('BOOKING_NOT_FOUND', 'Réservation introuvable.');
      const liveHold =
        b.status === 'PENDING_PAYMENT' && b.hold_expires_at !== null && b.hold_expires_at > now;
      if (b.status !== 'CONFIRMED' && !liveHold) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'BOOKING_NOT_CANCELLABLE',
          'Cette réservation n’est plus active : elle ne peut pas être annulée.',
        );
      }
      const payment = await trx
        .selectFrom('t_payments')
        .select('amount_xof')
        .where('booking_id', '=', bookingId)
        .where('status', '=', 'SUCCEEDED')
        .executeTakeFirst();
      const paid = payment?.amount_xof ?? 0;
      const refund = input.refundAmountXof ?? paid;
      if (refund > paid) {
        throw badRequest(
          'REFUND_ABOVE_PAID',
          paid === 0
            ? 'Aucun paiement n’a été reçu : il n’y a rien à rembourser.'
            : `Le remboursement ne peut pas dépasser le montant payé (${paid} FCFA).`,
        );
      }

      await releaseSlots(trx, [bookingId]);
      await trx
        .updateTable('t_bookings')
        .set((eb) => ({
          status: 'CANCELLED',
          cancelled_at: now,
          cancel_reason: input.reason,
          cancelled_by_admin_id: admin.id,
          refund_status: refund > 0 ? 'DUE' : 'NONE',
          refund_amount_xof: refund > 0 ? refund : null,
          version: eb('version', '+', 1),
        }))
        .where('id', '=', bookingId)
        .execute();
      // A payment still in progress must not go through any more.
      await trx
        .updateTable('t_payments')
        .set({ status: 'CANCELLED' })
        .where('booking_id', '=', bookingId)
        .where('status', 'in', ['INITIATED', 'PENDING'])
        .execute();
      await auditAdmin(trx, admin.id, 'ADMIN_BOOKING_CANCELLED', 'booking', bookingId, {
        reason: input.reason,
        paidXof: paid,
        refundXof: refund,
      });
      if (b.status === 'CONFIRMED')
        await this.lifecycle.queueCancellationNotification(trx, bookingId);
    });
    return this.detail(bookingId, admin);
  }

  async markRefunded(
    bookingId: number,
    input: AdminMarkRefundedRequest,
    admin: AdminPrincipal,
  ): Promise<AdminBookingDetail> {
    const now = this.clock.now();
    await inTransaction(this.db, async (trx) => {
      const b = await trx
        .selectFrom('t_bookings')
        .select(['status', 'refund_status', 'refund_amount_xof'])
        .where('id', '=', bookingId)
        .forUpdate()
        .executeTakeFirst();
      if (!b) throw notFound('BOOKING_NOT_FOUND', 'Réservation introuvable.');
      if (b.refund_status !== 'DUE') {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'NO_REFUND_DUE',
          'Aucun remboursement n’est en attente pour cette réservation.',
        );
      }
      await trx
        .updateTable('t_bookings')
        .set({
          refund_status: 'DONE',
          refunded_at: now,
          refunded_by_admin_id: admin.id,
          refund_note: input.note ?? null,
          // A cancelled or expired booking whose money went back is "Remboursée".
          ...(b.status === 'CONFIRMED' ? {} : { status: 'REFUNDED' as const }),
        })
        .where('id', '=', bookingId)
        .execute();
      await auditAdmin(trx, admin.id, 'ADMIN_REFUND_DONE', 'booking', bookingId, {
        amountXof: b.refund_amount_xof,
      });
    });
    return this.detail(bookingId, admin);
  }

  async updateNote(
    bookingId: number,
    note: string | null,
    admin: AdminPrincipal,
  ): Promise<AdminBookingDetail> {
    const exists = await this.db
      .selectFrom('t_bookings')
      .select('id')
      .where('id', '=', bookingId)
      .executeTakeFirst();
    if (!exists) throw notFound('BOOKING_NOT_FOUND', 'Réservation introuvable.');
    await this.db
      .updateTable('t_bookings')
      .set({ admin_note: note })
      .where('id', '=', bookingId)
      .execute();
    await auditAdmin(this.db, admin.id, 'ADMIN_BOOKING_NOTE_UPDATED', 'booking', bookingId);
    return this.detail(bookingId, admin);
  }

  private async timezoneFor(spaceId: number | undefined): Promise<string> {
    let query = this.db.selectFrom('t_spaces').select('timezone').orderBy('id').limit(1);
    if (spaceId) query = query.where('id', '=', spaceId);
    const row = await query.executeTakeFirst();
    return row?.timezone ?? 'Africa/Lome';
  }
}

function toApiError(error: unknown): unknown {
  if (!(error instanceof BookingRuleError)) return error;
  const conflict = error.code === 'SLOT_UNAVAILABLE' || error.code === 'PACKAGE_DOES_NOT_FIT';
  const message =
    error.code === 'SLOT_UNAVAILABLE'
      ? 'Un des créneaux choisis n’est plus libre. Actualisez le planning et choisissez un autre horaire.'
      : error.message;
  return new ApiError(conflict ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST, error.code, message);
}
