import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminSpaceCreate,
  AdminSpaceDto,
  AdminSpaceUpdate,
  ClosureCreate,
  ClosureDto,
  OpeningHoursDayDto,
  OpeningHoursUpdate,
  OwnerRecipientCreate,
  OwnerRecipientDto,
} from '@bovann/shared';
import type { Kysely } from 'kysely';
import { toRules } from '../availability/availability.service';
import { generateDaySlots, type OpeningRule } from '../availability/domain/availability';
import {
  addDays,
  isoWeekday,
  localToUtc,
  timeToMinutes,
  utcToLocalDate,
  utcToLocalTime,
} from '../availability/domain/time';
import { inTransaction, isDuplicateOn } from '../booking/booking-tx';
import { CLOCK, type Clock } from '../common/clock';
import { ApiError, badRequest, notFound } from '../common/errors';
import { DB } from '../database/database.module';
import type { Database, Space } from '../database/schema';
import { activeBookingsBetween, conflictError, loadSpace, toConflictDto } from './admin-common';
import { auditAdmin } from './admin-audit';
import type { AdminPrincipal } from './auth/admin-auth.service';

const DEFAULT_OPENS = '08:00:00';
const DEFAULT_CLOSES = '21:30:00';

export function toSpaceDto(s: Space): AdminSpaceDto {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    address: s.address,
    timezone: s.timezone,
    slotDurationMin: s.slot_duration_min,
    minLeadMin: s.min_lead_min,
    horizonDays: s.horizon_days,
    holdDurationMin: s.hold_duration_min,
    fewSlotsThreshold: s.few_slots_threshold,
    inPersonEnabled: s.in_person_enabled,
    virtualEnabled: s.virtual_enabled,
    isActive: s.is_active,
  };
}

/** "Ma salle — Lomé" → "ma-salle-lome". */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'espace';
}

