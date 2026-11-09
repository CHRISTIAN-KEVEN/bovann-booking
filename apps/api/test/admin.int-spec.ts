import type { INestApplication } from '@nestjs/common';
import type {
  AdminBookingDetail,
  AdminBookingListResponse,
  AdminCreateBookingRequest,
  AdminDashboardStats,
  AdminDayOptionsResponse,
  AdminPackagesResponse,
  ClosureDto,
  CreateBookingResponse,
  DayAvailabilityResponse,
  OpeningHoursDayDto,
  PackagesResponse,
  ScheduleResponse,
} from '@bovann/shared';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { Database } from '../src/database/schema';
import { adminApp, createAdminUser, signedIn, type AdminClient } from './helpers/admin-app';
import { holdRequest, newPhone, TestClock } from './helpers/booking-app';
import { freshDatabase } from './helpers/test-db';

/**
 * Phase 5 end to end: the admin API over HTTP against MySQL, with a frozen
 * clock (Monday 9 November 2026, 08:00 in Lomé = UTC). Each scenario uses its
 * own day so tests stay independent.
 */
const START = '2026-11-09T08:00:00.000Z';
const clock = new TestClock(new Date(START));
let app: INestApplication;
let db: Kysely<Database>;
let owner: AdminClient;
let staff: AdminClient;
const SPACE = 1;

