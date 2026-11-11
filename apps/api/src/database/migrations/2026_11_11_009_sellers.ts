/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema types */
import { sql, type Kysely } from 'kysely';

/**
 * Sellers of the live directory sign in with a one-time code sent to their phone
 * (product-owner decision of 2026-11-10: phone + code by WhatsApp or SMS, no password).
 *
 * - t_sellers: one per phone number, created at the first successful sign-in.
 * - t_seller_otps: codes sent. Only a keyed hash of the code is stored. A code works once,
 *   for 10 minutes, with at most 5 tries; only the phone's latest code counts.
 * - t_seller_sessions: signed-in devices (hash of the cookie token), like admin sessions.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `CREATE TABLE t_sellers (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        phone_e164 VARCHAR(16) NOT NULL,
        locale CHAR(2) NOT NULL DEFAULT 'fr',
        blocked_at DATETIME(3) NULL,
        blocked_reason VARCHAR(255) NULL,
        last_sign_in_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_sellers_phone (phone_e164),
        CONSTRAINT chk_sellers_phone CHECK (REGEXP_LIKE(phone_e164, '^[+][1-9][0-9]{6,14}$')),
        CONSTRAINT chk_sellers_locale CHECK (locale IN ('fr','en'))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);

  await sql
    .raw(
      `CREATE TABLE t_seller_otps (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        phone_e164 VARCHAR(16) NOT NULL,
        channel ENUM('WHATSAPP','SMS') NOT NULL,
        code_hash CHAR(64) NOT NULL,
        attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
        expires_at DATETIME(3) NOT NULL,
        consumed_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY ix_seller_otps_phone (phone_e164, created_at),
        CONSTRAINT chk_seller_otps_phone CHECK (REGEXP_LIKE(phone_e164, '^[+][1-9][0-9]{6,14}$')),
        CONSTRAINT chk_seller_otps_expiry CHECK (expires_at > created_at),
        CONSTRAINT chk_seller_otps_attempts CHECK (attempts <= 10)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);

  await sql
    .raw(
      `CREATE TABLE t_seller_sessions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        seller_id BIGINT UNSIGNED NOT NULL,
        token_hash CHAR(64) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        last_seen_at DATETIME(3) NOT NULL,
        expires_at DATETIME(3) NOT NULL,
        revoked_at DATETIME(3) NULL,
        user_agent VARCHAR(255) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_seller_sessions_token (token_hash),
        KEY ix_seller_sessions_seller (seller_id, revoked_at),
        CONSTRAINT fk_seller_sessions_seller FOREIGN KEY (seller_id) REFERENCES t_sellers (id) ON DELETE CASCADE,
        CONSTRAINT chk_seller_sessions_expiry CHECK (expires_at > created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`DROP TABLE t_seller_sessions`).execute(db);
  await sql.raw(`DROP TABLE t_seller_otps`).execute(db);
  await sql.raw(`DROP TABLE t_sellers`).execute(db);
}
