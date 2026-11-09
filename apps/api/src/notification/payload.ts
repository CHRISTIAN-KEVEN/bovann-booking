import { SESSION_MODE_LABELS_FR, type BookingType, type SessionMode } from '@bovann/shared';
import type { Kysely } from 'kysely';
import { utcToLocalDate, utcToLocalTime } from '../availability/domain/time';
import type { Database } from '../database/schema';

/**
 * Everything an email needs, frozen when the email is queued (inside the
 * booking's transaction). Later edits to the booking or the customer don't
 * change an email already queued. Fields added after Phase 3 are optional so
 * older queued emails still render.
 */
export interface NotificationPayload {
  bookingId?: number;
  reference: string;
  spaceId: number;
  spaceName: string;
  spaceAddress?: string | null;
  mode: SessionMode;
  modeLabel: string;
  /** Local date 'YYYY-MM-DD' and times 'HH:MM' in the studio's time zone. */
  date: string;
  startTime: string;
  endTime: string;
  bookingType?: BookingType;
  /** Each slot 'HH:MM–HH:MM' (single slots may not be consecutive). */
  slotRanges?: string[];
  packageName: string | null;
  slotCount: number;
  totalXof: number;
  /** Amount the studio must give back (cancellation or late payment). */
  refundXof?: number | null;
  source?: 'ONLINE' | 'ADMIN';
  liveDescription: string | null;
  customer: {
    fullName: string;
    phone: string;
    email: string | null;
    businessName: string;
    businessSector: string;
  };
}

export async function buildNotificationPayload(
  db: Kysely<Database>,
  bookingId: number,
): Promise<NotificationPayload> {
  const row = await db
    .selectFrom('t_bookings as b')
    .innerJoin('t_customers as c', 'c.id', 'b.customer_id')
    .innerJoin('t_spaces as s', 's.id', 'b.space_id')
    .select([
      'b.id',
      'b.reference',
      'b.mode',
      'b.booking_type',
      'b.source',
      'b.starts_at',
      'b.ends_at',
      'b.package_name',
      'b.slot_count',
      'b.total_xof',
      'b.refund_amount_xof',
      'b.live_description',
      's.id as space_id',
      's.name as space_name',
      's.address',
      's.timezone',
      's.slot_duration_min',
      'c.full_name',
      'c.phone_e164',
      'c.email',
      'c.business_name',
      'c.business_sector',
    ])
    .where('b.id', '=', bookingId)
    .executeTakeFirstOrThrow();
  const slots = await db
    .selectFrom('t_booking_slots')
    .select('slot_start')
    .where('booking_id', '=', bookingId)
    .orderBy('slot_start')
    .execute();
  const tz = row.timezone;
  return {
    bookingId: row.id,
    reference: row.reference,
    spaceId: row.space_id,
    spaceName: row.space_name,
    spaceAddress: row.address,
    mode: row.mode,
    modeLabel: SESSION_MODE_LABELS_FR[row.mode],
    date: utcToLocalDate(row.starts_at, tz),
    startTime: utcToLocalTime(row.starts_at, tz),
    endTime: utcToLocalTime(row.ends_at, tz),
    bookingType: row.booking_type,
    slotRanges: slots.map(({ slot_start }) => {
      const end = new Date(slot_start.getTime() + row.slot_duration_min * 60_000);
      return `${utcToLocalTime(slot_start, tz)}–${utcToLocalTime(end, tz)}`;
    }),
    packageName: row.package_name,
    slotCount: row.slot_count,
    totalXof: row.total_xof,
    refundXof: row.refund_amount_xof,
    source: row.source,
    liveDescription: row.live_description,
    customer: {
      fullName: row.full_name,
      phone: row.phone_e164,
      email: row.email,
      businessName: row.business_name,
      businessSector: row.business_sector,
    },
  };
}
