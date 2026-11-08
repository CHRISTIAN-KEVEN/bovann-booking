import { sql, type Kysely } from 'kysely';
import { ER_DUP_ENTRY, isDuplicateKeyError } from '../src/database/connection';
import type { Database } from '../src/database/schema';
import { SEED_PACKAGES, SEED_SPACE } from '../src/database/seed';
import { freshDatabase } from './helpers/test-db';

/**
 * These tests prove that the critical business rules are enforced by MySQL
 * itself, not only by application code (project rule: "application-level
 * validation alone is not sufficient for critical constraints").
 */

let db: Kysely<Database>;
let spaceId: number;
let customerId: number;
let referenceCounter = 0;

/** Shape of the error MySQL raises on a UNIQUE violation. */
const DUPLICATE_KEY = { errno: ER_DUP_ENTRY };

const SLOT_14H = new Date('2026-11-12T14:00:00.000Z');
const SLOT_15H30 = new Date('2026-11-12T15:30:00.000Z');

beforeAll(async () => {
  db = await freshDatabase();
  spaceId = (
    await db
      .selectFrom('t_spaces')
      .select('id')
      .where('slug', '=', SEED_SPACE.slug)
      .executeTakeFirstOrThrow()
  ).id;
  const inserted = await db
    .insertInto('t_customers')
    .values({
      full_name: 'Afi Mensah',
      phone_e164: '+22890123456',
      business_name: 'Boutique Afi Mode',
      business_sector: 'Mode & beauté',
    })
    .executeTakeFirstOrThrow();
  customerId = Number(inserted.insertId);
});

afterAll(async () => {
  await db?.destroy();
});

/** Inserts a pending SLOTS booking covering the given slots (without occupying them). */
async function createBooking(slots: Date[], trx: Kysely<Database> = db): Promise<number> {
  referenceCounter += 1;
  const first = slots[0]!;
  const last = slots[slots.length - 1]!;
  const result = await trx
    .insertInto('t_bookings')
    .values({
      reference: `TEST-${referenceCounter.toString().padStart(6, '0')}`,
      space_id: spaceId,
      customer_id: customerId,
      mode: 'IN_PERSON',
      booking_type: 'SLOTS',
      slot_count: slots.length,
      starts_at: first,
      ends_at: new Date(last.getTime() + 90 * 60_000),
      unit_price_xof: 15000,
      list_price_xof: 15000 * slots.length,
      total_xof: 15000 * slots.length,
      hold_expires_at: new Date(Date.now() + 10 * 60_000),
    })
    .executeTakeFirstOrThrow();
  const bookingId = Number(result.insertId);
  await trx
    .insertInto('t_booking_slots')
    .values(slots.map((slot_start) => ({ booking_id: bookingId, slot_start })))
    .execute();
  return bookingId;
}

async function occupy(bookingId: number, slots: Date[], trx: Kysely<Database> = db): Promise<void> {
  await trx
    .insertInto('t_slot_occupancies')
    .values(slots.map((slot_start) => ({ space_id: spaceId, slot_start, booking_id: bookingId })))
    .execute();
}

async function expectRejected(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  await expect(promise).rejects.toThrow(pattern);
}

describe('seed data', () => {
  it('creates the studio, 7 opening days and 4 packages priced for both modes', async () => {
    const hours = await db
      .selectFrom('t_opening_hours')
      .selectAll()
      .where('space_id', '=', spaceId)
      .execute();
    expect(hours).toHaveLength(7);
    expect(hours.every((h) => h.opens_at === '08:00:00' && h.closes_at === '21:30:00')).toBe(true);

    const prices = await db
      .selectFrom('t_package_prices as pp')
      .innerJoin('t_packages as p', 'p.id', 'pp.package_id')
      .select(['p.code', 'pp.mode', 'pp.price_xof'])
      .where('pp.valid_to', 'is', null)
      .execute();
    expect(prices).toHaveLength(SEED_PACKAGES.length * 2);
    expect(prices.find((p) => p.code === 'SLOT' && p.mode === 'IN_PERSON')?.price_xof).toBe(15000);
  });

  it('returns MySQL booleans as JS booleans', async () => {
    const space = await db
      .selectFrom('t_spaces')
      .selectAll()
      .where('id', '=', spaceId)
      .executeTakeFirstOrThrow();
    expect(space.is_active).toBe(true);
    expect(space.virtual_enabled).toBe(true);
  });
});

