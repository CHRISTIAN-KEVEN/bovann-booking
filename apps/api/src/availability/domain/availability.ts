import type { DayStatus, SlotStatus } from '@bovann/shared';
import { addDays, isValidTimeZone, localToUtc, timeToMinutes, utcToLocalDate } from './time';

/**
 * Pure availability rules: no database, no clock. Everything the rules need
 * is passed in, so every edge case can be unit-tested deterministically.
 */

export interface Interval {
  start: Date;
  end: Date;
}

export interface OpeningRule {
  isOpen: boolean;
  /** 'HH:MM[:SS]' local time. */
  opensAt: string;
  closesAt: string;
}

export interface SpaceRules {
  timezone: string;
  slotDurationMin: number;
  /** A slot can be booked until this many minutes before it starts. */
  minLeadMin: number;
  /** Bookings are open up to this many days ahead (today + horizonDays included). */
  horizonDays: number;
  /** A day with this many available slots or fewer shows as "presque complet". */
  fewSlotsThreshold: number;
}

/**
 * Slot and day statuses come from the shared API contract (packages/shared).
 * BOOKED covers both customer bookings and admin blocks: customers are never
 * told why a slot is unavailable.
 */
export type { DayStatus, SlotStatus };

export interface SlotAvailability extends Interval {
  status: SlotStatus;
}

export interface DayAvailability {
  date: string;
  status: DayStatus;
  slots: SlotAvailability[];
  availableCount: number;
}

export interface DayInput {
  date: string;
  opening: OpeningRule | undefined;
  rules: SpaceRules;
  now: Date;
  /** Start instants (ms) of slots currently held by a booking or an admin block. */
  occupied: ReadonlySet<number>;
  closures: readonly Interval[];
}

/**
 * The slot grid of one day: back-to-back slots from opening time, each fully
 * inside opening hours (a slot that would end after closing is not offered).
 */
export function generateDaySlots(
  date: string,
  opening: OpeningRule | undefined,
  rules: SpaceRules,
): Interval[] {
  if (!opening || !opening.isOpen) return [];
  if (!isValidTimeZone(rules.timezone))
    throw new RangeError(`Unknown time zone "${rules.timezone}"`);
  if (!Number.isInteger(rules.slotDurationMin) || rules.slotDurationMin <= 0) {
    throw new RangeError(`Invalid slot duration ${rules.slotDurationMin}`);
  }
  const open = timeToMinutes(opening.opensAt);
  const close = timeToMinutes(opening.closesAt);
  const slots: Interval[] = [];
  for (let t = open; t + rules.slotDurationMin <= close; t += rules.slotDurationMin) {
    slots.push({
      start: localToUtc(date, t, rules.timezone),
      end: localToUtc(date, t + rules.slotDurationMin, rules.timezone),
    });
  }
  return slots;
}

/** Last local date on which slots can be booked. */
export function lastBookableDate(now: Date, rules: SpaceRules): string {
  return addDays(utcToLocalDate(now, rules.timezone), rules.horizonDays);
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function evaluateDay(input: DayInput): DayAvailability {
  const { date, opening, rules, now, occupied, closures } = input;
  const today = utcToLocalDate(now, rules.timezone);
  const beyondHorizon = date > lastBookableDate(now, rules);
  const bookableFrom = now.getTime() + rules.minLeadMin * 60_000;

  const slots: SlotAvailability[] = generateDaySlots(date, opening, rules).map((slot) => {
    let status: SlotStatus;
    if (closures.some((closure) => overlaps(slot, closure))) status = 'CLOSED';
    else if (slot.start.getTime() < bookableFrom) status = 'PAST';
    else if (beyondHorizon) status = 'OUT_OF_RANGE';
    else if (occupied.has(slot.start.getTime())) status = 'BOOKED';
    else status = 'AVAILABLE';
    return { ...slot, status };
  });

  const availableCount = slots.filter((s) => s.status === 'AVAILABLE').length;
  return {
    date,
    slots,
    availableCount,
    status: dayStatus(date, today, beyondHorizon, slots, availableCount, rules),
  };
}

function dayStatus(
  date: string,
  today: string,
  beyondHorizon: boolean,
  slots: SlotAvailability[],
  availableCount: number,
  rules: SpaceRules,
): DayStatus {
  if (date < today) return 'PAST';
  if (slots.length === 0) return 'CLOSED';
  if (beyondHorizon) return 'OUT_OF_RANGE';
  const openSlots = slots.filter((s) => s.status !== 'CLOSED');
  if (openSlots.length === 0) return 'CLOSED';
  if (availableCount === 0) {
    return openSlots.every((s) => s.status === 'PAST') ? 'PAST' : 'FULL';
  }
  return availableCount <= rules.fewSlotsThreshold ? 'FEW' : 'AVAILABLE';
}
