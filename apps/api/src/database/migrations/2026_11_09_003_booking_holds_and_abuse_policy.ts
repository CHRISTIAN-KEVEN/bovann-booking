/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema types */
import { sql, type Kysely } from 'kysely';

/**
 * Phase 3a, decisions of 2026-11-08:
 * - Payment holds last 5 minutes by default; admins may set 2–15 minutes.
 * - Anti-abuse limits live in a single-row policy table (typed, DB-checked,
 *   editable from the admin in Phase 5).
 * - Bookings record an anonymous client fingerprint (HMAC of the IP address,
 *   never the IP itself) to count unpaid holds per connection, and the hash of
 *   the secret access token given to the customer to follow their booking.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `UPDATE t_spaces SET hold_duration_min = 5
       WHERE hold_duration_min = 10 OR hold_duration_min NOT BETWEEN 2 AND 15`,
    )
    .execute(db);
  await sql
    .raw(
      `ALTER TABLE t_spaces
        DROP CHECK chk_spaces_hold,
        ALTER COLUMN hold_duration_min SET DEFAULT 5,
        ADD CONSTRAINT chk_spaces_hold CHECK (hold_duration_min BETWEEN 2 AND 15)`,
    )
    .execute(db);

  await sql
    .raw(
      `ALTER TABLE t_bookings
        ADD COLUMN client_fingerprint CHAR(64) NULL AFTER live_description,
        ADD COLUMN access_token_hash CHAR(64) NULL AFTER client_fingerprint,
        ADD KEY ix_bookings_fingerprint (client_fingerprint, created_at),
        ADD KEY ix_bookings_customer_status (customer_id, status, created_at),
        ADD UNIQUE KEY uq_bookings_access_token (access_token_hash)`,
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

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS t_booking_policy`).execute(db);
  await sql
    .raw(
      `ALTER TABLE t_bookings
        DROP INDEX uq_bookings_access_token,
        DROP INDEX ix_bookings_customer_status,
        DROP INDEX ix_bookings_fingerprint,
        DROP COLUMN access_token_hash,
        DROP COLUMN client_fingerprint`,
    )
    .execute(db);
  await sql
    .raw(
      `ALTER TABLE t_spaces
        DROP CHECK chk_spaces_hold,
        ALTER COLUMN hold_duration_min SET DEFAULT 10,
        ADD CONSTRAINT chk_spaces_hold CHECK (hold_duration_min BETWEEN 1 AND 60)`,
    )
    .execute(db);
}
