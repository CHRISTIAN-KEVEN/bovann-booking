import type { ReviewPeriod, ReviewStatus } from '@bovann/shared';
import {
  addDays,
  isoWeekday,
  localToUtc,
  timeToMinutes,
  utcToLocalDate,
  utcToLocalTime,
} from '../availability/domain/time';

/**
 * Review hours: lives are submitted and reviewed only during these weekly periods, so a seller
 * never waits for a review nobody is there to do. Pure functions, no clock or database.
 */
export function reviewStatus(periods: ReviewPeriod[], now: Date, timeZone: string): ReviewStatus {
  const today = utcToLocalDate(now, timeZone);
  const nowMin = timeToMinutes(utcToLocalTime(now, timeZone));
  const todays = dayPeriods(periods, isoWeekday(today));

  const current = todays.find((p) => p.open <= nowMin && nowMin < p.close);
  if (current) {
    return {
      open: true,
      closesAt: localToUtc(today, current.close, timeZone).toISOString(),
      nextOpensAt: null,
      today: todays.map(label),
      timezone: timeZone,
    };
  }

  let nextOpensAt: string | null = null;
  for (let offset = 0; offset <= 7 && !nextOpensAt; offset++) {
    const date = addDays(today, offset);
    const next = dayPeriods(periods, isoWeekday(date)).find((p) => offset > 0 || p.open > nowMin);
    if (next) nextOpensAt = localToUtc(date, next.open, timeZone).toISOString();
  }
  return { open: false, closesAt: null, nextOpensAt, today: todays.map(label), timezone: timeZone };
}

/**
 * Checks a week of periods before saving: valid times, each period ends after it starts,
 * and periods of the same day don't overlap. Returns French problems (empty when fine).
 */
export function reviewHoursProblems(periods: ReviewPeriod[]): string[] {
  const problems: string[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const day = periods.filter((p) => p.weekday === weekday);
    const minutes = day.map((p) => ({
      open: timeToMinutes(p.opensAt),
      close: timeToMinutes(p.closesAt),
    }));
    if (minutes.some((m) => m.close <= m.open)) {
      problems.push('Chaque période doit finir après son début.');
      continue;
    }
    minutes.sort((a, b) => a.open - b.open);
    for (let i = 1; i < minutes.length; i++) {
      if (minutes[i]!.open < minutes[i - 1]!.close) {
        problems.push('Deux périodes du même jour se chevauchent.');
        break;
      }
    }
  }
  return [...new Set(problems)];
}

function dayPeriods(periods: ReviewPeriod[], weekday: number) {
  return periods
    .filter((p) => p.weekday === weekday)
    .map((p) => ({ open: timeToMinutes(p.opensAt), close: timeToMinutes(p.closesAt) }))
    .sort((a, b) => a.open - b.open);
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const label = (p: { open: number; close: number }) => ({
  opensAt: hhmm(p.open),
  closesAt: hhmm(p.close),
});
