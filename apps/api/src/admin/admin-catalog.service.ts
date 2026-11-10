import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  SESSION_MODES,
  type AdminPackageInput,
  type AdminPackagesResponse,
  type SessionMode,
} from '@bovann/shared';
import type { Kysely, Transaction } from 'kysely';
import { toRules } from '../availability/availability.service';
import { CatalogRepository } from '../availability/catalog.repository';
import { generateDaySlots } from '../availability/domain/availability';
import { validatePriceLadder, type LadderEntry } from '../availability/domain/pricing';
import { addDays, isoWeekday, utcToLocalDate } from '../availability/domain/time';
import { inTransaction } from '../booking/booking-tx';
import { CLOCK, type Clock } from '../common/clock';
import { ApiError, badRequest, notFound } from '../common/errors';
import { DB } from '../database/database.module';
import type { Database, Space } from '../database/schema';
import { loadSpace } from './admin-common';
import { auditAdmin } from './admin-audit';
import type { AdminPrincipal } from './auth/admin-auth.service';

interface PackageState {
  id: number | null;
  code: string;
  name: string;
  isFullDay: boolean;
  slotCount: number | null;
  isActive: boolean;
  prices: Partial<Record<SessionMode, number>>;
}

/**
 * Packages and their prices. Prices are versioned (never updated in place):
 * a change closes the current price and opens a new one, so past bookings and
 * reports keep the price that applied at the time. Every save is checked
 * against the agreed price ladder (longer = cheaper per slot).
 */
