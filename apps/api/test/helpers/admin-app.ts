import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AdminRole } from '@bovann/shared';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { AdminModule } from '../../src/admin/admin.module';
import { hashPassword } from '../../src/admin/auth/passwords';
import { configureApp } from '../../src/app.setup';
import { BookingModule } from '../../src/booking/booking.module';
import { CLOCK, ClockModule } from '../../src/common/clock';
import { ConfigModule } from '../../src/config/config.module';
import { DatabaseModule } from '../../src/database/database.module';
import type { Database } from '../../src/database/schema';
import type { TestClock } from './booking-app';
import { testDatabaseUrl } from './test-db';

/** Boots the customer and admin APIs on the test database, with a controllable clock. */
export async function adminApp(
  clock: TestClock,
  env: Record<string, string> = {},
): Promise<INestApplication> {
  Object.assign(process.env, {
    DATABASE_URL: testDatabaseUrl(),
    HOLD_EXPIRY_INTERVAL_SEC: '0',
    HOLD_RATE_LIMIT_PER_MIN: '1000',
    ADMIN_LOGIN_RATE_LIMIT_PER_MIN: '1000',
    ...env,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule, ClockModule, DatabaseModule, BookingModule, AdminModule],
  })
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, { corsOrigins: [], trustProxyHops: 1 });
  await app.init();
  return app;
}

export const TEST_PASSWORD = 'correct horse battery';

let userCounter = 0;

/** Inserts an admin account directly (as the setup command would). */
export async function createAdminUser(
  db: Kysely<Database>,
  options: { role?: AdminRole; mustChangePassword?: boolean; password?: string } = {},
): Promise<{ id: number; email: string; password: string }> {
  userCounter += 1;
  const email = `admin${userCounter}-${Date.now()}@example.test`;
  const password = options.password ?? TEST_PASSWORD;
  const result = await db
    .insertInto('t_admin_users')
    .values({
      email,
      full_name: `Admin ${userCounter}`,
      role: options.role ?? 'OWNER',
      password_hash: await hashPassword(password),
      must_change_password: options.mustChangePassword ?? false,
    })
    .executeTakeFirstOrThrow();
  return { id: Number(result.insertId), email, password };
}

/** A supertest agent that keeps the session cookie and sends the CSRF header. */
export interface AdminClient {
  agent: ReturnType<typeof request.agent>;
  get(path: string): request.Test;
  post(path: string, body?: object): request.Test;
  patch(path: string, body?: object): request.Test;
  put(path: string, body?: object): request.Test;
  del(path: string): request.Test;
}

export function adminClient(app: INestApplication): AdminClient {
  const agent = request.agent(app.getHttpServer());
  const url = (path: string) => `/api/v1/admin${path}`;
  return {
    agent,
    get: (path) => agent.get(url(path)),
    post: (path, body = {}) => agent.post(url(path)).set('X-Bovann-Admin', '1').send(body),
    patch: (path, body = {}) => agent.patch(url(path)).set('X-Bovann-Admin', '1').send(body),
    put: (path, body = {}) => agent.put(url(path)).set('X-Bovann-Admin', '1').send(body),
    del: (path) => agent.delete(url(path)).set('X-Bovann-Admin', '1'),
  };
}

/** Signs in and returns a client carrying the session. */
export async function signedIn(
  app: INestApplication,
  user: { email: string; password: string },
): Promise<AdminClient> {
  const client = adminClient(app);
  await client.post('/auth/login', { email: user.email, password: user.password }).expect(200);
  return client;
}
