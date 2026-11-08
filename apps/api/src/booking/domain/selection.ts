import type { BookingSelectionInput, BookingType } from '@bovann/shared';
import type { DayAvailability, Interval } from '../../availability/domain/availability';
import {
  fullDayOption,
  packageStartOptions,
  quotePackage,
  quoteSlots,
  type Quote,
} from '../../availability/domain/pricing';

/** A business rule refused the request. `message` is French, shown to the customer. */
export class BookingRuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CatalogPackage {
  id: number;
  code: string;
  name: string;
  isFullDay: boolean;
  slotCount: number | null;
  priceXof: number;
}

export interface ResolvedSelection {
  bookingType: BookingType;
  packageId: number | null;
  packageName: string | null;
  slots: Interval[];
  quote: Quote;
}

const MAX_SINGLE_SLOTS = 20;

/**
 * Checks what the customer picked against the day's live availability and the
 * catalog, and prices it. Pure: the same inputs always give the same answer.
 * The database lock taken afterwards remains the final word on concurrency.
 */
export function resolveSelection(
  day: DayAvailability,
  selection: BookingSelectionInput,
  packages: readonly CatalogPackage[],
  unitPriceXof: number,
): ResolvedSelection {
  if (selection.type === 'SLOTS') {
    const starts = [...new Set(selection.slotStarts.map((s) => new Date(s).getTime()))].sort(
      (a, b) => a - b,
    );
    if (starts.length === 0)
      throw new BookingRuleError('EMPTY_SELECTION', 'Choisissez au moins un créneau.');
    if (starts.length > MAX_SINGLE_SLOTS) {
      throw new BookingRuleError(
        'TOO_MANY_SLOTS',
        'Trop de créneaux sélectionnés en une seule réservation.',
      );
    }
    const slots = starts.map((start) => {
      const slot = day.slots.find((s) => s.start.getTime() === start);
      if (!slot) {
        throw new BookingRuleError(
          'SLOT_NOT_FOUND',
          'Un des créneaux choisis n’existe pas pour cette date.',
        );
      }
      if (slot.status !== 'AVAILABLE') throw slotUnavailable();
      return { start: slot.start, end: slot.end };
    });
    return {
      bookingType: 'SLOTS',
      packageId: null,
      packageName: null,
      slots,
      quote: quoteSlots(unitPriceXof, slots.length),
    };
  }

  const pkg = packages.find((p) => p.code === selection.packageCode);
  if (!pkg) throw new BookingRuleError('PACKAGE_NOT_FOUND', 'Ce forfait n’est pas disponible.');
  const start = new Date(selection.start).getTime();

  let count: number;
  let option: Interval | undefined;
  if (pkg.isFullDay) {
    const fit = fullDayOption(day);
    count = fit?.slotCount ?? 0;
    option = fit && fit.option.start.getTime() === start ? fit.option : undefined;
  } else {
    count = pkg.slotCount ?? 0;
    option =
      count > 0
        ? packageStartOptions(day, count).find((o) => o.start.getTime() === start)
        : undefined;
  }
  if (!option) {
    throw new BookingRuleError(
      'PACKAGE_DOES_NOT_FIT',
      'Ce forfait n’est plus disponible à cette heure. Choisissez une autre heure de début.',
    );
  }

  const firstIndex = day.slots.findIndex((s) => s.start.getTime() === start);
  const slots = day.slots
    .slice(firstIndex, firstIndex + count)
    .map((s) => ({ start: s.start, end: s.end }));
  return {
    bookingType: 'PACKAGE',
    packageId: pkg.id,
    packageName: pkg.name,
    slots,
    quote: quotePackage(pkg.priceXof, unitPriceXof, count),
  };
}

export function slotUnavailable(): BookingRuleError {
  return new BookingRuleError(
    'SLOT_UNAVAILABLE',
    'Désolé, un des créneaux choisis vient d’être réservé. Choisissez un autre horaire.',
  );
}
