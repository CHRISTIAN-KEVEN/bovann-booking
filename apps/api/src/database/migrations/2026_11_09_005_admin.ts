/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema types */
import { sql, type Kysely } from 'kysely';

/**
 * Phase 5 (admin), decisions of 2026-11-09:
 * - Admins sign in with email + password. Sessions live in the database (not
 *   in a self-contained token) so logout, deactivation and password changes
 *   end them at once. Only the SHA-256 of the session token is stored.
 * - Accounts lock for a while after repeated wrong passwords; an admin-set
 *   temporary password must be changed at the next sign-in.
 * - The studio can add bookings itself (phone, walk-in) with the payment noted
 *   (cash, mobile money received directly, bank transfer, free or unpaid).
 * - Cancelling a paid booking marks a refund "to handle"; the studio refunds
 *   by hand and then marks it done (automatic refunds come with Phase 4).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE t_admin_users
        ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active,
        ADD COLUMN failed_login_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER must_change_password,
        ADD COLUMN locked_until DATETIME(3) NULL AFTER failed_login_count,
        ADD COLUMN password_changed_at DATETIME(3) NULL AFTER locked_until`,
    )
    .execute(db);

  await sql
    .raw(
      `CREATE TABLE t_admin_sessions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        admin_user_id BIGINT UNSIGNED NOT NULL,
        token_hash CHAR(64) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        last_seen_at DATETIME(3) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        revoked_at DATETIME(3) NULL,
        ip VARCHAR(45) NULL,
        user_agent VARCHAR(255) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_admin_sessions_token (token_hash),
        KEY ix_admin_sessions_user (admin_user_id, revoked_at),
        CONSTRAINT fk_admin_sessions_user FOREIGN KEY (admin_user_id) REFERENCES t_admin_users (id) ON DELETE CASCADE,
        CONSTRAINT chk_admin_sessions_expiry CHECK (expires_at > created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);

  await sql
    .raw(
      `ALTER TABLE t_bookings
        ADD COLUMN source ENUM('ONLINE','ADMIN') NOT NULL DEFAULT 'ONLINE' AFTER status,
        ADD COLUMN created_by_admin_id BIGINT UNSIGNED NULL AFTER source,
        ADD COLUMN cancelled_by_admin_id BIGINT UNSIGNED NULL AFTER cancel_reason,
        ADD COLUMN admin_note VARCHAR(1000) NULL AFTER live_description,
        ADD COLUMN refund_status ENUM('NONE','DUE','DONE') NOT NULL DEFAULT 'NONE' AFTER cancelled_by_admin_id,
        ADD COLUMN refund_amount_xof INT UNSIGNED NULL AFTER refund_status,
        ADD COLUMN refunded_at DATETIME(3) NULL AFTER refund_amount_xof,
        ADD COLUMN refunded_by_admin_id BIGINT UNSIGNED NULL AFTER refunded_at,
        ADD COLUMN refund_note VARCHAR(255) NULL AFTER refunded_by_admin_id,
        ADD KEY ix_bookings_refund (refund_status, cancelled_at),
        ADD KEY ix_bookings_status_start (status, starts_at),
        ADD CONSTRAINT fk_bookings_created_by FOREIGN KEY (created_by_admin_id) REFERENCES t_admin_users (id),
        ADD CONSTRAINT fk_bookings_cancelled_by FOREIGN KEY (cancelled_by_admin_id) REFERENCES t_admin_users (id),
        ADD CONSTRAINT fk_bookings_refunded_by FOREIGN KEY (refunded_by_admin_id) REFERENCES t_admin_users (id),
        ADD CONSTRAINT chk_bookings_source CHECK (source = 'ONLINE' OR created_by_admin_id IS NOT NULL),
        ADD CONSTRAINT chk_bookings_refund CHECK (
          (refund_status = 'NONE' AND refund_amount_xof IS NULL) OR
          (refund_status IN ('DUE','DONE') AND refund_amount_xof IS NOT NULL AND refund_amount_xof > 0)
        ),
        ADD CONSTRAINT chk_bookings_refund_done CHECK (refund_status <> 'DONE' OR refunded_at IS NOT NULL),
        ADD CONSTRAINT chk_bookings_refunded_status CHECK (status <> 'REFUNDED' OR refund_status = 'DONE')`,
    )
    .execute(db);

  await sql
    .raw(
      `ALTER TABLE t_payments
        MODIFY COLUMN method ENUM('MOBILE_MONEY','CARD','CASH','BANK_TRANSFER','OTHER') NOT NULL,
        ADD COLUMN recorded_by_admin_id BIGINT UNSIGNED NULL AFTER succeeded_at,
        ADD COLUMN note VARCHAR(255) NULL AFTER recorded_by_admin_id,
        ADD KEY ix_payments_succeeded (status, succeeded_at),
        ADD CONSTRAINT fk_payments_recorded_by FOREIGN KEY (recorded_by_admin_id) REFERENCES t_admin_users (id)`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE t_payments
        DROP FOREIGN KEY fk_payments_recorded_by,
        DROP KEY ix_payments_succeeded,
        DROP COLUMN note,
        DROP COLUMN recorded_by_admin_id`,
    )
    .execute(db);
  await sql
    .raw(`DELETE FROM t_payments WHERE method IN ('CASH','BANK_TRANSFER','OTHER')`)
    .execute(db);
  await sql
    .raw(`ALTER TABLE t_payments MODIFY COLUMN method ENUM('MOBILE_MONEY','CARD') NOT NULL`)
    .execute(db);

  await sql
    .raw(
      `ALTER TABLE t_bookings
        DROP CHECK chk_bookings_refunded_status,
        DROP CHECK chk_bookings_refund_done,
        DROP CHECK chk_bookings_refund,
        DROP CHECK chk_bookings_source,
        DROP FOREIGN KEY fk_bookings_refunded_by,
        DROP FOREIGN KEY fk_bookings_cancelled_by,
        DROP FOREIGN KEY fk_bookings_created_by,
        DROP KEY ix_bookings_status_start,
        DROP KEY ix_bookings_refund,
        DROP COLUMN refund_note,
        DROP COLUMN refunded_by_admin_id,
        DROP COLUMN refunded_at,
        DROP COLUMN refund_amount_xof,
        DROP COLUMN refund_status,
        DROP COLUMN admin_note,
        DROP COLUMN cancelled_by_admin_id,
        DROP COLUMN created_by_admin_id,
        DROP COLUMN source`,
    )
    .execute(db);

  await sql.raw(`DROP TABLE t_admin_sessions`).execute(db);
  await sql
    .raw(
      `ALTER TABLE t_admin_users
        DROP COLUMN password_changed_at,
        DROP COLUMN locked_until,
        DROP COLUMN failed_login_count,
        DROP COLUMN must_change_password`,
    )
    .execute(db);
}