@Injectable()
export class AdminCatalogService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly catalog: CatalogRepository,
  ) {}

  async list(spaceId: number): Promise<AdminPackagesResponse> {
    const space = await loadSpace(this.db, spaceId);
    const states = await this.loadStates(this.db, space.id);
    const now = this.clock.now();
    const upcoming = await this.db
      .selectFrom('t_bookings')
      .select(['package_id', (eb) => eb.fn.countAll<number>().as('n')])
      .where('space_id', '=', space.id)
      .where('package_id', 'is not', null)
      .where('status', 'in', ['CONFIRMED', 'PENDING_PAYMENT'])
      .where('starts_at', '>', now)
      .groupBy('package_id')
      .execute();
    const counts = new Map(upcoming.map((u) => [u.package_id, Number(u.n)]));
    const meta = await this.db
      .selectFrom('t_packages')
      .select(['id', 'name_en', 'description', 'sort_order'])
      .where('space_id', '=', space.id)
      .execute();
    const metaById = new Map(meta.map((m) => [m.id, m]));
    return {
      fullDaySlotCount: await this.fullDaySlotCount(space),
      packages: states.map((s) => ({
        id: s.id!,
        code: s.code,
        name: s.name,
        nameEn: metaById.get(s.id!)?.name_en ?? null,
        description: metaById.get(s.id!)?.description ?? null,
        isFullDay: s.isFullDay,
        slotCount: s.slotCount,
        isActive: s.isActive,
        sortOrder: metaById.get(s.id!)?.sort_order ?? 0,
        prices: s.prices,
        upcomingBookings: counts.get(s.id!) ?? 0,
      })),
    };
  }

  async create(
    spaceId: number,
    input: AdminPackageInput,
    admin: AdminPrincipal,
  ): Promise<AdminPackagesResponse> {
    const space = await loadSpace(this.db, spaceId);
    const isFullDay = input.isFullDay ?? false;
    const slotCount = isFullDay ? null : (input.slotCount ?? null);
    assertSize(isFullDay, slotCount);
    const prices = definedPrices(input.prices);
    if (Object.keys(prices).length === 0) {
      throw badRequest('PRICE_REQUIRED', 'Indiquez un prix pour au moins un mode.');
    }

    await inTransaction(this.db, async (trx) => {
      const states = await this.loadStates(trx, space.id, true);
      if (isFullDay && states.some((s) => s.isFullDay)) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'FULL_DAY_EXISTS',
          'Un forfait « journée » existe déjà pour cet espace.',
        );
      }
      const code = uniqueCode(input.name, new Set(states.map((s) => s.code)));
      const draft: PackageState = {
        id: null,
        code,
        name: input.name,
        isFullDay,
        slotCount,
        isActive: input.isActive ?? true,
        prices,
      };
      await this.assertLadder(space, [...states, draft]);

      const result = await trx
        .insertInto('t_packages')
        .values({
          space_id: space.id,
          code,
          name: input.name,
          name_en: input.nameEn ?? null,
          description: input.description ?? null,
          is_full_day: isFullDay,
          slot_count: slotCount,
          is_active: draft.isActive,
          sort_order: input.sortOrder ?? (isFullDay ? 100 : (slotCount ?? 0) * 10),
        })
        .executeTakeFirstOrThrow();
      const packageId = Number(result.insertId);
      await this.writePrices(trx, packageId, {}, prices, admin.id);
      await auditAdmin(trx, admin.id, 'ADMIN_PACKAGE_CREATED', 'package', packageId, {
        code,
        name: input.name,
        slotCount,
        isFullDay,
        prices,
      });
    });
    return this.list(spaceId);
  }

  async update(
    packageId: number,
    input: Partial<AdminPackageInput>,
    admin: AdminPrincipal,
  ): Promise<AdminPackagesResponse> {
    const pkg = await this.db
      .selectFrom('t_packages')
      .select(['space_id'])
      .where('id', '=', packageId)
      .executeTakeFirst();
    if (!pkg) throw notFound('PACKAGE_NOT_FOUND', 'Ce forfait n’existe plus.');
    const space = await loadSpace(this.db, pkg.space_id);

    await inTransaction(this.db, async (trx) => {
      const states = await this.loadStates(trx, space.id, true);
      const current = states.find((s) => s.id === packageId)!;
      if (input.isFullDay !== undefined && input.isFullDay !== current.isFullDay) {
        throw badRequest(
          'PACKAGE_KIND_FIXED',
          'Un forfait ne peut pas devenir ou cesser d’être un forfait « journée » : créez-en un nouveau.',
        );
      }
      const nextPrices = { ...current.prices };
      if (input.prices) {
        for (const mode of SESSION_MODES) {
          if (!(mode in input.prices)) continue;
          const value = input.prices[mode];
          if (value === null || value === undefined) delete nextPrices[mode];
          else nextPrices[mode] = value;
        }
      }
      const next: PackageState = {
        ...current,
        name: input.name ?? current.name,
        slotCount: current.isFullDay
          ? null
          : input.slotCount !== undefined
            ? input.slotCount
            : current.slotCount,
        isActive: input.isActive ?? current.isActive,
        prices: nextPrices,
      };
      assertSize(next.isFullDay, next.slotCount);
      if (next.isActive && Object.keys(next.prices).length === 0) {
        throw badRequest(
          'PRICE_REQUIRED',
          'Un forfait actif doit avoir un prix pour au moins un mode.',
        );
      }
      await this.assertLadder(
        space,
        states.map((s) => (s.id === packageId ? next : s)),
      );

      await trx
        .updateTable('t_packages')
        .set({
          name: next.name,
          ...(input.nameEn !== undefined && { name_en: input.nameEn }),
          slot_count: next.slotCount,
          is_active: next.isActive,
          ...(input.description !== undefined && { description: input.description }),
          ...(input.sortOrder !== undefined && { sort_order: input.sortOrder }),
        })
        .where('id', '=', packageId)
        .execute();
      await this.writePrices(trx, packageId, current.prices, next.prices, admin.id);
      await auditAdmin(trx, admin.id, 'ADMIN_PACKAGE_UPDATED', 'package', packageId, {
        before: {
          name: current.name,
          slotCount: current.slotCount,
          isActive: current.isActive,
          prices: current.prices,
        },
        after: {
          name: next.name,
          slotCount: next.slotCount,
          isActive: next.isActive,
          prices: next.prices,
        },
      });
    });
    return this.list(space.id);
  }

  private async loadStates(
    db: Kysely<Database> | Transaction<Database>,
    spaceId: number,
    lock = false,
  ): Promise<PackageState[]> {
    let packagesQuery = db
      .selectFrom('t_packages')
      .select(['id', 'code', 'name', 'is_full_day', 'slot_count', 'is_active'])
      .where('space_id', '=', spaceId)
      .orderBy('sort_order')
      .orderBy('id');
    // Serialises concurrent catalog edits of one space (the ladder spans all its packages).
    if (lock) packagesQuery = packagesQuery.forUpdate();
    const packages = await packagesQuery.execute();
    if (packages.length === 0) return [];
    const prices = await db
      .selectFrom('t_package_prices')
      .select(['package_id', 'mode', 'price_xof'])
      .where(
        'package_id',
        'in',
        packages.map((p) => p.id),
      )
      .where('valid_to', 'is', null)
      .execute();
    return packages.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      isFullDay: p.is_full_day,
      slotCount: p.slot_count,
      isActive: p.is_active,
      prices: Object.fromEntries(
        prices.filter((pr) => pr.package_id === p.id).map((pr) => [pr.mode, pr.price_xof]),
      ),
    }));
  }

  /** Closes changed or removed prices and opens the new ones, effective now. */
  private async writePrices(
    trx: Transaction<Database>,
    packageId: number,
    before: Partial<Record<SessionMode, number>>,
    after: Partial<Record<SessionMode, number>>,
    adminId: number,
  ): Promise<void> {
    const now = this.clock.now();
    for (const mode of SESSION_MODES) {
      if (before[mode] === after[mode]) continue;
      if (before[mode] !== undefined) {
        await trx
          .updateTable('t_package_prices')
          .set({ valid_to: now })
          .where('package_id', '=', packageId)
          .where('mode', '=', mode)
          .where('valid_to', 'is', null)
          .execute();
      }
      if (after[mode] !== undefined) {
        await trx
          .insertInto('t_package_prices')
          .values({
            package_id: packageId,
            mode,
            price_xof: after[mode]!,
            valid_from: now,
            created_by: adminId,
          })
          .execute();
      }
    }
  }

  private async assertLadder(space: Space, states: PackageState[]): Promise<void> {
    const fullDay = await this.fullDaySlotCount(space);
    const violations: string[] = [];
    for (const mode of SESSION_MODES) {
      const entries: LadderEntry[] = states
        .filter((s) => s.isActive && s.prices[mode] !== undefined)
        .map((s) => ({
          code: s.code,
          name: s.name,
          slotCount: s.isFullDay ? fullDay : (s.slotCount ?? 0),
          priceXof: s.prices[mode]!,
        }))
        .filter((e) => e.slotCount > 0);
      if (entries.length === 0) continue;
      const label = mode === 'IN_PERSON' ? 'En studio' : 'Virtuel';
      for (const v of validatePriceLadder(entries)) violations.push(`${label} : ${v.message}`);
    }
    if (violations.length > 0) {
      throw badRequest('PRICE_RULE_VIOLATION', violations[0]!, { violations });
    }
  }

  /** Slots in the longest opening day of the week (what the full-day package covers at most). */
  private async fullDaySlotCount(space: Space): Promise<number> {
    const opening = await this.catalog.openingRules(space.id);
    const today = utcToLocalDate(this.clock.now(), space.timezone);
    let max = 0;
    for (let i = 0; i < 7; i++) {
      const date = addDays(today, i);
      max = Math.max(
        max,
        generateDaySlots(date, opening.get(isoWeekday(date)), toRules(space)).length,
      );
    }
    return max;
  }
}

function definedPrices(
  prices: Partial<Record<SessionMode, number | null>>,
): Partial<Record<SessionMode, number>> {
  const out: Partial<Record<SessionMode, number>> = {};
  for (const mode of SESSION_MODES) {
    const v = prices[mode];
    if (v !== null && v !== undefined) out[mode] = v;
  }
  return out;
}

function assertSize(isFullDay: boolean, slotCount: number | null): void {
  if (isFullDay) return;
  if (slotCount === null || !Number.isInteger(slotCount) || slotCount < 1 || slotCount > 20) {
    throw badRequest('INVALID_SLOT_COUNT', 'Le nombre de créneaux doit être entre 1 et 20.');
  }
}

/** "Pack 4h30" → "PACK_4H30", unique within the space. */
function uniqueCode(name: string, taken: Set<string>): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'FORFAIT';
  let code = base;
  for (let n = 2; taken.has(code); n++) code = `${base}_${n}`;
  return code;
}
