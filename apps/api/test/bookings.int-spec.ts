import type { INestApplication } from '@nestjs/common';
import type { CreateBookingResponse, DayAvailabilityResponse } from '@bovann/shared';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { BookingLifecycleService } from '../src/booking/booking-lifecycle.service';
import type { Database } from '../src/database/schema';
import { bookingApp, holdRequest, newPhone, TestClock } from './helpers/booking-app';
import { freshDatabase } from './helpers/test-db';

/**
 * Phase 3a end to end: HTTP → services → MySQL, clock under test control.
 * Every scenario uses its own day or slots so tests don't depend on each other.
 */
const START = '2026-11-08T21:00:00.000Z';
const clock = new TestClock(new Date(START));
let app: INestApplication;
let db: Kysely<Database>;
let lifecycle: BookingLifecycleService;
let ipCounter = 0;

const slot = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`;
const newIp = () => `41.207.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

function post(body: object, ip = newIp()) {
  return request(app.getHttpServer())
    .post('/api/v1/bookings')
    .set('X-Forwarded-For', ip)
    .send(body);
}
function get(reference: string, token?: string) {
  const r = request(app.getHttpServer()).get(`/api/v1/bookings/${reference}`);
  return token ? r.set('X-Booking-Token', token) : r;
}
function cancel(reference: string, token: string) {
  return request(app.getHttpServer())
    .post(`/api/v1/bookings/${reference}/cancel`)
    .set('X-Booking-Token', token);
}
function devPay(reference: string, outcome: 'succeed' | 'fail') {
  return request(app.getHttpServer()).post(`/api/v1/dev/payments/${reference}/${outcome}`).send({});
}
async function day(date: string): Promise<DayAvailabilityResponse> {
  // Availability is served by the same app (BookingModule imports AvailabilityModule).
  const res = await request(app.getHttpServer())
    .get(`/api/v1/spaces/studio-principal-lome/availability/${date}?mode=IN_PERSON`)
    .expect(200);
  return res.body as DayAvailabilityResponse;
}
const statusAt = (d: DayAvailabilityResponse, hhmm: string) =>
  d.slots.find((s) => s.startTime === hhmm)!.status;
async function bookingRow(reference: string) {
  return db
    .selectFrom('t_bookings')
    .selectAll()
    .where('reference', '=', reference)
    .executeTakeFirstOrThrow();
}

