import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SellerCodeResponse } from '@bovann/shared';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { CLOCK, ClockModule } from '../src/common/clock';
import { ConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import type { Database } from '../src/database/schema';
import { DisabledOtpSender, OTP_SENDER } from '../src/sellers/otp-sender';
import { SellersModule } from '../src/sellers/sellers.module';
import { TestClock } from './helpers/booking-app';
import { freshDatabase, testDatabaseUrl } from './helpers/test-db';

/**
 * Seller sign-in with a one-time code (decision of 2026-11-10). Codes come back in
 * `devCode` because tests use the simulated sender, like development.
 */
const clock = new TestClock(new Date('2026-11-11T08:00:00.000Z'));
let db: Kysely<Database>;
let app: INestApplication;

async function sellerApp(options: { disabled?: boolean } = {}): Promise<INestApplication> {
  Object.assign(process.env, {
    DATABASE_URL: testDatabaseUrl(),
    HOLD_EXPIRY_INTERVAL_SEC: '0',
    NOTIFICATION_INTERVAL_SEC: '0',
    OTP_RATE_LIMIT_PER_HOUR: '1000',
  });
  let builder = Test.createTestingModule({
    imports: [ConfigModule, ClockModule, DatabaseModule, SellersModule],
  })
    .overrideProvider(CLOCK)
    .useValue(clock);
  if (options.disabled)
    builder = builder.overrideProvider(OTP_SENDER).useValue(new DisabledOtpSender());
  const nest = (await builder.compile()).createNestApplication();
  configureApp(nest, { corsOrigins: [], trustProxyHops: 1 });
  await nest.init();
  return nest;
}

let phoneCounter = 0;
const newPhone = () => `+2289${String(1_000_000 + ++phoneCounter).slice(-7)}`;

const post = (path: string, body: unknown, lang?: string) => {
  const r = request(app.getHttpServer())
    .post(`/api/v1/seller${path}`)
    .set('X-Bovann-Seller', '1')
    .send(body as object);
  return lang ? r.set('Accept-Language', lang) : r;
};

const askCode = async (phone: string) =>
  (await post('/auth/code', { phone, channel: 'WHATSAPP' }).expect(200)).body as SellerCodeResponse;

const otherCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

beforeAll(async () => {
  db = await freshDatabase();
  app = await sellerApp();
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

beforeEach(() => clock.set('2026-11-11T08:00:00.000Z'));

describe('signing in with a code', () => {
  it('sends a code, signs in with it, and creates the seller once', async () => {
    const phone = newPhone();
    const sent = await askCode(phone);
    expect(sent).toMatchObject({ phone, channel: 'WHATSAPP', expiresInSec: 600, resendInSec: 60 });
    expect(sent.devCode).toMatch(/^\d{6}$/);

    const stored = await db
      .selectFrom('t_seller_otps')
      .select('code_hash')
      .where('phone_e164', '=', phone)
      .executeTakeFirstOrThrow();
    expect(stored.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.code_hash).not.toContain(sent.devCode);

    const res = await post('/auth/verify', { phone, code: sent.devCode }, 'en').expect(200);
    expect(res.body).toEqual({ id: expect.any(Number), phone });
    const cookie = res.get('Set-Cookie')!.find((c) => c.startsWith('bovann_seller_session='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Max-Age=7776000/); // 90 days, counted by the browser

    const me = await request(app.getHttpServer())
      .get('/api/v1/seller/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(me.body.phone).toBe(phone);

    // A second sign-in reuses the same seller.
    clock.advanceMinutes(2);
    const again = await askCode(phone);
    await post('/auth/verify', { phone, code: again.devCode }).expect(200);
    const sellers = await db
      .selectFrom('t_sellers')
      .selectAll()
      .where('phone_e164', '=', phone)
      .execute();
    expect(sellers).toHaveLength(1);
    expect(sellers[0]!.locale).toBe('fr');
  });

  it('counts wrong tries and stops the code after 5', async () => {
    const phone = newPhone();
    const { devCode } = await askCode(phone);
    const wrong = otherCode(devCode!);
    const first = await post('/auth/verify', { phone, code: wrong }).expect(400);
    expect(first.body).toMatchObject({
      code: 'OTP_INVALID',
      message: 'Code incorrect. Encore 4 essais.',
      details: { attemptsLeft: 4 },
    });
    for (let i = 0; i < 3; i++) await post('/auth/verify', { phone, code: wrong }).expect(400);
    const last = await post('/auth/verify', { phone, code: wrong }, 'en').expect(400);
    expect(last.body).toMatchObject({
      code: 'OTP_EXPIRED',
      message: 'Too many tries. Ask for a new code.',
    });
    const right = await post('/auth/verify', { phone, code: devCode }).expect(400);
    expect(right.body.code).toBe('OTP_EXPIRED');
  });

  it('accepts a code once, for 10 minutes, and only the latest one', async () => {
    const phone = newPhone();
    const first = await askCode(phone);
    clock.advanceMinutes(1);
    const second = await askCode(phone);
    expect((await post('/auth/verify', { phone, code: first.devCode }).expect(400)).body.code).toBe(
      'OTP_INVALID',
    );
    await post('/auth/verify', { phone, code: second.devCode }).expect(200);
    expect(
      (await post('/auth/verify', { phone, code: second.devCode }).expect(400)).body.code,
    ).toBe('OTP_EXPIRED');

    clock.advanceMinutes(2);
    const third = await askCode(phone);
    clock.advanceMinutes(10);
    expect((await post('/auth/verify', { phone, code: third.devCode }).expect(400)).body.code).toBe(
      'OTP_EXPIRED',
    );
  });

  it('waits a minute between codes and allows 5 per hour per phone', async () => {
    const phone = newPhone();
    await askCode(phone);
    clock.advanceMinutes(0.5);
    const soon = await post('/auth/code', { phone, channel: 'SMS' }).expect(429);
    expect(soon.body).toMatchObject({
      code: 'OTP_TOO_SOON',
      message: 'Patientez 30 s avant de demander un nouveau code.',
      details: { retryInSec: 30 },
    });
    for (let i = 0; i < 4; i++) {
      clock.advanceMinutes(1);
      await askCode(phone);
    }
    clock.advanceMinutes(1);
    const many = await post('/auth/code', { phone, channel: 'WHATSAPP' }, 'en').expect(429);
    expect(many.body).toMatchObject({
      code: 'OTP_TOO_MANY',
      message: 'Too many codes asked for this number. Try again in 55 min.',
    });
    clock.advanceMinutes(56);
    await askCode(phone);
  });

  it('checks the phone, the code format and the CSRF header', async () => {
    const bad = await post('/auth/code', { phone: '90 12 34 56' }).expect(400);
    expect(bad.body.details[0].message).toBe('Numéro de téléphone invalide.');
    const spaced = await post('/auth/code', { phone: '+228 91 99 99 01' }).expect(200);
    expect(spaced.body.phone).toBe('+22891999901');
    const code = await post('/auth/verify', { phone: '+22891999901', code: '12ab' }, 'en').expect(
      400,
    );
    expect(code.body.details[0].message).toBe('The code has 6 digits.');
    await request(app.getHttpServer())
      .post('/api/v1/seller/auth/code')
      .send({ phone: newPhone() })
      .expect(403);
  });
});

describe('sessions', () => {
  const signIn = async (phone = newPhone()) => {
    const { devCode } = await askCode(phone);
    const res = await post('/auth/verify', { phone, code: devCode }).expect(200);
    return {
      phone,
      cookie: res.get('Set-Cookie')!.find((c) => c.startsWith('bovann_seller_session='))!,
    };
  };
  const me = (cookie: string) =>
    request(app.getHttpServer()).get('/api/v1/seller/me').set('Cookie', cookie);

  it('signs out', async () => {
    const { cookie } = await signIn();
    await request(app.getHttpServer())
      .post('/api/v1/seller/auth/logout')
      .set('Cookie', cookie)
      .set('X-Bovann-Seller', '1')
      .expect(204);
    const after = await me(cookie).expect(401);
    expect(after.body.code).toBe('NOT_AUTHENTICATED');
  });

  it('ends after 30 days without activity', async () => {
    const { cookie } = await signIn();
    clock.advanceMinutes(29 * 24 * 60);
    await me(cookie).expect(200);
    clock.advanceMinutes(29 * 24 * 60);
    await me(cookie).expect(200);
    clock.advanceMinutes(31 * 24 * 60);
    await me(cookie).expect(401);
  });

  it('refuses a blocked seller, and ends their sessions', async () => {
    const { phone, cookie } = await signIn();
    await db
      .updateTable('t_sellers')
      .set({ blocked_at: clock.now(), blocked_reason: 'Faux lives' })
      .where('phone_e164', '=', phone)
      .execute();
    await me(cookie).expect(401);
    clock.advanceMinutes(2);
    const { devCode } = await askCode(phone);
    const res = await post('/auth/verify', { phone, code: devCode }).expect(403);
    expect(res.body.code).toBe('SELLER_BLOCKED');
  });
});

describe('without a WhatsApp/SMS provider', () => {
  it('says sign-in is not open yet', async () => {
    const closed = await sellerApp({ disabled: true });
    try {
      const status = await request(closed.getHttpServer())
        .get('/api/v1/seller/auth/status')
        .expect(200);
      expect(status.body).toEqual({ available: false });
      const res = await request(closed.getHttpServer())
        .post('/api/v1/seller/auth/code')
        .set('X-Bovann-Seller', '1')
        .send({ phone: newPhone() })
        .expect(503);
      expect(res.body.code).toBe('OTP_UNAVAILABLE');
      expect(res.body.devCode).toBeUndefined();
    } finally {
      await closed.close();
    }
    const open = await request(app.getHttpServer()).get('/api/v1/seller/auth/status').expect(200);
    expect(open.body).toEqual({ available: true });
  });
});
