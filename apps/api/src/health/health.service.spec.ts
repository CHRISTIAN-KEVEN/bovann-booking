import { Kysely, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler, type Driver } from 'kysely';
import type { Database } from '../database/schema';
import { HealthService } from './health.service';

/** Builds a Kysely instance whose driver either answers or fails, without any MySQL. */
function fakeDb(fail: boolean): Kysely<Database> {
  const connection = {
    executeQuery: async () => {
      if (fail) throw new Error('connect ECONNREFUSED');
      return { rows: [] };
    },
    streamQuery: () => {
      throw new Error('not used');
    },
  };
  const driver: Driver = {
    init: async () => undefined,
    acquireConnection: async () => connection,
    beginTransaction: async () => undefined,
    commitTransaction: async () => undefined,
    rollbackTransaction: async () => undefined,
    releaseConnection: async () => undefined,
    destroy: async () => undefined,
  };
  return new Kysely<Database>({
    dialect: {
      createAdapter: () => new MysqlAdapter(),
      createDriver: () => driver,
      createIntrospector: (db) => new MysqlIntrospector(db),
      createQueryCompiler: () => new MysqlQueryCompiler(),
    },
  });
}

describe('HealthService', () => {
  it('reports ok when the database answers', async () => {
    const report = await new HealthService(fakeDb(false)).ready();
    expect(report.status).toBe('ok');
    expect(report.checks.database).toBe('up');
  });

  it('reports degraded (not a crash) when the database is down', async () => {
    const report = await new HealthService(fakeDb(true)).ready();
    expect(report.status).toBe('degraded');
    expect(report.checks.database).toBe('down');
  });

  it('liveness never depends on the database', () => {
    expect(new HealthService(fakeDb(true)).live()).toEqual({ status: 'ok' });
  });
});
