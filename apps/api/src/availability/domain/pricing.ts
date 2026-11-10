import { formatXof } from '@bovann/shared';
import type { DayAvailability, Interval } from './availability';

/**
 * Package fit and price rules. All amounts are whole XOF.
 *
 * The unit price is the price of the single-slot package: the reference that
 * every discount is measured against.
 */

export interface Quote {
  slotCount: number;
  listPriceXof: number;
  discountXof: number;
  totalXof: number;
}

/** Price of N single slots bought one by one. */
export function quoteSlots(unitPriceXof: number, slotCount: number): Quote {
  assertAmount(unitPriceXof);
  assertCount(slotCount);
  const list = unitPriceXof * slotCount;
  return { slotCount, listPriceXof: list, discountXof: 0, totalXof: list };
}

/**
 * Price of a package covering `slotCount` slots. The discount is the saving
 * versus buying those slots one by one, never negative: a mispriced package
 * (more expensive than single slots) shows no discount instead of a negative one.
 * Satisfies the database rule total = list − discount.
 */
export function quotePackage(
  packagePriceXof: number,
  unitPriceXof: number,
  slotCount: number,
): Quote {
  assertAmount(packagePriceXof);
  assertAmount(unitPriceXof);
  assertCount(slotCount);
  const reference = unitPriceXof * slotCount;
  const list = Math.max(reference, packagePriceXof);
  return {
    slotCount,
    listPriceXof: list,
    discountXof: list - packagePriceXof,
    totalXof: packagePriceXof,
  };
}

/**
 * Start times at which a package of `slotCount` consecutive slots fits:
 * every slot in the run must be available and directly follow the previous one.
 */
export function packageStartOptions(day: DayAvailability, slotCount: number): Interval[] {
  assertCount(slotCount);
  const { slots } = day;
  const options: Interval[] = [];
  for (let i = 0; i + slotCount <= slots.length; i++) {
    let fits = true;
    for (let j = i; j < i + slotCount; j++) {
      const slot = slots[j]!;
      const next = slots[j + 1];
      if (slot.status !== 'AVAILABLE') fits = false;
      else if (j < i + slotCount - 1 && next && next.start.getTime() !== slot.end.getTime())
        fits = false;
      if (!fits) break;
    }
    if (fits) options.push({ start: slots[i]!.start, end: slots[i + slotCount - 1]!.end });
  }
  return options;
}

/** A full-day package fits only when every slot of the day is available. */
export function fullDayOption(
  day: DayAvailability,
): { slotCount: number; option: Interval } | null {
  const { slots } = day;
  if (slots.length === 0 || slots.some((s) => s.status !== 'AVAILABLE')) return null;
  return {
    slotCount: slots.length,
    option: { start: slots[0]!.start, end: slots[slots.length - 1]!.end },
  };
}

export interface LadderEntry {
  code: string;
  name: string;
  /** For a full-day package: the largest number of slots in a day of the week. */
  slotCount: number;
  priceXof: number;
}

export interface PriceRuleViolation {
  code: string;
  message: string;
  /** The same in English (the API sends it when the request asks for English). */
  messageEn?: string;
}

/**
 * Business rule agreed with the product owner: longer packages must be cheaper
 * per slot than shorter ones, and every multi-slot package must cost less than
 * buying its slots one by one. Used when an admin saves prices (Phase 5).
 * Messages are in French because they are shown to the admin.
 */
export function validatePriceLadder(entries: readonly LadderEntry[]): PriceRuleViolation[] {
  const violations: PriceRuleViolation[] = [];
  const single = entries.find((e) => e.slotCount === 1);
  if (!single) {
    return [
      {
        code: '*',
        message:
          'Un forfait « créneau unique » (1 créneau) est obligatoire : il sert de prix de référence.',
      },
    ];
  }

  for (const e of entries) {
    if (e.slotCount >= 2 && e.priceXof >= single.priceXof * e.slotCount) {
      violations.push({
        code: e.code,
        message: `« ${e.name} » doit coûter moins de ${formatXof(single.priceXof * e.slotCount)} (${e.slotCount} créneaux à l'unité).`,
        messageEn: `“${e.name}” must cost less than ${formatXof(single.priceXof * e.slotCount, 'en')} (${e.slotCount} single slots).`,
      });
    }
  }

  const sorted = [...entries].sort((a, b) => a.slotCount - b.slotCount);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const shorter = sorted[i]!;
      const longer = sorted[j]!;
      if (longer.slotCount === shorter.slotCount) continue;
      // Per-slot price must strictly decrease: shorter/sc > longer/lc, compared without floats.
      if (longer.priceXof * shorter.slotCount >= shorter.priceXof * longer.slotCount) {
        violations.push({
          code: longer.code,
          message: `« ${longer.name} » doit revenir moins cher par créneau que « ${shorter.name} ».`,
          messageEn: `“${longer.name}” must cost less per slot than “${shorter.name}”.`,
        });
      }
    }
  }
  return dedupe(violations);
}

function dedupe(violations: PriceRuleViolation[]): PriceRuleViolation[] {
  const seen = new Set<string>();
  return violations.filter((v) => {
    const key = `${v.code}|${v.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assertAmount(value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`Invalid XOF amount ${value}`);
}

function assertCount(value: number): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`Invalid slot count ${value}`);
}
