/**
 * French calendar helpers working on local date strings ('YYYY-MM-DD'), the
 * format the API returns in the studio's time zone. No Date arithmetic in the
 * browser's own zone, so a visitor abroad sees Lomé dates, not their own.
 */

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];
const MONTHS_SHORT = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
export const WEEKDAY_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

/** ISO weekday 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const { y, m, d } = parts(date);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Jeudi 12 novembre" (with the year when `withYear`). */
export function formatLongDate(date: string, withYear = false): string {
  const { y, m, d } = parts(date);
  const base = `${capitalize(WEEKDAYS[isoWeekday(date) - 1]!)} ${d} ${MONTHS[m - 1]}`;
  return withYear ? `${base} ${y}` : base;
}

/** "Jeu. 12 nov." for compact summaries. */
export function formatShortDate(date: string): string {
  const { m, d } = parts(date);
  return `${capitalize(WEEKDAYS[isoWeekday(date) - 1]!.slice(0, 3))}. ${d} ${MONTHS_SHORT[m - 1]}`;
}

/** "Novembre 2026" */
export function formatMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${capitalize(MONTHS[m! - 1]!)} ${y}`;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y! * 12 + (m! - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Leading empty cells so the 1st falls under the right weekday (weeks start on Monday). */
export function leadingBlanks(month: string): number {
  return isoWeekday(`${month}-01`) - 1;
}

/** "1h30", "3h", "6h" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}
