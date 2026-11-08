import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  discountPercent,
  type DayAvailabilityResponse,
  type DayPackageDto,
  type MonthAvailabilityResponse,
  type PackageDto,
  type PackagesResponse,
  type SessionMode,
  type SpaceDto,
  type StartOptionDto,
} from '@bovann/shared';
import { ApiError, badRequest, notFound } from '../common/errors';
import { CLOCK, type Clock } from '../common/clock';
import type { Space } from '../database/schema';
import { CatalogRepository, type PackageWithPrice } from './catalog.repository';
import {
  evaluateDay,
  generateDaySlots,
  lastBookableDate,
  type DayAvailability,
  type Interval,
  type OpeningRule,
  type SpaceRules,
} from './domain/availability';
import { fullDayOption, packageStartOptions, quotePackage, type Quote } from './domain/pricing';
import {
  addDays,
  datesOfMonth,
  isoWeekday,
  localToUtc,
  utcToLocalDate,
  utcToLocalTime,
} from './domain/time';

/**
 * Orchestrates catalog and availability reads: loads data through the
 * repository, applies the pure domain rules, shapes the public DTOs.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly repo: CatalogRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getSpace(slug: string): Promise<SpaceDto> {
    const space = await this.loadSpace(slug);
    const now = this.clock.now();
    const rules = toRules(space);
    return {
      slug: space.slug,
      name: space.name,
      address: space.address,
      timezone: space.timezone,
      slotDurationMin: space.slot_duration_min,
      modes: enabledModes(space),
      booking: {
        minLeadMin: space.min_lead_min,
        horizonDays: space.horizon_days,
        today: utcToLocalDate(now, space.timezone),
        lastBookableDate: lastBookableDate(now, rules),
      },
    };
  }

  async getPackages(slug: string, mode: SessionMode): Promise<PackagesResponse> {
    const space = await this.loadSpace(slug);
    assertModeEnabled(space, mode);
    const now = this.clock.now();
    const [packages, opening] = await Promise.all([
      this.repo.packagesWithPrices(space.id, mode, now),
      this.repo.openingRules(space.id),
    ]);
    const unitPriceXof = unitPrice(packages);
    const longestDay = longestDaySlotCount(space, opening, now);
    return {
      mode,
      unitPriceXof,
      packages: packages
        .map((p) => ({ p, count: p.isFullDay ? longestDay : (p.slotCount ?? 0) }))
        .filter(({ count }) => count > 0)
        .map(({ p, count }) => toPackageDto(p, count, unitPriceXof, space)),
    };
  }

  async getMonth(slug: string, month: string): Promise<MonthAvailabilityResponse> {
    const space = await this.loadSpace(slug);
    const dates = datesOfMonth(month);
    const days = await this.evaluateRange(space, dates);
    return {
      month,
      days: days.map((d) => ({ date: d.date, status: d.status, availableCount: d.availableCount })),
    };
  }

  async getDay(slug: string, date: string, mode: SessionMode): Promise<DayAvailabilityResponse> {
    const space = await this.loadSpace(slug);
    assertModeEnabled(space, mode);
    const now = this.clock.now();
    const [[day], packages] = await Promise.all([
      this.evaluateRange(space, [date]),
      this.repo.packagesWithPrices(space.id, mode, now),
    ]);
    const unitPriceXof = unitPrice(packages);
    const tz = space.timezone;

    const dayPackages: DayPackageDto[] = packages.flatMap((p) => {
      if (p.isFullDay) {
        const fit = fullDayOption(day!);
        const count = fit?.slotCount ?? day!.slots.length;
        if (count === 0) return [];
        return [
          {
            ...toPackageDto(p, count, unitPriceXof, space),
            startOptions: fit ? [toOption(fit.option, tz)] : [],
          },
        ];
      }
      const count = p.slotCount ?? 0;
      if (count === 0) return [];
      return [
        {
          ...toPackageDto(p, count, unitPriceXof, space),
          startOptions: packageStartOptions(day!, count).map((o) => toOption(o, tz)),
        },
      ];
    });

    return {
      date,
      mode,
      status: day!.status,
      availableCount: day!.availableCount,
      unitPriceXof,
      slots: day!.slots.map((s) => ({ ...toOption(s, tz), status: s.status })),
      packages: dayPackages,
    };
  }

  /** Evaluates consecutive local dates with one query per data source. */
  private async evaluateRange(space: Space, dates: string[]): Promise<DayAvailability[]> {
    const now = this.clock.now();
    const rules = toRules(space);
    const from = localToUtc(dates[0]!, 0, space.timezone);
    const to = localToUtc(addDays(dates[dates.length - 1]!, 1), 0, space.timezone);
    const [opening, closures, occupied] = await Promise.all([
      this.repo.openingRules(space.id),
      this.repo.closures(space.id, from, to),
      this.repo.occupiedSlotStarts(space.id, from, to, now),
    ]);
    return dates.map((date) =>
      evaluateDay({ date, opening: opening.get(isoWeekday(date)), rules, now, occupied, closures }),
    );
  }

  private async loadSpace(slug: string): Promise<Space> {
    const space = await this.repo.findActiveSpace(slug);
    if (!space) throw notFound('SPACE_NOT_FOUND', 'Cet espace est introuvable.');
    return space;
  }
}

