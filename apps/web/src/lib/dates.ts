const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Calendar helpers (French and English) working on local date strings ('YYYY-MM-DD'), the
 * format the API returns in the studio's time zone. No Date arithmetic in the
 * browser's own zone, so a visitor abroad sees Lomé dates, not their own.
 */

type Lang = 'fr' | 'en';

const MONTHS: Record<Lang, string[]> = {
  fr: [
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
  ],
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
};
const MONTHS_SHORT: Record<Lang, string[]> = {
  fr: [
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
  ],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const WEEKDAYS: Record<Lang, string[]> = {
  fr: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};
const INITIALS: Record<Lang, string[]> = {
  fr: ['L', 'M', 'M', 'J', 'V', 'S', 'D'],
  en: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
};
/** Monday-first weekday initials for the calendar header. */
export function weekdayInitials(lang: Lang = 'fr'): string[] {
  return INITIALS[lang];
}
/** Full weekday names, Monday first. */
export function weekdayNames(lang: Lang = 'fr'): string[] {
  return WEEKDAYS[lang].map(capitalize);
}
export const WEEKDAY_INITIALS = INITIALS.fr;

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

/** "Jeudi 12 novembre" / "Thursday 12 November" (with the year when `withYear`). */
export function formatLongDate(date: string, withYear = false, lang: Lang = 'fr'): string {
  const { y, m, d } = parts(date);
  const base = `${capitalize(WEEKDAYS[lang][isoWeekday(date) - 1]!)} ${d} ${MONTHS[lang][m - 1]}`;
  return withYear ? `${base} ${y}` : base;
}

/** "Jeu. 12 nov." / "Thu 12 Nov" for compact summaries. */
export function formatShortDate(date: string, lang: Lang = 'fr'): string {
  const { m, d } = parts(date);
  const day = capitalize(WEEKDAYS[lang][isoWeekday(date) - 1]!.slice(0, 3));
  return lang === 'en'
    ? `${day} ${d} ${MONTHS_SHORT.en[m - 1]}`
    : `${day}. ${d} ${MONTHS_SHORT.fr[m - 1]}`;
}

/** "Novembre 2026" / "November 2026" */
export function formatMonth(month: string, lang: Lang = 'fr'): string {
  const [y, m] = month.split('-').map(Number);
  return `${capitalize(MONTHS[lang][m! - 1]!)} ${y}`;
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
