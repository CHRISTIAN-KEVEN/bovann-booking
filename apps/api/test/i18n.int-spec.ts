import type { INestApplication } from '@nestjs/common';
import type { BookingDto, CreateBookingResponse, PackagesResponse, SpaceDto } from '@bovann/shared';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { Database } from '../src/database/schema';
import { NotificationService } from '../src/notification/notification.service';
import { adminApp, FakeMailer } from './helpers/admin-app';
import { holdRequest, newPhone, TestClock } from './helpers/booking-app';
import { freshDatabase } from './helpers/test-db';

/**
 * French and English (2026-11-10): the API answers in the language the page asks for
 * (Accept-Language), and each booking keeps its language for the customer's emails.
 */
const clock = new TestClock(new Date('2026-11-09T08:00:00.000Z'));
const mailer = new FakeMailer();
let app: INestApplication;
let db: Kysely<Database>;
let ip = 0;
const SLUG = 'studio-principal-lome';

const get = (path: string, lang?: string) => {
  const r = request(app.getHttpServer()).get(`/api/v1${path}`);
  return lang ? r.set('Accept-Language', lang) : r;
};

async function book(slot: string, lang: string, email = 'client@example.test') {
  const res = await request(app.getHttpServer())
    .post('/api/v1/bookings')
    .set('Accept-Language', lang)
    .set('X-Forwarded-For', `41.207.170.${++ip}`)
    .send(
      holdRequest({
        selection: { type: 'PACKAGE', packageCode: 'PACK_3H', start: slot },
        customer: {
          fullName: 'Kofi Mensah',
          phone: newPhone(),
          email,
          businessName: 'Kofi Electro',
          businessSector: 'Services',
        },
      }),
    )
    .expect(201);
  return res.body as CreateBookingResponse;
}

beforeAll(async () => {
  db = await freshDatabase();
  await db
    .updateTable('t_package_prices')
    .set({ valid_from: new Date('2026-01-01T00:00:00Z') })
    .execute();
  app = await adminApp(clock, {}, { mailer });
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

describe('names in the page language', () => {
  it('gives the space and package names in English when asked, in French otherwise', async () => {
    const fr = (await get(`/spaces/${SLUG}`).expect(200)).body as SpaceDto;
    const en = (await get(`/spaces/${SLUG}`, 'en').expect(200)).body as SpaceDto;
    expect(fr.name).toBe('Studio principal — Lomé');
    expect(en.name).toBe('Main studio — Lomé');

    const pkFr = (await get(`/spaces/${SLUG}/packages?mode=IN_PERSON`, 'fr').expect(200))
      .body as PackagesResponse;
    const pkEn = (
      await get(`/spaces/${SLUG}/packages?mode=IN_PERSON`, 'en-GB,en;q=0.9').expect(200)
    ).body as PackagesResponse;
    expect(pkFr.packages.map((p) => p.name)).toContain('Pack 3h');
    expect(pkEn.packages.map((p) => p.name)).toEqual(
      expect.arrayContaining(['Single slot', '3h package', '6h package', 'Full day']),
    );
  });

  it('falls back to the French name when no English one was entered', async () => {
    await db
      .updateTable('t_packages')
      .set({ name_en: null })
      .where('code', '=', 'PACK_6H')
      .execute();
    const pkEn = (await get(`/spaces/${SLUG}/packages?mode=IN_PERSON`, 'en').expect(200))
      .body as PackagesResponse;
    expect(pkEn.packages.find((p) => p.code === 'PACK_6H')!.name).toBe('Pack 6h');
    await db
      .updateTable('t_packages')
      .set({ name_en: '6h package' })
      .where('code', '=', 'PACK_6H')
      .execute();
  });
});

describe('error messages in the page language', () => {
  it('translates catalog messages, keeps French by default', async () => {
    const fr = await get('/spaces/nope').expect(404);
    const en = await get('/spaces/nope', 'en').expect(404);
    expect(fr.body).toMatchObject({
      code: 'SPACE_NOT_FOUND',
      message: 'Cet espace est introuvable.',
    });
    expect(en.body).toMatchObject({
      code: 'SPACE_NOT_FOUND',
      message: 'This space can’t be found.',
    });
  });

  it('translates validation problems, details included', async () => {
    const en = await get(`/spaces/${SLUG}/availability?month=nope`, 'en').expect(400);
    expect(en.body.code).toBe('VALIDATION_ERROR');
    expect(en.body.message).toBe('Invalid month: use the format YYYY-MM, for example 2026-11.');
    expect(JSON.stringify(en.body)).not.toMatch(/[éèà]/);
  });

  it('sends messages built with values in both languages', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/auth/me')
      .set('Accept-Language', 'en')
      .expect(401);
    expect(res.body.message).toBe('Your session has expired. Sign in again.');
    expect(res.body).not.toHaveProperty('messageEn');
  });
});

describe('bookings remember their language', () => {
  it('stores the language, shows the package in the asked language, emails the customer in it', async () => {
    const b = await book('2026-11-20T08:00:00.000Z', 'en');
    expect(b.booking.packageName).toBe('3h package');
    expect(b.payment.instructions).toMatch(/^Simulated payment: a request for 27,000 FCFA/);

    const row = await db
      .selectFrom('t_bookings')
      .select(['id', 'locale', 'package_name', 'package_name_en'])
      .where('reference', '=', b.booking.reference)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      locale: 'en',
      package_name: 'Pack 3h',
      package_name_en: '3h package',
    });

    const asFrench = (
      await get(`/bookings/${b.booking.reference}`, 'fr')
        .set('X-Booking-Token', b.accessToken)
        .expect(200)
    ).body as BookingDto;
    expect(asFrench.packageName).toBe('Pack 3h');

    await request(app.getHttpServer())
      .post(`/api/v1/dev/payments/${b.booking.reference}/succeed`)
      .send({})
      .expect(200);
    mailer.sent = [];
    await app.get(NotificationService).processDue();
    const customer = mailer.sent.find((m) => m.to === 'client@example.test')!;
    expect(customer.subject).toBe(`Booking confirmed · ${b.booking.reference}`);
    expect(customer.html).toContain('lang="en"');
    expect(customer.text).toContain('Your booking is confirmed');
    expect(customer.text).toContain('3h package');
    expect(customer.text).toContain('/en/mes-reservations?ref=');
    // The studio's own emails stay in French.
    expect(
      mailer.sent
        .filter((m) => m.to !== 'client@example.test')
        .every((m) => m.subject.startsWith('Nouvelle réservation')),
    ).toBe(true);

    const receipt = await get(`/bookings/${b.booking.reference}/receipt`, 'en')
      .set('X-Booking-Token', b.accessToken)
      .expect(200);
    expect(receipt.headers['content-disposition']).toBe(
      `attachment; filename="receipt-${b.booking.reference}.pdf"`,
    );
  });

  it('keeps French for bookings made on the French site', async () => {
    const b = await book('2026-11-21T08:00:00.000Z', 'fr', 'autre@example.test');
    expect(b.booking.packageName).toBe('Pack 3h');
    const row = await db
      .selectFrom('t_bookings')
      .select('locale')
      .where('reference', '=', b.booking.reference)
      .executeTakeFirstOrThrow();
    expect(row.locale).toBe('fr');
  });
});