describe('double booking prevention (t_slot_occupancies)', () => {
  it('rejects a second booking on an occupied slot', async () => {
    const first = await createBooking([SLOT_14H]);
    await occupy(first, [SLOT_14H]);

    const second = await createBooking([SLOT_14H]);
    const attempt = occupy(second, [SLOT_14H]);
    await expect(attempt).rejects.toMatchObject(DUPLICATE_KEY);
  });

  it('rolls back the whole multi-slot hold when one slot is taken', async () => {
    const booking = await createBooking([SLOT_15H30, SLOT_14H].sort((a, b) => +a - +b));
    await expect(
      db.transaction().execute(async (trx) => {
        await occupy(booking, [SLOT_15H30], trx); // free
        await occupy(booking, [SLOT_14H], trx); // taken by the previous test
      }),
    ).rejects.toMatchObject(DUPLICATE_KEY);

    const leftover = await db
      .selectFrom('t_slot_occupancies')
      .select('id')
      .where('booking_id', '=', booking)
      .execute();
    expect(leftover).toHaveLength(0);
  });

  it('lets exactly one of many concurrent holds on the same slot succeed', async () => {
    const slot = new Date('2026-11-13T08:00:00.000Z');
    const contenders = await Promise.all(Array.from({ length: 8 }, () => createBooking([slot])));

    const outcomes = await Promise.allSettled(
      contenders.map((bookingId) =>
        db.transaction().execute(async (trx) => {
          await occupy(bookingId, [slot], trx);
        }),
      ),
    );

    const succeeded = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    expect(rejected.every((o) => isDuplicateKeyError(o.reason))).toBe(true);
  });

  it('refuses an occupancy for a slot the booking does not cover', async () => {
    const booking = await createBooking([new Date('2026-11-14T08:00:00.000Z')]);
    await expectRejected(
      occupy(booking, [new Date('2026-11-14T09:30:00.000Z')]),
      /foreign key constraint fails/i,
    );
  });

  it('refuses an occupancy owned by both a booking and a block', async () => {
    const slot = new Date('2026-11-15T08:00:00.000Z');
    const booking = await createBooking([slot]);
    const block = await db
      .insertInto('t_slot_blocks')
      .values({ space_id: spaceId, reason: 'Maintenance' })
      .executeTakeFirstOrThrow();
    await expectRejected(
      db
        .insertInto('t_slot_occupancies')
        .values({
          space_id: spaceId,
          slot_start: slot,
          booking_id: booking,
          block_id: Number(block.insertId),
        })
        .execute(),
      /chk_occupancies_owner/,
    );
  });

  it('lets an admin block a free slot, which then cannot be booked', async () => {
    const slot = new Date('2026-11-16T08:00:00.000Z');
    const block = await db
      .insertInto('t_slot_blocks')
      .values({ space_id: spaceId, reason: 'Événement privé' })
      .executeTakeFirstOrThrow();
    await db
      .insertInto('t_slot_occupancies')
      .values({ space_id: spaceId, slot_start: slot, block_id: Number(block.insertId) })
      .execute();

    const booking = await createBooking([slot]);
    await expect(occupy(booking, [slot])).rejects.toMatchObject(DUPLICATE_KEY);
  });
});