beforeAll(async () => {
  db = await freshDatabase();
  await db
    .updateTable('t_package_prices')
    .set({ valid_from: new Date('2026-01-01T00:00:00Z') })
    .execute();
  app = await bookingApp(clock);
  lifecycle = app.get(BookingLifecycleService);
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

beforeEach(() => clock.set(START));

describe('creating a hold ("Payer")', () => {
  it('holds the slots for 5 minutes, prices them and starts the payment', async () => {
    const res = await post(
      holdRequest({
        selection: {
          type: 'SLOTS',
          slotStarts: [slot('2026-11-16', '08:00'), slot('2026-11-16', '09:30')],
        },
      }),
    ).expect(201);
    const body = res.body as CreateBookingResponse;

    expect(body.booking.reference).toMatch(/^BOV-2611-[0-9A-Z]{5}$/);
    expect(body.booking).toMatchObject({
      status: 'PENDING_PAYMENT',
      mode: 'IN_PERSON',
      date: '2026-11-16',
      startTime: '08:00',
      endTime: '11:00',
      bookingType: 'SLOTS',
      slotCount: 2,
      price: { listPriceXof: 30000, discountXof: 0, totalXof: 30000 },
      holdExpiresAt: '2026-11-08T21:05:00.000Z',
      holdSecondsLeft: 300,
      payment: { status: 'PENDING', method: 'MOBILE_MONEY', channel: 'TMONEY' },
    });
    expect(body.accessToken.length).toBeGreaterThanOrEqual(43);
    expect(body.payment.instructions).toContain('30000');

    const d = await day('2026-11-16');
    expect(statusAt(d, '08:00')).toBe('BOOKED');
    expect(statusAt(d, '09:30')).toBe('BOOKED');

    const row = await bookingRow(body.booking.reference);
    expect(row.access_token_hash).not.toBe(body.accessToken);
  });

  it('books a package at a start time where it fits, with its discount', async () => {
    const res = await post(
      holdRequest({
        selection: { type: 'PACKAGE', packageCode: 'PACK_6H', start: slot('2026-11-17', '12:30') },
      }),
    ).expect(201);
    expect((res.body as CreateBookingResponse).booking).toMatchObject({
      bookingType: 'PACKAGE',
      packageName: 'Pack 6h',
      slotCount: 4,
      startTime: '12:30',
      endTime: '18:30',
      price: { listPriceXof: 60000, discountXof: 9000, totalXof: 51000 },
    });
  });

  it('refuses a slot someone else holds with a French 409', async () => {
    await post(
      holdRequest({ selection: { type: 'SLOTS', slotStarts: [slot('2026-11-18', '08:00')] } }),
    ).expect(201);
    const res = await post(
      holdRequest({ selection: { type: 'SLOTS', slotStarts: [slot('2026-11-18', '08:00')] } }),
    ).expect(409);
    expect(res.body).toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect(res.body.message).toContain('vient d’être réservé');
  });

  it('lets exactly one of several simultaneous customers get the same slot', async () => {
    const target = slot('2026-11-19', '14:00');
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        post(holdRequest({ selection: { type: 'SLOTS', slotStarts: [target] } })),
      ),
    );
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409, 409]);
    const occupancies = await db
      .selectFrom('t_slot_occupancies')
      .select('id')
      .where('slot_start', '=', new Date(target))
      .execute();
    expect(occupancies).toHaveLength(1);
  });

  it('refuses a package start where it no longer fits', async () => {
    await post(
      holdRequest({ selection: { type: 'SLOTS', slotStarts: [slot('2026-11-20', '14:00')] } }),
    ).expect(201);
    const res = await post(
      holdRequest({
        selection: { type: 'PACKAGE', packageCode: 'PACK_3H', start: slot('2026-11-20', '12:30') },
      }),
    ).expect(409);
    expect(res.body.code).toBe('PACKAGE_DOES_NOT_FIT');
  });

  it('validates input with French messages', async () => {
    const badPhone = holdRequest();
    badPhone.customer.phone = '90123456';
    expect((await post(badPhone).expect(400)).body.message).toContain('indicatif');

    const noTerms = { ...holdRequest(), acceptTerms: false };
    expect((await post(noTerms).expect(400)).body.message).toContain('conditions');

    const noBusiness = holdRequest();
    noBusiness.customer.businessName = '  ';
    expect((await post(noBusiness).expect(400)).body.message).toContain('entreprise');
  });

  it('keeps one record per phone: latest details win, email kept when not given again', async () => {
    const phone = newPhone();
    await post(
      holdRequest({
        phone,
        selection: { type: 'SLOTS', slotStarts: [slot('2026-11-21', '08:00')] },
      }),
    ).expect(201);
    const second = holdRequest({
      phone,
      selection: { type: 'SLOTS', slotStarts: [slot('2026-11-21', '09:30')] },
    });
    second.customer.fullName = 'Afi Mensah-Koffi';
    second.customer.email = null;
    await post(second).expect(201);
    const customer = await db
      .selectFrom('t_customers')
      .selectAll()
      .where('phone_e164', '=', phone)
      .executeTakeFirstOrThrow();
    expect(customer.full_name).toBe('Afi Mensah-Koffi');
    expect(customer.email).toBe('afi@example.test');
  });
});

describe('one active hold per phone', () => {
  it('a new hold by the same phone replaces the previous one and frees its slots', async () => {
    const phone = newPhone();
    const first = (
      await post(
        holdRequest({
          phone,
          selection: { type: 'SLOTS', slotStarts: [slot('2026-11-23', '08:00')] },
        }),
      ).expect(201)
    ).body as CreateBookingResponse;
    await post(
      holdRequest({
        phone,
        selection: { type: 'SLOTS', slotStarts: [slot('2026-11-23', '11:00')] },
      }),
    ).expect(201);

    const old = await bookingRow(first.booking.reference);
    expect(old.status).toBe('CANCELLED');
    expect(old.cancel_reason).toBe('SUPERSEDED');
    const d = await day('2026-11-23');
    expect(statusAt(d, '08:00')).toBe('AVAILABLE');
    expect(statusAt(d, '11:00')).toBe('BOOKED');
  });

  it('the same phone may re-pick the slots of its own previous hold', async () => {
    const phone = newPhone();
    const s = slot('2026-11-24', '08:00');
    await post(holdRequest({ phone, selection: { type: 'SLOTS', slotStarts: [s] } })).expect(201);
    await post(holdRequest({ phone, selection: { type: 'SLOTS', slotStarts: [s] } })).expect(201);
  });
});

