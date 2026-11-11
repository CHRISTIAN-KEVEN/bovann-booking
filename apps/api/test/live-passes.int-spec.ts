import type { INestApplication } from '@nestjs/common';
import type {
  AdminLiveListResponse,
  AdminSellerDto,
  LiveWallResponse,
  SellerLiveDto,
  SellerLivesResponse,
  SellerPaymentDto,
} from '@bovann/shared';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { Database } from '../src/database/schema';
import { adminApp, createAdminUser, signedIn, type AdminClient } from './helpers/admin-app';
import { TestClock } from './helpers/booking-app';
import { freshDatabase } from './helpers/test-db';

/**
 * Passes and payment (2026-11-11). A seller with a pass goes online at approval; without one,
 * the approved live waits 30 minutes for payment (a live alone, or a pass). Payments use the
 * simulated provider; the outcome is decided with /dev/seller-payments/:id/succeed|fail,
 * like bookings. Wednesday 11 November 2026, 09:00 (Lomé = UTC) is within review hours.
 */
const OPEN = '2026-11-11T09:00:00.000Z';
const clock = new TestClock(new Date(OPEN));
let app: INestApplication;
let db: Kysely<Database>;
let owner: AdminClient;
let staff: AdminClient;

interface SellerClient {
  id: number;
  phone: string;
  get(path: string): request.Test;
  post(path: string, body?: object): request.Test;
}

let phoneCounter = 0;
async function seller(): Promise<SellerClient> {
  const phone = `+2289${String(3_000_000 + ++phoneCounter).slice(-7)}`;
  const agent = request.agent(app.getHttpServer());
  const sent = await agent
    .post('/api/v1/seller/auth/code')
    .set('X-Bovann-Seller', '1')
    .send({ phone })
    .expect(200);
  const me = await agent
    .post('/api/v1/seller/auth/verify')
    .set('X-Bovann-Seller', '1')
    .send({ phone, code: sent.body.devCode })
    .expect(200);
  return {
    id: me.body.id,
    phone,
    get: (path) => agent.get(`/api/v1/seller${path}`),
    post: (path, body) =>
      agent
        .post(`/api/v1/seller${path}`)
        .set('X-Bovann-Seller', '1')
        .send(body ?? {}),
  };
}

let linkCounter = 0;
const live = () => ({
  sellerName: 'Afi Mode',
  url: `https://www.tiktok.com/@pass${++linkCounter}/live`,
  countryCode: 'TG',
  categoryCode: 'MODE',
  categoryOther: null,
  durationMin: 120,
});

const momo = (s: SellerClient) => ({
  method: 'MOBILE_MONEY',
  channel: 'TMONEY',
  payerPhone: s.phone,
});
const dev = (id: number, outcome: 'succeed' | 'fail') =>
  request(app.getHttpServer()).post(`/api/v1/dev/seller-payments/${id}/${outcome}`).send({});
const wall = async () =>
  (await request(app.getHttpServer()).get('/api/v1/lives').expect(200)).body as LiveWallResponse;
const mine = async (s: SellerClient) =>
  (await s.get('/lives').expect(200)).body as SellerLivesResponse;

/** Sends a live and has staff approve it. */
async function approved(s: SellerClient): Promise<SellerLiveDto> {
  const sent = (await s.post('/lives', live()).expect(201)).body as SellerLiveDto;
  await staff.post(`/lives/${sent.id}/approve`).expect(200);
  return (await mine(s)).lives.find((l) => l.id === sent.id)!;
}

