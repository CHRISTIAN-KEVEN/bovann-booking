import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  PASS_DAYS,
  type AdminSellerDto,
  type LivePrices,
  type PassPlan,
  type SellerPassDto,
} from '@bovann/shared';
import type { Kysely, Transaction } from 'kysely';
import { auditAdmin } from '../admin/admin-audit';
import type { AdminPrincipal } from '../admin/auth/admin-auth.service';
import { inTransaction } from '../booking/booking-tx';
import { CLOCK, type Clock } from '../common/clock';
import { ApiError, badRequest, notFound } from '../common/errors';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';

type Db = Kysely<Database> | Transaction<Database>;

/**
 * Passes (30 or 365 days, prepaid) and their prices. Posting a live needs a pass in force.
 * A pass bought while another is running starts when that one ends, so nothing is lost.
 */
@Injectable()
export class PassesService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ prices

  async prices(db: Db = this.db): Promise<LivePrices> {
    const row = await db
      .selectFrom('t_live_prices')
      .select(['pass_month_xof', 'pass_year_xof'])
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    return { passMonthXof: row.pass_month_xof, passYearXof: row.pass_year_xof };
  }

  async setPrices(prices: LivePrices, admin: AdminPrincipal): Promise<LivePrices> {
    if (prices.passYearXof >= prices.passMonthXof * 12) {
      throw badRequest('PASS_YEAR_TOO_HIGH', {
        fr: `Le pass annuel doit coûter moins que 12 mois (${prices.passMonthXof * 12} FCFA).`,
        en: `The annual pass must cost less than 12 months (${prices.passMonthXof * 12} FCFA).`,
      });
    }
    await inTransaction(this.db, async (trx) => {
      await trx
        .updateTable('t_live_prices')
        .set({
          pass_month_xof: prices.passMonthXof,
          pass_year_xof: prices.passYearXof,
          updated_by_admin_id: admin.id,
        })
        .where('id', '=', 1)
        .execute();
      await auditAdmin(trx, admin.id, 'LIVE_PRICES_UPDATE', 'live_prices', 1, { ...prices });
    });
    return this.prices();
  }

  // ------------------------------------------------------------------ passes

  /** The seller's pass in force now (with the end of any pass bought ahead), or null. */
  async activePass(sellerId: number, now: Date, db: Db = this.db): Promise<SellerPassDto | null> {
    const rows = await db
      .selectFrom('t_seller_passes')
      .select(['plan', 'starts_at', 'ends_at'])
      .where('seller_id', '=', sellerId)
      .where('ends_at', '>', now)
      .orderBy('starts_at')
      .execute();
    const current = rows.find((p) => p.starts_at <= now);
    if (!current) return null;
    const last = rows[rows.length - 1]!;
    return {
      plan: current.plan,
      startsAt: current.starts_at.toISOString(),
      endsAt: last.ends_at.toISOString(),
    };
  }

  /**
   * Adds a pass to a seller, starting now or when their last pass ends. Call inside the
   * transaction that records the payment (or the staff grant).
   */
  async addPass(
    trx: Transaction<Database>,
    sellerId: number,
    plan: PassPlan,
    now: Date,
    source:
      | { paymentId: number; priceXof: number }
      | { adminId: number; priceXof: number; note: string | null },
  ): Promise<void> {
    // Serialises passes of one seller (two payments confirmed together still chain).
    await trx
      .selectFrom('t_sellers')
      .select('id')
      .where('id', '=', sellerId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const last = await trx
      .selectFrom('t_seller_passes')
      .select('ends_at')
      .where('seller_id', '=', sellerId)
      .where('ends_at', '>', now)
      .orderBy('ends_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    const startsAt = last ? last.ends_at : now;
    await trx
      .insertInto('t_seller_passes')
      .values({
        seller_id: sellerId,
        plan,
        starts_at: startsAt,
        ends_at: new Date(startsAt.getTime() + PASS_DAYS[plan] * 86_400_000),
        price_xof: source.priceXof,
        payment_id: 'paymentId' in source ? source.paymentId : null,
        granted_by_admin_id: 'adminId' in source ? source.adminId : null,
        note: 'note' in source ? source.note : null,
        created_at: now,
      })
      .execute();
  }

  /** Staff activate a pass after receiving the money (cash, transfer…). */
  async grant(
    sellerId: number,
    plan: PassPlan,
    note: string | null,
    admin: AdminPrincipal,
  ): Promise<AdminSellerDto> {
    await inTransaction(this.db, async (trx) => {
      const seller = await trx
        .selectFrom('t_sellers')
        .select(['id', 'blocked_at'])
        .where('id', '=', sellerId)
        .executeTakeFirst();
      if (!seller) throw notFound('SELLER_NOT_FOUND', 'Ce vendeur est introuvable.');
      if (seller.blocked_at) {
        throw new ApiError(HttpStatus.CONFLICT, 'SELLER_BLOCKED', 'Ce vendeur est bloqué.');
      }
      const prices = await this.prices(trx);
      const priceXof = plan === 'MONTH' ? prices.passMonthXof : prices.passYearXof;
      await this.addPass(trx, sellerId, plan, this.clock.now(), {
        adminId: admin.id,
        priceXof,
        note,
      });
      await auditAdmin(trx, admin.id, 'SELLER_PASS_GRANT', 'seller', sellerId, { plan, note });
    });
    const [seller] = await this.sellers(sellerId);
    return seller!;
  }

  /** Sellers, most recently active first, with their pass. */
  async sellers(onlyId?: number): Promise<AdminSellerDto[]> {
    const now = this.clock.now();
    const since = new Date(now.getTime() - 30 * 86_400_000);
    let query = this.db
      .selectFrom('t_sellers as s')
      .select((eb) => [
        's.id',
        's.phone_e164',
        's.created_at',
        's.last_sign_in_at',
        's.blocked_at',
        eb
          .selectFrom('t_lives as l')
          .select((e) => e.fn.countAll<number>().as('n'))
          .whereRef('l.seller_id', '=', 's.id')
          .where('l.created_at', '>=', since)
          .as('lives_count'),
      ])
      .orderBy('s.last_sign_in_at', 'desc')
      .orderBy('s.id', 'desc')
      .limit(500);
    if (onlyId) query = query.where('s.id', '=', onlyId);
    const rows = await query.execute();
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        phone: r.phone_e164,
        createdAt: r.created_at.toISOString(),
        lastSignInAt: r.last_sign_in_at?.toISOString() ?? null,
        livesCount: Number(r.lives_count ?? 0),
        pass: await this.activePass(r.id, now),
        blocked: r.blocked_at !== null,
      })),
    );
  }
}