const at = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`;

function manual(overrides: Partial<AdminCreateBookingRequest> = {}): AdminCreateBookingRequest {
  return {
    spaceId: SPACE,
    mode: 'IN_PERSON',
    selection: { type: 'SLOTS', slotStarts: [at('2026-11-20', '08:00')] },
    customer: {
      fullName: 'Komi Adjo',
      phone: newPhone(),
      email: 'komi@example.test',
      businessName: 'Adjo Cosmétiques',
      businessSector: 'Beauté',
    },
    payment: { status: 'PAID', method: 'CASH' },
    ...overrides,
  };
}

async function customerDay(date: string): Promise<DayAvailabilityResponse> {
  const res = await request(app.getHttpServer())
    .get(`/api/v1/spaces/studio-principal-lome/availability/${date}?mode=IN_PERSON`)
    .expect(200);
  return res.body as DayAvailabilityResponse;
}
const statusAt = (d: DayAvailabilityResponse, hhmm: string) =>
  d.slots.find((s) => s.startTime === hhmm)!.status;

function onlineHold(slotStarts: string[]) {
  return request(app.getHttpServer())
    .post('/api/v1/bookings')
    .send(holdRequest({ selection: { type: 'SLOTS', slotStarts } }));
}
function devPay(reference: string) {
  return request(app.getHttpServer()).post(`/api/v1/dev/payments/${reference}/succeed`).send({});
}

beforeAll(async () => {
  db = await freshDatabase();
  await db
    .updateTable('t_package_prices')
    .set({ valid_from: new Date('2026-01-01T00:00:00Z') })
    .execute();
  app = await adminApp(clock);
  owner = await signedIn(app, await createAdminUser(db));
  staff = await signedIn(app, await createAdminUser(db, { role: 'STAFF' }));
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

beforeEach(() => clock.set(START));

describe('studio bookings (phone, walk-in)', () => {
  it('books and confirms at once, takes the slots and queues the owner email', async () => {
    const body = (await staff.post('/bookings', manual()).expect(201)).body as AdminBookingDetail;
    expect(body).toMatchObject({
      status: 'CONFIRMED',
      source: 'ADMIN',
      totalXof: 15000,
      paymentState: 'PAID',
      paymentMethod: 'CASH',
    });
    expect(body.history.map((h) => h.action)).toEqual(['ADMIN_BOOKING_CREATED']);
    expect(statusAt(await customerDay('2026-11-20'), '08:00')).toBe('BOOKED');

    const notifications = await db
      .selectFrom('t_notifications')
      .select('template')
      .where('booking_id', '=', body.id)
      .orderBy('template')
      .execute();
    expect(notifications.map((n) => n.template)).toEqual([
      'customer_booking_confirmed',
      'owner_booking_confirmed',
    ]);
  });

  it('can book a package, a negotiated price, or for free', async () => {
    const pack = (
      await owner
        .post(
          '/bookings',
          manual({
            selection: {
              type: 'PACKAGE',
              packageCode: 'PACK_3H',
              start: at('2026-11-20', '11:00'),
            },
            totalXof: 20000,
          }),
        )
        .expect(201)
    ).body as AdminBookingDetail;
    expect(pack).toMatchObject({
      slotCount: 2,
      totalXof: 20000,
      listPriceXof: 30000,
      discountXof: 10000,
    });

    const free = (
      await owner
        .post(
          '/bookings',
          manual({
            selection: { type: 'SLOTS', slotStarts: [at('2026-11-20', '14:00')] },
            totalXof: 0,
            payment: { status: 'UNPAID' },
          }),
        )
        .expect(201)
    ).body as AdminBookingDetail;
    expect(free).toMatchObject({ totalXof: 0, paymentState: 'FREE', payments: [] });

    const tooMuch = await owner
      .post(
        '/bookings',
        manual({
          selection: { type: 'SLOTS', slotStarts: [at('2026-11-20', '15:30')] },
          totalXof: 15001,
        }),
      )
      .expect(400);
    expect(tooMuch.body.code).toBe('PRICE_ABOVE_LIST');
  });

  it('may book within the hour (customers need 1 h notice), but not a slot already over', async () => {
    // 08:45: the 09:30 slot is closed to customers (1 h lead) but open to the studio.
    clock.set('2026-11-09T08:45:00.000Z');
    expect(statusAt(await customerDay('2026-11-09'), '09:30')).toBe('PAST');
    await owner
      .post(
        '/bookings',
        manual({ selection: { type: 'SLOTS', slotStarts: [at('2026-11-09', '09:30')] } }),
      )
      .expect(201);
    // The 08:00 slot is in progress: still bookable for a walk-in.
    await owner
      .post(
        '/bookings',
        manual({ selection: { type: 'SLOTS', slotStarts: [at('2026-11-09', '08:00')] } }),
      )
      .expect(201);
    clock.set('2026-11-09T11:00:00.000Z');
    await owner
      .post(
        '/bookings',
        manual({ selection: { type: 'SLOTS', slotStarts: [at('2026-11-09', '08:00')] } }),
      )
      .expect(409);
  });

  it('never double-books: a slot taken online is refused, and the other way round', async () => {
    const hold = (await onlineHold([at('2026-11-21', '08:00')]).expect(201))
      .body as CreateBookingResponse;
    await devPay(hold.booking.reference).expect(200);
    const res = await owner
      .post(
        '/bookings',
        manual({ selection: { type: 'SLOTS', slotStarts: [at('2026-11-21', '08:00')] } }),
      )
      .expect(409);
    expect(res.body.code).toBe('SLOT_UNAVAILABLE');

    await owner
      .post(
        '/bookings',
        manual({ selection: { type: 'SLOTS', slotStarts: [at('2026-11-21', '09:30')] } }),
      )
      .expect(201);
    await onlineHold([at('2026-11-21', '09:30')]).expect(409);
  });

  it('reclaims an online hold whose 5 minutes are over', async () => {
    await onlineHold([at('2026-11-21', '11:00')]).expect(201);
    await owner
      .post(
        '/bookings',
        manual({ selection: { type: 'SLOTS', slotStarts: [at('2026-11-21', '11:00')] } }),
      )
      .expect(409);
    clock.advanceMinutes(6);
    await owner
      .post(
        '/bookings',
        manual({ selection: { type: 'SLOTS', slotStarts: [at('2026-11-21', '11:00')] } }),
      )
      .expect(201);
  });

  it('pre-fills a known customer from their phone number', async () => {
    const phone = newPhone();
    await owner
      .post(
        '/bookings',
        manual({
          customer: { ...manual().customer, phone, fullName: 'Ama Lawson' },
          selection: { type: 'SLOTS', slotStarts: [at('2026-11-21', '14:00')] },
        }),
      )
      .expect(201);
    const found = await owner
      .get(`/customers/lookup?phone=${encodeURIComponent(phone)}`)
      .expect(200);
    expect(found.body.customer).toMatchObject({ fullName: 'Ama Lawson', phone });
    const none = await owner
      .get(`/customers/lookup?phone=${encodeURIComponent(newPhone())}`)
      .expect(200);
    expect(none.body.customer).toBeNull();
  });

  it('lists the day options without lead time', async () => {
    clock.set('2026-11-09T12:45:00.000Z');
    const res = (
      await owner.get(`/spaces/${SPACE}/day-options?date=2026-11-09&mode=IN_PERSON`).expect(200)
    ).body as AdminDayOptionsResponse;
    const available = res.slots.filter((s) => s.available).map((s) => s.startTime);
    expect(available[0]).toBe('12:30'); // in progress, still bookable
    expect(res.packages.find((p) => p.code === 'SLOT')!.totalXof).toBe(15000);
  });
});

describe('payments, cancellations and refunds', () => {
  it('records the payment of an unpaid studio booking, once', async () => {
    const b = (
      await staff
        .post(
          '/bookings',
          manual({
            selection: { type: 'SLOTS', slotStarts: [at('2026-11-23', '08:00')] },
            payment: { status: 'UNPAID' },
          }),
        )
        .expect(201)
    ).body as AdminBookingDetail;
    expect(b.paymentState).toBe('UNPAID');
    expect(b.can.recordPayment).toBe(true);

    const unpaid = (await owner.get('/bookings?tab=UNPAID').expect(200))
      .body as AdminBookingListResponse;
    expect(unpaid.items.map((i) => i.id)).toContain(b.id);
    const stats = (await owner.get(`/spaces/${SPACE}/stats`).expect(200))
      .body as AdminDashboardStats;
    expect(stats.unpaidCount).toBeGreaterThanOrEqual(1);

    const paid = (
      await staff
        .post(`/bookings/${b.id}/payments`, {
          method: 'MOBILE_MONEY',
          channel: 'FLOOZ',
          note: 'Reçu au comptoir',
        })
        .expect(200)
    ).body as AdminBookingDetail;
    expect(paid.paymentState).toBe('PAID');
    expect(paid.payments[0]).toMatchObject({
      provider: 'manual',
      amountXof: 15000,
      status: 'SUCCEEDED',
    });
    expect(
      (await staff.post(`/bookings/${b.id}/payments`, { method: 'CASH' }).expect(409)).body.code,
    ).toBe('ALREADY_PAID');
    // Nothing to collect for a free booking.
    const free = (
      await staff
        .post(
          '/bookings',
          manual({
            selection: { type: 'SLOTS', slotStarts: [at('2026-11-23', '15:30')] },
            totalXof: 0,
            payment: { status: 'UNPAID' },
          }),
        )
        .expect(201)
    ).body as AdminBookingDetail;
    expect(
      (await staff.post(`/bookings/${free.id}/payments`, { method: 'CASH' }).expect(409)).body.code,
    ).toBe('PAYMENT_NOT_EXPECTED');
  });

  it('cancelling a paid booking frees the slot and puts the refund on the to-do list', async () => {
    const hold = (await onlineHold([at('2026-11-23', '09:30')]).expect(201))
      .body as CreateBookingResponse;
    await devPay(hold.booking.reference).expect(200);
    const list = (await owner.get(`/bookings?q=${hold.booking.reference}`).expect(200))
      .body as AdminBookingListResponse;
    const id = list.items[0]!.id;

    // The team can't cancel.
    expect(
      (await staff.post(`/bookings/${id}/cancel`, { reason: 'Test' }).expect(403)).body.code,
    ).toBe('FORBIDDEN_ROLE');
    expect(
      (
        await owner
          .post(`/bookings/${id}/cancel`, { reason: 'Panne', refundAmountXof: 20000 })
          .expect(400)
      ).body.code,
    ).toBe('REFUND_ABOVE_PAID');

    const cancelled = (
      await owner
        .post(`/bookings/${id}/cancel`, { reason: 'Panne de courant au studio' })
        .expect(200)
    ).body as AdminBookingDetail;
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Panne de courant au studio',
      refund: { status: 'DUE', amountXof: 15000 },
      can: { cancel: false, markRefunded: true },
    });
    expect(statusAt(await customerDay('2026-11-23'), '09:30')).toBe('AVAILABLE');
    const due = (await owner.get('/bookings?tab=REFUND_DUE').expect(200))
      .body as AdminBookingListResponse;
    expect(due.items.map((i) => i.id)).toContain(id);
    const emails = await db
      .selectFrom('t_notifications')
      .select('template')
      .where('booking_id', '=', id)
      .where('template', '=', 'customer_booking_cancelled')
      .execute();
    expect(emails).toHaveLength(1);

    await staff.post(`/bookings/${id}/refund`, {}).expect(403);
    const refunded = (
      await owner.post(`/bookings/${id}/refund`, { note: 'Renvoyé par T-Money' }).expect(200)
    ).body as AdminBookingDetail;
    expect(refunded).toMatchObject({
      status: 'REFUNDED',
      refund: { status: 'DONE', note: 'Renvoyé par T-Money' },
    });
    expect(refunded.history.map((h) => h.action)).toEqual([
      'BOOKING_HOLD_CREATED',
      'BOOKING_CONFIRMED',
      'ADMIN_BOOKING_CANCELLED',
      'ADMIN_REFUND_DONE',
    ]);
    await owner.post(`/bookings/${id}/refund`, {}).expect(409);
    await owner.post(`/bookings/${id}/cancel`, { reason: 'Encore' }).expect(409);
  });

  it('cancelling without money received, or choosing no refund, leaves nothing to refund', async () => {
    const unpaid = (
      await owner
        .post(
          '/bookings',
          manual({
            selection: { type: 'SLOTS', slotStarts: [at('2026-11-23', '11:00')] },
            payment: { status: 'UNPAID' },
          }),
        )
        .expect(201)
    ).body as AdminBookingDetail;
    const a = (
      await owner.post(`/bookings/${unpaid.id}/cancel`, { reason: 'Client absent' }).expect(200)
    ).body as AdminBookingDetail;
    expect(a.refund.status).toBe('NONE');

    const paid = (
      await owner
        .post(
          '/bookings',
          manual({ selection: { type: 'SLOTS', slotStarts: [at('2026-11-23', '12:30')] } }),
        )
        .expect(201)
    ).body as AdminBookingDetail;
    const b = (
      await owner
        .post(`/bookings/${paid.id}/cancel`, { reason: 'Annulation tardive', refundAmountXof: 0 })
        .expect(200)
    ).body as AdminBookingDetail;
    expect(b.refund.status).toBe('NONE');
  });

  it('can stop an online payment in progress', async () => {
    const hold = (await onlineHold([at('2026-11-23', '14:00')]).expect(201))
      .body as CreateBookingResponse;
    const list = (await owner.get('/bookings?tab=PENDING').expect(200))
      .body as AdminBookingListResponse;
    const item = list.items.find((i) => i.reference === hold.booking.reference)!;
    expect(item.paymentState).toBe('PENDING');
    await owner.post(`/bookings/${item.id}/cancel`, { reason: 'Doublon' }).expect(200);
    // The payment arriving afterwards is not confirmed.
    await devPay(hold.booking.reference);
    const row = await db
      .selectFrom('t_bookings')
      .select('status')
      .where('id', '=', item.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('CANCELLED');
  });
});

describe('bookings list', () => {
  it('searches by phone, name or reference and hides abandoned checkouts from "Toutes"', async () => {
    const phone = '+22890557788';
    const b = (
      await owner
        .post(
          '/bookings',
          manual({
            customer: { ...manual().customer, phone, fullName: 'Yawa Dossou' },
            selection: { type: 'SLOTS', slotStarts: [at('2026-11-24', '08:00')] },
          }),
        )
        .expect(201)
    ).body as AdminBookingDetail;
    for (const q of ['90 55 77', 'Dossou', b.reference]) {
      const res = (await owner.get(`/bookings?q=${encodeURIComponent(q)}`).expect(200))
        .body as AdminBookingListResponse;
      expect(res.items.map((i) => i.id)).toContain(b.id);
    }

    const abandoned = (await onlineHold([at('2026-11-24', '09:30')]).expect(201))
      .body as CreateBookingResponse;
    clock.advanceMinutes(6);
    const all = (await owner.get('/bookings?tab=ALL&pageSize=100').expect(200))
      .body as AdminBookingListResponse;
    expect(all.items.map((i) => i.reference)).not.toContain(abandoned.booking.reference);
    const dropped = (await owner.get('/bookings?tab=ABANDONED&pageSize=100').expect(200))
      .body as AdminBookingListResponse;
    expect(dropped.items.map((i) => i.reference)).toContain(abandoned.booking.reference);
  });

  it('filters by date and pages', async () => {
    const res = (await owner.get('/bookings?from=2026-11-24&to=2026-11-24&pageSize=1').expect(200))
      .body as AdminBookingListResponse;
    expect(res.pageSize).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.date).toBe('2026-11-24');
    await owner.get('/bookings?from=24-11-2026').expect(400);
  });
});

describe('planning and blocks', () => {
  it('shows booked, waiting, blocked and free slots', async () => {
    await owner
      .post(
        '/bookings',
        manual({ selection: { type: 'SLOTS', slotStarts: [at('2026-11-25', '08:00')] } }),
      )
      .expect(201);
    await onlineHold([at('2026-11-25', '09:30')]).expect(201);
    await staff
      .post(`/spaces/${SPACE}/blocks`, {
        slotStarts: [at('2026-11-25', '11:00'), at('2026-11-25', '12:30')],
        reason: 'Maintenance',
      })
      .expect(201);
    const sched = (await owner.get(`/spaces/${SPACE}/schedule?from=2026-11-25&days=1`).expect(200))
      .body as ScheduleResponse;
    const states = sched.days[0]!.slots.map((s) => `${s.startTime}:${s.state}`);
    expect(states.slice(0, 5)).toEqual([
      '08:00:BOOKED',
      '09:30:PENDING',
      '11:00:BLOCKED',
      '12:30:BLOCKED',
      '14:00:FREE',
    ]);
    expect(sched.days[0]!.slots[0]!.booking).toMatchObject({ customerName: 'Komi Adjo' });
    expect(sched.days[0]!.slots[2]!.block).toMatchObject({ reason: 'Maintenance' });
  });

  it('a blocked slot can’t be booked; unblocking frees it', async () => {
    const block = (
      await staff
        .post(`/spaces/${SPACE}/blocks`, {
          slotStarts: [at('2026-11-26', '08:00')],
          reason: 'Tournage privé',
        })
        .expect(201)
    ).body as { id: number };
    expect(statusAt(await customerDay('2026-11-26'), '08:00')).toBe('BOOKED');
    await onlineHold([at('2026-11-26', '08:00')]).expect(409);
    await owner
      .post(
        '/bookings',
        manual({ selection: { type: 'SLOTS', slotStarts: [at('2026-11-26', '08:00')] } }),
      )
      .expect(409);

    await staff.del(`/blocks/${block.id}`).expect(204);
    expect(statusAt(await customerDay('2026-11-26'), '08:00')).toBe('AVAILABLE');
    await staff.del(`/blocks/${block.id}`).expect(404);
  });

  it('refuses to block a booked, past or non-existent slot', async () => {
    await owner
      .post(
        '/bookings',
        manual({ selection: { type: 'SLOTS', slotStarts: [at('2026-11-26', '09:30')] } }),
      )
      .expect(201);
    expect(
      (
        await staff
          .post(`/spaces/${SPACE}/blocks`, { slotStarts: [at('2026-11-26', '09:30')], reason: 'X' })
          .expect(409)
      ).body.code,
    ).toBe('SLOT_NOT_FREE');
    expect(
      (
        await staff
          .post(`/spaces/${SPACE}/blocks`, { slotStarts: [at('2026-11-26', '09:45')], reason: 'X' })
          .expect(400)
      ).body.code,
    ).toBe('SLOT_NOT_FOUND');
    expect(
      (
        await staff
          .post(`/spaces/${SPACE}/blocks`, { slotStarts: [at('2026-11-08', '08:00')], reason: 'X' })
          .expect(400)
      ).body.code,
    ).toBe('SLOT_IN_PAST');
  });

  it('computes the dashboard figures', async () => {
    // Today (Monday 9 Nov): one confirmed booking at 17:00, paid 15 000 this month.
    await owner
      .post(
        '/bookings',
        manual({ selection: { type: 'SLOTS', slotStarts: [at('2026-11-09', '17:00')] } }),
      )
      .expect(201);
    const stats = (await owner.get(`/spaces/${SPACE}/stats`).expect(200))
      .body as AdminDashboardStats;
    expect(stats.todayBookings).toBeGreaterThanOrEqual(1);
    expect(stats.weekOccupancyPercent).toBeGreaterThan(0);
    expect(stats.weekOccupancyPercent).toBeLessThanOrEqual(100);
    expect(stats.collectedThisMonthXof).toBeGreaterThanOrEqual(15000);
  });
});

describe('opening hours and closures', () => {
  const week = (
    overrides: Partial<Record<number, { isOpen: boolean; opensAt: string; closesAt: string }>> = {},
  ) => ({
    days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      isOpen: true,
      opensAt: '08:00',
      closesAt: '21:30',
      ...overrides[weekday],
    })),
  });

  it('refuses hours that would exclude an upcoming booking, and lists it', async () => {
    // Sunday 29 Nov, 20:00 booked.
    const b = (
      await owner
        .post(
          '/bookings',
          manual({ selection: { type: 'SLOTS', slotStarts: [at('2026-11-29', '20:00')] } }),
        )
        .expect(201)
    ).body as AdminBookingDetail;
    const res = await owner
      .put(
        `/spaces/${SPACE}/opening-hours`,
        week({ 7: { isOpen: true, opensAt: '08:00', closesAt: '18:30' } }),
      )
      .expect(409);
    expect(res.body.code).toBe('OPENING_HOURS_CONFLICT');
    expect(res.body.details.bookings.map((x: { reference: string }) => x.reference)).toContain(
      b.reference,
    );
    await staff.put(`/spaces/${SPACE}/opening-hours`, week()).expect(403);
  });

  it('applies valid hours: new slot grid for customers and admins', async () => {
    // Wednesdays close earlier: no Wednesday booking ends after 18:30.
    const hours = (
      await owner
        .put(
          `/spaces/${SPACE}/opening-hours`,
          week({ 3: { isOpen: true, opensAt: '08:00', closesAt: '18:30' } }),
        )
        .expect(200)
    ).body as OpeningHoursDayDto[];
    expect(hours.find((d) => d.weekday === 3)).toMatchObject({
      opensAt: '08:00',
      closesAt: '18:30',
      slotCount: 7,
    });
    // Wednesday 9 Dec.
    const day = await customerDay('2026-12-09');
    expect(day.slots.map((s) => s.startTime).at(-1)).toBe('17:00');
    await owner.put(`/spaces/${SPACE}/opening-hours`, week()).expect(200);

    expect(
      (
        await owner
          .put(
            `/spaces/${SPACE}/opening-hours`,
            week({ 2: { isOpen: true, opensAt: '08:00', closesAt: '09:00' } }),
          )
          .expect(400)
      ).body.code,
    ).toBe('OPENING_TOO_SHORT');
  });

  it('closes days for customers, unless bookings are in the way', async () => {
    await owner
      .post(
        '/bookings',
        manual({ selection: { type: 'SLOTS', slotStarts: [at('2026-12-01', '14:00')] } }),
      )
      .expect(201);
    const blocked = await owner
      .post(`/spaces/${SPACE}/closures`, {
        startDate: '2026-12-01',
        endDate: '2026-12-02',
        reason: 'Inventaire',
      })
      .expect(409);
    expect(blocked.body.code).toBe('CLOSURE_CONFLICT');

    const closure = (
      await owner
        .post(`/spaces/${SPACE}/closures`, {
          startDate: '2026-12-03',
          endDate: '2026-12-04',
          reason: 'Inventaire',
        })
        .expect(201)
    ).body as ClosureDto;
    expect(closure).toMatchObject({ startDate: '2026-12-03', endDate: '2026-12-04', allDay: true });
    expect((await customerDay('2026-12-03')).status).toBe('CLOSED');
    expect((await customerDay('2026-12-04')).status).toBe('CLOSED');
    expect((await customerDay('2026-12-05')).status).not.toBe('CLOSED');

    // Part of a day.
    const evening = (
      await owner
        .post(`/spaces/${SPACE}/closures`, {
          startDate: '2026-12-07',
          endDate: '2026-12-07',
          startTime: '17:00',
          endTime: '21:30',
        })
        .expect(201)
    ).body as ClosureDto;
    expect(evening.allDay).toBe(false);
    const d = await customerDay('2026-12-07');
    expect(statusAt(d, '15:30')).toBe('AVAILABLE');
    expect(statusAt(d, '17:00')).toBe('CLOSED');

    const listed = (await owner.get(`/spaces/${SPACE}/closures`).expect(200)).body as ClosureDto[];
    expect(listed.map((c) => c.id)).toEqual(expect.arrayContaining([closure.id, evening.id]));
    await owner.del(`/closures/${closure.id}`).expect(204);
    expect((await customerDay('2026-12-03')).status).not.toBe('CLOSED');
  });
});

describe('space settings', () => {
  it('updates the payment hold within 2–15 minutes', async () => {
    const res = await owner.patch(`/spaces/${SPACE}`, { holdDurationMin: 3 }).expect(200);
    expect(res.body.holdDurationMin).toBe(3);
    const hold = (await onlineHold([at('2026-11-30', '08:00')]).expect(201))
      .body as CreateBookingResponse;
    expect(hold.booking.holdSecondsLeft).toBe(180);
    await owner.patch(`/spaces/${SPACE}`, { holdDurationMin: 16 }).expect(400);
    await owner.patch(`/spaces/${SPACE}`, { holdDurationMin: 5 }).expect(200);
    await owner.patch(`/spaces/${SPACE}`, { slotDurationMin: 60 }).expect(400);
  });

  it('keeps at least one mode', async () => {
    await owner
      .patch(`/spaces/${SPACE}`, { inPersonEnabled: false, virtualEnabled: false })
      .expect(400);
  });

  it('creates a new space with default hours and no packages yet', async () => {
    const created = await owner
      .post('/spaces', { name: 'Studio B — Lomé', inPersonEnabled: true, virtualEnabled: false })
      .expect(201);
    expect(created.body).toMatchObject({
      slug: 'studio-b-lome',
      holdDurationMin: 5,
      virtualEnabled: false,
    });
    const hours = (await owner.get(`/spaces/${created.body.id}/opening-hours`).expect(200))
      .body as OpeningHoursDayDto[];
    expect(hours.every((h) => h.isOpen && h.slotCount === 9)).toBe(true);
    const again = await owner.post('/spaces', {
      name: 'Studio B — Lomé',
      inPersonEnabled: true,
      virtualEnabled: true,
    });
    expect(again.body.slug).toBe('studio-b-lome-2');
  });

  it('manages the owner notification emails', async () => {
    const list = await owner
      .post(`/spaces/${SPACE}/recipients`, { email: 'Gerant@Bovann.test', name: 'Gérant' })
      .expect(201);
    const added = list.body.find((r: { email: string }) => r.email === 'gerant@bovann.test');
    expect(added).toBeTruthy();
    await owner.post(`/spaces/${SPACE}/recipients`, { email: 'gerant@bovann.test' }).expect(409);
    const toggled = await owner.patch(`/recipients/${added.id}`, { isActive: false }).expect(200);
    expect(toggled.body.find((r: { id: number }) => r.id === added.id).isActive).toBe(false);
    await owner.del(`/recipients/${added.id}`).expect(200);
    await staff.get(`/spaces/${SPACE}/recipients`).expect(403);
  });
});

describe('packages and prices', () => {
  async function packages(): Promise<AdminPackagesResponse> {
    return (await owner.get(`/spaces/${SPACE}/packages`).expect(200)).body as AdminPackagesResponse;
  }
  const byCode = (r: AdminPackagesResponse, code: string) =>
    r.packages.find((p) => p.code === code)!;

  it('lists packages with current prices per mode', async () => {
    const r = await packages();
    expect(r.fullDaySlotCount).toBe(9);
    expect(byCode(r, 'PACK_6H')).toMatchObject({
      slotCount: 4,
      prices: { IN_PERSON: 51000, VIRTUAL: 51000 },
    });
  });

  it('refuses prices that break the ladder (longer must be cheaper per slot)', async () => {
    const pack6 = byCode(await packages(), 'PACK_6H');
    const res = await owner
      .patch(`/packages/${pack6.id}`, { prices: { IN_PERSON: 60000 } })
      .expect(400);
    expect(res.body.code).toBe('PRICE_RULE_VIOLATION');
    expect(res.body.message).toMatch(/^En studio : /);

    const single = byCode(await packages(), 'SLOT');
    // Removing the single-slot reference price breaks every other package.
    await owner.patch(`/packages/${single.id}`, { isActive: false }).expect(400);
  });

  it('versions a price change: new bookings use it, history is kept', async () => {
    const pack3 = byCode(await packages(), 'PACK_3H');
    await owner.patch(`/packages/${pack3.id}`, { prices: { IN_PERSON: 26000 } }).expect(200);
    const offered = (
      await request(app.getHttpServer())
        .get('/api/v1/spaces/studio-principal-lome/packages?mode=IN_PERSON')
        .expect(200)
    ).body as PackagesResponse;
    expect(offered.packages.find((p) => p.code === 'PACK_3H')!.price.totalXof).toBe(26000);
    const history = await db
      .selectFrom('t_package_prices')
      .select(['price_xof', 'valid_to'])
      .where('package_id', '=', pack3.id)
      .where('mode', '=', 'IN_PERSON')
      .orderBy('id')
      .execute();
    expect(history.map((h) => [h.price_xof, h.valid_to === null])).toEqual([
      [27000, false],
      [26000, true],
    ]);
  });

  it('creates a package, offers it in one mode only, and can withdraw it', async () => {
    const created = await owner
      .post(`/spaces/${SPACE}/packages`, {
        name: 'Pack 4h30',
        slotCount: 3,
        prices: { IN_PERSON: 38500 },
      })
      .expect(201);
    const pack = byCode(created.body as AdminPackagesResponse, 'PACK_4H30');
    expect(pack.prices).toEqual({ IN_PERSON: 38500 });

    const virtual = (
      await request(app.getHttpServer())
        .get('/api/v1/spaces/studio-principal-lome/packages?mode=VIRTUAL')
        .expect(200)
    ).body as PackagesResponse;
    expect(virtual.packages.map((p) => p.code)).not.toContain('PACK_4H30');

    await owner.patch(`/packages/${pack.id}`, { isActive: false }).expect(200);
    const inPerson = (
      await request(app.getHttpServer())
        .get('/api/v1/spaces/studio-principal-lome/packages?mode=IN_PERSON')
        .expect(200)
    ).body as PackagesResponse;
    expect(inPerson.packages.map((p) => p.code)).not.toContain('PACK_4H30');

    // 3 slots at 44 000 costs more per slot than Pack 3h: refused.
    await owner
      .post(`/spaces/${SPACE}/packages`, {
        name: 'Pack cher',
        slotCount: 3,
        prices: { IN_PERSON: 44000 },
      })
      .expect(400);
    // Only one full-day package.
    await owner
      .post(`/spaces/${SPACE}/packages`, {
        name: 'Journée 2',
        isFullDay: true,
        prices: { IN_PERSON: 100000 },
      })
      .expect(409);
  });
});

describe('customers and payments pages', () => {
  it('lists customers with their totals, and one customer with their bookings', async () => {
    const phone = newPhone();
    await owner
      .post(
        '/bookings',
        manual({
          customer: {
            ...manual().customer,
            phone,
            fullName: 'Edem Kpodar',
            businessName: 'Kpodar Tech',
          },
          selection: { type: 'SLOTS', slotStarts: [at('2026-12-08', '08:00')] },
        }),
      )
      .expect(201);
    const list = await owner.get('/customers?q=Kpodar').expect(200);
    expect(list.body.items[0]).toMatchObject({
      fullName: 'Edem Kpodar',
      bookingsCount: 1,
      totalPaidXof: 15000,
    });
    const detail = await owner.get(`/customers/${list.body.items[0].id}`).expect(200);
    expect(detail.body.bookings).toHaveLength(1);
    await owner.get('/customers/999999').expect(404);
  });

  it('lists payments, filterable by status', async () => {
    const res = await staff.get('/payments?status=SUCCEEDED&pageSize=5').expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((p: { status: string }) => p.status === 'SUCCEEDED')).toBe(true);
    expect(res.body.items[0].booking.reference).toMatch(/^BOV-/);
  });
});
