import { HttpStatus } from '@nestjs/common';
import type {
  AdminBookingListItem,
  AdminPaymentState,
  BookingSource,
  BookingStatus,
  BookingType,
  ConflictingBookingDto,
  PaymentMethod,
  RefundStatus,
  SessionMode,
} from '@bovann/shared';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { utcToLocalDate, utcToLocalTime } from '../availability/domain/time';
import { ApiError, notFound, type BilingualText } from '../common/errors';
import type { Database, Space } from '../database/schema';
import { localized } from '../common/request-context';

export async function loadSpace(db: Kysely<Database>, spaceId: number): Promise<Space> {
  const space = await db
    .selectFrom('t_spaces')
    .selectAll()
    .where('id', '=', spaceId)
    .executeTakeFirst();
  if (!space) throw notFound('SPACE_NOT_FOUND', 'Cet espace est introuvable.');
  return space;
}

/** Route ids: positive integers. */
export function parseId(value: string, label = 'Identifiant'): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', `${label} introuvable.`);
  }
  return id;
}

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (format AAAA-MM-JJ).');

export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide (format HH:MM).');

export const phoneSchema = z
  .string({ message: 'Le numéro de téléphone est obligatoire.' })
  .transform((v) => v.replace(/[\s.()-]/g, ''))
  .pipe(
    z
      .string()
      .regex(
        /^\+[1-9]\d{6,14}$/,
        'Numéro de téléphone invalide : indiquez l’indicatif, par exemple +228 90 12 34 56.',
      ),
  );

export const optionalEmailSchema = z
  .string()
  .trim()
  .max(254)
  .email('Adresse e-mail invalide.')
  .transform((v) => v.toLowerCase())
  .nullish()
  .or(z.literal('').transform(() => null));

