/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema types */
import { sql, type Kysely } from 'kysely';

/**
 * "Mes réservations" (product-owner decision of 2026-11-09, no customer accounts): a customer can
 * find a booking from another device with its reference and phone number. Each successful lookup
 * issues a new access token for that device, so the token held by the device that booked keeps
 * working (`t_bookings.access_token_hash` stays the first token). Only SHA-256 hashes are stored.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `CREATE TABLE t_booking_access_tokens (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        booking_id BIGINT UNSIGNED NOT NULL,
        token_hash CHAR(64) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_booking_access_tokens_hash (token_hash),
        KEY ix_booking_access_tokens_booking (booking_id),
        CONSTRAINT fk_booking_access_tokens_booking FOREIGN KEY (booking_id) REFERENCES t_bookings (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS t_booking_access_tokens`).execute(db);
}
