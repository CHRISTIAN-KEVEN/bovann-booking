/* eslint-disable no-console */
import { loadEnv } from '../config/env';
import { createDb } from './connection';
import { assertMigrationSuccess, createMigrator } from './migrator';

/**
 * Usage: tsx src/database/cli.ts <latest|down|reset|status>
 *  - latest: apply every pending migration
 *  - down:   roll back the most recent migration
 *  - reset:  roll back everything (refused in production)
 *  - status: list migrations and whether they have run
 */
async function main(): Promise<void> {
  const command = process.argv[2] ?? 'latest';
  const env = loadEnv();
  const db = createDb({ url: env.DATABASE_URL, poolSize: 1 });
  const migrator = createMigrator(db);

  try {
    switch (command) {
      case 'latest': {
        const result = await migrator.migrateToLatest();
        report(result.results);
        assertMigrationSuccess(result);
        break;
      }
      case 'down': {
        const result = await migrator.migrateDown();
        report(result.results);
        assertMigrationSuccess(result);
        break;
      }
      case 'reset': {
        if (env.NODE_ENV === 'production') {
          throw new Error('Refusing to reset the database in production.');
        }
        const { NO_MIGRATIONS } = await import('kysely');
        const result = await migrator.migrateTo(NO_MIGRATIONS);
        report(result.results);
        assertMigrationSuccess(result);
        break;
      }
      case 'status': {
        const list = await migrator.getMigrations();
        for (const migration of list) {
          const state = migration.executedAt
            ? `applied ${migration.executedAt.toISOString()}`
            : 'pending';
          console.log(`${migration.name}  ${state}`);
        }
        break;
      }
      default:
        throw new Error(`Unknown command "${command}". Use latest, down, reset or status.`);
    }
  } finally {
    await db.destroy();
  }
}

function report(
  results: { migrationName: string; direction: string; status: string }[] | undefined,
) {
  if (!results?.length) {
    console.log('Nothing to do: database is up to date.');
    return;
  }
  for (const r of results) {
    console.log(
      `${r.status === 'Success' ? '✓' : '✗'} ${r.direction.toLowerCase()} ${r.migrationName}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
