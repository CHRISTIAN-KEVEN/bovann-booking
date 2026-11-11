import { Migrator, type Kysely, type Migration, type MigrationResultSet } from 'kysely';
import * as initialSchema from './migrations/2026_11_08_001_initial_schema';
import * as fewSlotsThreshold from './migrations/2026_11_08_002_space_few_slots_threshold';
import * as bookingHolds from './migrations/2026_11_09_003_booking_holds_and_abuse_policy';
import * as removeAbuseRules from './migrations/2026_11_09_004_remove_abuse_rules';
import * as admin from './migrations/2026_11_09_005_admin';
import * as bookingAccessTokens from './migrations/2026_11_09_006_booking_access_tokens';
import * as english from './migrations/2026_11_10_007_english';
import * as lives from './migrations/2026_11_10_008_lives';
import * as sellers from './migrations/2026_11_11_009_sellers';
import * as livePosting from './migrations/2026_11_11_010_live_posting';

/**
 * Migrations are registered explicitly (not discovered from the file system),
 * so the same list works from TypeScript sources and from the compiled build.
 * Names sort chronologically; never rename or edit a migration once it has run
 * in staging or production: add a new one instead.
 */
const migrations: Record<string, Migration> = {
  '2026_11_08_001_initial_schema': initialSchema,
  '2026_11_08_002_space_few_slots_threshold': fewSlotsThreshold,
  '2026_11_09_003_booking_holds_and_abuse_policy': bookingHolds,
  '2026_11_09_004_remove_abuse_rules': removeAbuseRules,
  '2026_11_09_005_admin': admin,
  '2026_11_09_006_booking_access_tokens': bookingAccessTokens,
  '2026_11_10_007_english': english,
  '2026_11_10_008_lives': lives,
  '2026_11_11_009_sellers': sellers,
  '2026_11_11_010_live_posting': livePosting,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the migrator works on any schema
export function createMigrator(db: Kysely<any>): Migrator {
  return new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
    migrationTableName: 't_schema_migrations',
    migrationLockTableName: 't_schema_migrations_lock',
  });
}

/** Throws with a readable message if any migration failed. */
export function assertMigrationSuccess({ error, results }: MigrationResultSet): void {
  const failed = results?.find((result) => result.status === 'Error');
  if (error || failed) {
    const name = failed ? ` (${failed.migrationName})` : '';
    const cause = error instanceof Error ? error.message : String(error ?? 'unknown error');
    throw new Error(`Migration failed${name}: ${cause}`);
  }
}