beforeAll(async () => {
  db = await freshDatabase();
  app = await adminApp(clock, { OTP_RATE_LIMIT_PER_HOUR: '1000' });
  owner = await signedIn(app, await createAdminUser(db));
  staff = await signedIn(app, await createAdminUser(db, { role: 'STAFF' }));
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

beforeEach(async () => {
  clock.set(OPEN);
  await db.deleteFrom('t_seller_passes').execute();
  await db.deleteFrom('t_seller_payments').execute();
  await db.deleteFrom('t_lives').execute();
});

describe('a seller without a pass', () => {
  it('pays for the approved live, which then goes online', async () => {
    const afi = await seller();
    const waiting = await approved(afi);
    expect(waiting).toMatchObject({
      status: 'AWAITING_PAYMENT',
      paymentDueAt: '2026-11-11T09:30:00.000Z',
      startedAt: '',
    });
    expect((await wall()).lives).toEqual([]);
    const awaiting = (await staff.get('/lives?tab=awaiting').expect(200))
      .body as AdminLiveListResponse;
    expect(awaiting.lives.map((l) => l.id)).toEqual([waiting.id]);

    const before = await mine(afi);
    expect(before.pass).toBeNull();
    expect(before.prices).toEqual({ passMonthXof: 10_000, passYearXof: 100_000, liveXof: 1_500 });

    const payment = (
      await afi.post('/payments', { purpose: 'LIVE', liveId: waiting.id, ...momo(afi) }).expect(201)
    ).body as SellerPaymentDto;
    expect(payment).toMatchObject({
      purpose: 'LIVE',
      amountXof: 1_500,
      status: 'PENDING',
      instructions: expect.stringContaining('1500 FCFA'),
    });

    clock.advanceMinutes(2);
    expect((await dev(payment.id, 'succeed').expect(200)).body).toEqual({ outcome: 'SUCCEEDED' });
    expect((await dev(payment.id, 'succeed').expect(200)).body).toEqual({
      outcome: 'ALREADY_DONE',
    });
    expect((await afi.get(`/payments/${payment.id}`).expect(200)).body.status).toBe('SUCCEEDED');

    const after = (await mine(afi)).lives[0]!;
    expect(after).toMatchObject({
      status: 'APPROVED',
      startedAt: '2026-11-11T09:02:00.000Z',
      endsAt: '2026-11-11T11:02:00.000Z',
    });
    expect((await wall()).lives.map((l) => l.id)).toEqual([waiting.id]);
    expect((await mine(afi)).pass).toBeNull();
  });

  it('can try again after a failed payment; a new attempt replaces an unfinished one', async () => {
    const afi = await seller();
    const waiting = await approved(afi);
    const first = (
      await afi.post('/payments', { purpose: 'LIVE', liveId: waiting.id, ...momo(afi) }).expect(201)
    ).body as SellerPaymentDto;
    await dev(first.id, 'fail').expect(200);
    const failed = (await afi.get(`/payments/${first.id}`).expect(200)).body as SellerPaymentDto;
    expect(failed).toMatchObject({ status: 'FAILED', failureReason: 'DECLINED' });
    expect((await mine(afi)).lives[0]!.status).toBe('AWAITING_PAYMENT');

    const second = (
      await afi
        .post('/payments', { purpose: 'LIVE', liveId: waiting.id, method: 'CARD' })
        .expect(201)
    ).body as SellerPaymentDto;
    const third = (
      await afi.post('/payments', { purpose: 'LIVE', liveId: waiting.id, ...momo(afi) }).expect(201)
    ).body as SellerPaymentDto;
    expect((await afi.get(`/payments/${second.id}`).expect(200)).body.status).toBe('CANCELLED');
    await dev(third.id, 'succeed').expect(200);
    expect((await wall()).lives).toHaveLength(1);

    // The replaced attempt confirmed late by the provider: the live is already paid.
    expect((await dev(second.id, 'succeed').expect(409)).body.code).toBe('PAYMENT_DUPLICATE');
  });

  it('loses the approval after 30 minutes without payment', async () => {
    const afi = await seller();
    const waiting = await approved(afi);
    clock.advanceMinutes(30);
    expect((await mine(afi)).lives[0]!.status).toBe('EXPIRED');
    const late = await afi
      .post('/payments', { purpose: 'LIVE', liveId: waiting.id, ...momo(afi) })
      .expect(409);
    expect(late.body.code).toBe('LIVE_NOT_PAYABLE');
    const past = (await staff.get('/lives?tab=past').expect(200)).body as AdminLiveListResponse;
    expect(past.lives.find((l) => l.id === waiting.id)?.status).toBe('EXPIRED');
    expect(((await staff.get('/lives?tab=awaiting')).body as AdminLiveListResponse).lives).toEqual(
      [],
    );
    // Expired: the seller may send a live again (also the same link).
    await afi.post('/lives', { ...live(), url: waiting.url }).expect(201);
  });

  it('can take a pass instead: the live goes online and the next ones need no payment', async () => {
    const afi = await seller();
    const waiting = await approved(afi);
    const payment = (
      await afi
        .post('/payments', { purpose: 'PASS_MONTH', liveId: waiting.id, method: 'CARD' })
        .expect(201)
    ).body as SellerPaymentDto;
    expect(payment.amountXof).toBe(10_000);
    await dev(payment.id, 'succeed').expect(200);

    const after = await mine(afi);
    expect(after.pass).toEqual({
      plan: 'MONTH',
      startsAt: OPEN,
      endsAt: '2026-12-11T09:00:00.000Z',
    });
    expect(after.lives[0]!.status).toBe('APPROVED');

    clock.set('2026-11-11T15:30:00.000Z'); // afternoon review period
    const next = await approved(afi);
    expect(next.status).toBe('APPROVED');
  });

  it('keeps one live between sending and going online', async () => {
    const afi = await seller();
    await approved(afi);
    const again = await afi.post('/lives', live()).expect(409);
    expect(again.body.code).toBe('LIVE_PENDING_EXISTS');
  });
});

describe('passes', () => {
  it('are bought from the seller space, and a new one follows the current one', async () => {
    const afi = await seller();
    const month = (
      await afi.post('/payments', { purpose: 'PASS_MONTH', method: 'CARD' }).expect(201)
    ).body as SellerPaymentDto;
    await dev(month.id, 'succeed').expect(200);
    clock.advanceMinutes(60 * 24 * 10);
    const year = (await afi.post('/payments', { purpose: 'PASS_YEAR', ...momo(afi) }).expect(201))
      .body as SellerPaymentDto;
    expect(year.amountXof).toBe(100_000);
    await dev(year.id, 'succeed').expect(200);
    expect((await mine(afi)).pass).toEqual({
      plan: 'MONTH',
      startsAt: OPEN,
      endsAt: '2027-12-11T09:00:00.000Z',
    });
  });

  it('stop counting once they run out', async () => {
    clock.set('2026-11-11T15:00:00.000Z');
    const afi = await seller();
    await staff.post(`/sellers/${afi.id}/pass`, { plan: 'MONTH' }).expect(200);
    // Make it end in an hour.
    await db
      .updateTable('t_seller_passes')
      .set({ ends_at: new Date('2026-11-11T16:00:00.000Z') })
      .where('seller_id', '=', afi.id)
      .execute();
    expect((await mine(afi)).pass?.endsAt).toBe('2026-11-11T16:00:00.000Z');
    clock.set('2026-11-11T16:00:00.000Z');
    expect((await mine(afi)).pass).toBeNull();
    expect((await approved(afi)).status).toBe('AWAITING_PAYMENT');
  });

  it('can be activated by staff after a cash payment', async () => {
    const afi = await seller();
    const granted = (
      await staff
        .post(`/sellers/${afi.id}/pass`, { plan: 'MONTH', note: 'Payé en espèces' })
        .expect(200)
    ).body as AdminSellerDto;
    expect(granted).toMatchObject({
      phone: afi.phone,
      pass: { plan: 'MONTH', endsAt: '2026-12-11T09:00:00.000Z' },
      blocked: false,
    });
    expect((await approved(afi)).status).toBe('APPROVED');

    const list = (await staff.get('/sellers').expect(200)).body as AdminSellerDto[];
    expect(list.find((x) => x.id === afi.id)).toMatchObject({ livesCount: 1 });
    await staff.post('/sellers/999999/pass', { plan: 'MONTH' }).expect(404);
    const audit = await db
      .selectFrom('t_audit_log')
      .select('action')
      .where('action', '=', 'SELLER_PASS_GRANT')
      .execute();
    expect(audit.length).toBeGreaterThan(0);
  });
});

describe('prices', () => {
  afterEach(async () => {
    await owner
      .put('/live-prices', { passMonthXof: 10_000, passYearXof: 100_000, liveXof: 1_500 })
      .expect(200);
  });

  it('are set by administrators; a live alone costs more than a month ÷ 30', async () => {
    expect((await staff.get('/live-prices').expect(200)).body).toEqual({
      passMonthXof: 10_000,
      passYearXof: 100_000,
      liveXof: 1_500,
    });
    await staff
      .put('/live-prices', { passMonthXof: 9_000, passYearXof: 90_000, liveXof: 1_000 })
      .expect(403);
    const low = await owner
      .put('/live-prices', { passMonthXof: 12_000, passYearXof: 120_000, liveXof: 400 })
      .expect(400);
    expect(low.body).toMatchObject({
      code: 'LIVE_PRICE_TOO_LOW',
      message: 'Le prix d’un live doit être supérieur au prix du mois ÷ 30 (400 FCFA).',
    });
    await owner
      .put('/live-prices', { passMonthXof: 12_000, passYearXof: 120_000, liveXof: 2_000 })
      .expect(200);

    const afi = await seller();
    const waiting = await approved(afi);
    const payment = (
      await afi
        .post('/payments', { purpose: 'LIVE', liveId: waiting.id, method: 'CARD' })
        .expect(201)
    ).body as SellerPaymentDto;
    expect(payment.amountXof).toBe(2_000);
  });
});

describe('what a seller can send', () => {
  it('checks the payment request', async () => {
    const afi = await seller();
    const kofi = await seller();
    const waiting = await approved(afi);
    const noOperator = await afi
      .post('/payments', { purpose: 'LIVE', liveId: waiting.id, method: 'MOBILE_MONEY' })
      .expect(400);
    expect(noOperator.body.details[0].message).toBe(
      'Choisissez l’opérateur et le numéro Mobile Money.',
    );
    await afi.post('/payments', { purpose: 'LIVE', method: 'CARD' }).expect(400);
    await kofi
      .post('/payments', { purpose: 'LIVE', liveId: waiting.id, method: 'CARD' })
      .expect(404);
    await kofi.get('/payments/1').expect(404);
    await request(app.getHttpServer()).post('/api/v1/seller/payments').send({}).expect(403);
  });
});

describe('database rules', () => {
  it('refuse a live price at or below a month ÷ 30, and a pass without its source', async () => {
    await expect(
      db.updateTable('t_live_prices').set({ live_xof: 300 }).where('id', '=', 1).execute(),
    ).rejects.toMatchObject({ errno: 3819 });
    const afi = await seller();
    await expect(
      db
        .insertInto('t_seller_passes')
        .values({
          seller_id: afi.id,
          plan: 'MONTH',
          starts_at: new Date(OPEN),
          ends_at: new Date('2026-12-11T09:00:00Z'),
          price_xof: 10_000,
          created_at: new Date(OPEN),
        })
        .execute(),
    ).rejects.toMatchObject({ errno: 3819 });
  });
});
