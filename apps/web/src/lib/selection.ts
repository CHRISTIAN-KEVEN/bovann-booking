import type {
  DayAvailabilityResponse,
  DayPackageDto,
  SlotDto,
  StartOptionDto,
} from '@bovann/shared';
import type { SelectionSummary } from './flow';

/**
 * Pure helpers for the day screen: summaries shown in the bottom bar and the
 * "switch to a package and save" suggestion. Prices always come from the API.
 */

/** Merges back-to-back slots into ranges: "08:00 – 11:00, 20:00 – 21:30". */
export function timesLabel(
  slots: Pick<SlotDto, 'start' | 'end' | 'startTime' | 'endTime'>[],
): string {
  const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start));
  const ranges: { startTime: string; endTime: string; end: string }[] = [];
  for (const s of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last.end === s.start) {
      last.endTime = s.endTime;
      last.end = s.end;
    } else {
      ranges.push({ startTime: s.startTime, endTime: s.endTime, end: s.end });
    }
  }
  return ranges.map((r) => `${r.startTime} – ${r.endTime}`).join(', ');
}

export function summarizeSlots(
  day: DayAvailabilityResponse,
  selectedStarts: readonly string[],
): SelectionSummary | null {
  const chosen = day.slots.filter((s) => selectedStarts.includes(s.start));
  if (chosen.length === 0) return null;
  const total = day.unitPriceXof * chosen.length;
  return {
    label: `${chosen.length} créneau${chosen.length > 1 ? 'x' : ''}`,
    timesLabel: timesLabel(chosen),
    slotCount: chosen.length,
    listPriceXof: total,
    discountXof: 0,
    totalXof: total,
  };
}

export function summarizePackage(pkg: DayPackageDto, option: StartOptionDto): SelectionSummary {
  return {
    label: pkg.name,
    timesLabel: `${option.startTime} – ${option.endTime}`,
    slotCount: pkg.slotCount,
    listPriceXof: pkg.price.listPriceXof,
    discountXof: pkg.price.discountXof,
    totalXof: pkg.price.totalXof,
  };
}

export interface PackageSuggestion {
  pkg: DayPackageDto;
  option: StartOptionDto;
  savingXof: number;
}

/**
 * When the customer picked N back-to-back slots and a cheaper N-slot package
 * starts at the same time, suggest it (design: "Passer au Pack 3h").
 */
export function suggestPackage(
  day: DayAvailabilityResponse,
  selectedStarts: readonly string[],
): PackageSuggestion | null {
  const chosen = day.slots
    .filter((s) => selectedStarts.includes(s.start))
    .sort((a, b) => a.start.localeCompare(b.start));
  if (chosen.length < 2) return null;
  for (let i = 1; i < chosen.length; i++) {
    if (chosen[i]!.start !== chosen[i - 1]!.end) return null;
  }
  const pkg = day.packages.find((p) => !p.isFullDay && p.slotCount === chosen.length);
  if (!pkg) return null;
  const option = pkg.startOptions.find((o) => o.start === chosen[0]!.start);
  const saving = day.unitPriceXof * chosen.length - pkg.price.totalXof;
  if (!option || saving <= 0) return null;
  return { pkg, option, savingXof: saving };
}
