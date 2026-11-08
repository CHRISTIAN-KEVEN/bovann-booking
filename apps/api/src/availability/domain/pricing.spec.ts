import { evaluateDay, type SpaceRules } from './availability';
import {
  fullDayOption,
  packageStartOptions,
  quotePackage,
  quoteSlots,
  validatePriceLadder,
} from './pricing';

const RULES: SpaceRules = {
  timezone: 'Africa/Lome',
  slotDurationMin: 90,
  minLeadMin: 60,
  horizonDays: 90,
  fewSlotsThreshold: 3,
};
const OPEN = { isOpen: true, opensAt: '08:00:00', closesAt: '21:30:00' };
const NOW = new Date('2026-11-08T21:00:00Z');
const at = (t: string) => new Date(`2026-11-12T${t}:00Z`).getTime();

function dayWith(occupiedTimes: string[]) {
  return evaluateDay({
    date: '2026-11-12',
    opening: OPEN,
    rules: RULES,
    now: NOW,
    occupied: new Set(occupiedTimes.map(at)),
    closures: [],
  });
}

const starts = (options: { start: Date }[]) =>
  options.map((o) => o.start.toISOString().slice(11, 16));

describe('quotes', () => {
  it('single slots: count × unit price, no discount', () => {
    expect(quoteSlots(15000, 2)).toEqual({
      slotCount: 2,
      listPriceXof: 30000,
      discountXof: 0,
      totalXof: 30000,
    });
  });

  it('packages: discount versus single slots (seed prices)', () => {
    expect(quotePackage(27000, 15000, 2)).toEqual({
      slotCount: 2,
      listPriceXof: 30000,
      discountXof: 3000,
      totalXof: 27000,
    });
    expect(quotePackage(51000, 15000, 4)).toEqual({
      slotCount: 4,
      listPriceXof: 60000,
      discountXof: 9000,
      totalXof: 51000,
    });
    expect(quotePackage(108000, 15000, 9)).toEqual({
      slotCount: 9,
      listPriceXof: 135000,
      discountXof: 27000,
      totalXof: 108000,
    });
  });

  it('never produces a negative discount for a mispriced package', () => {
    const q = quotePackage(35000, 15000, 2);
    expect(q.discountXof).toBe(0);
    expect(q.totalXof).toBe(35000);
    expect(q.listPriceXof - q.discountXof).toBe(q.totalXof);
  });

  it('rejects invalid amounts', () => {
    expect(() => quoteSlots(0, 1)).toThrow(RangeError);
    expect(() => quoteSlots(15000.5, 1)).toThrow(RangeError);
    expect(() => quotePackage(27000, 15000, 0)).toThrow(RangeError);
  });
});

describe('package start options', () => {
  it('on an empty day, a 4-slot package can start at any of the first 6 slots', () => {
    expect(starts(packageStartOptions(dayWith([]), 4))).toEqual([
      '08:00',
      '09:30',
      '11:00',
      '12:30',
      '14:00',
      '15:30',
    ]);
  });

  it('matches the approved design: with 09:30, 11:00 and 18:30 booked, Pack 6h only fits at 12:30', () => {
    const d = dayWith(['09:30', '11:00', '18:30']);
    const options = packageStartOptions(d, 4);
    expect(starts(options)).toEqual(['12:30']);
    expect(options[0]!.end.toISOString()).toBe('2026-11-12T18:30:00.000Z');
  });

  it('a 2-slot package skips runs broken by a booked slot', () => {
    expect(starts(packageStartOptions(dayWith(['09:30', '11:00', '18:30']), 2))).toEqual([
      '12:30',
      '14:00',
      '15:30',
    ]);
  });

  it('respects the lead time today', () => {
    const today = evaluateDay({
      date: '2026-11-12',
      opening: OPEN,
      rules: RULES,
      now: new Date('2026-11-12T12:10:00Z'),
      occupied: new Set(),
      closures: [],
    });
    expect(starts(packageStartOptions(today, 4))).toEqual(['14:00', '15:30']);
  });

  it('full day only when every slot is free', () => {
    expect(fullDayOption(dayWith([]))?.slotCount).toBe(9);
    expect(fullDayOption(dayWith(['20:00']))).toBeNull();
  });
});

describe('validatePriceLadder', () => {
  const seed = [
    { code: 'SLOT', name: 'Créneau unique', slotCount: 1, priceXof: 15000 },
    { code: 'PACK_3H', name: 'Pack 3h', slotCount: 2, priceXof: 27000 },
    { code: 'PACK_6H', name: 'Pack 6h', slotCount: 4, priceXof: 51000 },
    { code: 'FULL_DAY', name: 'Journée', slotCount: 9, priceXof: 108000 },
  ];

  it('accepts the seed prices', () => {
    expect(validatePriceLadder(seed)).toEqual([]);
  });

  it('refuses a package that costs as much as its slots bought one by one', () => {
    const v = validatePriceLadder(
      seed.map((p) => (p.code === 'PACK_3H' ? { ...p, priceXof: 30000 } : p)),
    );
    expect(v.some((x) => x.code === 'PACK_3H' && x.message.includes('30 000 FCFA'))).toBe(true);
  });

  it('refuses a longer package that is not cheaper per slot than a shorter one', () => {
    // Pack 6h at 54 000 = 13 500/slot, same as Pack 3h at 27 000 = 13 500/slot.
    const v = validatePriceLadder(
      seed.map((p) => (p.code === 'PACK_6H' ? { ...p, priceXof: 54000 } : p)),
    );
    expect(v).toContainEqual({
      code: 'PACK_6H',
      message: '« Pack 6h » doit revenir moins cher par créneau que « Pack 3h ».',
    });
  });

  it('requires a single-slot reference price', () => {
    expect(validatePriceLadder(seed.filter((p) => p.slotCount !== 1))[0]!.code).toBe('*');
  });
});