describe('following and cancelling a booking', () => {
  it('needs the access token; a wrong token looks like an unknown booking', async () => {
    const { booking, accessToken } = (
      await post(
        holdRequest({ selection: { type: 'SLOTS', slotStarts: [slot('2026-11-25', '08:00')] } }),
      ).expect(201)
    ).body as CreateBookingResponse;
    await get(booking.reference, accessToken).expect(200);
    expect((await get(booking.reference).expect(404)).body.code).toBe('BOOKING_NOT_FOUND');
    await get(booking.reference, 'wrong-token').expect(404);
  });

  it('cancelling frees the slots immediately, and is idempotent', async () => {
    const { booking, accessToken } = (
      await post(
        holdRequest({ selection: { type: 'SLOTS', slotStarts: [slot('2026-11-25', '11:00')] } }),
      ).expect(201)
    ).body as CreateBookingResponse;
    const res = await cancel(booking.reference, accessToken).expect(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(statusAt(await day('2026-11-25'), '11:00')).toBe('AVAILABLE');
    await cancel(booking.reference, accessToken).expect(200);
  });

  it('a confirmed booking cannot be cancelled by the customer', async () => {
    const { booking, accessToken } = (
      await post(
        holdRequest({ selection: { type: 'SLOTS', slotStarts: [slot('2026-11-25', '14:00')] } }),
      ).expect(201)
    ).body as CreateBookingResponse;
    await devPay(booking.reference, 'succeed').expect(200);
    expect((await cancel(booking.reference, accessToken).expect(409)).body.code).toBe(
      'BOOKING_NOT_CANCELLABLE',
    );
  });
});

describe('hold expiry (5 minutes)', () => {
  it('after 5 minutes the slot is free for others even before the cleanup job runs', async () => {
    const s = slot('2026-11-26', '08:00');
    const first = (
      await post(holdRequest({ selection: { type: 'SLOTS', slotStarts: [s] } })).expect(201)
    ).body as CreateBookingResponse;
    clock.advanceMinutes(4);
    await post(holdRequest({ selection: { type: 'SLOTS', slotStarts: [s] } })).expect(409);
    clock.advanceMinutes(1);
    expect(statusAt(await day('2026-11-26'), '08:00')).toBe('AVAILABLE');
    await post(holdRequest({ selection: { type: 'SLOTS', slotStarts: [s] } })).expect(201);
    expect((await bookingRow(first.booking.reference)).status).toBe('EXPIRED');
  });

  it('the cleanup job marks expired holds and releases their slots', async () => {
    const { booking } = (
      await post(
        holdRequest({ selection: { type: 'SLOTS', slotStarts: [slot('2026-11-26', '11:00')] } }),
      ).expect(201)
    ).body as CreateBookingResponse;
    clock.advanceMinutes(6);
    expect(await lifecycle.expireDueHolds()).toBeGreaterThanOrEqual(1);
    const row = await bookingRow(booking.reference);
    expect(row.status).toBe('EXPIRED');
    const locks = await db
      .selectFrom('t_slot_occupancies')
      .select('id')
      .where('booking_id', '=', row.id)
      .execute();
    expect(locks).toHaveLength(0);
  });
});

describe('payment outcome (simulated provider)', () => {
  it('a successful payment confirms the booking and queues the owner and customer emails once', async () => {
    const { booking, accessToken } = (
      await post(
        holdRequest({ selection: { type: 'SLOTS', slotStarts: [slot('2026-11-27', '08:00')] } }),
      ).expect(201)
    ).body as CreateBookingResponse;
    expect((await devPay(booking.reference, 'succeed').expect(200)).body.outcome).toBe('CONFIRMED');
    expect((await devPay(booking.reference, 'succeed').expect(200)).body.outcome).toBe(
      'ALREADY_CONFIRMED',
    );

    const view = (await get(booking.reference, accessToken).expect(200)).body;
    expect(view).toMatchObject({
      status: 'CONFIRMED',
      holdExpiresAt: null,
      payment: { status: 'SUCCEEDED' },
    });

    const row = await bookingRow(booking.reference);
    const notifications = await db
      .selectFrom('t_notifications')
      .select(['template', 'recipient', 'payload', 'status'])
      .where('booking_id', '=', row.id)
      .orderBy('template')
      .execute();
    expect(notifications.map((n) => [n.template, n.recipient, n.status])).toEqual([
      ['customer_booking_confirmed', 'afi@example.test', 'PENDING'],
      ['owner_booking_confirmed', 'owner@example.test', 'PENDING'],
    ]);
    expect(notifications[1]!.payload).toMatchObject({
      reference: booking.reference,
      modeLabel: 'En studio',
      date: '2026-11-27',
      startTime: '08:00',
      totalXof: 15000,
      customer: { businessName: 'Boutique Afi Mode', businessSector: 'Mode & beauté' },
    });
  });

  it('a failed payment ends the hold and frees the slots at once', async () => {
    const { booking } = (
      await post(
        holdRequest({ selection: { type: 'SLOTS', slotStarts: [slot('2026-11-27', '11:00')] } }),
      ).expect(201)
    ).body as CreateBookingResponse;
    await devPay(booking.reference, 'fail').expect(200);
    const row = await bookingRow(booking.reference);
    expect([row.status, row.cancel_reason]).toEqual(['CANCELLED', 'PAYMENT_FAILED']);
    expect(statusAt(await day('2026-11-27'), '11:00')).toBe('AVAILABLE');
  });

  it('a payment arriving after expiry still confirms if the slots are free', async () => {
    const { booking } = (
      await post(
        holdRequest({ selection: { type: 'SLOTS', slotStarts: [slot('2026-11-27', '14:00')] } }),
      ).expect(201)
    ).body as CreateBookingResponse;
    clock.advanceMinutes(6);
    await lifecycle.expireDueHolds();
    expect((await devPay(booking.reference, 'succeed').expect(200)).body.outcome).toBe('CONFIRMED');
    expect(statusAt(await day('2026-11-27'), '14:00')).toBe('BOOKED');
  });

  it('a payment arriving after someone else took the slot is flagged for refund to the owners', async () => {
    const s = slot('2026-11-27', '17:00');
    const late = (
      await post(holdRequest({ selection: { type: 'SLOTS', slotStarts: [s] } })).expect(201)
    ).body as CreateBookingResponse;
    clock.advanceMinutes(6);
    await post(holdRequest({ selection: { type: 'SLOTS', slotStarts: [s] } })).expect(201);
    expect((await devPay(late.booking.reference, 'succeed').expect(200)).body.outcome).toBe(
      'LATE_PAYMENT_REFUND_REQUIRED',
    );

    const row = await bookingRow(late.booking.reference);
    expect(row.status).toBe('EXPIRED');
    // It shows up in the admin's "refunds to handle".
    expect(row.refund_status).toBe('DUE');
    expect(row.refund_amount_xof).toBe(15000);
    const flagged = await db
      .selectFrom('t_notifications')
      .select('template')
      .where('booking_id', '=', row.id)
      .execute();
    expect(flagged.map((n) => n.template)).toEqual(['owner_late_payment_refund']);
  });
});

describe('retrying (no penalties: product-owner decision of 2026-11-09)', () => {
  it('a customer may abandon and retry as many times as they like', async () => {
    const phone = newPhone();
    const ip = newIp();
    for (const hhmm of ['08:00', '09:30', '11:00', '12:30', '14:00']) {
      const { booking, accessToken } = (
        await post(
          holdRequest({
            phone,
            selection: { type: 'SLOTS', slotStarts: [slot('2026-12-01', hhmm)] },
          }),
          ip,
        ).expect(201)
      ).body as CreateBookingResponse;
      await cancel(booking.reference, accessToken).expect(200);
    }
    for (const hhmm of ['15:30', '17:00']) {
      const { booking } = (
        await post(
          holdRequest({
            phone,
            selection: { type: 'SLOTS', slotStarts: [slot('2026-12-01', hhmm)] },
          }),
          ip,
        ).expect(201)
      ).body as CreateBookingResponse;
      await devPay(booking.reference, 'fail').expect(200);
    }
    await post(
      holdRequest({
        phone,
        selection: { type: 'SLOTS', slotStarts: [slot('2026-12-01', '18:30')] },
      }),
      ip,
    ).expect(201);
  });

  it('several customers on the same connection can all hold at once', async () => {
    const ip = newIp();
    for (const hhmm of ['08:00', '09:30', '11:00', '12:30']) {
      await post(
        holdRequest({ selection: { type: 'SLOTS', slotStarts: [slot('2026-12-02', hhmm)] } }),
        ip,
      ).expect(201);
    }
  });
});
