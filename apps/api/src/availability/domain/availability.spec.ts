import {
  evaluateDay,
  generateDaySlots,
  lastBookableDate,
  type DayInput,
  type SpaceRules,
} from './availability';

const RULES: SpaceRules = {
  timezone: 'Africa/Lome',
  slotDurationMin: 90,
  minLeadMin: 60,
  horizonDays: 90,
  fewSlotsThreshold: 3,
};
const OPEN = { isOpen: true, opensAt: '08:00:00', closesAt: '21:30:00' };
const NOW = new Date('2026-11-08T21:00:00Z'); // Sunday evening in Lomé
const at = (iso: string) => new Date(iso).getTime();

function day(overrides: Partial<DayInput> = {}): ReturnType<typeof evaluateDay> {
  return evaluateDay({
    date: '2026-11-12',
    opening: OPEN,
    rules: RULES,
    now: NOW,
    occupied: new Set(),
    closures: [],
    ...overrides,
  });
}

describe('generateDaySlots', () => {
  it('makes 9 slots of 1h30 between 08:00 and 21:30', () => {
    const slots = generateDaySlots('2026-11-12', OPEN, RULES);
    expect(slots).toHaveLength(9);
    expect(slots[0]!.start.toISOString()).toBe('2026-11-12T08:00:00.000Z');
    expect(slots[8]!.end.toISOString()).toBe('2026-11-12T21:30:00.000Z');
  });

  it('never offers a slot that would end after closing time', () => {
    const slots = generateDaySlots('2026-11-12', { ...OPEN, closesAt: '21:00:00' }, RULES);
    expect(slots).toHaveLength(8);
    expect(slots[7]!.end.toISOString()).toBe('2026-11-12T20:00:00.000Z');
  });

  it('returns no slots on a closed weekday or without hours', () => {
    expect(generateDaySlots('2026-11-12', { ...OPEN, isOpen: false }, RULES)).toEqual([]);
    expect(generateDaySlots('2026-11-12', undefined, RULES)).toEqual([]);
  });

  it('places slots correctly in a zone with an offset', () => {
    const slots = generateDaySlots('2026-11-12', OPEN, { ...RULES, timezone: 'Africa/Lagos' });
    expect(slots[0]!.start.toISOString()).toBe('2026-11-12T07:00:00.000Z');
  });
});

describe('evaluateDay', () => {
  it('a future empty day is fully available', () => {
    const d = day();
    expect(d.status).toBe('AVAILABLE');
    expect(d.availableCount).toBe(9);
    expect(d.slots.every((s) => s.status === 'AVAILABLE')).toBe(true);
  });

  it('marks booked and blocked slots without revealing which', () => {
    const d = day({ occupied: new Set([at('2026-11-12T09:30:00Z'), at('2026-11-12T11:00:00Z')]) });
    expect(d.slots[1]!.status).toBe('BOOKED');
    expect(d.slots[2]!.status).toBe('BOOKED');
    expect(d.availableCount).toBe(7);
    expect(d.status).toBe('AVAILABLE');
  });

  it('is "presque complet" with 3 or fewer slots left', () => {
    const occupied = new Set(
      ['08:00', '09:30', '11:00', '12:30', '14:00', '15:30'].map((t) => at(`2026-11-12T${t}:00Z`)),
    );
    const d = day({ occupied });
    expect(d.availableCount).toBe(3);
    expect(d.status).toBe('FEW');
  });

  it('is full when every slot is taken', () => {
    const occupied = new Set(
      generateDaySlots('2026-11-12', OPEN, RULES).map((s) => s.start.getTime()),
    );
    expect(day({ occupied }).status).toBe('FULL');
  });

  it('respects the 1-hour booking lead time today', () => {
    // Thursday 12:10 in Lomé: 12:30 starts in 20 min (too late), 14:00 is fine.
    const d = day({ now: new Date('2026-11-12T12:10:00Z') });
    expect(d.slots[3]!.status).toBe('PAST'); // 12:30
    expect(d.slots[4]!.status).toBe('AVAILABLE'); // 14:00
    expect(d.availableCount).toBe(5);
  });

  it('a day whose slots are all over is PAST, not FULL', () => {
    expect(day({ now: new Date('2026-11-12T21:00:00Z') }).status).toBe('PAST');
  });

  it('earlier dates are PAST', () => {
    expect(day({ date: '2026-11-07' }).status).toBe('PAST');
  });

  it('days beyond the 90-day horizon cannot be booked', () => {
    expect(lastBookableDate(NOW, RULES)).toBe('2027-02-06');
    expect(day({ date: '2027-02-06' }).status).toBe('AVAILABLE');
    const beyond = day({ date: '2027-02-07' });
    expect(beyond.status).toBe('OUT_OF_RANGE');
    expect(beyond.availableCount).toBe(0);
  });

  it('a closure covering the whole day closes it', () => {
    const d = day({
      closures: [
        { start: new Date('2026-11-12T00:00:00Z'), end: new Date('2026-11-13T00:00:00Z') },
      ],
    });
    expect(d.status).toBe('CLOSED');
    expect(d.availableCount).toBe(0);
  });

  it('a partial closure only removes the slots it overlaps', () => {
    // Closed 13:00–15:00: overlaps 12:30–14:00 and 14:00–15:30.
    const d = day({
      closures: [
        { start: new Date('2026-11-12T13:00:00Z'), end: new Date('2026-11-12T15:00:00Z') },
      ],
    });
    expect(d.slots.filter((s) => s.status === 'CLOSED')).toHaveLength(2);
    expect(d.slots[3]!.status).toBe('CLOSED');
    expect(d.slots[4]!.status).toBe('CLOSED');
    expect(d.availableCount).toBe(7);
  });

  it('a closure that ends exactly when a slot starts does not block it', () => {
    const d = day({
      closures: [
        { start: new Date('2026-11-12T06:00:00Z'), end: new Date('2026-11-12T08:00:00Z') },
      ],
    });
    expect(d.slots[0]!.status).toBe('AVAILABLE');
  });

  it('a closed weekday is CLOSED', () => {
    expect(day({ opening: { ...OPEN, isOpen: false } }).status).toBe('CLOSED');
  });
});
