import type { INestApplication } from '@nestjs/common';
import type { AdminLiveDto, AdminLiveListResponse, LiveWallResponse } from '@bovann/shared';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { Database } from '../src/database/schema';
import { adminApp, createAdminUser, signedIn, type AdminClient } from './helpers/admin-app';
import { TestClock } from './helpers/booking-app';
import { freshDatabase } from './helpers/test-db';

/**
 * Live directory, first part (2026-11-10): the public wall, and staff listing lives for
 * sellers. Covers expiry, filters' data, link and text rules, language and database rules.
 */
const clock = new TestClock(new Date('2026-11-10T09:00:00.000Z'));
let app: INestApplication;
let db: Kysely<Database>;
let owner: AdminClient;
let staff: AdminClient;

const wall = async (lang?: string) => {
  const r = request(app.getHttpServer()).get('/api/v1/lives');
  return ((lang ? await r.set('Accept-Language', lang) : await r).body ?? {}) as LiveWallResponse;
};

let linkCounter = 0;
const live = (overrides: Record<string, unknown> = {}) => ({
  sellerName: 'Afi Mode',
  url: `https://www.tiktok.com/@afimode${++linkCounter}/live`,
  countryCode: 'TG',
  categoryCode: 'MODE',
  categoryOther: null,
  durationMin: 120,
  ...overrides,
});

beforeAll(async () => {
  db = await freshDatabase();
  app = await adminApp(clock);
  owner = await signedIn(app, await createAdminUser(db));
  staff = await signedIn(app, await createAdminUser(db, { role: 'STAFF' }));
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

beforeEach(async () => {
  clock.set('2026-11-10T09:00:00.000Z');
  await db.deleteFrom('t_lives').execute();
});

describe('the public wall', () => {
  it('is empty at first and lists the categories for the filters, in the page language', async () => {
    const fr = await wall();
    expect(fr.lives).toEqual([]);
    expect(fr.now).toBe('2026-11-10T09:00:00.000Z');
    expect(fr.categories.map((c) => c.code)).toEqual([
      'MODE',
      'BEAUTE',
      'ALIMENTATION',
      'ELECTRONIQUE',
      'MAISON',
      'SANTE',
      'SERVICES',
      'EVENEMENTIEL',
    ]);
    expect(fr.categories[2]).toEqual({ code: 'ALIMENTATION', name: 'Alimentation', icon: 'food' });
    const en = await wall('en');
    expect(en.categories[2]!.name).toBe('Food & drinks');
  });

  it('shows a live listed by staff at once, newest first, until its time is up', async () => {
    const first = (await staff.post('/lives', live({ durationMin: 60 })).expect(201))
      .body as AdminLiveDto;
    expect(first).toMatchObject({
      sellerName: 'Afi Mode',
      platform: 'TIKTOK',
      status: 'APPROVED',
      startedAt: '2026-11-10T09:00:00.000Z',
      endsAt: '2026-11-10T10:00:00.000Z',
      addedBy: expect.stringMatching(/^Admin /),
    });
    clock.advanceMinutes(10);
    await staff
      .post(
        '/lives',
        live({
          sellerName: 'Kofi Électro',
          url: 'facebook.com/kofielectro/videos/123',
          countryCode: 'GH',
          categoryCode: 'ELECTRONIQUE',
          durationMin: 240,
        }),
      )
      .expect(201);

    let now = await wall();
    expect(now.lives.map((l) => l.sellerName)).toEqual(['Kofi Électro', 'Afi Mode']);
    expect(now.lives[0]).toMatchObject({
      platform: 'FACEBOOK',
      url: 'https://facebook.com/kofielectro/videos/123',
      countryCode: 'GH',
      categoryCode: 'ELECTRONIQUE',
      categoryLabel: 'Téléphones & électronique',
      categoryIcon: 'elec',
    });
    expect((await wall('en')).lives[0]!.categoryLabel).toBe('Phones & electronics');

    clock.set('2026-11-10T10:00:00.000Z'); // the first one's hour is up
    now = await wall();
    expect(now.lives.map((l) => l.sellerName)).toEqual(['Kofi Électro']);

    const online = (await staff.get('/lives?tab=online').expect(200)).body as AdminLiveListResponse;
    expect(online.lives.map((l) => l.sellerName)).toEqual(['Kofi Électro']);
    const past = (await staff.get('/lives?tab=past').expect(200)).body as AdminLiveListResponse;
    expect(past.lives.map((l) => l.sellerName)).toEqual(['Afi Mode']);
  });

  it('keeps a category the seller typed ("Autre") as written', async () => {
    await owner
      .post('/lives', live({ categoryCode: null, categoryOther: '  Pagnes   et tissus ' }))
      .expect(201);
    const [entry] = (await wall('en')).lives;
    expect(entry).toMatchObject({
      categoryCode: null,
      categoryLabel: 'Pagnes et tissus',
      categoryIcon: 'autre',
    });
  });

  it('takes a live off the wall when staff remove it, once', async () => {
    const created = (await staff.post('/lives', live()).expect(201)).body as AdminLiveDto;
    const removed = (
      await staff.post(`/lives/${created.id}/remove`, { reason: 'Lien cassé' }).expect(201)
    ).body as AdminLiveDto;
    expect(removed).toMatchObject({
      status: 'REMOVED',
      endReason: 'Lien cassé',
      endedAt: '2026-11-10T09:00:00.000Z',
    });
    expect((await wall()).lives).toEqual([]);
    const again = await staff.post(`/lives/${created.id}/remove`, {}).expect(409);
    expect(again.body.code).toBe('LIVE_NOT_ONLINE');
    await staff.post('/lives/999999/remove', {}).expect(404);

    const audit = await db
      .selectFrom('t_audit_log')
      .select('action')
      .where('entity', '=', 'live')
      .where('entity_id', '=', String(created.id))
      .orderBy('id')
      .execute();
    expect(audit.map((a) => a.action)).toEqual(['LIVE_CREATE', 'LIVE_REMOVE']);
  });

  it('refuses the same live twice while it is on the wall', async () => {
    const body = live();
    await staff.post('/lives', body).expect(201);
    const res = await staff.post('/lives', { ...body, url: `${body.url}#again` }).expect(409);
    expect(res.body.code).toBe('LIVE_ALREADY_ONLINE');
    clock.advanceMinutes(121);
    await staff.post('/lives', body).expect(201);
  });
});

describe('what staff can type', () => {
  it('accepts only TikTok and Facebook links, with clear messages in both languages', async () => {
    for (const url of [
      'https://youtube.com/live/x',
      'javascript:alert(1)',
      'https://tiktok.com.evil.test/@x',
    ]) {
      const res = await staff.post('/lives', live({ url })).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details[0].message).toBe('Seuls les liens TikTok et Facebook sont acceptés.');
    }
    const en = await staff.agent
      .post('/api/v1/admin/lives')
      .set('X-Bovann-Admin', '1')
      .set('Accept-Language', 'en')
      .send(live({ url: 'not a link' }))
      .expect(400);
    expect(en.body.details[0].message).toBe(
      'This link isn’t valid. Copy it from TikTok or Facebook.',
    );
  });

  it('cleans names, and checks country, category and duration', async () => {
    const created = (
      await staff.post('/lives', live({ sellerName: ' Awa​  Cosmétiques\n' })).expect(201)
    ).body as AdminLiveDto;
    expect(created.sellerName).toBe('Awa Cosmétiques');

    const bad = async (overrides: Record<string, unknown>, message: string) => {
      const res = await staff.post('/lives', live(overrides)).expect(400);
      expect(res.body.details.map((d: { message: string }) => d.message)).toContain(message);
    };
    await bad({ sellerName: ' ​ ' }, 'Le nom du vendeur est obligatoire (2 caractères minimum).');
    await bad({ countryCode: 'XX' }, 'Choisissez le pays du vendeur.');
    await bad({ durationMin: 90 }, 'Durée invalide : 1, 2, 3 ou 4 heures.');
    await bad(
      { categoryCode: null, categoryOther: null },
      'Choisissez une catégorie ou écrivez la vôtre.',
    );
    await bad({ categoryOther: 'Pagnes' }, 'Choisissez une catégorie ou écrivez la vôtre.');

    const unknown = await staff.post('/lives', live({ categoryCode: 'NOPE' })).expect(400);
    expect(unknown.body.code).toBe('CATEGORY_NOT_FOUND');
    await staff.post('/lives', { ...live(), extra: 1 }).expect(400);
  });

  it('needs a staff session', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/lives').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/admin/lives')
      .set('X-Bovann-Admin', '1')
      .send(live())
      .expect(401);
  });
});