@Injectable()
export class AdminSettingsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ spaces

  async listSpaces(): Promise<AdminSpaceDto[]> {
    const rows = await this.db.selectFrom('t_spaces').selectAll().orderBy('id').execute();
    return rows.map(toSpaceDto);
  }

  async getSpace(spaceId: number): Promise<AdminSpaceDto> {
    return toSpaceDto(await loadSpace(this.db, spaceId));
  }

  /** A new space starts with the default opening hours and no packages (not bookable yet). */
  async createSpace(input: AdminSpaceCreate, admin: AdminPrincipal): Promise<AdminSpaceDto> {
    if (!input.inPersonEnabled && !input.virtualEnabled) throw noModeError();
    const base = slugify(input.name);
    const id = await inTransaction(this.db, async (trx) => {
      let spaceId = 0;
      for (let n = 1; n <= 50 && !spaceId; n++) {
        try {
          const result = await trx
            .insertInto('t_spaces')
            .values({
              slug: n === 1 ? base : `${base}-${n}`,
              name: input.name,
              address: input.address ?? null,
              in_person_enabled: input.inPersonEnabled,
              virtual_enabled: input.virtualEnabled,
            })
            .executeTakeFirstOrThrow();
          spaceId = Number(result.insertId);
        } catch (error) {
          if (!isDuplicateOn(error, 'uq_spaces_slug')) throw error;
        }
      }
      if (!spaceId) throw new Error('Could not generate a unique space slug');
      await trx
        .insertInto('t_opening_hours')
        .values(
          [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
            space_id: spaceId,
            weekday,
            is_open: true,
            opens_at: DEFAULT_OPENS,
            closes_at: DEFAULT_CLOSES,
          })),
        )
        .execute();
      await auditAdmin(trx, admin.id, 'ADMIN_SPACE_CREATED', 'space', spaceId, {
        name: input.name,
      });
      return spaceId;
    });
    return this.getSpace(id);
  }

  async updateSpace(
    spaceId: number,
    input: AdminSpaceUpdate,
    admin: AdminPrincipal,
  ): Promise<AdminSpaceDto> {
    const space = await loadSpace(this.db, spaceId);
    const inPerson = input.inPersonEnabled ?? space.in_person_enabled;
    const virtual = input.virtualEnabled ?? space.virtual_enabled;
    if (!inPerson && !virtual) throw noModeError();

    const changes = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.address !== undefined && { address: input.address }),
      ...(input.minLeadMin !== undefined && { min_lead_min: input.minLeadMin }),
      ...(input.horizonDays !== undefined && { horizon_days: input.horizonDays }),
      ...(input.holdDurationMin !== undefined && { hold_duration_min: input.holdDurationMin }),
      ...(input.fewSlotsThreshold !== undefined && {
        few_slots_threshold: input.fewSlotsThreshold,
      }),
      ...(input.inPersonEnabled !== undefined && { in_person_enabled: input.inPersonEnabled }),
      ...(input.virtualEnabled !== undefined && { virtual_enabled: input.virtualEnabled }),
      ...(input.isActive !== undefined && { is_active: input.isActive }),
    };
    if (Object.keys(changes).length > 0) {
      await this.db.updateTable('t_spaces').set(changes).where('id', '=', spaceId).execute();
      await auditAdmin(this.db, admin.id, 'ADMIN_SPACE_UPDATED', 'space', spaceId, { ...input });
    }
    return this.getSpace(spaceId);
  }

  // ------------------------------------------------------------------ opening hours

  async openingHours(spaceId: number): Promise<OpeningHoursDayDto[]> {
    const space = await loadSpace(this.db, spaceId);
    const rows = await this.db
      .selectFrom('t_opening_hours')
      .select(['weekday', 'is_open', 'opens_at', 'closes_at'])
      .where('space_id', '=', spaceId)
      .orderBy('weekday')
      .execute();
    const byDay = new Map(rows.map((r) => [r.weekday, r]));
    const today = utcToLocalDate(this.clock.now(), space.timezone);
    return [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
      const r = byDay.get(weekday);
      const rule: OpeningRule = {
        isOpen: r?.is_open ?? false,
        opensAt: r?.opens_at ?? DEFAULT_OPENS,
        closesAt: r?.closes_at ?? DEFAULT_CLOSES,
      };
      return {
        weekday,
        isOpen: rule.isOpen,
        opensAt: rule.opensAt.slice(0, 5),
        closesAt: rule.closesAt.slice(0, 5),
        slotCount: generateDaySlots(nextDateWithWeekday(today, weekday), rule, toRules(space))
          .length,
      };
    });
  }

  /**
   * Replaces the weekly hours. Refused (409, with the list) if an upcoming
   * booking would fall outside the new slot grid: the studio must move or
   * cancel it first, so no customer silently loses a confirmed session.
   */
  async updateOpeningHours(
    spaceId: number,
    input: OpeningHoursUpdate,
    admin: AdminPrincipal,
  ): Promise<OpeningHoursDayDto[]> {
    const space = await loadSpace(this.db, spaceId);
    const weekdays = new Set(input.days.map((d) => d.weekday));
    if (input.days.length !== 7 || weekdays.size !== 7) {
      throw badRequest('INVALID_OPENING_HOURS', 'Indiquez les horaires des 7 jours de la semaine.');
    }
    for (const d of input.days) {
      if (
        d.isOpen &&
        timeToMinutes(d.closesAt) - timeToMinutes(d.opensAt) < space.slot_duration_min
      ) {
        throw badRequest(
          'OPENING_TOO_SHORT',
          `${WEEKDAY_FR[d.weekday]} : l’ouverture doit durer au moins un créneau (${space.slot_duration_min} min).`,
        );
      }
    }

    const now = this.clock.now();
    const rules = toRules(space);
    const newRules = new Map<number, OpeningRule>(
      input.days.map((d) => [
        d.weekday,
        { isOpen: d.isOpen, opensAt: `${d.opensAt}:00`, closesAt: `${d.closesAt}:00` },
      ]),
    );
    const upcoming = await activeBookingsBetween(
      this.db,
      space.id,
      now,
      new Date(now.getTime() + 3650 * 86_400_000),
      now,
    );
    const conflicts = upcoming.filter((b) =>
      b.slotStarts.some((start) => {
        const date = utcToLocalDate(start, space.timezone);
        return !generateDaySlots(date, newRules.get(isoWeekday(date)), rules).some(
          (s) => s.start.getTime() === start.getTime(),
        );
      }),
    );
    if (conflicts.length > 0) {
      throw conflictError(
        'OPENING_HOURS_CONFLICT',
        `Ces horaires excluraient ${conflicts.length} réservation${conflicts.length > 1 ? 's' : ''} à venir. Déplacez-les ou annulez-les d’abord.`,
        conflicts.map(toConflictDto),
      );
    }

    await inTransaction(this.db, async (trx) => {
      for (const d of input.days) {
        await trx
          .insertInto('t_opening_hours')
          .values({
            space_id: space.id,
            weekday: d.weekday,
            is_open: d.isOpen,
            opens_at: `${d.opensAt}:00`,
            closes_at: `${d.closesAt}:00`,
          })
          .onDuplicateKeyUpdate({
            is_open: d.isOpen,
            opens_at: `${d.opensAt}:00`,
            closes_at: `${d.closesAt}:00`,
          })
          .execute();
      }
      await auditAdmin(trx, admin.id, 'ADMIN_OPENING_HOURS_UPDATED', 'space', space.id, {
        days: input.days,
      });
    });
    return this.openingHours(spaceId);
  }

  // ------------------------------------------------------------------ closures

  async closures(spaceId: number): Promise<ClosureDto[]> {
    const space = await loadSpace(this.db, spaceId);
    const rows = await this.db
      .selectFrom('t_closures')
      .select(['id', 'starts_at', 'ends_at', 'reason'])
      .where('space_id', '=', spaceId)
      .where('ends_at', '>', this.clock.now())
      .orderBy('starts_at')
      .execute();
    return rows.map((r) => toClosureDto(r, space.timezone));
  }

  /** Closed days or hours. Refused if active bookings fall inside (cancel them first). */
  async createClosure(
    spaceId: number,
    input: ClosureCreate,
    admin: AdminPrincipal,
  ): Promise<ClosureDto> {
    const space = await loadSpace(this.db, spaceId);
    const tz = space.timezone;
    if (input.endDate < input.startDate) {
      throw badRequest('INVALID_RANGE', 'La date de fin doit suivre la date de début.');
    }
    const partial = input.startTime !== undefined || input.endTime !== undefined;
    if (partial && (!input.startTime || !input.endTime)) {
      throw badRequest('INVALID_RANGE', 'Indiquez l’heure de début et l’heure de fin.');
    }
    const startsAt = localToUtc(input.startDate, partial ? timeToMinutes(input.startTime!) : 0, tz);
    const endsAt = partial
      ? localToUtc(input.endDate, timeToMinutes(input.endTime!), tz)
      : localToUtc(addDays(input.endDate, 1), 0, tz);
    if (endsAt <= startsAt) {
      throw badRequest('INVALID_RANGE', 'La fin de la fermeture doit suivre son début.');
    }
    const now = this.clock.now();
    if (endsAt <= now) {
      throw badRequest('CLOSURE_IN_PAST', 'Cette fermeture est entièrement dans le passé.');
    }

    const conflicts = await activeBookingsBetween(this.db, space.id, startsAt, endsAt, now);
    const overlapping = conflicts.filter((b) =>
      b.slotStarts.some((s) => {
        const end = new Date(s.getTime() + space.slot_duration_min * 60_000);
        return s < endsAt && startsAt < end;
      }),
    );
    if (overlapping.length > 0) {
      throw conflictError(
        'CLOSURE_CONFLICT',
        `${overlapping.length} réservation${overlapping.length > 1 ? 's tombent' : ' tombe'} pendant cette fermeture. Annulez-les ou déplacez-les d’abord.`,
        overlapping.map(toConflictDto),
      );
    }

    const result = await this.db
      .insertInto('t_closures')
      .values({
        space_id: space.id,
        starts_at: startsAt,
        ends_at: endsAt,
        reason: input.reason ?? null,
        created_by: admin.id,
      })
      .executeTakeFirstOrThrow();
    const id = Number(result.insertId);
    await auditAdmin(this.db, admin.id, 'ADMIN_CLOSURE_CREATED', 'closure', id, {
      spaceId: space.id,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      reason: input.reason ?? null,
    });
    return toClosureDto(
      { id, starts_at: startsAt, ends_at: endsAt, reason: input.reason ?? null },
      tz,
    );
  }

  async deleteClosure(closureId: number, admin: AdminPrincipal): Promise<void> {
    const result = await this.db
      .deleteFrom('t_closures')
      .where('id', '=', closureId)
      .executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) {
      throw notFound('CLOSURE_NOT_FOUND', 'Cette fermeture n’existe plus.');
    }
    await auditAdmin(this.db, admin.id, 'ADMIN_CLOSURE_DELETED', 'closure', closureId);
  }

  // ------------------------------------------------------------------ owner email recipients

  async recipients(spaceId: number): Promise<OwnerRecipientDto[]> {
    await loadSpace(this.db, spaceId);
    const rows = await this.db
      .selectFrom('t_space_owner_recipients')
      .select(['id', 'email', 'name', 'is_active'])
      .where('space_id', '=', spaceId)
      .orderBy('id')
      .execute();
    return rows.map((r) => ({ id: r.id, email: r.email, name: r.name, isActive: r.is_active }));
  }

  async addRecipient(
    spaceId: number,
    input: OwnerRecipientCreate,
    admin: AdminPrincipal,
  ): Promise<OwnerRecipientDto[]> {
    await loadSpace(this.db, spaceId);
    try {
      const result = await this.db
        .insertInto('t_space_owner_recipients')
        .values({ space_id: spaceId, email: input.email, name: input.name ?? null })
        .executeTakeFirstOrThrow();
      await auditAdmin(
        this.db,
        admin.id,
        'ADMIN_RECIPIENT_ADDED',
        'owner_recipient',
        Number(result.insertId),
        { spaceId, email: input.email },
      );
    } catch (error) {
      if (isDuplicateOn(error, 'uq_owner_recipients_space_email')) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'RECIPIENT_EXISTS',
          'Cette adresse reçoit déjà les notifications.',
        );
      }
      throw error;
    }
    return this.recipients(spaceId);
  }

  async updateRecipient(
    recipientId: number,
    isActive: boolean,
    admin: AdminPrincipal,
  ): Promise<OwnerRecipientDto[]> {
    const row = await this.recipientOrThrow(recipientId);
    await this.db
      .updateTable('t_space_owner_recipients')
      .set({ is_active: isActive })
      .where('id', '=', recipientId)
      .execute();
    await auditAdmin(this.db, admin.id, 'ADMIN_RECIPIENT_UPDATED', 'owner_recipient', recipientId, {
      isActive,
    });
    return this.recipients(row.space_id);
  }

  async deleteRecipient(recipientId: number, admin: AdminPrincipal): Promise<OwnerRecipientDto[]> {
    const row = await this.recipientOrThrow(recipientId);
    await this.db.deleteFrom('t_space_owner_recipients').where('id', '=', recipientId).execute();
    await auditAdmin(this.db, admin.id, 'ADMIN_RECIPIENT_DELETED', 'owner_recipient', recipientId, {
      email: row.email,
    });
    return this.recipients(row.space_id);
  }

  private async recipientOrThrow(id: number) {
    const row = await this.db
      .selectFrom('t_space_owner_recipients')
      .select(['space_id', 'email'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound('RECIPIENT_NOT_FOUND', 'Cette adresse n’existe plus.');
    return row;
  }
}

export const WEEKDAY_FR: Record<number, string> = {
  1: 'Lundi',
  2: 'Mardi',
  3: 'Mercredi',
  4: 'Jeudi',
  5: 'Vendredi',
  6: 'Samedi',
  7: 'Dimanche',
};

function noModeError(): ApiError {
  return badRequest('NO_MODE', 'Proposez au moins un mode : en studio ou virtuel.');
}

function nextDateWithWeekday(from: string, weekday: number): string {
  return addDays(from, (weekday - isoWeekday(from) + 7) % 7);
}

function toClosureDto(
  r: { id: number; starts_at: Date; ends_at: Date; reason: string | null },
  tz: string,
): ClosureDto {
  const startDate = utcToLocalDate(r.starts_at, tz);
  const startTime = utcToLocalTime(r.starts_at, tz);
  const endTime = utcToLocalTime(r.ends_at, tz);
  const allDay = startTime === '00:00' && endTime === '00:00';
  // A whole-day closure ends at midnight the next day: show the last closed day.
  const endDate = utcToLocalDate(allDay ? new Date(r.ends_at.getTime() - 1) : r.ends_at, tz);
  return {
    id: r.id,
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
    startDate,
    endDate,
    startTime,
    endTime,
    allDay,
    reason: r.reason,
  };
}