export const requiredText = (label: string, max: number) =>
  z
    .string({ message: `${label} est obligatoire.` })
    .trim()
    .min(1, `${label} est obligatoire.`)
    .max(max, `${label} est trop long (${max} caractères maximum).`);

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Texte trop long (${max} caractères maximum).`)
    .nullish()
    .transform((v) => (v ? v : null));

export function conflictError(
  code: string,
  message: string | BilingualText,
  conflicts: ConflictingBookingDto[],
): ApiError {
  return new ApiError(HttpStatus.CONFLICT, code, message, { bookings: conflicts });
}

/** Row shape needed to build a booking list item. */
export interface BookingRow {
  id: number;
  reference: string;
  status: BookingStatus;
  source: BookingSource;
  mode: SessionMode;
  space_id: number;
  timezone: string;
  starts_at: Date;
  ends_at: Date;
  booking_type: BookingType;
  package_name: string | null;
  package_name_en: string | null;
  slot_count: number;
  total_xof: number;
  hold_expires_at: Date | null;
  refund_status: RefundStatus;
  created_at: Date;
  customer_id: number;
  full_name: string;
  business_name: string;
  phone_e164: string;
}

export interface PaymentSummary {
  succeeded: { method: PaymentMethod; channel: string | null } | null;
  latest: { method: PaymentMethod; channel: string | null } | null;
}

export function paymentState(
  row: BookingRow,
  payments: PaymentSummary,
  now: Date,
): AdminPaymentState {
  if (payments.succeeded) return 'PAID';
  if (row.total_xof === 0) return 'FREE';
  if (row.status === 'PENDING_PAYMENT' && row.hold_expires_at && row.hold_expires_at > now) {
    return 'PENDING';
  }
  if (row.status === 'CONFIRMED') return 'UNPAID';
  return 'NONE';
}

export function toListItem(
  row: BookingRow,
  payments: PaymentSummary,
  now: Date,
): AdminBookingListItem {
  const shown = payments.succeeded ?? payments.latest;
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    source: row.source,
    mode: row.mode,
    spaceId: row.space_id,
    date: utcToLocalDate(row.starts_at, row.timezone),
    startTime: utcToLocalTime(row.starts_at, row.timezone),
    endTime: utcToLocalTime(row.ends_at, row.timezone),
    startsAt: row.starts_at.toISOString(),
    bookingType: row.booking_type,
    packageName:
      row.package_name === null ? null : localized(row.package_name, row.package_name_en),
    slotCount: row.slot_count,
    totalXof: row.total_xof,
    paymentState: paymentState(row, payments, now),
    paymentMethod: shown?.method ?? null,
    paymentChannel: shown?.channel ?? null,
    refundStatus: row.refund_status,
    customer: {
      id: row.customer_id,
      fullName: row.full_name,
      businessName: row.business_name,
      phone: row.phone_e164,
    },
    createdAt: row.created_at.toISOString(),
  };
}

/** Columns for {@link BookingRow}, from t_bookings b, t_customers c, t_spaces s. */
export const BOOKING_ROW_COLUMNS = [
  'b.id',
  'b.reference',
  'b.status',
  'b.source',
  'b.mode',
  'b.space_id',
  's.timezone',
  'b.starts_at',
  'b.ends_at',
  'b.booking_type',
  'b.package_name',
  'b.package_name_en',
  'b.slot_count',
  'b.total_xof',
  'b.hold_expires_at',
  'b.refund_status',
  'b.created_at',
  'c.id as customer_id',
  'c.full_name',
  'c.business_name',
  'c.phone_e164',
] as const;

/** Succeeded and latest payment per booking, in one query. */
export async function paymentSummaries(
  db: Kysely<Database>,
  bookingIds: readonly number[],
): Promise<Map<number, PaymentSummary>> {
  const map = new Map<number, PaymentSummary>();
  if (bookingIds.length === 0) return map;
  const rows = await db
    .selectFrom('t_payments')
    .select(['booking_id', 'method', 'channel', 'status'])
    .where('booking_id', 'in', [...bookingIds])
    .orderBy('id')
    .execute();
  for (const r of rows) {
    const entry = map.get(r.booking_id) ?? { succeeded: null, latest: null };
    entry.latest = { method: r.method, channel: r.channel };
    if (r.status === 'SUCCEEDED') entry.succeeded = { method: r.method, channel: r.channel };
    map.set(r.booking_id, entry);
  }
  return map;
}

export const NO_PAYMENTS: PaymentSummary = { succeeded: null, latest: null };

/** Bookings that still hold slots (confirmed, or waiting for payment within their hold). */
export async function activeBookingsBetween(
  db: Kysely<Database>,
  spaceId: number,
  from: Date,
  to: Date,
  now: Date,
): Promise<Array<ConflictingBookingDto & { slotStarts: Date[]; startsAt: Date; endsAt: Date }>> {
  const rows = await db
    .selectFrom('t_bookings as b')
    .innerJoin('t_customers as c', 'c.id', 'b.customer_id')
    .innerJoin('t_spaces as s', 's.id', 'b.space_id')
    .innerJoin('t_booking_slots as bs', 'bs.booking_id', 'b.id')
    .select([
      'b.id',
      'b.reference',
      'b.starts_at',
      'b.ends_at',
      's.timezone',
      'c.full_name',
      'bs.slot_start',
    ])
    .where('b.space_id', '=', spaceId)
    .where('b.ends_at', '>', from)
    .where('b.starts_at', '<', to)
    .where((eb) =>
      eb.or([
        eb('b.status', '=', 'CONFIRMED'),
        eb.and([eb('b.status', '=', 'PENDING_PAYMENT'), eb('b.hold_expires_at', '>', now)]),
      ]),
    )
    .orderBy('b.starts_at')
    .orderBy('bs.slot_start')
    .execute();
  const byId = new Map<
    number,
    ConflictingBookingDto & { slotStarts: Date[]; startsAt: Date; endsAt: Date }
  >();
  for (const r of rows) {
    let entry = byId.get(r.id);
    if (!entry) {
      entry = {
        id: r.id,
        reference: r.reference,
        date: utcToLocalDate(r.starts_at, r.timezone),
        startTime: utcToLocalTime(r.starts_at, r.timezone),
        endTime: utcToLocalTime(r.ends_at, r.timezone),
        customerName: r.full_name,
        slotStarts: [],
        startsAt: r.starts_at,
        endsAt: r.ends_at,
      };
      byId.set(r.id, entry);
    }
    entry.slotStarts.push(r.slot_start);
  }
  return [...byId.values()];
}

export function toConflictDto(b: ConflictingBookingDto): ConflictingBookingDto {
  return {
    id: b.id,
    reference: b.reference,
    date: b.date,
    startTime: b.startTime,
    endTime: b.endTime,
    customerName: b.customerName,
  };
}
