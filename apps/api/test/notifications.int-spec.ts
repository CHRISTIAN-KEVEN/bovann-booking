import type { INestApplication } from '@nestjs/common';
import type { AdminBookingDetail, CreateBookingResponse } from '@bovann/shared';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { Database } from '../src/database/schema';
import { NotificationService, MAX_ATTEMPTS } from '../src/notification/notification.service';
import {
  adminApp,
  createAdminUser,
  FakeMailer,
  signedIn,
  type AdminClient,
} from './helpers/admin-app';
import { holdRequest, newPhone, TestClock } from './helpers/booking-app';
import { freshDatabase } from './helpers/test-db';

/** Phase 6: the outbox worker delivers queued emails, retries, and reports in the admin. */
const START = '2026-11-09T08:00:00.000Z';
const clock = new TestClock(new Date(START));
const mailer = new FakeMailer();
let app: INestApplication;
let db: Kysely<Database>;
let owner: AdminClient;
let staff: AdminClient;
let service: NotificationService;

const at = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`;

async function paidOnlineBooking(slot: string, email: string | null = 'client@example.test') {
  const hold = (
    await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .send(
        holdRequest({
          selection: { type: 'SLOTS', slotStarts: [slot] },
          customer: {
            fullName: 'Afi Mensah',
            phone: newPhone(),
            email,
            businessName: 'Boutique Afi Mode',
            businessSector: 'Mode & beauté',
          },
        }),
      )
      .expect(201)
  ).body as CreateBookingResponse;
  await request(app.getHttpServer())
    .post(`/api/v1/dev/payments/${hold.booking.reference}/succeed`)
    .send({})
    .expect(200);
  const row = await db
    .selectFrom('t_bookings')
    .select('id')
    .where('reference', '=', hold.booking.reference)
    .executeTakeFirstOrThrow();
  return { id: row.id, reference: hold.booking.reference };
}

async function notificationsOf(bookingId: number) {
  return db
    .selectFrom('t_notifications')
    .selectAll()
    .where('booking_id', '=', bookingId)
    .orderBy('id')
    .execute();
}

beforeAll(async () => {
  db = await freshDatabase();
  await db
    .updateTable('t_package_prices')
    .set({ valid_from: new Date('2026-01-01T00:00:00Z') })
    .execute();
  await db.deleteFrom('t_space_owner_recipients').execute();
  await db
    .insertInto('t_space_owner_recipients')
    .values([
      { space_id: 1, email: 'gerant@bovann.test', name: 'Gérant' },
      { space_id: 1, email: 'associe@bovann.test', name: 'Associé' },
    ])
    .execute();
  app = await adminApp(clock, {}, { mailer });
  service = app.get(NotificationService);
  owner = await signedIn(app, await createAdminUser(db));
  staff = await signedIn(app, await createAdminUser(db, { role: 'STAFF' }));
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

beforeEach(async () => {
  clock.set(START);
  mailer.sent = [];
  mailer.failWith = null;
  // Each test starts with an empty queue.
  await service.processDue();
  mailer.sent = [];
});

describe('sending queued emails', () => {
  it('sends the owners and the customer their emails once a booking is paid', async () => {
    const b = await paidOnlineBooking(at('2026-11-20', '08:00'));
    expect((await service.processDue()).sent).toBe(3);

    const byRecipient = Object.fromEntries(mailer.sent.map((m) => [m.to, m]));
    expect(Object.keys(byRecipient).sort()).toEqual([
      'associe@bovann.test',
      'client@example.test',
      'gerant@bovann.test',
    ]);
    expect(byRecipient['gerant@bovann.test']!.subject).toContain(
      `Nouvelle réservation ${b.reference}`,
    );
    expect(byRecipient['gerant@bovann.test']!.html).toContain('Boutique Afi Mode');
    expect(byRecipient['client@example.test']!.subject).toBe(
      `Réservation confirmée · ${b.reference}`,
    );

    const rows = await notificationsOf(b.id);
    expect(rows.every((r) => r.status === 'SENT' && r.sent_at && r.attempts === 1)).toBe(true);
    // Nothing is sent twice.
    expect((await service.processDue()).sent).toBe(0);
  });

  it('sends no customer email when no address was given', async () => {
    const b = await paidOnlineBooking(at('2026-11-20', '09:30'), null);
    await service.processDue();
    expect(mailer.sent.map((m) => m.to).sort()).toEqual([
      'associe@bovann.test',
      'gerant@bovann.test',
    ]);
    expect((await notificationsOf(b.id)).map((r) => r.template)).toEqual([
      'owner_booking_confirmed',
      'owner_booking_confirmed',
    ]);
  });

  it('retries a temporary failure later, with growing delays, then gives up', async () => {
    const b = await paidOnlineBooking(at('2026-11-20', '11:00'), null);
    mailer.failWith = { code: 'ECONNECTION', message: 'Connection refused' };
    await service.processDue();
    let [row] = await notificationsOf(b.id);
    expect(row).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      last_error: 'ECONNECTION Connection refused',
    });
    expect(row!.next_attempt_at.toISOString()).toBe('2026-11-09T08:01:00.000Z');

    // Not retried before its time.
    expect((await service.processDue()).failed).toBe(0);
    for (let i = 2; i <= MAX_ATTEMPTS; i++) {
      clock.advanceMinutes(300);
      await service.processDue();
    }
    [row] = await notificationsOf(b.id);
    expect(row).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS });

    // Fixed configuration: "Renvoyer" from the admin sends it.
    // (A day and a half went by: sign in again.)
    mailer.failWith = null;
    const later = await signedIn(app, await createAdminUser(db, { role: 'STAFF' }));
    await later.post(`/notifications/${row!.id}/retry`).expect(204);
    await service.processDue();
    expect((await notificationsOf(b.id))[0]).toMatchObject({ status: 'SENT' });
    await later.post(`/notifications/${row!.id}/retry`).expect(409);
  });

  it('gives up at once when the address is refused for good', async () => {
    const b = await paidOnlineBooking(at('2026-11-20', '12:30'), 'nobody@example.test');
    mailer.failWith = { responseCode: 550, response: '550 5.1.1 The email account does not exist' };
    await service.processDue();
    const rows = await notificationsOf(b.id);
    expect(rows.every((r) => r.status === 'FAILED' && r.attempts === 1)).toBe(true);
  });

  it('keeps retrying when the daily quota is reached', async () => {
    const b = await paidOnlineBooking(at('2026-11-20', '14:00'), null);
    mailer.failWith = {
      responseCode: 550,
      response: '550 5.4.5 Daily user sending quota exceeded',
    };
    await service.processDue();
    expect((await notificationsOf(b.id)).every((r) => r.status === 'PENDING')).toBe(true);
  });

  it('picks up an email left half-sent by a crash', async () => {
    const b = await paidOnlineBooking(at('2026-11-20', '15:30'), null);
    await db
      .updateTable('t_notifications')
      .set({ status: 'SENDING', next_attempt_at: clock.now() })
      .where('booking_id', '=', b.id)
      .execute();
    await service.processDue();
    expect((await notificationsOf(b.id)).every((r) => r.status === 'SENDING')).toBe(true);
    clock.advanceMinutes(11);
    await service.processDue();
    expect((await notificationsOf(b.id)).every((r) => r.status === 'SENT')).toBe(true);
  });
});

describe('emails for studio actions', () => {
  it('tells the customer when the studio cancels, with the refund to come', async () => {
    const b = await paidOnlineBooking(at('2026-11-21', '08:00'));
    await service.processDue();
    mailer.sent = [];
    await owner.post(`/bookings/${b.id}/cancel`, { reason: 'Panne au studio' }).expect(200);
    await service.processDue();
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe('client@example.test');
    expect(mailer.sent[0]!.subject).toBe(`Réservation annulée · ${b.reference}`);
    expect(mailer.sent[0]!.text).toMatch(/remboursé de 15\s000\sFCFA/);
    // The internal reason stays internal.
    expect(mailer.sent[0]!.text).not.toContain('Panne');
  });

  it('notifies the owners of a studio booking too', async () => {
    const res = await staff
      .post('/bookings', {
        spaceId: 1,
        mode: 'VIRTUAL',
        selection: { type: 'SLOTS', slotStarts: [at('2026-11-21', '09:30')] },
        customer: {
          fullName: 'Komi Adjo',
          phone: newPhone(),
          businessName: 'Adjo Cosmétiques',
          businessSector: 'Beauté',
        },
        payment: { status: 'PAID', method: 'CASH' },
      })
      .expect(201);
    await service.processDue();
    const ownerEmail = mailer.sent.find((m) => m.to === 'gerant@bovann.test')!;
    expect(ownerEmail.text).toContain('Réservation ajoutée par le studio.');
    expect(ownerEmail.text).toContain('assistant qui modère le live');

    const detail = (await staff.get(`/bookings/${res.body.id}`).expect(200))
      .body as AdminBookingDetail;
    expect(detail.notifications.map((n) => [n.label, n.status])).toEqual([
      ['Nouvelle réservation (gérants)', 'SENT'],
      ['Nouvelle réservation (gérants)', 'SENT'],
    ]);
  });

  it('asks the owners to refund a payment that came too late', async () => {
    const slot = at('2026-11-21', '11:00');
    const late = (
      await request(app.getHttpServer())
        .post('/api/v1/bookings')
        .send(holdRequest({ selection: { type: 'SLOTS', slotStarts: [slot] } }))
        .expect(201)
    ).body as CreateBookingResponse;
    clock.advanceMinutes(6);
    await paidOnlineBooking(slot, null); // someone else takes the slot
    await request(app.getHttpServer())
      .post(`/api/v1/dev/payments/${late.booking.reference}/succeed`)
      .send({})
      .expect(200);
    await service.processDue();
    const refund = mailer.sent.find((m) => m.subject.startsWith('À rembourser'))!;
    expect(refund.subject).toContain(late.booking.reference);
    expect(refund.subject).toMatch(/15\s000\sFCFA/);
  });
});

describe('admin settings and test email', () => {
  it('reports the sending settings and the queue', async () => {
    const res = await staff.get('/notifications/settings').expect(200);
    expect(res.body).toMatchObject({ enabled: true, from: 'Bovann OCD Live <test@example.test>' });
    expect(typeof res.body.pending).toBe('number');
  });

  it('sends a test email to the administrator, and reports a provider refusal', async () => {
    await staff.post('/notifications/test', {}).expect(403);
    const me = (await owner.get('/auth/me').expect(200)).body as { email: string };
    const ok = await owner.post('/notifications/test', {}).expect(200);
    expect(ok.body.to).toBe(me.email);
    expect(mailer.sent.at(-1)!.subject).toBe('Test d’envoi · Bovann OCD Live');

    mailer.failWith = {
      code: 'EAUTH',
      responseCode: 535,
      response: '535-5.7.8 Username and Password not accepted',
    };
    const failed = await owner
      .post('/notifications/test', { to: 'autre@example.test' })
      .expect(502);
    expect(failed.body.code).toBe('EMAIL_SEND_FAILED');
    expect(failed.body.message).toContain('535-5.7.8 Username and Password not accepted');
  });

  it('says so when sending is not configured', async () => {
    const disabled = await adminApp(clock);
    try {
      const client = await signedIn(disabled, await createAdminUser(db));
      expect((await client.get('/notifications/settings').expect(200)).body.enabled).toBe(false);
      expect((await client.post('/notifications/test', {}).expect(409)).body.code).toBe(
        'EMAIL_DISABLED',
      );
    } finally {
      await disabled.close();
    }
  });
});
