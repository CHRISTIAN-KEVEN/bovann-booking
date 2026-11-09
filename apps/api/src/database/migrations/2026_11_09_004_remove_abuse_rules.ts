/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema types */
import { sql, type Kysely } from 'kysely';

/**
 * Product-owner decision of 2026-11-09: no anti-abuse penalties. Holds are
 * simply released 5 minutes after "Payer" (configurable) or at once on payment
 * failure, and customers may retry freely. Removes what migration 003 added
 * for those rules: the policy table and the client fingerprint.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS t_booking_policy`).execute(db);
  await sql
    .raw(
      `ALTER TABLE t_bookings DROP INDEX ix_bookings_fingerprint, DROP COLUMN client_fingerprint`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE t_bookings
        ADD COLUMN client_fingerprint CHAR(64) NULL AFTER live_description,
        ADD KEY ix_bookings_fingerprint (client_fingerprint, created_at)`,
    )
    .execute(db);
  await sql
    .raw(
      `CREATE TABLE t_booking_policy (
        id TINYINT UNSIGNED NOT NULL,
        max_active_holds_per_client TINYINT UNSIGNED NOT NULL DEFAULT 2,
        unpaid_hold_limit TINYINT UNSIGNED NOT NULL DEFAULT 3,
        unpaid_window_hours SMALLINT UNSIGNED NOT NULL DEFAULT 24,
        cooldown_hours SMALLINT UNSIGNED NOT NULL DEFAULT 24,
        updated_by BIGINT UNSIGNED NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        CONSTRAINT fk_booking_policy_updated_by FOREIGN KEY (updated_by) REFERENCES t_admin_users (id),
        CONSTRAINT chk_booking_policy_single_row CHECK (id = 1),
        CONSTRAINT chk_booking_policy_active CHECK (max_active_holds_per_client BETWEEN 1 AND 10),
        CONSTRAINT chk_booking_policy_unpaid CHECK (unpaid_hold_limit BETWEEN 1 AND 20),
        CONSTRAINT chk_booking_policy_window CHECK (unpaid_window_hours BETWEEN 1 AND 168),
        CONSTRAINT chk_booking_policy_cooldown CHECK (cooldown_hours BETWEEN 1 AND 168)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);
  await sql.raw(`INSERT INTO t_booking_policy (id) VALUES (1)`).execute(db);
}
