import type { INestApplication } from '@nestjs/common';
import type {
  AdminLiveListResponse,
  LiveWallResponse,
  SellerLiveDto,
  SellerLivesResponse,
} from '@bovann/shared';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { Database } from '../src/database/schema';
import { adminApp, createAdminUser, signedIn, type AdminClient } from './helpers/admin-app';
import { TestClock } from './helpers/booking-app';
import { freshDatabase } from './helpers/test-db';

/**
 * Sellers post their live during review hours; staff approve (on the wall at once, for the
 * chosen duration) or refuse with a message. Default hours: Monday–Saturday 08–11 and 15–18
 * (Lomé = UTC). Wednesday 11 November 2026, 09:00 is open.
 */
const OPEN = '2026-11-11T09:00:00.000Z';
const clock = new TestClock(new Date(OPEN));
let app: INestApplication;
let db: Kysely<Database>;
let owner: AdminClient;
let staff: AdminClient;

interface SellerClient {
  phone: string;
  agent: ReturnType<typeof request.agent>;
  get(path: string): request.Test;
  post(path: string, body?: object): request.Test;
}

let phoneCounter = 0;
async function seller(): Promise<SellerClient> {
  const phone = `+2289${String(2_000_000 + ++phoneCounter).slice(-7)}`;
  const agent = request.agent(app.getHttpServer());
  const sent = await agent
    .post('/api/v1/seller/auth/code')
    .set('X-Bovann-Seller', '1')
    .send({ phone })
    .expect(200);
  await agent
    .post('/api/v1/seller/auth/verify')
    .set('X-Bovann-Seller', '1')
    .send({ phone, code: sent.body.devCode })
    .expect(200);
  // Posting needs a pass in force (see live-passes.int-spec.ts).
  const me = await agent.get('/api/v1/seller/me').expect(200);
  await staff.post(`/sellers/${me.body.id}/pass`, { plan: 'YEAR' }).expect(200);
  return {
    phone,
    agent,
    get: (path) => agent.get(`/api/v1/seller${path}`),
    post: (path, body) =>
      agent
        .post(`/api/v1/seller${path}`)
        .set('X-Bovann-Seller', '1')
        .send(body ?? {}),
  };
}

let linkCounter = 0;
const live = (overrides: Record<string, unknown> = {}) => ({
  sellerName: 'Afi Mode',
  url: `https://www.tiktok.com/@afi${++linkCounter}/live`,
  countryCode: 'TG',
  categoryCode: null,
  categoryOther: 'Pagnes et tissus',
  durationMin: 120,
  ...overrides,
});

const wall = async () =>
  (await request(app.getHttpServer()).get('/api/v1/lives').expect(200)).body as LiveWallResponse;

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
  await db.deleteFrom('t_lives').execute();
});

