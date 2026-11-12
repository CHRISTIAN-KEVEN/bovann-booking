import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  REVIEW_TIMEZONE,
  SELLER_LIVES_PER_DAY,
  type AdminLiveDto,
  type AdminLiveListResponse,
  type AdminLiveTab,
  type CategoryIcon,
  type LiveCategoryDto,
  type LiveCountry,
  type LiveDto,
  type LiveStatus,
  type LiveWallResponse,
  type ReviewPeriod,
  type ReviewStatus,
  type SellerLiveDto,
  type SellerLivesResponse,
} from '@bovann/shared';
import type { Kysely, Transaction } from 'kysely';
import { auditAdmin } from '../admin/admin-audit';
import type { AdminPrincipal } from '../admin/auth/admin-auth.service';
import { localToUtc, utcToLocalDate } from '../availability/domain/time';
import { inTransaction } from '../booking/booking-tx';
import { CLOCK, type Clock } from '../common/clock';
import { ApiError, badRequest, notFound } from '../common/errors';
import { localized } from '../common/request-context';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { PassesService } from './passes.service';
import { reviewHoursProblems, reviewStatus } from './review-hours';

/** The wall shows at most this many lives (far above what is expected at once). */
export const WALL_LIMIT = 500;
/** "Terminés" in the admin and a seller's history: the last 30 days. */
const PAST_DAYS = 30;
const PAST_LIMIT = 200;

export interface LiveCreateInput {
  sellerName: string;
  url: string;
  platform: 'TIKTOK' | 'FACEBOOK';
  countryCode: LiveCountry;
  categoryCode: string | null;
  categoryOther: string | null;
  durationMin: number;
}

/** Row shape shared by the wall, sellers' and admin queries. */
interface LiveRow {
  id: number;
  seller_name: string;
  platform: 'TIKTOK' | 'FACEBOOK';
  url: string;
  country_code: string;
  category_other: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  category_code: string | null;
  category_name_fr: string | null;
  category_name_en: string | null;
  category_icon: CategoryIcon | null;
}

interface FullRow extends LiveRow {
  status: LiveStatus;
  duration_min: number;
  created_at: Date;
  reviewed_at: Date | null;
  reject_reason: string | null;
}

/**
 * Live directory ("En direct").
 *
 * - A live is on the wall while it is APPROVED and starts_at <= now < ends_at: expiry needs no
 *   background job.
 * - Sellers post during review hours; the request waits (PENDING) until staff approve it
 *   (it goes on the wall at once, for the duration chosen) or reject it with a message.
 * - Staff can also list a live for a seller (approved at once) and take one down.
 */
