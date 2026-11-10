import { Inject, Injectable } from '@nestjs/common';
import type { SessionMode } from '@bovann/shared';
import type { Kysely } from 'kysely';
import { DB } from '../database/database.module';
import type { Database, Space } from '../database/schema';
import type { Interval, OpeningRule } from './domain/availability';

export interface PackageWithPrice {
  id: number;
  code: string;
  name: string;
  /** English name and description, entered by the admin (null: show the French ones). */
  nameEn: string | null;
  description: string | null;
  descriptionEn: string | null;
  isFullDay: boolean;
  slotCount: number | null;
  priceXof: number;
}

/**
 * Read-only queries for catalog and availability. No business decisions here:
 * the domain functions decide, this class only fetches.
 */
@Injectable()
export class CatalogRepository {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  findActiveSpace(slug: string): Promise<Space | undefined> {
    return this.db
      .selectFrom('t_spaces')
      .selectAll()
      .where('slug', '=', slug)
      .where('is_active', '=', true)
      .executeTakeFirst();
  }

  /** Weekly opening rules keyed by ISO weekday (1 = Monday … 7 = Sunday). */
  async openingRules(spaceId: number): Promise<Map<number, OpeningRule>> {
    const rows = await this.db
      .selectFrom('t_opening_hours')
      .select(['weekday', 'is_open', 'opens_at', 'closes_at'])
      .where('space_id', '=', spaceId)
      .execute();
    return new Map(
      rows.map((r) => [
        r.weekday,
        { isOpen: r.is_open, opensAt: r.opens_at, closesAt: r.closes_at },
      ]),
    );
  }

  /** Closures overlapping [from, to). */
  async closures(spaceId: number, from: Date, to: Date): Promise<Interval[]> {
    const rows = await this.db
      .selectFrom('t_closures')
      .select(['starts_at', 'ends_at'])
      .where('space_id', '=', spaceId)
      .where('starts_at', '<', to)
      .where('ends_at', '>', from)
      .execute();
    return rows.map((r) => ({ start: r.starts_at, end: r.ends_at }));
  }

  /**
   * Start instants (ms) of slots in [from, to) that are really unavailable:
   * admin blocks, confirmed bookings, and pending bookings whose payment hold
   * has not expired yet. An expired hold still has occupancy rows until the
   * cleanup job runs (Phase 3), but its slots are shown as available because
   * the next booking attempt will reclaim them.
   * `ignoreBookingIds`: holds about to be replaced (the same customer's previous
   * unpaid hold), whose slots the customer may pick again.
   */
  async occupiedSlotStarts(
    spaceId: number,
    from: Date,
    to: Date,
    now: Date,
    ignoreBookingIds: readonly number[] = [],
  ): Promise<Set<number>> {
    let query = this.db
      .selectFrom('t_slot_occupancies as o')
      .leftJoin('t_bookings as b', 'b.id', 'o.booking_id')
      .select('o.slot_start')
      .where('o.space_id', '=', spaceId)
      .where('o.slot_start', '>=', from)
      .where('o.slot_start', '<', to)
      .where((eb) =>
        eb.or([
          eb('o.block_id', 'is not', null),
          eb('b.status', '=', 'CONFIRMED'),
          eb.and([eb('b.status', '=', 'PENDING_PAYMENT'), eb('b.hold_expires_at', '>', now)]),
        ]),
      );
    if (ignoreBookingIds.length > 0) {
      query = query.where((eb) =>
        eb.or([
          eb('o.booking_id', 'is', null),
          eb('o.booking_id', 'not in', [...ignoreBookingIds]),
        ]),
      );
    }
    const rows = await query.execute();
    return new Set(rows.map((r) => r.slot_start.getTime()));
  }

  /** Active packages with the price in force at `now` for the given mode. */
  async packagesWithPrices(
    spaceId: number,
    mode: SessionMode,
    now: Date,
  ): Promise<PackageWithPrice[]> {
    const rows = await this.db
      .selectFrom('t_packages as p')
      .innerJoin('t_package_prices as pp', 'pp.package_id', 'p.id')
      .select([
        'p.id',
        'p.code',
        'p.name',
        'p.name_en',
        'p.description',
        'p.description_en',
        'p.is_full_day',
        'p.slot_count',
        'pp.price_xof',
      ])
      .where('p.space_id', '=', spaceId)
      .where('p.is_active', '=', true)
      .where('pp.mode', '=', mode)
      .where('pp.valid_from', '<=', now)
      .where((eb) => eb.or([eb('pp.valid_to', 'is', null), eb('pp.valid_to', '>', now)]))
      .orderBy('p.sort_order')
      .orderBy('p.id')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      nameEn: r.name_en,
      description: r.description,
      descriptionEn: r.description_en,
      isFullDay: r.is_full_day,
      slotCount: r.slot_count,
      priceXof: r.price_xof,
    }));
  }
}
