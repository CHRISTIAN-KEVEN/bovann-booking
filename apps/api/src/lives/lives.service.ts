import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminLiveDto,
  AdminLiveListResponse,
  AdminLiveTab,
  CategoryIcon,
  LiveCategoryDto,
  LiveCountry,
  LiveDto,
  LiveWallResponse,
} from '@bovann/shared';
import type { Kysely } from 'kysely';
import { auditAdmin } from '../admin/admin-audit';
import type { AdminPrincipal } from '../admin/auth/admin-auth.service';
import { inTransaction } from '../booking/booking-tx';
import { CLOCK, type Clock } from '../common/clock';
import { ApiError, badRequest, notFound } from '../common/errors';
import { localized } from '../common/request-context';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';

/** The wall shows at most this many lives (far above what is expected at once). */
export const WALL_LIMIT = 500;
/** "Terminés" in the admin: listings of the last 30 days, newest first. */
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

/** Row shape shared by the wall and admin queries. */
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

/**
 * Live directory ("En direct"). A live is on the wall while it is APPROVED and
 * starts_at <= now < ends_at: expiry needs no background job. Staff can list a live for a
 * seller (it is approved at once) and take one down; sellers' own posting comes next.
 */
@Injectable()
export class LivesService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ public

  async wall(): Promise<LiveWallResponse> {
    const now = this.clock.now();
    const [rows, categories] = await Promise.all([
      this.baseQuery()
        .where('l.status', '=', 'APPROVED')
        .where('l.starts_at', '<=', now)
        .where('l.ends_at', '>', now)
        .orderBy('l.starts_at', 'desc')
        .orderBy('l.id', 'desc')
        .limit(WALL_LIMIT)
        .execute(),
      this.categories(),
    ]);
    return { now: now.toISOString(), lives: rows.map(toLiveDto), categories };
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

  // ------------------------------------------------------------------ admin

  async adminList(tab: AdminLiveTab): Promise<AdminLiveListResponse> {
    const now = this.clock.now();
    let query = this.adminQuery();
    if (tab === 'online') {
      query = query
        .where('l.status', '=', 'APPROVED')
        .where('l.ends_at', '>', now)
        .orderBy('l.starts_at', 'desc');
    } else {
      const since = new Date(now.getTime() - PAST_DAYS * 86_400_000);
      query = query
        .where('l.created_at', '>=', since)
        .where((eb) => eb.or([eb('l.status', '!=', 'APPROVED'), eb('l.ends_at', '<=', now)]))
        .orderBy('l.created_at', 'desc')
        .limit(PAST_LIMIT);
    }
    const rows = await query.orderBy('l.id', 'desc').execute();
    return { now: now.toISOString(), lives: rows.map(toAdminLiveDto) };
  }

  /** Staff list a live for a seller: approved and on the wall at once, for `durationMin`. */
  async create(input: LiveCreateInput, admin: AdminPrincipal): Promise<AdminLiveDto> {
    const id = await inTransaction(this.db, async (trx) => {
      const now = this.clock.now();
      let categoryId: number | null = null;
      if (input.categoryCode) {
        const category = await trx
          .selectFrom('t_categories')
          .select('id')
          .where('code', '=', input.categoryCode)
          .where('is_active', '=', true)
          .executeTakeFirst();
        if (!category) {
          throw badRequest(
            'CATEGORY_NOT_FOUND',
            'Cette catégorie n’existe pas. Choisissez-en une autre.',
          );
        }
        categoryId = category.id;
      }

      // The same live can't be on the wall twice (locks the link so two staff can't race).
      const online = await trx
        .selectFrom('t_lives')
        .select('id')
        .where('url', '=', input.url)
        .where('status', '=', 'APPROVED')
        .where('ends_at', '>', now)
        .forUpdate()
        .executeTakeFirst();
      if (online) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'LIVE_ALREADY_ONLINE',
          'Ce live est déjà sur le mur.',
        );
      }

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

  private adminQuery() {
    return this.baseQuery()
      .leftJoin('t_admin_users as cb', 'cb.id', 'l.created_by_admin_id')
      .leftJoin('t_admin_users as eb', 'eb.id', 'l.ended_by_admin_id')
      .select([
        'l.status',
        'l.duration_min',
        'l.created_at',
        'l.ended_at',
        'l.end_reason',
        'cb.full_name as added_by',
        'eb.full_name as ended_by',
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
    startedAt: (row.starts_at ?? new Date(0)).toISOString(),
    endsAt: (row.ends_at ?? new Date(0)).toISOString(),
  };
}

function toAdminLiveDto(
  row: LiveRow & {
    status: AdminLiveDto['status'];
    duration_min: number;
    created_at: Date;
    ended_at: Date | null;
    end_reason: string | null;
    added_by: string | null;
    ended_by: string | null;
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
  };
}
