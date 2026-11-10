import { Inject, Injectable } from '@nestjs/common';
import type { BookingDto } from '@bovann/shared';
import type { Kysely } from 'kysely';
import { utcToLocalDate, utcToLocalTime } from '../availability/domain/time';
import { CLOCK, type Clock } from '../common/clock';
import { notFound } from '../common/errors';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { generateAccessToken, hashAccessToken } from './domain/identifiers';
import { localized } from '../common/request-context';

/** Read side of bookings: builds the customer-facing DTO. */
@Injectable()
export class BookingQueryService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Finds a booking by reference AND access token. A wrong token gets the same
   * 404 as an unknown reference, so references can't be probed.
   */
  async idByReferenceAndToken(reference: string, token: string | undefined): Promise<number> {
    const hash = token ? hashAccessToken(token) : undefined;
    const row = hash
      ? await this.db
          .selectFrom('t_bookings as b')
          .select('b.id')
          .where('b.reference', '=', reference)
          .where((eb) =>
            eb.or([
              eb('b.access_token_hash', '=', hash),
              eb.exists(
                eb
                  .selectFrom('t_booking_access_tokens as t')
                  .select('t.id')
                  .whereRef('t.booking_id', '=', 'b.id')
                  .where('t.token_hash', '=', hash),
              ),
            ]),
          )
          .executeTakeFirst()
      : undefined;
    if (!row) throw notFound('BOOKING_NOT_FOUND', 'Réservation introuvable.');
    return row.id;
  }

  /**
   * "Mes réservations": finds a booking from its reference and the customer's phone number, and
   * issues a new access token for this device. A mismatch gets the same 404 as an unknown
   * reference; the route is rate limited, and references are random, so guessing is impractical.
   */
  async lookup(
    reference: string,
    phone: string,
  ): Promise<{ booking: BookingDto; accessToken: string }> {
    const row = await this.db
      .selectFrom('t_bookings as b')
      .innerJoin('t_customers as c', 'c.id', 'b.customer_id')
      .select('b.id')
      .where('b.reference', '=', reference)
      .where('c.phone_e164', '=', phone)
      .executeTakeFirst();
    if (!row) {
      throw notFound(
        'BOOKING_NOT_FOUND',
        'Aucune réservation ne correspond à cette référence et à ce numéro.',
      );
    }
    const access = generateAccessToken();
    await this.db
      .insertInto('t_booking_access_tokens')
      .values({ booking_id: row.id, token_hash: access.hash })
      .execute();
    return { booking: await this.byId(row.id), accessToken: access.token };
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
        'b.package_name_en',
        'b.slot_count',
        'b.starts_at',
        'b.ends_at',
        'b.list_price_xof',
        'b.discount_xof',
        'b.total_xof',
        'b.hold_expires_at',
        's.name as space_name',
        's.name_en as space_name_en',
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
    const holding = b.status === 'PENDING_PAYMENT' && b.hold_expires_at !== null;
    const secondsLeft = holding
      ? Math.max(0, Math.floor((b.hold_expires_at!.getTime() - this.clock.now().getTime()) / 1000))
      : null;
    return {
      reference: b.reference,
      status: b.status,
      mode: b.mode,
      spaceName: localized(b.space_name, b.space_name_en),
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
      packageName: b.package_name === null ? null : localized(b.package_name, b.package_name_en),
      slotCount: b.slot_count,
      price: { listPriceXof: b.list_price_xof, discountXof: b.discount_xof, totalXof: b.total_xof },
      holdExpiresAt: holding ? b.hold_expires_at!.toISOString() : null,
      holdSecondsLeft: secondsLeft,
      customer: { fullName: b.full_name, businessName: b.business_name },
      payment: payment
        ? { status: payment.status, method: payment.method, channel: payment.channel }
        : null,
    };
  }
}
