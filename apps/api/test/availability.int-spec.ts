import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  DayAvailabilityResponse,
  MonthAvailabilityResponse,
  PackagesResponse,
  SpaceDto,
} from '@bovann/shared';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { configureApp } from '../src/app.setup';
import { AvailabilityModule } from '../src/availability/availability.module';
import { CLOCK, ClockModule } from '../src/common/clock';
import { ConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import type { Database } from '../src/database/schema';
import { freshDatabase, testDatabaseUrl } from './helpers/test-db';

/**
 * End-to-end through HTTP, Nest, Kysely and MySQL, with the clock frozen on
 * Sunday 8 November 2026, 21:00 in Lomé.
 *
 * Fixture for Thursday 12 November (matches the approved design):
 *   09:30 and 11:00 → confirmed booking
 *   18:30           → pending booking, hold still valid
 *   08:00           → pending booking whose hold EXPIRED (must show as available)
 * Friday 13: 08:00 blocked by an admin. Friday 20: closed all day.
 */
const NOW = new Date('2026-11-08T21:00:00.000Z');
const SLUG = 'studio-principal-lome';

let app: INestApplication;
let db: Kysely<Database>;
let spaceId: number;
let customerId: number;
let ref = 0;

async function book(
  status: 'CONFIRMED' | 'PENDING_PAYMENT',
  slotIsos: string[],
  holdExpiresAt: Date | null,
) {
  ref += 1;
  const slots = slotIsos.map((iso) => new Date(iso));
  const res = await db
    .insertInto('t_bookings')
    .values({
      reference: `AVAIL-${ref}`,
      space_id: spaceId,
      customer_id: customerId,
      mode: 'IN_PERSON',
      booking_type: 'SLOTS',
      slot_count: slots.length,
      starts_at: slots[0]!,
      ends_at: new Date(slots[slots.length - 1]!.getTime() + 90 * 60_000),
      unit_price_xof: 15000,
      list_price_xof: 15000 * slots.length,
      total_xof: 15000 * slots.length,
      status,
      hold_expires_at: holdExpiresAt,
      confirmed_at: status === 'CONFIRMED' ? NOW : null,
    })
    .executeTakeFirstOrThrow();
  const bookingId = Number(res.insertId);
  await db
    .insertInto('t_booking_slots')
    .values(slots.map((slot_start) => ({ booking_id: bookingId, slot_start })))
    .execute();
  await db
    .insertInto('t_slot_occupancies')
    .values(slots.map((slot_start) => ({ space_id: spaceId, slot_start, booking_id: bookingId })))
    .execute();
}

beforeAll(async () => {
  db = await freshDatabase();
  process.env.DATABASE_URL = testDatabaseUrl();
  spaceId = (
    await db.selectFrom('t_spaces').select('id').where('slug', '=', SLUG).executeTakeFirstOrThrow()
  ).id;
  // The seed dates prices "from now"; the frozen test clock is earlier, so backdate them.
  await db
    .updateTable('t_package_prices')
    .set({ valid_from: new Date('2026-01-01T00:00:00Z') })
    .execute();
  customerId = Number(
    (
      await db
        .insertInto('t_customers')
        .values({
          full_name: 'Kodjo Agbeko',
          phone_e164: '+22891000008',
          business_name: 'KA Électronique',
          business_sector: 'Électronique',
        })
        .executeTakeFirstOrThrow()
    ).insertId,
  );

  await book('CONFIRMED', ['2026-11-12T09:30:00Z', '2026-11-12T11:00:00Z'], null);
  await book('PENDING_PAYMENT', ['2026-11-12T18:30:00Z'], new Date('2026-11-08T21:05:00Z'));
  await book('PENDING_PAYMENT', ['2026-11-12T08:00:00Z'], new Date('2026-11-08T20:50:00Z'));

  const block = await db
    .insertInto('t_slot_blocks')
    .values({ space_id: spaceId, reason: 'Maintenance' })
    .executeTakeFirstOrThrow();
  await db
    .insertInto('t_slot_occupancies')
    .values({
      space_id: spaceId,
      slot_start: new Date('2026-11-13T08:00:00Z'),
      block_id: Number(block.insertId),
    })
    .execute();
  await db
    .insertInto('t_closures')
    .values({
      space_id: spaceId,
      starts_at: new Date('2026-11-20T00:00:00Z'),
      ends_at: new Date('2026-11-21T00:00:00Z'),
      reason: 'Jour férié',
    })
    .execute();

  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ClockModule, DatabaseModule, AvailabilityModule],
  })
    .overrideProvider(CLOCK)
    .useValue({ now: () => NOW })
    .compile();
  app = moduleRef.createNestApplication();
  configureApp(app, { corsOrigins: [] });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

