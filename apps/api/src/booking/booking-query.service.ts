import { Inject, Injectable } from '@nestjs/common';
import type { BookingDto } from '@bovann/shared';
import type { Kysely } from 'kysely';
import { utcToLocalDate, utcToLocalTime } from '../availability/domain/time';
import { notFound } from '../common/errors';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { hashAccessToken } from './domain/identifiers';

/** Read side of bookings: builds the customer-facing DTO. */
@Injectable()
export class BookingQueryService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  /**
   * Finds a booking by reference AND access token. A wrong token gets the same
   * 404 as an unknown reference, so references can't be probed.
   */
  async idByReferenceAndToken(reference: string, token: string | undefined): Promise<number> {
    const row = token
      ? await this.db
          .selectFrom('t_bookings')
          .select('id')
          .where('reference', '=', reference)
          .where('access_token_hash', '=', hashAccessToken(token))
          .executeTakeFirst()
      : undefined;
    if (!row) throw notFound('BOOKING_NOT_FOUND', 'Réservation introuvable.');
    return row.id;
  }

  async byId(bookingId: number): Promise<BookingDto> {
    const b = await this.db
      .selectFrom('t_bookings as b')
      .innerJoin('t_spaces as s', 's.id', 'b.space_id')
      .innerJoin('t_customers as c', 'c.id', 'b.customer_id')
      .select([
        'b.id',
        'b.reference',
        'b.status',
        'b.mode',
        'b.booking_type',
        'b.package_name',
        'b.slot_count',
        'b.starts_at',
        'b.ends_at',
        'b.list_price_xof',
        'b.discount_xof',
        'b.total_xof',
        'b.hold_expires_at',
        's.name as space_name',
        's.timezone',
        's.slot_duration_min',
        'c.full_name',
        'c.business_name',
      ])
      .where('b.id', '=', bookingId)
      .executeTakeFirstOrThrow();

    const [slots, payment] = await Promise.all([
      this.db
        .selectFrom('t_booking_slots')
        .select('slot_start')
        .where('booking_id', '=', bookingId)
        .orderBy('slot_start')
        .execute(),
      this.db
        .selectFrom('t_payments')
        .select(['status', 'method', 'channel'])
        .where('booking_id', '=', bookingId)
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst(),
    ]);

    const tz = b.timezone;
    return {
      reference: b.reference,
      status: b.status,
      mode: b.mode,
      spaceName: b.space_name,
      date: utcToLocalDate(b.starts_at, tz),
      startTime: utcToLocalTime(b.starts_at, tz),
      endTime: utcToLocalTime(b.ends_at, tz),
      slots: slots.map(({ slot_start }) => {
        const end = new Date(slot_start.getTime() + b.slot_duration_min * 60_000);
        return {
          start: slot_start.toISOString(),
          end: end.toISOString(),
          startTime: utcToLocalTime(slot_start, tz),
          endTime: utcToLocalTime(end, tz),
        };
      }),
      bookingType: b.booking_type,
      packageName: b.package_name,
      slotCount: b.slot_count,
      price: { listPriceXof: b.list_price_xof, discountXof: b.discount_xof, totalXof: b.total_xof },
      holdExpiresAt:
        b.status === 'PENDING_PAYMENT' && b.hold_expires_at
          ? b.hold_expires_at.toISOString()
          : null,
      customer: { fullName: b.full_name, businessName: b.business_name },
      payment: payment
        ? { status: payment.status, method: payment.method, channel: payment.channel }
        : null,
    };
  }
}