@Injectable()
export class LivesService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly passes: PassesService,
  ) {}

  // ------------------------------------------------------------------ public

  async wall(): Promise<LiveWallResponse> {
    const now = this.clock.now();
    const [rows, categories, review] = await Promise.all([
      this.baseQuery()
        .where('l.status', '=', 'APPROVED')
        .where('l.starts_at', '<=', now)
        .where('l.ends_at', '>', now)
        .orderBy('l.starts_at', 'desc')
        .orderBy('l.id', 'desc')
        .limit(WALL_LIMIT)
        .execute(),
      this.categories(),
      this.review(now),
    ]);
    return { now: now.toISOString(), lives: rows.map(toLiveDto), categories, review };
  }

  async categories(): Promise<LiveCategoryDto[]> {
    const rows = await this.db
      .selectFrom('t_categories')
      .select(['code', 'name_fr', 'name_en', 'icon'])
      .where('is_active', '=', true)
      .orderBy('sort_order')
      .orderBy('id')
      .execute();
    return rows.map((c) => ({ code: c.code, name: localized(c.name_fr, c.name_en), icon: c.icon }));
  }

  // ------------------------------------------------------------------ review hours

  async reviewPeriods(db: Kysely<Database> = this.db): Promise<ReviewPeriod[]> {
    const rows = await db
      .selectFrom('t_review_hours')
      .select(['weekday', 'opens_at', 'closes_at'])
      .orderBy('weekday')
      .orderBy('opens_at')
      .execute();
    return rows.map((r) => ({
      weekday: r.weekday,
      opensAt: r.opens_at.slice(0, 5),
      closesAt: r.closes_at.slice(0, 5),
    }));
  }

  async review(now = this.clock.now()): Promise<ReviewStatus> {
    return reviewStatus(await this.reviewPeriods(), now, REVIEW_TIMEZONE);
  }

  /** Replaces the whole week (administrators). */
  async setReviewPeriods(periods: ReviewPeriod[], admin: AdminPrincipal): Promise<ReviewPeriod[]> {
    const problems = reviewHoursProblems(periods);
    if (problems.length > 0) {
      throw badRequest(
        'REVIEW_HOURS_INVALID',
        problems[0]!,
        problems.map((message) => ({ message })),
      );
    }
    await inTransaction(this.db, async (trx) => {
      await trx.deleteFrom('t_review_hours').execute();
      if (periods.length > 0) {
        await trx
          .insertInto('t_review_hours')
          .values(
            periods.map((p) => ({
              weekday: p.weekday,
              opens_at: `${p.opensAt}:00`,
              closes_at: `${p.closesAt}:00`,
            })),
          )
          .execute();
      }
      await auditAdmin(trx, admin.id, 'REVIEW_HOURS_UPDATE', 'review_hours', 0, { periods });
    });
    return this.reviewPeriods();
  }

  // ------------------------------------------------------------------ sellers

  async sellerLives(sellerId: number): Promise<SellerLivesResponse> {
    const now = this.clock.now();
    const since = new Date(now.getTime() - PAST_DAYS * 86_400_000);
    const [rows, review, categories, pass, prices] = await Promise.all([
      this.fullQuery()
        .where('l.seller_id', '=', sellerId)
        .where('l.created_at', '>=', since)
        .orderBy('l.created_at', 'desc')
        .orderBy('l.id', 'desc')
        .limit(PAST_LIMIT)
        .execute(),
      this.review(now),
      this.categories(),
      this.passes.activePass(sellerId, now),
      this.passes.prices(),
    ]);
    return {
      now: now.toISOString(),
      lives: rows.map(toSellerLiveDto),
      review,
      categories,
      pass,
      prices,
    };
  }

  /**
   * A seller posts their live: it waits for staff review. Only during review hours, and only
   * with a pass in force (decision of 2026-11-12). Staff approval then puts it online at once;
   * the pass is not checked again, so a pass ending during the review doesn't lose the live.
   */
  async submit(sellerId: number, input: LiveCreateInput): Promise<SellerLiveDto> {
    const id = await inTransaction(this.db, async (trx) => {
      const now = this.clock.now();
      // One submission at a time per seller (limits below are checked under this lock).
      await trx
        .selectFrom('t_sellers')
        .select('id')
        .where('id', '=', sellerId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      if (!(await this.passes.activePass(sellerId, now, trx))) {
        throw new ApiError(
          HttpStatus.PAYMENT_REQUIRED,
          'PASS_REQUIRED',
          'Prenez un pass pour publier vos lives.',
        );
      }

      const review = reviewStatus(await this.reviewPeriods(trx), now, REVIEW_TIMEZONE);
      if (!review.open) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'REVIEW_CLOSED',
          'Les lives sont vérifiés seulement pendant les heures de validation. Revenez à la prochaine ouverture.',
          { nextOpensAt: review.nextOpensAt },
        );
      }

      const pending = await trx
        .selectFrom('t_lives')
        .select('id')
        .where('seller_id', '=', sellerId)
        .where('status', '=', 'PENDING')
        .executeTakeFirst();
      if (pending) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'LIVE_PENDING_EXISTS',
          'Vous avez déjà un live en vérification. Attendez la réponse avant d’en envoyer un autre.',
          { liveId: pending.id },
        );
      }

      const today = utcToLocalDate(now, REVIEW_TIMEZONE);
      const { count } = await trx
        .selectFrom('t_lives')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('seller_id', '=', sellerId)
        .where('status', '!=', 'CANCELLED')
        .where('created_at', '>=', localToUtc(today, 0, REVIEW_TIMEZONE))
        .executeTakeFirstOrThrow();
      if (Number(count) >= SELLER_LIVES_PER_DAY) {
        throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'LIVE_DAILY_LIMIT', {
          fr: `Vous avez déjà envoyé ${SELLER_LIVES_PER_DAY} lives aujourd’hui. Revenez demain.`,
          en: `You have already sent ${SELLER_LIVES_PER_DAY} lives today. Come back tomorrow.`,
        });
      }

      await this.assertLinkFree(trx, input.url, now);
      const categoryId = await this.categoryId(trx, input.categoryCode);
      const inserted = await trx
        .insertInto('t_lives')
        .values({
          seller_id: sellerId,
          seller_name: input.sellerName,
          platform: input.platform,
          url: input.url,
          country_code: input.countryCode,
          category_id: categoryId,
          category_other: categoryId ? null : input.categoryOther,
          duration_min: input.durationMin,
          status: 'PENDING',
          created_at: now,
        })
        .executeTakeFirstOrThrow();
      return Number(inserted.insertId);
    });
    return this.sellerGet(sellerId, id);
  }

  /** The seller withdraws a request (before review) or ends their live early ("J’ai terminé"). */
  async sellerEnd(sellerId: number, liveId: number): Promise<SellerLiveDto> {
    await inTransaction(this.db, async (trx) => {
      const now = this.clock.now();
      const live = await trx
        .selectFrom('t_lives')
        .select(['id', 'status', 'ends_at'])
        .where('id', '=', liveId)
        .where('seller_id', '=', sellerId)
        .forUpdate()
        .executeTakeFirst();
      if (!live) throw notFound('LIVE_NOT_FOUND', 'Ce live est introuvable.');
      if (live.status === 'PENDING') {
        await trx
          .updateTable('t_lives')
          .set({ status: 'CANCELLED', ended_at: now })
          .where('id', '=', liveId)
          .execute();
      } else if (live.status === 'APPROVED' && live.ends_at && live.ends_at > now) {
        await trx
          .updateTable('t_lives')
          .set({ status: 'ENDED', ended_at: now })
          .where('id', '=', liveId)
          .execute();
      } else {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'LIVE_NOT_ONLINE',
          'Ce live n’est plus sur le mur.',
        );
      }
    });
    return this.sellerGet(sellerId, liveId);
  }

  private async sellerGet(sellerId: number, id: number): Promise<SellerLiveDto> {
    const row = await this.fullQuery()
      .where('l.id', '=', id)
      .where('l.seller_id', '=', sellerId)
      .executeTakeFirst();
    if (!row) throw notFound('LIVE_NOT_FOUND', 'Ce live est introuvable.');
    return toSellerLiveDto(row);
  }

  // ------------------------------------------------------------------ admin

  async adminList(tab: AdminLiveTab): Promise<AdminLiveListResponse> {
    const now = this.clock.now();
    let query = this.adminQuery();
    if (tab === 'pending') {
      query = query.where('l.status', '=', 'PENDING').orderBy('l.created_at', 'asc');
    } else if (tab === 'online') {
      query = query
        .where('l.status', '=', 'APPROVED')
        .where('l.ends_at', '>', now)
        .orderBy('l.starts_at', 'desc');
    } else {
      const since = new Date(now.getTime() - PAST_DAYS * 86_400_000);
      query = query
        .where('l.created_at', '>=', since)
        .where('l.status', '!=', 'PENDING')
        .where((eb) => eb.or([eb('l.status', '!=', 'APPROVED'), eb('l.ends_at', '<=', now)]))
        .orderBy('l.created_at', 'desc')
        .limit(PAST_LIMIT);
    }
    const [rows, pendingCount, review] = await Promise.all([
      query.orderBy('l.id', 'desc').execute(),
      this.pendingCount(),
      this.review(now),
    ]);
    return { now: now.toISOString(), lives: rows.map(toAdminLiveDto), pendingCount, review };
  }

  async pendingCount(): Promise<number> {
    const { count } = await this.db
      .selectFrom('t_lives')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('status', '=', 'PENDING')
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  /** Staff list a live for a seller: approved and on the wall at once, for `durationMin`. */
  async create(input: LiveCreateInput, admin: AdminPrincipal): Promise<AdminLiveDto> {
    const id = await inTransaction(this.db, async (trx) => {
      const now = this.clock.now();
      const categoryId = await this.categoryId(trx, input.categoryCode);
      await this.assertLinkFree(trx, input.url, now);
      const inserted = await trx
        .insertInto('t_lives')
        .values({
          seller_name: input.sellerName,
          platform: input.platform,
          url: input.url,
          country_code: input.countryCode,
          category_id: categoryId,
          category_other: categoryId ? null : input.categoryOther,
          duration_min: input.durationMin,
          status: 'APPROVED',
          starts_at: now,
          ends_at: new Date(now.getTime() + input.durationMin * 60_000),
          created_by_admin_id: admin.id,
          created_at: now,
        })
        .executeTakeFirstOrThrow();
      const liveId = Number(inserted.insertId);
      await auditAdmin(trx, admin.id, 'LIVE_CREATE', 'live', liveId, {
        url: input.url,
        durationMin: input.durationMin,
      });
      return liveId;
    });
    return this.adminGet(id);
  }

  /** Approves a request: on the wall from now, for the duration the seller chose. */
  async approve(id: number, admin: AdminPrincipal): Promise<AdminLiveDto> {
    await inTransaction(this.db, async (trx) => {
      const now = this.clock.now();
      const live = await this.lockPending(trx, id);
      await this.assertLinkFree(trx, live.url, now, id);
      await trx
        .updateTable('t_lives')
        .set({
          status: 'APPROVED',
          starts_at: now,
          ends_at: new Date(now.getTime() + live.duration_min * 60_000),
          reviewed_by_admin_id: admin.id,
          reviewed_at: now,
        })
        .where('id', '=', id)
        .execute();
      await auditAdmin(trx, admin.id, 'LIVE_APPROVE', 'live', id, {});
    });
    return this.adminGet(id);
  }

  /** Refuses a request; the reason is shown to the seller. */
  async reject(id: number, reason: string, admin: AdminPrincipal): Promise<AdminLiveDto> {
    await inTransaction(this.db, async (trx) => {
      const now = this.clock.now();
      await this.lockPending(trx, id);
      await trx
        .updateTable('t_lives')
        .set({
          status: 'REJECTED',
          reviewed_by_admin_id: admin.id,
          reviewed_at: now,
          reject_reason: reason,
        })
        .where('id', '=', id)
        .execute();
      await auditAdmin(trx, admin.id, 'LIVE_REJECT', 'live', id, { reason });
    });
    return this.adminGet(id);
  }

  /** Takes a live off the wall at once (wrong link, finished early, content not allowed…). */
  async remove(id: number, reason: string | null, admin: AdminPrincipal): Promise<AdminLiveDto> {
    await inTransaction(this.db, async (trx) => {
      const now = this.clock.now();
      const live = await trx
        .selectFrom('t_lives')
        .select(['id', 'status', 'ends_at'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!live) throw notFound('LIVE_NOT_FOUND', 'Ce live est introuvable.');
      if (live.status !== 'APPROVED' || !live.ends_at || live.ends_at <= now) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'LIVE_NOT_ONLINE',
          'Ce live n’est plus sur le mur.',
        );
      }
      await trx
        .updateTable('t_lives')
        .set({ status: 'REMOVED', ended_at: now, ended_by_admin_id: admin.id, end_reason: reason })
        .where('id', '=', id)
        .execute();
      await auditAdmin(trx, admin.id, 'LIVE_REMOVE', 'live', id, { reason });
    });
    return this.adminGet(id);
  }

  private async adminGet(id: number): Promise<AdminLiveDto> {
    const row = await this.adminQuery().where('l.id', '=', id).executeTakeFirst();
    if (!row) throw notFound('LIVE_NOT_FOUND', 'Ce live est introuvable.');
    return toAdminLiveDto(row);
  }

  // ------------------------------------------------------------------ shared steps

  private async lockPending(trx: Transaction<Database>, id: number) {
    const live = await trx
      .selectFrom('t_lives')
      .select(['id', 'status', 'url', 'duration_min'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!live) throw notFound('LIVE_NOT_FOUND', 'Ce live est introuvable.');
    if (live.status !== 'PENDING') {
      throw new ApiError(HttpStatus.CONFLICT, 'LIVE_NOT_PENDING', 'Ce live a déjà été traité.');
    }
    return live;
  }

  private async categoryId(
    trx: Transaction<Database>,
    code: string | null,
  ): Promise<number | null> {
    if (!code) return null;
    const category = await trx
      .selectFrom('t_categories')
      .select('id')
      .where('code', '=', code)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (!category) {
      throw badRequest(
        'CATEGORY_NOT_FOUND',
        'Cette catégorie n’existe pas. Choisissez-en une autre.',
      );
    }
    return category.id;
  }

  /**
   * The same live can't be on the wall twice, or wait for review while it is on the wall.
   * Locks the link's rows so two staff (or a seller and staff) can't race.
   */
  private async assertLinkFree(
    trx: Transaction<Database>,
    url: string,
    now: Date,
    exceptId?: number,
  ): Promise<void> {
    let query = trx
      .selectFrom('t_lives')
      .select(['id', 'status'])
      .where('url', '=', url)
      .where((eb) =>
        eb.or([
          eb('status', '=', 'PENDING'),
          eb.and([eb('status', '=', 'APPROVED'), eb('ends_at', '>', now)]),
        ]),
      );
    if (exceptId) query = query.where('id', '!=', exceptId);
    const taken = await query.forUpdate().executeTakeFirst();
    if (taken?.status === 'APPROVED') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'LIVE_ALREADY_ONLINE',
        'Ce live est déjà sur le mur.',
      );
    }
    if (taken) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'LIVE_ALREADY_PENDING',
        'Ce live est déjà en vérification.',
      );
    }
  }

  // ------------------------------------------------------------------ queries

  private baseQuery() {
    return this.db
      .selectFrom('t_lives as l')
      .leftJoin('t_categories as c', 'c.id', 'l.category_id')
      .select([
        'l.id',
        'l.seller_name',
        'l.platform',
        'l.url',
        'l.country_code',
        'l.category_other',
        'l.starts_at',
        'l.ends_at',
        'c.code as category_code',
        'c.name_fr as category_name_fr',
        'c.name_en as category_name_en',
        'c.icon as category_icon',
      ]);
  }

  private fullQuery() {
    return this.baseQuery().select([
      'l.status',
      'l.duration_min',
      'l.created_at',
      'l.reviewed_at',
      'l.reject_reason',
    ]);
  }

  private adminQuery() {
    return this.fullQuery()
      .leftJoin('t_admin_users as cb', 'cb.id', 'l.created_by_admin_id')
      .leftJoin('t_admin_users as eb', 'eb.id', 'l.ended_by_admin_id')
      .leftJoin('t_admin_users as rb', 'rb.id', 'l.reviewed_by_admin_id')
      .leftJoin('t_sellers as s', 's.id', 'l.seller_id')
      .select([
        'l.ended_at',
        'l.end_reason',
        'cb.full_name as added_by',
        'eb.full_name as ended_by',
        'rb.full_name as reviewed_by',
        's.phone_e164 as seller_phone',
      ]);
  }
}

