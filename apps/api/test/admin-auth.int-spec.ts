import type { INestApplication } from '@nestjs/common';
import type { AdminMe, TemporaryPasswordResponse } from '@bovann/shared';
import type { Kysely } from 'kysely';
import request from 'supertest';
import type { Database } from '../src/database/schema';
import {
  adminApp,
  adminClient,
  createAdminUser,
  signedIn,
  TEST_PASSWORD,
} from './helpers/admin-app';
import { TestClock } from './helpers/booking-app';
import { freshDatabase } from './helpers/test-db';

/** Phase 5: admin sign-in, sessions, roles and accounts, against MySQL. */
const START = '2026-11-09T08:00:00.000Z';
const clock = new TestClock(new Date(START));
let app: INestApplication;
let db: Kysely<Database>;

beforeAll(async () => {
  db = await freshDatabase();
  app = await adminApp(clock);
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
});

beforeEach(() => clock.set(START));

describe('signing in', () => {
  it('opens a session in an httpOnly cookie and answers "me"', async () => {
    const owner = await createAdminUser(db);
    const client = adminClient(app);
    const res = await client
      .post('/auth/login', { email: owner.email.toUpperCase(), password: owner.password })
      .expect(200);
    expect(res.body).toMatchObject({
      email: owner.email,
      role: 'OWNER',
      mustChangePassword: false,
    });
    const cookie = res.headers['set-cookie']![0]!;
    expect(cookie).toMatch(/^bovann_admin_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const me = (await client.get('/auth/me').expect(200)).body as AdminMe;
    expect(me.id).toBe(owner.id);

    // Only the hash of the token is stored.
    const token = /bovann_admin_session=([^;]+)/.exec(cookie)![1]!;
    const stored = await db.selectFrom('t_admin_sessions').select('token_hash').execute();
    expect(stored.some((s) => s.token_hash === token)).toBe(false);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const owner = await createAdminUser(db);
    const wrong = await adminClient(app)
      .post('/auth/login', { email: owner.email, password: 'not the password' })
      .expect(401);
    const unknown = await adminClient(app)
      .post('/auth/login', { email: 'nobody@example.test', password: 'whatever123' })
      .expect(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account for 15 minutes after 5 wrong passwords', async () => {
    const owner = await createAdminUser(db);
    for (let i = 0; i < 5; i++) {
      await adminClient(app)
        .post('/auth/login', { email: owner.email, password: 'wrong-pass' })
        .expect(401);
    }
    const locked = await adminClient(app)
      .post('/auth/login', { email: owner.email, password: owner.password })
      .expect(429);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');

    clock.advanceMinutes(16);
    await adminClient(app)
      .post('/auth/login', { email: owner.email, password: owner.password })
      .expect(200);
  });

  it('refuses a deactivated account even with the right password', async () => {
    const owner = await createAdminUser(db);
    await db
      .updateTable('t_admin_users')
      .set({ is_active: false })
      .where('id', '=', owner.id)
      .execute();
    await adminClient(app)
      .post('/auth/login', { email: owner.email, password: owner.password })
      .expect(401);
  });

  it('limits sign-in attempts per connection', async () => {
    const limited = await adminApp(clock, { ADMIN_LOGIN_RATE_LIMIT_PER_MIN: '3' });
    try {
      const attempt = () =>
        request(limited.getHttpServer())
          .post('/api/v1/admin/auth/login')
          .set('X-Bovann-Admin', '1')
          .set('X-Forwarded-For', '41.207.9.9')
          .send({ email: 'x@example.test', password: 'whatever123' });
      for (let i = 0; i < 3; i++) await attempt().expect(401);
      expect((await attempt().expect(429)).body.code).toBe('TOO_MANY_LOGIN_ATTEMPTS');
    } finally {
      await limited.close();
      Object.assign(process.env, { ADMIN_LOGIN_RATE_LIMIT_PER_MIN: '1000' });
    }
  });
});

describe('protection of admin routes', () => {
  it('answers 401 without a session', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/admin/bookings').expect(401);
    expect(res.body.code).toBe('NOT_AUTHENTICATED');
  });

  it('refuses state-changing requests without the CSRF header', async () => {
    const owner = await createAdminUser(db);
    const client = await signedIn(app, owner);
    const res = await client.agent.post('/api/v1/admin/auth/logout').send({}).expect(403);
    expect(res.body.code).toBe('CSRF_HEADER_MISSING');
    // Sign-in needs it too (no login CSRF).
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(403);
  });

  it('ends the session at logout', async () => {
    const client = await signedIn(app, await createAdminUser(db));
    await client.post('/auth/logout').expect(204);
    await client.get('/auth/me').expect(401);
  });

  it('ends a session after 12 hours without activity, and after 7 days in any case', async () => {
    const client = await signedIn(app, await createAdminUser(db));
    clock.advanceMinutes(11 * 60);
    await client.get('/auth/me').expect(200);
    clock.advanceMinutes(11 * 60);
    await client.get('/auth/me').expect(200); // activity keeps it alive
    clock.advanceMinutes(12 * 60 + 1);
    await client.get('/auth/me').expect(401);

    const busy = await signedIn(app, await createAdminUser(db));
    for (let h = 0; h < 7 * 24; h += 10) {
      clock.advanceMinutes(10 * 60);
      if (h + 10 < 7 * 24) await busy.get('/auth/me').expect(200);
    }
    await busy.get('/auth/me').expect(401);
  });

  it('keeps the team (STAFF) out of administrator-only actions', async () => {
    const staff = await signedIn(app, await createAdminUser(db, { role: 'STAFF' }));
    await staff.get('/bookings').expect(200);
    const res = await staff.get('/users').expect(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');
    await staff.patch('/spaces/1', { holdDurationMin: 4 }).expect(403);
    await staff.post('/spaces/1/packages', { name: 'X', slotCount: 3, prices: {} }).expect(403);
  });

  it('signs out a deactivated account at once', async () => {
    const owner = await signedIn(app, await createAdminUser(db));
    const staffUser = await createAdminUser(db, { role: 'STAFF' });
    const staff = await signedIn(app, staffUser);
    await owner.patch(`/users/${staffUser.id}`, { isActive: false }).expect(200);
    await staff.get('/auth/me').expect(401);
  });
});

describe('temporary passwords and accounts', () => {
  it('a new account must choose its own password before doing anything else', async () => {
    const owner = await signedIn(app, await createAdminUser(db));
    const created = (
      await owner
        .post('/users', { email: 'Kossi@Example.test', fullName: 'Kossi Amegbo', role: 'STAFF' })
        .expect(201)
    ).body as TemporaryPasswordResponse;
    expect(created.user).toMatchObject({
      email: 'kossi@example.test',
      role: 'STAFF',
      mustChangePassword: true,
    });
    expect(created.temporaryPassword).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);

    const kossi = await signedIn(app, {
      email: 'kossi@example.test',
      password: created.temporaryPassword,
    });
    expect((await kossi.get('/auth/me').expect(200)).body.mustChangePassword).toBe(true);
    expect((await kossi.get('/bookings').expect(403)).body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const weak = await kossi
      .post('/auth/password', { currentPassword: created.temporaryPassword, newPassword: 'short' })
      .expect(400);
    expect(weak.body.code).toBe('WEAK_PASSWORD');
    await kossi
      .post('/auth/password', { currentPassword: 'wrong', newPassword: 'un mot de passe solide' })
      .expect(400);
    const changed = await kossi
      .post('/auth/password', {
        currentPassword: created.temporaryPassword,
        newPassword: 'un mot de passe solide',
      })
      .expect(200);
    expect(changed.body.mustChangePassword).toBe(false);
    await kossi.get('/bookings').expect(200);
  });

  it('changing the password signs out the other sessions', async () => {
    const user = await createAdminUser(db);
    const laptop = await signedIn(app, user);
    const phone = await signedIn(app, user);
    await laptop
      .post('/auth/password', {
        currentPassword: TEST_PASSWORD,
        newPassword: 'nouveau mot de passe',
      })
      .expect(200);
    await laptop.get('/auth/me').expect(200);
    await phone.get('/auth/me').expect(401);
  });

  it('refuses a duplicate email', async () => {
    const owner = await signedIn(app, await createAdminUser(db));
    const existing = await createAdminUser(db);
    const res = await owner
      .post('/users', { email: existing.email, fullName: 'Copie', role: 'STAFF' })
      .expect(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });

  it('resetting a password signs the person out and gives a new temporary password', async () => {
    const owner = await signedIn(app, await createAdminUser(db));
    const staffUser = await createAdminUser(db, { role: 'STAFF' });
    const staff = await signedIn(app, staffUser);
    const reset = (await owner.post(`/users/${staffUser.id}/reset-password`).expect(200))
      .body as TemporaryPasswordResponse;
    await staff.get('/auth/me').expect(401);
    await adminClient(app)
      .post('/auth/login', { email: staffUser.email, password: staffUser.password })
      .expect(401);
    const again = await signedIn(app, {
      email: staffUser.email,
      password: reset.temporaryPassword,
    });
    expect((await again.get('/auth/me')).body.mustChangePassword).toBe(true);
  });

  it('never leaves the studio without an active administrator', async () => {
    // Make this the only active owner.
    await db
      .updateTable('t_admin_users')
      .set({ is_active: false })
      .where('role', '=', 'OWNER')
      .execute();
    const soleUser = await createAdminUser(db);
    const sole = await signedIn(app, soleUser);
    expect(
      (await sole.patch(`/users/${soleUser.id}`, { role: 'STAFF' }).expect(400)).body.code,
    ).toBe('CANNOT_CHANGE_OWN_ACCESS');

    const secondUser = await createAdminUser(db);
    const second = await signedIn(app, secondUser);
    // Two owners: one may demote the other…
    await second.patch(`/users/${soleUser.id}`, { role: 'STAFF' }).expect(200);
    // …but the last one can't be removed by anyone (and not by themselves).
    expect(
      (await second.patch(`/users/${secondUser.id}`, { isActive: false }).expect(400)).body.code,
    ).toBe('CANNOT_CHANGE_OWN_ACCESS');
    const users = (await second.get('/users').expect(200)).body as Array<{
      id: number;
      role: string;
      isActive: boolean;
    }>;
    expect(users.filter((u) => u.role === 'OWNER' && u.isActive)).toHaveLength(1);
  });
});
