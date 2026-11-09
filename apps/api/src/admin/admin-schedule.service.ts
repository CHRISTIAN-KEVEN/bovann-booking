import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminDashboardStats,
  BlockCreate,
  ScheduleDayDto,
  ScheduleResponse,
  ScheduleSlotDto,
} from '@bovann/shared';
import type { Kysely } from 'kysely';
import { toRules } from '../availability/availability.service';
import { CatalogRepository } from '../availability/catalog.repository';
import { generateDaySlots, type Interval } from '../availability/domain/availability';
import {
  addDays,
  isoWeekday,
  localToUtc,
  utcToLocalDate,
  utcToLocalTime,
} from '../availability/domain/time';
import { inTransaction, isDuplicateOn } from '../booking/booking-tx';
import { reclaimExpiredHolds } from '../booking/booking-writes';
import { CLOCK, type Clock } from '../common/clock';
import { ApiError, badRequest, notFound } from '../common/errors';
import { DB } from '../database/database.module';
import type { Database, Space } from '../database/schema';
import { loadSpace } from './admin-common';
import { auditAdmin } from './admin-audit';
import type { AdminPrincipal } from './auth/admin-auth.service';

const MAX_SCHEDULE_DAYS = 42;

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** The studio's planning: who is in which slot, blocks, and the dashboard figures. */
@Injectable()
export class AdminScheduleService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly catalog: CatalogRepository,
  ) {}

  async schedule(spaceId: number, fromDate: string, days: number): Promise<ScheduleResponse> {
    if (days < 1 || days > MAX_SCHEDULE_DAYS) {
      throw badRequest('INVALID_RANGE', `Période invalide (1 à ${MAX_SCHEDULE_DAYS} jours).`);
    }
    const space = await loadSpace(this.db, spaceId);
    const now = this.clock.now();
    const tz = space.timezone;
    const dates = Array.from({ length: days }, (_, i) => addDays(fromDate, i));
    const from = localToUtc(dates[0]!, 0, tz);
    const to = localToUtc(addDays(dates[dates.length - 1]!, 1), 0, tz);

    const [opening, closures, occupancies] = await Promise.all([
      this.catalog.openingRules(space.id),
      this.catalog.closures(space.id, from, to),
      this.db
        .selectFrom('t_slot_occupancies as o')
        .leftJoin('t_bookings as b', 'b.id', 'o.booking_id')
        .leftJoin('t_customers as c', 'c.id', 'b.customer_id')
        .leftJoin('t_slot_blocks as k', 'k.id', 'o.block_id')
        .select([
          'o.slot_start',
          'o.block_id',
          'k.reason as block_reason',
          'b.id as booking_id',
          'b.reference',
          'b.status',
          'b.hold_expires_at',
          'b.mode',
          'c.full_name',
          'c.business_name',
        ])
        .where('o.space_id', '=', space.id)
        .where('o.slot_start', '>=', from)
        .where('o.slot_start', '<', to)
        .execute(),
    ]);
    const byStart = new Map(occupancies.map((o) => [o.slot_start.getTime(), o]));
    const rules = toRules(space);

    const result: ScheduleDayDto[] = dates.map((date) => {
      const grid = generateDaySlots(date, opening.get(isoWeekday(date)), rules);
      const slots: ScheduleSlotDto[] = grid.map((slot) => {
        const base = {
          start: slot.start.toISOString(),
          end: slot.end.toISOString(),
          startTime: utcToLocalTime(slot.start, tz),
          endTime: utcToLocalTime(slot.end, tz),
          isPast: slot.end <= now,
          booking: null,
          block: null,
        };
        if (closures.some((c) => overlaps(slot, c))) return { ...base, state: 'CLOSED' as const };
        const o = byStart.get(slot.start.getTime());
        if (o?.block_id) {
          return {
            ...base,
            state: 'BLOCKED' as const,
            block: { id: o.block_id, reason: o.block_reason ?? '' },
          };
        }
        const live =
          o?.booking_id &&
          (o.status === 'CONFIRMED' ||
            (o.status === 'PENDING_PAYMENT' && o.hold_expires_at && o.hold_expires_at > now));
        if (o && live) {
          return {
            ...base,
            state: o.status === 'CONFIRMED' ? ('BOOKED' as const) : ('PENDING' as const),
            booking: {
              id: o.booking_id!,
              reference: o.reference!,
              customerName: o.full_name!,
              businessName: o.business_name!,
              mode: o.mode!,
            },
          };
        }
        return { ...base, state: 'FREE' as const };
      });
      return { date, isOpen: grid.length > 0, slots };
    });

    return { spaceId: space.id, today: utcToLocalDate(now, tz), days: result };
  }

  /** Makes slots unbookable (maintenance, private event…). */
  async createBlock(
    spaceId: number,
    input: BlockCreate,
    admin: AdminPrincipal,
  ): Promise<{ id: number }> {
    const space = await loadSpace(this.db, spaceId);
    const now = this.clock.now();
    const starts = [...new Set(input.slotStarts.map((s) => new Date(s).getTime()))]
      .sort((a, b) => a - b)
      .map((ms) => new Date(ms));
    await this.assertOnGrid(space, starts);

    try {
      return await inTransaction(this.db, async (trx) => {
        await reclaimExpiredHolds(trx, space.id, starts, now);
        const result = await trx
          .insertInto('t_slot_blocks')
          .values({ space_id: space.id, reason: input.reason, created_by: admin.id })
          .executeTakeFirstOrThrow();
        const id = Number(result.insertId);
        await trx
          .insertInto('t_slot_occupancies')
          .values(starts.map((slot_start) => ({ space_id: space.id, slot_start, block_id: id })))
          .execute();
        await auditAdmin(trx, admin.id, 'ADMIN_SLOTS_BLOCKED', 'slot_block', id, {
          spaceId: space.id,
          slots: starts.map((s) => s.toISOString()),
          reason: input.reason,
        });
        return { id };
      });
    } catch (error) {
      if (isDuplicateOn(error, 'uq_slot_occupancies_slot')) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'SLOT_NOT_FREE',
          'Un des créneaux choisis est déjà réservé ou bloqué. Actualisez le planning.',
        );
      }
      throw error;
    }
  }

  async deleteBlock(blockId: number, admin: AdminPrincipal): Promise<void> {
    await inTransaction(this.db, async (trx) => {
      const block = await trx
        .selectFrom('t_slot_blocks')
        .select(['id', 'space_id', 'reason'])
        .where('id', '=', blockId)
        .forUpdate()
        .executeTakeFirst();
      if (!block) throw notFound('BLOCK_NOT_FOUND', 'Ce blocage n’existe plus.');
      await trx.deleteFrom('t_slot_occupancies').where('block_id', '=', blockId).execute();
      await trx.deleteFrom('t_slot_blocks').where('id', '=', blockId).execute();
      await auditAdmin(trx, admin.id, 'ADMIN_SLOTS_UNBLOCKED', 'slot_block', blockId, {
        spaceId: block.space_id,
        reason: block.reason,
      });
    });
  }

  async stats(spaceId: number): Promise<AdminDashboardStats> {
    const space = await loadSpace(this.db, spaceId);
    const now = this.clock.now();
    const tz = space.timezone;
    const today = utcToLocalDate(now, tz);
    const todayStart = localToUtc(today, 0, tz);
    const tomorrowStart = localToUtc(addDays(today, 1), 0, tz);
    const monday = addDays(today, 1 - isoWeekday(today));
    const weekStart = localToUtc(monday, 0, tz);
    const weekEnd = localToUtc(addDays(monday, 7), 0, tz);
    const monthStart = localToUtc(`${today.slice(0, 7)}-01`, 0, tz);
    const [y, m] = today.slice(0, 7).split('-').map(Number) as [number, number];
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const monthEnd = localToUtc(nextMonth, 0, tz);

    const [todayRow, weekBooked, weekBlocked, opening, closures, received, refunded, unpaid, dues] =
      await Promise.all([
        this.db
          .selectFrom('t_bookings')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('space_id', '=', space.id)
          .where('status', '=', 'CONFIRMED')
          .where('starts_at', '>=', todayStart)
          .where('starts_at', '<', tomorrowStart)
          .executeTakeFirstOrThrow(),
        this.db
          .selectFrom('t_slot_occupancies as o')
          .innerJoin('t_bookings as b', 'b.id', 'o.booking_id')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('o.space_id', '=', space.id)
          .where('b.status', '=', 'CONFIRMED')
          .where('o.slot_start', '>=', weekStart)
          .where('o.slot_start', '<', weekEnd)
          .executeTakeFirstOrThrow(),
        this.db
          .selectFrom('t_slot_occupancies')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('space_id', '=', space.id)
          .where('block_id', 'is not', null)
          .where('slot_start', '>=', weekStart)
          .where('slot_start', '<', weekEnd)
          .executeTakeFirstOrThrow(),
        this.catalog.openingRules(space.id),
        this.catalog.closures(space.id, weekStart, weekEnd),
        this.db
          .selectFrom('t_payments as p')
          .innerJoin('t_bookings as b', 'b.id', 'p.booking_id')
          .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('p.amount_xof'), eb.val(0)).as('total'))
          .where('b.space_id', '=', space.id)
          .where('p.status', '=', 'SUCCEEDED')
          .where('p.succeeded_at', '>=', monthStart)
          .where('p.succeeded_at', '<', monthEnd)
          .executeTakeFirstOrThrow(),
        this.db
          .selectFrom('t_bookings')
          .select((eb) =>
            eb.fn.coalesce(eb.fn.sum<number>('refund_amount_xof'), eb.val(0)).as('total'),
          )
          .where('space_id', '=', space.id)
          .where('refund_status', '=', 'DONE')
          .where('refunded_at', '>=', monthStart)
          .where('refunded_at', '<', monthEnd)
          .executeTakeFirstOrThrow(),
        this.db
          .selectFrom('t_bookings as b')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('b.space_id', '=', space.id)
          .where('b.status', '=', 'CONFIRMED')
          .where('b.total_xof', '>', 0)
          .where(({ not, exists, selectFrom }) =>
            not(
              exists(
                selectFrom('t_payments as p')
                  .select('p.id')
                  .whereRef('p.booking_id', '=', 'b.id')
                  .where('p.status', '=', 'SUCCEEDED'),
              ),
            ),
          )
          .executeTakeFirstOrThrow(),
        this.db
          .selectFrom('t_bookings')
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('space_id', '=', space.id)
          .where('refund_status', '=', 'DUE')
          .executeTakeFirstOrThrow(),
      ]);

    const rules = toRules(space);
    let openSlots = 0;
    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      openSlots += generateDaySlots(date, opening.get(isoWeekday(date)), rules).filter(
        (slot) => !closures.some((c) => overlaps(slot, c)),
      ).length;
    }
    const capacity = openSlots - Number(weekBlocked.n);
    return {
      todayBookings: Number(todayRow.n),
      weekOccupancyPercent:
        capacity > 0 ? Math.min(100, Math.round((Number(weekBooked.n) / capacity) * 100)) : 0,
      collectedThisMonthXof: Number(received.total) - Number(refunded.total),
      unpaidCount: Number(unpaid.n),
      refundsDueCount: Number(dues.n),
    };
  }

  /** Every start must be a real slot of its day and not inside a closure. */
  private async assertOnGrid(space: Space, starts: Date[]): Promise<void> {
    const tz = space.timezone;
    const rules = toRules(space);
    const opening = await this.catalog.openingRules(space.id);
    const from = starts[0]!;
    const to = new Date(starts[starts.length - 1]!.getTime() + space.slot_duration_min * 60_000);
    const closures = await this.catalog.closures(space.id, from, to);
    const now = this.clock.now();
    for (const start of starts) {
      const date = utcToLocalDate(start, tz);
      const slot = generateDaySlots(date, opening.get(isoWeekday(date)), rules).find(
        (s) => s.start.getTime() === start.getTime(),
      );
      if (!slot) {
        throw badRequest('SLOT_NOT_FOUND', 'Un des créneaux choisis n’existe pas pour cette date.');
      }
      if (slot.end <= now) {
        throw badRequest('SLOT_IN_PAST', 'Un créneau déjà terminé ne peut pas être bloqué.');
      }
      if (closures.some((c) => overlaps(slot, c))) {
        throw badRequest('SLOT_CLOSED', 'Un des créneaux tombe pendant une fermeture.');
      }
    }
  }
}
