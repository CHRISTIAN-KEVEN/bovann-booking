import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { bookingApp, holdRequest, TestClock } from './helpers/booking-app';
import { freshDatabase } from './helpers/test-db';

/** Request rate limit on "Payer", per client connection (default 5 per minute). */
describe('POST /api/v1/bookings rate limit', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const db = await freshDatabase();
    await db.destroy();
    app = await bookingApp(new TestClock(new Date('2026-11-08T21:00:00Z')), {
      HOLD_RATE_LIMIT_PER_MIN: '3',
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers 429 after the limit, per connection', async () => {
    const send = (ip: string) =>
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('X-Forwarded-For', ip)
        .send(holdRequest({ acceptTerms: false as never }));
    // Invalid bodies still count: the limit protects the endpoint itself.
    for (let i = 0; i < 3; i++) await send('41.207.200.1').expect(400);
    const limited = await send('41.207.200.1').expect(429);
    expect(limited.body.code).toBe('TOO_MANY_REQUESTS');
    await send('41.207.200.2').expect(400);
  });
});
