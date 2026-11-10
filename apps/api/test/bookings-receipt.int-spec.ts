import type { INestApplication } from '@nestjs/common';
import type { CreateBookingResponse } from '@bovann/shared';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { Database } from '../src/database/schema';
import { bookingApp, holdRequest, TestClock } from './helpers/booking-app';
import { freshDatabase } from './helpers/test-db';

/** Customer receipt PDF: GET /bookings/:reference/receipt with the booking token. */
const clock = new TestClock(new Date('2026-11-08T21:00:00.000Z'));
let app: INestApplication;
let db: Kysely<Database>;
let ip = 0;

const binary = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const receipt = (reference: string, token?: string) => {
  const r = request(app.getHttpServer()).get(`/api/v1/bookings/${reference}/receipt`);
  if (token) r.set('X-Booking-Token', token);
  return r.buffer(true).parse(binary);
};

async function book(slotStart: string) {
  const res = await request(app.getHttpServer())
    .post('/api/v1/bookings')
    .set('X-Forwarded-For', `41.207.160.${++ip}`)
    .send(holdRequest({ selection: { type: 'SLOTS', slotStarts: [slotStart] } }))
    .expect(201);
  return res.body as CreateBookingResponse;
}

beforeAll(async () => {
  db = await freshDatabase();
  await db
    .updateTable('t_package_prices')
    .set({ valid_from: new Date('2026-01-01T00:00:00Z') })
    .execute();
  app = await bookingApp(clock);
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('GET /bookings/:reference/receipt', () => {
  it('downloads a one-page PDF once the booking is confirmed', async () => {
    const b = await book('2026-11-19T08:00:00.000Z');
    // Not available while unpaid.
    const early = await receipt(b.booking.reference, b.accessToken).expect(409);
    expect(JSON.parse((early.body as Buffer).toString()).code).toBe('RECEIPT_NOT_AVAILABLE');

    await request(app.getHttpServer())
      .post(`/api/v1/dev/payments/${b.booking.reference}/succeed`)
      .send({})
      .expect(200);

    const res = await receipt(b.booking.reference, b.accessToken).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="recu-${b.booking.reference}.pdf"`,
    );
    const pdf = res.body as Buffer;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it('answers 404 without the right token, like the booking itself', async () => {
    const b = await book('2026-11-19T09:30:00.000Z');
    await receipt(b.booking.reference).expect(404);
    await receipt(b.booking.reference, 'wrong-token').expect(404);
  });
});
