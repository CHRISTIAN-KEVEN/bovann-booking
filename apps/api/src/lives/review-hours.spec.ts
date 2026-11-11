import type { ReviewPeriod } from '@bovann/shared';
import { reviewHoursProblems, reviewStatus } from './review-hours';

const LOME = 'Africa/Lome'; // UTC+0 all year
const weekdays: ReviewPeriod[] = [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
  { weekday, opensAt: '08:00', closesAt: '11:00' },
  { weekday, opensAt: '15:00', closesAt: '18:00' },
]);

describe('reviewStatus', () => {
  it('is open during a period and says when it closes', () => {
    // Wednesday 11 November 2026, 09:30 in Lomé.
    expect(reviewStatus(weekdays, new Date('2026-11-11T09:30:00Z'), LOME)).toEqual({
      open: true,
      closesAt: '2026-11-11T11:00:00.000Z',
      nextOpensAt: null,
      today: [
        { opensAt: '08:00', closesAt: '11:00' },
        { opensAt: '15:00', closesAt: '18:00' },
      ],
      timezone: LOME,
    });
  });

  it('points to the next period: later today, tomorrow, or after a closed day', () => {
    expect(reviewStatus(weekdays, new Date('2026-11-11T12:40:00Z'), LOME)).toMatchObject({
      open: false,
      nextOpensAt: '2026-11-11T15:00:00.000Z',
    });
    // Closing time itself is closed.
    expect(reviewStatus(weekdays, new Date('2026-11-11T18:00:00Z'), LOME)).toMatchObject({
      open: false,
      nextOpensAt: '2026-11-12T08:00:00.000Z',
    });
    // Saturday evening → Monday morning (Sunday has no period).
    expect(reviewStatus(weekdays, new Date('2026-11-14T19:00:00Z'), LOME)).toMatchObject({
      open: false,
      nextOpensAt: '2026-11-16T08:00:00.000Z',
      today: [
        { opensAt: '08:00', closesAt: '11:00' },
        { opensAt: '15:00', closesAt: '18:00' },
      ],
    });
    expect(reviewStatus(weekdays, new Date('2026-11-15T10:00:00Z'), LOME).today).toEqual([]);
  });

  it('uses the local time zone', () => {
    const paris: ReviewPeriod[] = [{ weekday: 3, opensAt: '08:00', closesAt: '11:00' }];
    // 07:30 UTC = 08:30 in Paris (winter).
    expect(reviewStatus(paris, new Date('2026-11-11T07:30:00Z'), 'Europe/Paris')).toMatchObject({
      open: true,
      closesAt: '2026-11-11T10:00:00.000Z',
    });
  });

  it('has no next opening when no hours are set', () => {
    expect(reviewStatus([], new Date('2026-11-11T09:00:00Z'), LOME)).toMatchObject({
      open: false,
      nextOpensAt: null,
    });
  });
});

describe('reviewHoursProblems', () => {
  it('accepts the default week and refuses reversed or overlapping periods', () => {
    expect(reviewHoursProblems(weekdays)).toEqual([]);
    expect(reviewHoursProblems([{ weekday: 1, opensAt: '11:00', closesAt: '08:00' }])).toEqual([
      'Chaque période doit finir après son début.',
    ]);
    expect(
      reviewHoursProblems([
        { weekday: 2, opensAt: '08:00', closesAt: '12:00' },
        { weekday: 2, opensAt: '11:00', closesAt: '14:00' },
      ]),
    ).toEqual(['Deux périodes du même jour se chevauchent.']);
  });
});
