/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema types */
import { sql, type Kysely } from 'kysely';

/**
 * Phase 2: per-space threshold under which a day shows as "presque complet"
 * in the month calendar (agreed default: 3 slots left or fewer).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE t_spaces
        ADD COLUMN few_slots_threshold TINYINT UNSIGNED NOT NULL DEFAULT 3 AFTER hold_duration_min,
        ADD CONSTRAINT chk_spaces_few_slots CHECK (few_slots_threshold <= 50)`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql
    .raw(`ALTER TABLE t_spaces DROP CHECK chk_spaces_few_slots, DROP COLUMN few_slots_threshold`)
    .execute(db);
}