describe('booking rules', () => {
  it('refuses totals that do not add up', async () => {
    await expectRejected(
      db
        .insertInto('t_bookings')
        .values({
          reference: 'TEST-BADSUM',
          space_id: spaceId,
          customer_id: customerId,
          mode: 'VIRTUAL',
          booking_type: 'SLOTS',
          slot_count: 1,
          starts_at: SLOT_14H,
          ends_at: SLOT_15H30,
          unit_price_xof: 15000,
          list_price_xof: 15000,
          discount_xof: 1000,
          total_xof: 15000,
          hold_expires_at: new Date(),
        })
        .execute(),
      /chk_bookings_amounts/,
    );
  });

  it('refuses a package booking without a package', async () => {
    await expectRejected(
      db
        .insertInto('t_bookings')
        .values({
          reference: 'TEST-NOPKG',
          space_id: spaceId,
          customer_id: customerId,
          mode: 'IN_PERSON',
          booking_type: 'PACKAGE',
          slot_count: 2,
          starts_at: SLOT_14H,
          ends_at: new Date('2026-11-12T17:00:00.000Z'),
          unit_price_xof: 15000,
          list_price_xof: 30000,
          discount_xof: 3000,
          total_xof: 27000,
          hold_expires_at: new Date(),
        })
        .execute(),
      /chk_bookings_type/,
    );
  });

  it('refuses a pending booking without a hold expiry', async () => {
    await expectRejected(
      db
        .insertInto('t_bookings')
        .values({
          reference: 'TEST-NOHOLD',
          space_id: spaceId,
          customer_id: customerId,
          mode: 'IN_PERSON',
          booking_type: 'SLOTS',
          slot_count: 1,
          starts_at: SLOT_14H,
          ends_at: SLOT_15H30,
          unit_price_xof: 15000,
          list_price_xof: 15000,
          total_xof: 15000,
          hold_expires_at: null,
        })
        .execute(),
      /chk_bookings_hold/,
    );
  });

  it('refuses a malformed phone number', async () => {
    await expectRejected(
      db
        .insertInto('t_customers')
        .values({
          full_name: 'X',
          phone_e164: '90123456',
          business_name: 'X',
          business_sector: 'X',
        })
        .execute(),
      /chk_customers_phone/,
    );
  });
});

describe('pricing rules', () => {
  it('allows only one current price per package and mode', async () => {
    const pkg = await db
      .selectFrom('t_packages')
      .select('id')
      .where('code', '=', 'PACK_6H')
      .executeTakeFirstOrThrow();
    const attempt = db
      .insertInto('t_package_prices')
      .values({
        package_id: pkg.id,
        mode: 'IN_PERSON',
        price_xof: 50000,
        valid_from: sql<Date>`CURRENT_TIMESTAMP(3)`,
      })
      .execute();
    await expect(attempt).rejects.toMatchObject(DUPLICATE_KEY);
  });

  it('refuses a full-day package with a fixed slot count', async () => {
    await expectRejected(
      db
        .insertInto('t_packages')
        .values({
          space_id: spaceId,
          code: 'BAD_DAY',
          name: 'Bad',
          is_full_day: true,
          slot_count: 9,
        })
        .execute(),
      /chk_packages_size/,
    );
  });
});

describe('payment and notification rules', () => {
  it('allows at most one succeeded payment per booking', async () => {
    const booking = await createBooking([new Date('2026-11-17T08:00:00.000Z')]);
    const payment = (n: number) => ({
      booking_id: booking,
      provider: 'mock',
      provider_ref: `ref-${booking}-${n}`,
      idempotency_key: `key-${booking}-${n}`,
      method: 'MOBILE_MONEY' as const,
      amount_xof: 15000,
      status: 'SUCCEEDED' as const,
      succeeded_at: new Date(),
    });
    await db.insertInto('t_payments').values(payment(1)).execute();
    await expect(db.insertInto('t_payments').values(payment(2)).execute()).rejects.toMatchObject(
      DUPLICATE_KEY,
    );
  });

  it('never queues the same owner email twice for a booking', async () => {
    const booking = await createBooking([new Date('2026-11-18T08:00:00.000Z')]);
    const notification = {
      booking_id: booking,
      channel: 'EMAIL' as const,
      template: 'owner_booking_confirmed',
      recipient: 'owner@example.test',
      payload: JSON.stringify({ reference: 'x' }),
    };
    await db.insertInto('t_notifications').values(notification).execute();
    await expect(
      db.insertInto('t_notifications').values(notification).execute(),
    ).rejects.toMatchObject(DUPLICATE_KEY);
  });
});

describe('time handling', () => {
  it('stores and returns slot times in UTC without shifting', async () => {
    const slot = new Date('2026-11-19T20:00:00.000Z');
    const booking = await createBooking([slot]);
    const row = await db
      .selectFrom('t_booking_slots')
      .select('slot_start')
      .where('booking_id', '=', booking)
      .executeTakeFirstOrThrow();
    expect(row.slot_start.toISOString()).toBe('2026-11-19T20:00:00.000Z');

    const { rows } = await sql<{ tz: string }>`SELECT @@session.time_zone AS tz`.execute(db);
    expect(rows[0]?.tz).toBe('+00:00');
  });
});
