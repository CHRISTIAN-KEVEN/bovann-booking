import { evaluateDay, type SpaceRules } from '../../availability/domain/availability';
import { generateAccessToken, generateReference, hashAccessToken } from './identifiers';
import { BookingRuleError, resolveSelection, type CatalogPackage } from './selection';

describe('identifiers', () => {
  it('references read BOV-YYMM-XXXXX without confusable letters', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateReference('2026-11-12')).toMatch(/^BOV-2611-[0-9A-HJKMNP-TV-Z]{5}$/);
    }
  });

  it('access tokens are random and only their hash is comparable', () => {
    const a = generateAccessToken();
    const b = generateAccessToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(hashAccessToken(a.token)).toBe(a.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('resolveSelection', () => {
  const rules: SpaceRules = {
    timezone: 'Africa/Lome',
    slotDurationMin: 90,
    minLeadMin: 60,
    horizonDays: 90,
    fewSlotsThreshold: 3,
  };
  const day = evaluateDay({
    date: '2026-11-12',
    opening: { isOpen: true, opensAt: '08:00:00', closesAt: '21:30:00' },
    rules,
    now: new Date('2026-11-08T21:00:00Z'),
    occupied: new Set(
      ['09:30', '11:00', '18:30'].map((t) => new Date(`2026-11-12T${t}:00Z`).getTime()),
    ),
    closures: [],
  });
  const packages: CatalogPackage[] = [
    {
      id: 1,
      code: 'SLOT',
      name: 'Créneau unique',
      isFullDay: false,
      slotCount: 1,
      priceXof: 15000,
    },
    { id: 2, code: 'PACK_3H', name: 'Pack 3h', isFullDay: false, slotCount: 2, priceXof: 27000 },
    { id: 3, code: 'PACK_6H', name: 'Pack 6h', isFullDay: false, slotCount: 4, priceXof: 51000 },
    {
      id: 4,
      code: 'FULL_DAY',
      name: 'Journée',
      isFullDay: true,
      slotCount: null,
      priceXof: 108000,
    },
  ];
  const t = (hhmm: string) => `2026-11-12T${hhmm}:00.000Z`;
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      return (error as BookingRuleError).code;
    }
    return 'NO_ERROR';
  };

  it('prices separate single slots at the unit price, sorted, duplicates ignored', () => {
    const r = resolveSelection(
      day,
      { type: 'SLOTS', slotStarts: [t('20:00'), t('08:00'), t('08:00')] },
      packages,
      15000,
    );
    expect(r.bookingType).toBe('SLOTS');
    expect(r.slots.map((s) => s.start.toISOString())).toEqual([t('08:00'), t('20:00')]);
    expect(r.quote).toEqual({ slotCount: 2, listPriceXof: 30000, discountXof: 0, totalXof: 30000 });
  });

  it('refuses a booked slot as unavailable and a made-up time as not found', () => {
    expect(
      code(() =>
        resolveSelection(day, { type: 'SLOTS', slotStarts: [t('09:30')] }, packages, 15000),
      ),
    ).toBe('SLOT_UNAVAILABLE');
    expect(
      code(() =>
        resolveSelection(day, { type: 'SLOTS', slotStarts: [t('10:00')] }, packages, 15000),
      ),
    ).toBe('SLOT_NOT_FOUND');
  });

  it('refuses a slot of another day', () => {
    expect(
      code(() =>
        resolveSelection(
          day,
          { type: 'SLOTS', slotStarts: [t('08:00'), '2026-11-13T08:00:00.000Z'] },
          packages,
          15000,
        ),
      ),
    ).toBe('SLOT_NOT_FOUND');
  });

  it('books Pack 6h at 12:30 with its discount and the 4 slots', () => {
    const r = resolveSelection(
      day,
      { type: 'PACKAGE', packageCode: 'PACK_6H', start: t('12:30') },
      packages,
      15000,
    );
    expect(r.packageId).toBe(3);
    expect(r.slots).toHaveLength(4);
    expect(r.slots[3]!.end.toISOString()).toBe(t('18:30'));
    expect(r.quote).toEqual({
      slotCount: 4,
      listPriceXof: 60000,
      discountXof: 9000,
      totalXof: 51000,
    });
  });

  it('refuses a package start where it does not fit, the full day on a partly booked day, an unknown package', () => {
    expect(
      code(() =>
        resolveSelection(
          day,
          { type: 'PACKAGE', packageCode: 'PACK_6H', start: t('14:00') },
          packages,
          15000,
        ),
      ),
    ).toBe('PACKAGE_DOES_NOT_FIT');
    expect(
      code(() =>
        resolveSelection(
          day,
          { type: 'PACKAGE', packageCode: 'FULL_DAY', start: t('08:00') },
          packages,
          15000,
        ),
      ),
    ).toBe('PACKAGE_DOES_NOT_FIT');
    expect(
      code(() =>
        resolveSelection(
          day,
          { type: 'PACKAGE', packageCode: 'NOPE', start: t('08:00') },
          packages,
          15000,
        ),
      ),
    ).toBe('PACKAGE_NOT_FOUND');
  });
});
