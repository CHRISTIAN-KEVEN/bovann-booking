import { NO_MIGRATIONS, type Kysely } from 'kysely';
import { createDb } from '../../src/database/connection';
import { assertMigrationSuccess, createMigrator } from '../../src/database/migrator';
import type { Database } from '../../src/database/schema';
import { seed } from '../../src/database/seed';

export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Integration tests need a disposable MySQL database ' +
        '(see apps/api/.env.example).',
    );
  }
  if (!/test/i.test(url)) {
    throw new Error('DATABASE_URL_TEST must name a test database (its URL must contain "test").');
  }
  return url;
}

/** Drops everything, re-applies all migrations and the seed. */
export async function freshDatabase(): Promise<Kysely<Database>> {
  const db = createDb({ url: testDatabaseUrl(), poolSize: 5 });
  const migrator = createMigrator(db);
  assertMigrationSuccess(await migrator.migrateTo(NO_MIGRATIONS));
  assertMigrationSuccess(await migrator.migrateToLatest());
  await seed(db, ['owner@example.test']);
  return db;
}