const api = () => request(app.getHttpServer());

describe('GET /api/v1/spaces/:slug', () => {
  it('returns the space, its modes and booking window', async () => {
    const res = await api().get(`/api/v1/spaces/${SLUG}`).expect(200);
    const body = res.body as SpaceDto;
    expect(body).toMatchObject({
      slug: SLUG,
      timezone: 'Africa/Lome',
      slotDurationMin: 90,
      modes: ['IN_PERSON', 'VIRTUAL'],
      booking: {
        minLeadMin: 60,
        horizonDays: 90,
        today: '2026-11-08',
        lastBookableDate: '2027-02-06',
      },
    });
  });

  it('answers a French 404 for an unknown space', async () => {
    const res = await api().get('/api/v1/spaces/nope').expect(404);
    expect(res.body).toEqual({
      statusCode: 404,
      code: 'SPACE_NOT_FOUND',
      message: 'Cet espace est introuvable.',
    });
  });

  it('rejects a malformed slug', async () => {
    const res = await api().get('/api/v1/spaces/NOT_VALID!').expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/spaces/:slug/packages', () => {
  it('lists the 4 seed packages with their discounts', async () => {
    const res = await api().get(`/api/v1/spaces/${SLUG}/packages?mode=IN_PERSON`).expect(200);
    const body = res.body as PackagesResponse;
    expect(body.unitPriceXof).toBe(15000);
    expect(
      body.packages.map((p) => [p.code, p.slotCount, p.price.totalXof, p.price.discountPercent]),
    ).toEqual([
      ['SLOT', 1, 15000, 0],
      ['PACK_3H', 2, 27000, 10],
      ['PACK_6H', 4, 51000, 15],
      ['FULL_DAY', 9, 108000, 20],
    ]);
    expect(body.packages[2]!.durationMin).toBe(360);
  });

  it('requires a mode, with a French message', async () => {
    const res = await api().get(`/api/v1/spaces/${SLUG}/packages`).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toContain('mode');
  });
});

describe('GET /api/v1/spaces/:slug/availability?month=', () => {
  let days: MonthAvailabilityResponse['days'];

  beforeAll(async () => {
    const res = await api().get(`/api/v1/spaces/${SLUG}/availability?month=2026-11`).expect(200);
    days = (res.body as MonthAvailabilityResponse).days;
  });

  const dayOf = (d: number) => days[d - 1]!;

  it('returns every day of the month', () => {
    expect(days).toHaveLength(30);
    expect(dayOf(1).date).toBe('2026-11-01');
  });

  it('past days, and today once all slots are over, are PAST', () => {
    expect(dayOf(7).status).toBe('PAST');
    expect(dayOf(8).status).toBe('PAST');
  });

  it('Thursday 12: 3 slots taken, the expired hold counts as free', () => {
    expect(dayOf(12)).toEqual({ date: '2026-11-12', status: 'AVAILABLE', availableCount: 6 });
  });

  it('Friday 13: the admin block removes one slot', () => {
    expect(dayOf(13).availableCount).toBe(8);
  });

  it('Friday 20: closed all day', () => {
    expect(dayOf(20)).toEqual({ date: '2026-11-20', status: 'CLOSED', availableCount: 0 });
  });

  it('an untouched future day is fully available', () => {
    expect(dayOf(16)).toEqual({ date: '2026-11-16', status: 'AVAILABLE', availableCount: 9 });
  });

  it('rejects an invalid month', async () => {
    const res = await api().get(`/api/v1/spaces/${SLUG}/availability?month=2026-13`).expect(400);
    expect(res.body.message).toContain('AAAA-MM');
  });
});

describe('GET /api/v1/spaces/:slug/availability/:date', () => {
  let day: DayAvailabilityResponse;

  beforeAll(async () => {
    const res = await api()
      .get(`/api/v1/spaces/${SLUG}/availability/2026-11-12?mode=IN_PERSON`)
      .expect(200);
    day = res.body as DayAvailabilityResponse;
  });

  it('lists the 9 slots with their status and local times', () => {
    expect(day.slots.map((s) => `${s.startTime} ${s.status}`)).toEqual([
      '08:00 AVAILABLE',
      '09:30 BOOKED',
      '11:00 BOOKED',
      '12:30 AVAILABLE',
      '14:00 AVAILABLE',
      '15:30 AVAILABLE',
      '17:00 AVAILABLE',
      '18:30 BOOKED',
      '20:00 AVAILABLE',
    ]);
    expect(day.slots[0]).toMatchObject({
      start: '2026-11-12T08:00:00.000Z',
      end: '2026-11-12T09:30:00.000Z',
      endTime: '09:30',
    });
  });

  it('Pack 6h only fits at 12:30 → 18:30, as in the approved design', () => {
    const pack = day.packages.find((p) => p.code === 'PACK_6H')!;
    expect(pack.startOptions.map((o) => `${o.startTime}–${o.endTime}`)).toEqual(['12:30–18:30']);
    expect(pack.price.totalXof).toBe(51000);
  });

  it('the full-day package is listed but cannot be booked on a partly booked day', () => {
    const fullDay = day.packages.find((p) => p.code === 'FULL_DAY')!;
    expect(fullDay.startOptions).toEqual([]);
    expect(fullDay.slotCount).toBe(9);
  });

  it('single slots can start at every available slot', () => {
    const single = day.packages.find((p) => p.code === 'SLOT')!;
    expect(single.startOptions.map((o) => o.startTime)).toEqual([
      '08:00',
      '12:30',
      '14:00',
      '15:30',
      '17:00',
      '20:00',
    ]);
  });

  it('on a free day, the full-day package is bookable from 08:00 to 21:30', async () => {
    const res = await api()
      .get(`/api/v1/spaces/${SLUG}/availability/2026-11-16?mode=VIRTUAL`)
      .expect(200);
    const fullDay = (res.body as DayAvailabilityResponse).packages.find(
      (p) => p.code === 'FULL_DAY',
    )!;
    expect(fullDay.startOptions).toEqual([
      {
        start: '2026-11-16T08:00:00.000Z',
        end: '2026-11-16T21:30:00.000Z',
        startTime: '08:00',
        endTime: '21:30',
      },
    ]);
  });

  it('rejects an impossible date', async () => {
    const res = await api()
      .get(`/api/v1/spaces/${SLUG}/availability/2026-02-30?mode=IN_PERSON`)
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a mode the space does not offer', async () => {
    await db
      .updateTable('t_spaces')
      .set({ virtual_enabled: false })
      .where('id', '=', spaceId)
      .execute();
    try {
      const res = await api()
        .get(`/api/v1/spaces/${SLUG}/availability/2026-11-16?mode=VIRTUAL`)
        .expect(400);
      expect(res.body.code).toBe('MODE_NOT_AVAILABLE');
    } finally {
      await db
        .updateTable('t_spaces')
        .set({ virtual_enabled: true })
        .where('id', '=', spaceId)
        .execute();
    }
  });
});
