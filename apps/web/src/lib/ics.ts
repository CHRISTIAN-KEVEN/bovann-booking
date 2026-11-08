import type { BookingDto } from '@bovann/shared';
import { SESSION_MODE_LABELS_FR } from '@bovann/shared';

/** iCalendar file so the customer can add the session to their phone's calendar. */
export function bookingToIcs(
  booking: BookingDto,
  nowIso: string = new Date().toISOString(),
): string {
  const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const first = booking.slots[0];
  const last = booking.slots[booking.slots.length - 1];
  if (!first || !last) throw new Error('Booking without slots');
  const escape = (text: string) => text.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const what =
    booking.packageName ?? `${booking.slotCount} créneau${booking.slotCount > 1 ? 'x' : ''}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bovann OCD Live//Reservation//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.reference}@bovann-ocd-live`,
    `DTSTAMP:${stamp(nowIso)}`,
    `DTSTART:${stamp(first.start)}`,
    `DTEND:${stamp(last.end)}`,
    `SUMMARY:${escape(`Session live Bovann OCD Live (${SESSION_MODE_LABELS_FR[booking.mode]})`)}`,
    `DESCRIPTION:${escape(`Référence ${booking.reference} · ${what} · ${booking.startTime} – ${booking.endTime}`)}`,
    `LOCATION:${escape(booking.spaceName)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
