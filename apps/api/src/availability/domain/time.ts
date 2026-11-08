/**
 * Calendar helpers that work in a space's own time zone.
 *
 * Conventions:
 * - A "local date" is a string 'YYYY-MM-DD' in the space's time zone.
 * - A "local time" is 'HH:MM' or 'HH:MM:SS' (MySQL TIME).
 * - Instants are JS Dates (UTC), which is how they are stored in MySQL.
 *
 * Lomé is UTC+0 all year, but nothing here assumes it: a future space in
 * another zone (even one with daylight saving) gets correct slot times.
 * Implemented with Intl only, no date library.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(instant: Date, timeZone: string): LocalParts {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour! % 24,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** Offset (ms) of `timeZone` from UTC at `instant`: local = UTC + offset. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = localParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function parseLocalDate(value: string): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(value);
  if (!m) throw new RangeError(`Invalid date "${value}", expected YYYY-MM-DD`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid date "${value}"`);
  }
  return { year, month, day };
}

export function isValidLocalDate(value: string): boolean {
  try {
    parseLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

/** Minutes since midnight for 'HH:MM' or 'HH:MM:SS'. */
export function timeToMinutes(value: string): number {
  const m = TIME_RE.exec(value);
  if (!m) throw new RangeError(`Invalid time "${value}"`);
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) throw new RangeError(`Invalid time "${value}"`);
  return hours * 60 + minutes;
}

/**
 * Converts a wall-clock moment in `timeZone` to the UTC instant.
 * For times skipped by a daylight-saving jump, the result moves forward by the
 * jump (same behaviour as most calendar apps).
 */
export function localToUtc(date: string, minutesSinceMidnight: number, timeZone: string): Date {
  const { year, month, day } = parseLocalDate(date);
  const guess = Date.UTC(year, month - 1, day, 0, minutesSinceMidnight);
  const first = guess - offsetMs(new Date(guess), timeZone);
  const second = guess - offsetMs(new Date(first), timeZone);
  return new Date(second);
}

/** The local calendar date ('YYYY-MM-DD') of an instant in `timeZone`. */
export function utcToLocalDate(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The local wall-clock time ('HH:MM') of an instant in `timeZone`. */
export function utcToLocalTime(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** ISO weekday of a local date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const { year, month, day } = parseLocalDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function addDays(date: string, days: number): string {
  const { year, month, day } = parseLocalDate(date);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** All local dates of a month ('YYYY-MM'). */
export function datesOfMonth(yearMonth: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    throw new RangeError(`Invalid month "${yearMonth}", expected YYYY-MM`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  return Array.from(
    { length: daysInMonth(year, month) },
    (_, i) => `${m[1]}-${m[2]}-${pad(i + 1)}`,
  );
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