function toLiveDto(row: LiveRow): LiveDto {
  const hasCategory = row.category_code !== null;
  return {
    id: row.id,
    sellerName: row.seller_name,
    platform: row.platform,
    url: row.url,
    countryCode: row.country_code as LiveCountry,
    categoryCode: row.category_code,
    categoryLabel: hasCategory
      ? localized(row.category_name_fr ?? '', row.category_name_en)
      : (row.category_other ?? ''),
    categoryIcon: hasCategory ? (row.category_icon ?? 'autre') : 'autre',
    // Not on the wall yet (waiting for review): no times.
    startedAt: row.starts_at?.toISOString() ?? '',
    endsAt: row.ends_at?.toISOString() ?? '',
  };
}

function toSellerLiveDto(row: FullRow): SellerLiveDto {
  return {
    ...toLiveDto(row),
    status: row.status,
    durationMin: row.duration_min,
    createdAt: row.created_at.toISOString(),
    rejectReason: row.reject_reason,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
  };
}

function toAdminLiveDto(
  row: FullRow & {
    ended_at: Date | null;
    end_reason: string | null;
    added_by: string | null;
    ended_by: string | null;
    reviewed_by: string | null;
    seller_phone: string | null;
  },
): AdminLiveDto {
  return {
    ...toLiveDto(row),
    status: row.status,
    durationMin: row.duration_min,
    createdAt: row.created_at.toISOString(),
    addedBy: row.added_by,
    endedAt: row.ended_at?.toISOString() ?? null,
    endedBy: row.ended_by,
    endReason: row.end_reason,
    sellerPhone: row.seller_phone,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    rejectReason: row.reject_reason,
  };
}
