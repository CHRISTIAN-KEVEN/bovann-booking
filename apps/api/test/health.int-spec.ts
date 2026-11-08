import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import { HealthModule } from '../src/health/health.module';
import { testDatabaseUrl } from './helpers/test-db';

describe('GET /health (real MySQL)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl();
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule, HealthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.enableShutdownHooks();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('liveness answers 200', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });

  it('readiness answers 200 with the database up', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', checks: { database: 'up' } });
  });
});