describe('database rules', () => {
  const base = {
    seller_name: 'Afi Mode',
    platform: 'TIKTOK' as const,
    url: 'https://www.tiktok.com/@afi/live',
    country_code: 'TG',
    category_id: null,
    category_other: 'Pagnes',
    duration_min: 60,
  };

  it('refuses a listed live without times, a non-https link, both or neither category', async () => {
    const insert = (values: Record<string, unknown>) =>
      db
        .insertInto('t_lives')
        .values({ ...base, ...values } as never)
        .execute();
    await expect(insert({ status: 'APPROVED' })).rejects.toMatchObject({ errno: 3819 });
    await expect(insert({ url: 'http://www.tiktok.com/@afi' })).rejects.toMatchObject({
      errno: 3819,
    });
    await expect(insert({ category_other: null })).rejects.toMatchObject({ errno: 3819 });
    const mode = await db
      .selectFrom('t_categories')
      .select('id')
      .where('code', '=', 'MODE')
      .executeTakeFirstOrThrow();
    await expect(insert({ category_id: mode.id })).rejects.toMatchObject({ errno: 3819 });
    await expect(insert({ country_code: 'tg' })).rejects.toMatchObject({ errno: 3819 });
    await expect(
      insert({
        status: 'REMOVED',
        starts_at: new Date('2026-11-10T09:00:00Z'),
        ends_at: new Date('2026-11-10T10:00:00Z'),
      }),
    ).rejects.toMatchObject({ errno: 3819 });
    await insert({}); // a pending request needs no times
    const { n } = await db
      .selectFrom('t_lives')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    expect(Number(n)).toBe(1);
  });
});
