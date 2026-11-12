import type { INestApplication } from '@nestjs/common';
import type {
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
 * Passes (decision of 2026-11-12): posting a live needs a pass in force; approval then puts the
 * live online at once. Passes are paid with the simulated provider; the outcome is decided with
 * /dev/seller-payments/:id/succeed|fail, like bookings. Wednesday 11 November 2026, 09:00
 * (Lomé = UTC) is within review hours.
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

const buyPass = async (s: SellerClient, purpose: 'PASS_MONTH' | 'PASS_YEAR' = 'PASS_MONTH') => {
  const payment = (await s.post('/payments', { purpose, ...momo(s) }).expect(201))
    .body as SellerPaymentDto;
  await dev(payment.id, 'succeed').expect(200);
  return payment;
};

describe('posting needs a pass', () => {
  it('refuses to send without a pass, and the wall stays empty', async () => {
    const afi = await seller();
    const mineNow = await mine(afi);
    expect(mineNow.pass).toBeNull();
    expect(mineNow.prices).toEqual({ passMonthXof: 10_000, passYearXof: 100_000 });
    const refused = await afi.post('/lives', live()).expect(402);
    expect(refused.body).toMatchObject({
      code: 'PASS_REQUIRED',
      message: 'Prenez un pass pour publier vos lives.',
    });
    expect((await mine(afi)).lives).toEqual([]);
    expect((await wall()).lives).toEqual([]);
  });

  it('after a monthly pass paid by Mobile Money: send, approve, online', async () => {
    const afi = await seller();
    const payment = (
      await afi.post('/payments', { purpose: 'PASS_MONTH', ...momo(afi) }).expect(201)
    ).body as SellerPaymentDto;
    expect(payment).toMatchObject({
      purpose: 'PASS_MONTH',
      amountXof: 10_000,
      method: 'MOBILE_MONEY',
      channel: 'TMONEY',
      status: 'PENDING',
      instructions: expect.stringContaining('Paiement simulé'),
    });
    // Not paid yet: still no pass.
    await afi.post('/lives', live()).expect(402);

    expect((await dev(payment.id, 'succeed').expect(200)).body).toEqual({ outcome: 'SUCCEEDED' });
    expect((await afi.get(`/payments/${payment.id}`).expect(200)).body.status).toBe('SUCCEEDED');
    expect((await mine(afi)).pass).toEqual({
      plan: 'MONTH',
      startsAt: OPEN,
      endsAt: '2026-12-11T09:00:00.000Z',
    });

    const sent = (await afi.post('/lives', live()).expect(201)).body as SellerLiveDto;
    expect(sent.status).toBe('PENDING');
    await staff.post(`/lives/${sent.id}/approve`).expect(200);
    expect((await wall()).lives.map((l) => l.id)).toEqual([sent.id]);
    // Confirming twice changes nothing.
    expect((await dev(payment.id, 'succeed').expect(200)).body).toEqual({
      outcome: 'ALREADY_DONE',
    });
  });

  it('a failed payment gives no pass; trying again works, and replaces an unfinished attempt', async () => {
    const afi = await seller();
    const first = (
      await afi.post('/payments', { purpose: 'PASS_YEAR', method: 'CARD' }).expect(201)
    ).body as SellerPaymentDto;
    await dev(first.id, 'fail').expect(200);
    expect((await afi.get(`/payments/${first.id}`).expect(200)).body).toMatchObject({
      status: 'FAILED',
      failureReason: 'DECLINED',
    });
    expect((await mine(afi)).pass).toBeNull();

    const second = (
      await afi.post('/payments', { purpose: 'PASS_YEAR', method: 'CARD' }).expect(201)
    ).body as SellerPaymentDto;
    const third = (
      await afi.post('/payments', { purpose: 'PASS_YEAR', method: 'CARD' }).expect(201)
    ).body as SellerPaymentDto;
    expect((await afi.get(`/payments/${second.id}`).expect(200)).body).toMatchObject({
      status: 'CANCELLED',
      failureReason: 'SUPERSEDED',
    });
    await dev(third.id, 'succeed').expect(200);
    expect((await mine(afi)).pass).toMatchObject({
      plan: 'YEAR',
      endsAt: '2027-11-11T09:00:00.000Z',
    });
    await afi.post('/lives', live()).expect(201);
  });

  it('a live sent while the pass was valid still goes online if the pass ends during review', async () => {
    clock.set('2026-11-11T15:00:00.000Z');
    const afi = await seller();
    await staff.post(`/sellers/${afi.id}/pass`, { plan: 'MONTH' }).expect(200);
    await db
      .updateTable('t_seller_passes')
      .set({ ends_at: new Date('2026-11-11T15:10:00.000Z') })
      .where('seller_id', '=', afi.id)
      .execute();
    const sent = (await afi.post('/lives', live()).expect(201)).body as SellerLiveDto;
    clock.set('2026-11-11T15:20:00.000Z');
    expect((await mine(afi)).pass).toBeNull();
    await staff.post(`/lives/${sent.id}/approve`).expect(200);
    expect((await wall()).lives.map((l) => l.id)).toEqual([sent.id]);
    // But the next one needs a new pass.
    await afi.post(`/lives/${sent.id}/end`).expect(200);
    await afi.post('/lives', live()).expect(402);
  });
});

describe('passes', () => {
  it('bought ahead follow each other', async () => {
    const afi = await seller();
    await buyPass(afi, 'PASS_MONTH');
    clock.advanceMinutes(60 * 24 * 10);
    const year = await buyPass(afi, 'PASS_YEAR');
    expect(year.amountXof).toBe(100_000);
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
    await db
      .updateTable('t_seller_passes')
      .set({ ends_at: new Date('2026-11-11T16:00:00.000Z') })
      .where('seller_id', '=', afi.id)
      .execute();
    expect((await mine(afi)).pass?.endsAt).toBe('2026-11-11T16:00:00.000Z');
    clock.set('2026-11-11T16:00:00.000Z');
    expect((await mine(afi)).pass).toBeNull();
    expect((await afi.post('/lives', live()).expect(402)).body.code).toBe('PASS_REQUIRED');
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
    const sent = (await afi.post('/lives', live()).expect(201)).body as SellerLiveDto;
    await staff.post(`/lives/${sent.id}/approve`).expect(200);
    expect((await mine(afi)).lives[0]!.status).toBe('APPROVED');

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
    await owner.put('/live-prices', { passMonthXof: 10_000, passYearXof: 100_000 }).expect(200);
  });

  it('are set by administrators; a year costs less than 12 months', async () => {
    expect((await staff.get('/live-prices').expect(200)).body).toEqual({
      passMonthXof: 10_000,
      passYearXof: 100_000,
    });
    await staff.put('/live-prices', { passMonthXof: 9_000, passYearXof: 90_000 }).expect(403);
    const high = await owner
      .put('/live-prices', { passMonthXof: 12_000, passYearXof: 144_000 })
      .expect(400);
    expect(high.body).toMatchObject({
      code: 'PASS_YEAR_TOO_HIGH',
      message: 'Le pass annuel doit coûter moins que 12 mois (144000 FCFA).',
    });
    await owner.put('/live-prices', { passMonthXof: 12_000, passYearXof: 120_000 }).expect(200);

    const afi = await seller();
    const payment = (
      await afi.post('/payments', { purpose: 'PASS_MONTH', method: 'CARD' }).expect(201)
    ).body as SellerPaymentDto;
    expect(payment.amountXof).toBe(12_000);
  });
});

describe('what a seller can send', () => {
  it('checks the payment request', async () => {
    const afi = await seller();
    const kofi = await seller();
    const noOperator = await afi
      .post('/payments', { purpose: 'PASS_MONTH', method: 'MOBILE_MONEY' })
      .expect(400);
    expect(noOperator.body.details[0].message).toBe(
      'Choisissez l’opérateur et le numéro Mobile Money.',
    );
    const live = await afi.post('/payments', { purpose: 'LIVE', method: 'CARD' }).expect(400);
    expect(live.body.details[0].message).toBe('Choisissez un pass mensuel ou annuel.');
    const mine = (
      await afi.post('/payments', { purpose: 'PASS_MONTH', method: 'CARD' }).expect(201)
    ).body as SellerPaymentDto;
    await kofi.get(`/payments/${mine.id}`).expect(404);
    await request(app.getHttpServer()).post('/api/v1/seller/payments').send({}).expect(403);
  });
});

describe('database rules', () => {
  it('refuse a year at 12 months or more, and a pass without its source', async () => {
    await expect(
      db.updateTable('t_live_prices').set({ pass_year_xof: 120_000 }).where('id', '=', 1).execute(),
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
