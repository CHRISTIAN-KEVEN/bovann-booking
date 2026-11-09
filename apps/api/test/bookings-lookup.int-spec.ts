import type { INestApplication } from '@nestjs/common';
import type { BookingLookupResponse, CreateBookingResponse } from '@bovann/shared';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { Database } from '../src/database/schema';
import { bookingApp, holdRequest, newPhone, TestClock } from './helpers/booking-app';
import { freshDatabase } from './helpers/test-db';

/** "Mes réservations": find a booking from another device with its reference and phone. */
const clock = new TestClock(new Date('2026-11-08T21:00:00.000Z'));
let app: INestApplication;
let db: Kysely<Database>;
let ip = 0;
const nextIp = () => `41.207.150.${++ip}`;

const lookup = (body: object, from = nextIp()) =>
  request(app.getHttpServer())
    .post('/api/v1/bookings/lookup')
    .set('X-Forwarded-For', from)
    .send(body);
const get = (reference: string, token: string) =>
  request(app.getHttpServer()).get(`/api/v1/bookings/${reference}`).set('X-Booking-Token', token);

async function book(slotStart: string, phone = newPhone()) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/bookings')
    .set('X-Forwarded-For', nextIp())
    .send(holdRequest({ phone, selection: { type: 'SLOTS', slotStarts: [slotStart] } }))
    .expect(201);
  return { ...(res.body as CreateBookingResponse), phone };
}

beforeAll(async () => {
  db = await freshDatabase();
  await db
    .updateTable('t_package_prices')
    .set({ valid_from: new Date('2026-01-01T00:00:00Z') })
    .execute();
  app = await bookingApp(clock, { LOOKUP_RATE_LIMIT_PER_MIN: '4' });
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('POST /bookings/lookup', () => {
  it('returns the booking and a new token for this device; the first device keeps access', async () => {
    const first = await book('2026-11-18T08:00:00.000Z');
    const ref = first.booking.reference;

    // Customers may type the reference in lower case and the phone with spaces.
    const res = await lookup({
      reference: ref.toLowerCase(),
      phone: first.phone.replace(/^(\+228)(\d{2})(\d{2})/, '$1 $2 $3 '),
    }).expect(200);
    const body = res.body as BookingLookupResponse;
    expect(body.booking.reference).toBe(ref);
    expect(body.accessToken).not.toBe(first.accessToken);

    await get(ref, body.accessToken).expect(200);
    await get(ref, first.accessToken).expect(200);
    // The new token also allows cancelling the unpaid booking, like the original one.
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/${ref}/cancel`)
      .set('X-Booking-Token', body.accessToken)
      .expect(200);

    const stored = await db.selectFrom('t_booking_access_tokens').selectAll().execute();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored[0]!.token_hash).not.toContain(body.accessToken);
  });

  it('answers the same 404 for a wrong phone and an unknown reference', async () => {
    const b = await book('2026-11-18T09:30:00.000Z');
    const wrongPhone = await lookup({ reference: b.booking.reference, phone: newPhone() }).expect(
      404,
    );
    const unknown = await lookup({ reference: 'BOV-2611-ZZZZZ', phone: b.phone }).expect(404);
    expect(wrongPhone.body).toEqual(unknown.body);
    expect(wrongPhone.body.code).toBe('BOOKING_NOT_FOUND');
  });

  it('validates the reference and phone', async () => {
    const res = await lookup({ reference: 'abc', phone: '90123456' }).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('a token for one booking does not open another', async () => {
    const a = await book('2026-11-18T11:00:00.000Z');
    const b = await book('2026-11-18T12:30:00.000Z');
    const found = (await lookup({ reference: a.booking.reference, phone: a.phone }).expect(200))
      .body as BookingLookupResponse;
    await get(b.booking.reference, found.accessToken).expect(404);
  });

  it('is rate limited per connection, separately from "Payer"', async () => {
    const from = '41.207.151.1';
    const body = { reference: 'BOV-2611-ZZZZZ', phone: '+22890000001' };
    for (let i = 0; i < 4; i++) await lookup(body, from).expect(404);
    const limited = await lookup(body, from).expect(429);
    expect(limited.body.code).toBe('TOO_MANY_REQUESTS');
    // "Payer" from the same connection is not affected by the lookup limit.
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('X-Forwarded-For', from)
      .send(holdRequest({ selection: { type: 'SLOTS', slotStarts: ['2026-11-18T14:00:00.000Z'] } }))
      .expect(201);
  });
});