describe('posting a live', () => {
  it('waits for review, then goes on the wall when staff approve it', async () => {
    const afi = await seller();
    const sent = (await afi.post('/lives', live()).expect(201)).body as SellerLiveDto;
    expect(sent).toMatchObject({
      status: 'PENDING',
      categoryLabel: 'Pagnes et tissus',
      startedAt: '',
      createdAt: OPEN,
    });
    expect((await wall()).lives).toEqual([]);

    const queue = (await staff.get('/lives?tab=pending').expect(200)).body as AdminLiveListResponse;
    expect(queue.pendingCount).toBe(1);
    expect(queue.lives[0]).toMatchObject({
      id: sent.id,
      sellerPhone: afi.phone,
      status: 'PENDING',
    });
    expect((await staff.get('/lives/pending-count').expect(200)).body).toEqual({ count: 1 });

    clock.advanceMinutes(4);
    const approved = (await staff.post(`/lives/${sent.id}/approve`).expect(200)).body;
    expect(approved).toMatchObject({
      status: 'APPROVED',
      startedAt: '2026-11-11T09:04:00.000Z',
      endsAt: '2026-11-11T11:04:00.000Z',
      reviewedBy: expect.stringMatching(/^Admin /),
    });
    expect((await wall()).lives.map((l) => l.id)).toEqual([sent.id]);
    const mine = (await afi.get('/lives').expect(200)).body as SellerLivesResponse;
    expect(mine.lives[0]).toMatchObject({
      status: 'APPROVED',
      reviewedAt: '2026-11-11T09:04:00.000Z',
    });

    const again = await staff.post(`/lives/${sent.id}/approve`).expect(409);
    expect(again.body.code).toBe('LIVE_NOT_PENDING');
    expect((await staff.get('/lives/pending-count')).body).toEqual({ count: 0 });
  });

  it('shows the seller why staff refused it', async () => {
    const afi = await seller();
    const sent = (await afi.post('/lives', live()).expect(201)).body as SellerLiveDto;
    const empty = await staff.post(`/lives/${sent.id}/reject`, { reason: ' ' }).expect(400);
    expect(empty.body.details[0].message).toBe('Écrivez au vendeur pourquoi son live est refusé.');
    await staff
      .post(`/lives/${sent.id}/reject`, { reason: 'Le live n’a pas encore commencé.' })
      .expect(200);
    const mine = (await afi.get('/lives').expect(200)).body as SellerLivesResponse;
    expect(mine.lives[0]).toMatchObject({
      status: 'REJECTED',
      rejectReason: 'Le live n’a pas encore commencé.',
    });
    // Refused: the seller may send again.
    await afi.post('/lives', live()).expect(201);
  });

  it('is closed outside review hours and says when it opens', async () => {
    const afi = await seller();
    clock.set('2026-11-11T12:40:00.000Z');
    const lunch = await afi.post('/lives', live()).expect(409);
    expect(lunch.body).toMatchObject({
      code: 'REVIEW_CLOSED',
      details: { nextOpensAt: '2026-11-11T15:00:00.000Z' },
    });
    clock.set('2026-11-15T10:00:00.000Z'); // Sunday
    const sunday = (await afi.get('/lives').expect(200)).body as SellerLivesResponse;
    expect(sunday.review).toMatchObject({ open: false, nextOpensAt: '2026-11-16T08:00:00.000Z' });
    expect((await wall()).review.open).toBe(false);
  });

  it('allows one request at a time, which the seller can withdraw', async () => {
    const afi = await seller();
    const first = (await afi.post('/lives', live()).expect(201)).body as SellerLiveDto;
    const second = await afi.post('/lives', live()).expect(409);
    expect(second.body).toMatchObject({
      code: 'LIVE_PENDING_EXISTS',
      details: { liveId: first.id },
    });
    const cancelled = (await afi.post(`/lives/${first.id}/end`).expect(200)).body as SellerLiveDto;
    expect(cancelled.status).toBe('CANCELLED');
    await afi.post('/lives', live()).expect(201);
    const handled = await staff.post(`/lives/${first.id}/approve`).expect(409);
    expect(handled.body.code).toBe('LIVE_NOT_PENDING');
  });

  it('allows 5 lives a day per seller (withdrawn ones don’t count)', async () => {
    const afi = await seller();
    for (let i = 0; i < 5; i++) {
      const sent = (await afi.post('/lives', live()).expect(201)).body as SellerLiveDto;
      await staff.post(`/lives/${sent.id}/reject`, { reason: 'Test' }).expect(200);
    }
    const sixth = await afi.post('/lives', live()).expect(429);
    expect(sixth.body.code).toBe('LIVE_DAILY_LIMIT');
    clock.set('2026-11-12T08:30:00.000Z');
    const pending = (await afi.post('/lives', live()).expect(201)).body as SellerLiveDto;
    await afi.post(`/lives/${pending.id}/end`).expect(200);
    await afi.post('/lives', live()).expect(201);
  });

  it('refuses a link already waiting or already on the wall', async () => {
    const afi = await seller();
    const kofi = await seller();
    const body = live();
    const sent = (await afi.post('/lives', body).expect(201)).body as SellerLiveDto;
    expect((await kofi.post('/lives', body).expect(409)).body.code).toBe('LIVE_ALREADY_PENDING');
    await staff.post(`/lives/${sent.id}/approve`).expect(200);
    expect((await kofi.post('/lives', body).expect(409)).body.code).toBe('LIVE_ALREADY_ONLINE');
    expect((await staff.post('/lives', { ...body }).expect(409)).body.code).toBe(
      'LIVE_ALREADY_ONLINE',
    );
  });

  it('lets the seller end their live early, and only theirs', async () => {
    const afi = await seller();
    const kofi = await seller();
    const sent = (await afi.post('/lives', live()).expect(201)).body as SellerLiveDto;
    await staff.post(`/lives/${sent.id}/approve`).expect(200);
    await kofi.post(`/lives/${sent.id}/end`).expect(404);
    const ended = (await afi.post(`/lives/${sent.id}/end`).expect(200)).body as SellerLiveDto;
    expect(ended.status).toBe('ENDED');
    expect((await wall()).lives).toEqual([]);
    expect((await afi.post(`/lives/${sent.id}/end`).expect(409)).body.code).toBe('LIVE_NOT_ONLINE');
    const past = (await staff.get('/lives?tab=past').expect(200)).body as AdminLiveListResponse;
    expect(past.lives.map((l) => l.status)).toEqual(['ENDED']);
  });

  it('needs a seller session and the CSRF header', async () => {
    await request(app.getHttpServer()).get('/api/v1/seller/lives').expect(401);
    const afi = await seller();
    await afi.agent.post('/api/v1/seller/lives').send(live()).expect(403);
    const bad = await afi.post('/lives', live({ url: 'https://youtube.com/live/x' })).expect(400);
    expect(bad.body.details[0].message).toBe('Seuls les liens TikTok et Facebook sont acceptés.');
  });
});

