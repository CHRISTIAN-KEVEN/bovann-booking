/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema types */
import { sql, type Kysely } from 'kysely';

/**
 * French and English (product-owner decision of 2026-11-10).
 * - English names for spaces and packages, entered by the admin; French is shown when empty.
 * - Each booking remembers the language it was made in, for the customer's emails and receipt,
 *   and keeps the package's English name as it was when booked (like the French one).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`ALTER TABLE t_spaces ADD COLUMN name_en VARCHAR(120) NULL AFTER name`).execute(db);
  await sql
    .raw(
      `ALTER TABLE t_packages
        ADD COLUMN name_en VARCHAR(120) NULL AFTER name,
        ADD COLUMN description_en VARCHAR(500) NULL AFTER description`,
    )
    .execute(db);
  await sql
    .raw(
      `ALTER TABLE t_bookings
        ADD COLUMN locale CHAR(2) NOT NULL DEFAULT 'fr' AFTER source,
        ADD COLUMN package_name_en VARCHAR(120) NULL AFTER package_name,
        ADD CONSTRAINT ck_bookings_locale CHECK (locale IN ('fr', 'en'))`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE t_bookings
        DROP CHECK ck_bookings_locale,
        DROP COLUMN package_name_en,
        DROP COLUMN locale`,
    )
    .execute(db);
  await sql
    .raw(`ALTER TABLE t_packages DROP COLUMN description_en, DROP COLUMN name_en`)
    .execute(db);
  await sql.raw(`ALTER TABLE t_spaces DROP COLUMN name_en`).execute(db);
}
