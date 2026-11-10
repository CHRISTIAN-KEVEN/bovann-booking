import type { BookingDto } from '@bovann/shared';
import { SESSION_MODE_LABELS, type Locale } from '@bovann/shared';
import type { T } from '@/i18n/I18nProvider';
import { selectionLabel } from './selection';

/** iCalendar file so the customer can add the session to their phone's calendar. */
export function bookingToIcs(
  booking: BookingDto,
  t: T,
  locale: Locale = 'fr',
  nowIso: string = new Date().toISOString(),
): string {
  const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const first = booking.slots[0];
  const last = booking.slots[booking.slots.length - 1];
  if (!first || !last) throw new Error('Booking without slots');
  const escape = (text: string) => text.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const what = selectionLabel(booking, t);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Bovann OCD Live//Reservation//${locale.toUpperCase()}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.reference}@bovann-ocd-live`,
    `DTSTAMP:${stamp(nowIso)}`,
    `DTSTART:${stamp(first.start)}`,
    `DTEND:${stamp(last.end)}`,
    `SUMMARY:${escape(t('ics.summary', { mode: SESSION_MODE_LABELS[locale][booking.mode] }))}`,
    `DESCRIPTION:${escape(
      t('ics.description', {
        reference: booking.reference,
        what,
        times: `${booking.startTime} – ${booking.endTime}`,
      }),
    )}`,
    `LOCATION:${escape(booking.spaceName)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