describe('review hours', () => {
  afterEach(async () => {
    // Back to the default week for the other tests.
    const periods = [1, 2, 3, 4, 5, 6].flatMap((weekday) => [
      { weekday, opensAt: '08:00', closesAt: '11:00' },
      { weekday, opensAt: '15:00', closesAt: '18:00' },
    ]);
    await owner.put('/review-hours', { periods }).expect(200);
  });

  it('are set by administrators for the whole week', async () => {
    const current = (await staff.get('/review-hours').expect(200)).body;
    expect(current.periods).toHaveLength(12);
    expect(current.periods[0]).toEqual({ weekday: 1, opensAt: '08:00', closesAt: '11:00' });

    await staff.put('/review-hours', { periods: [] }).expect(403);
    const overlap = await owner
      .put('/review-hours', {
        periods: [
          { weekday: 3, opensAt: '08:00', closesAt: '12:00' },
          { weekday: 3, opensAt: '11:00', closesAt: '13:00' },
        ],
      })
      .expect(400);
    expect(overlap.body.code).toBe('REVIEW_HOURS_INVALID');
    await owner
      .put('/review-hours', { periods: [{ weekday: 3, opensAt: '25:00', closesAt: '26:00' }] })
      .expect(400);

    await owner
      .put('/review-hours', { periods: [{ weekday: 3, opensAt: '12:00', closesAt: '20:00' }] })
      .expect(200);
    expect((await wall()).review).toMatchObject({
      open: false,
      nextOpensAt: '2026-11-11T12:00:00.000Z',
      today: [{ opensAt: '12:00', closesAt: '20:00' }],
    });

    await owner.put('/review-hours', { periods: [] }).expect(200);
    expect((await wall()).review).toMatchObject({ open: false, nextOpensAt: null, today: [] });
    const audit = await db
      .selectFrom('t_audit_log')
      .select('action')
      .where('action', '=', 'REVIEW_HOURS_UPDATE')
      .execute();
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });
});