function toRules(space: Space): SpaceRules {
  return {
    timezone: space.timezone,
    slotDurationMin: space.slot_duration_min,
    minLeadMin: space.min_lead_min,
    horizonDays: space.horizon_days,
    fewSlotsThreshold: space.few_slots_threshold,
  };
}

function enabledModes(space: Space): SessionMode[] {
  const modes: SessionMode[] = [];
  if (space.in_person_enabled) modes.push('IN_PERSON');
  if (space.virtual_enabled) modes.push('VIRTUAL');
  return modes;
}

function assertModeEnabled(space: Space, mode: SessionMode): void {
  if (!enabledModes(space).includes(mode)) {
    throw badRequest(
      'MODE_NOT_AVAILABLE',
      "Ce mode de réservation n'est pas proposé pour cet espace.",
    );
  }
}

function unitPrice(packages: PackageWithPrice[]): number {
  const single = packages.find((p) => !p.isFullDay && p.slotCount === 1);
  if (!single) {
    throw new ApiError(
      HttpStatus.SERVICE_UNAVAILABLE,
      'PRICING_UNAVAILABLE',
      'Les tarifs de cet espace ne sont pas encore disponibles.',
    );
  }
  return single.priceXof;
}

/** Slots in the longest opening day of the week (full-day package size in the catalog). */
function longestDaySlotCount(space: Space, opening: Map<number, OpeningRule>, now: Date): number {
  const rules = toRules(space);
  const today = utcToLocalDate(now, space.timezone);
  let max = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(today, i);
    max = Math.max(max, generateDaySlots(date, opening.get(isoWeekday(date)), rules).length);
  }
  return max;
}

function toPackageDto(
  p: PackageWithPrice,
  slotCount: number,
  unitPriceXof: number,
  space: Space,
): PackageDto {
  const quote: Quote = quotePackage(p.priceXof, unitPriceXof, slotCount);
  return {
    code: p.code,
    name: p.name,
    description: p.description,
    isFullDay: p.isFullDay,
    slotCount,
    durationMin: slotCount * space.slot_duration_min,
    price: {
      listPriceXof: quote.listPriceXof,
      discountXof: quote.discountXof,
      totalXof: quote.totalXof,
      discountPercent: discountPercent(quote.totalXof, unitPriceXof, slotCount),
    },
  };
}

function toOption(interval: Interval, timeZone: string): StartOptionDto {
  return {
    start: interval.start.toISOString(),
    end: interval.end.toISOString(),
    startTime: utcToLocalTime(interval.start, timeZone),
    endTime: utcToLocalTime(interval.end, timeZone),
  };
}
