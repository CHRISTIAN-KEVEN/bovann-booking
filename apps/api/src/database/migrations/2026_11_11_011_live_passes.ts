/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema types */
import { sql, type Kysely } from 'kysely';

/**
 * Live directory: passes (product-owner decision of 2026-11-12: posting a live needs a pass
 * in force; paying for a single live is switched off for now).
 *
 * - t_live_prices: one row, set by administrators. A year costs less than 12 months.
 * - t_seller_passes: 30 or 365 days, prepaid; bought ahead, a pass starts when the previous ends.
 *   Paid online (payment_id) or activated by staff after cash (granted_by_admin_id).
 * - t_seller_payments: online payment attempts for a pass (the simulated provider until Phase 4).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `CREATE TABLE t_live_prices (
        id TINYINT UNSIGNED NOT NULL,
        pass_month_xof INT UNSIGNED NOT NULL,
        pass_year_xof INT UNSIGNED NOT NULL,
        updated_by_admin_id BIGINT UNSIGNED NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        CONSTRAINT fk_live_prices_admin FOREIGN KEY (updated_by_admin_id) REFERENCES t_admin_users (id),
        CONSTRAINT chk_live_prices_single CHECK (id = 1),
        CONSTRAINT chk_live_prices_positive CHECK (pass_month_xof > 0 AND pass_year_xof > 0),
        CONSTRAINT chk_live_prices_year CHECK (pass_year_xof < pass_month_xof * 12)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);
  // Example prices from the requirements, until Bovann sets its own.
  await db
    .insertInto('t_live_prices')
    .values({ id: 1, pass_month_xof: 10_000, pass_year_xof: 100_000 })
    .execute();

  await sql
    .raw(
      `CREATE TABLE t_seller_payments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        seller_id BIGINT UNSIGNED NOT NULL,
        purpose ENUM('PASS_MONTH','PASS_YEAR') NOT NULL,
        amount_xof INT UNSIGNED NOT NULL,
        method ENUM('MOBILE_MONEY','CARD') NOT NULL,
        channel VARCHAR(20) NULL,
        payer_phone VARCHAR(16) NULL,
        status ENUM('PENDING','SUCCEEDED','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
        provider VARCHAR(20) NOT NULL,
        provider_ref VARCHAR(100) NULL,
        idempotency_key CHAR(36) NOT NULL,
        instructions VARCHAR(500) NULL,
        failure_reason VARCHAR(255) NULL,
        created_at DATETIME(3) NOT NULL,
        completed_at DATETIME(3) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_seller_payments_idempotency (idempotency_key),
        KEY ix_seller_payments_seller (seller_id, created_at),
        CONSTRAINT fk_seller_payments_seller FOREIGN KEY (seller_id) REFERENCES t_sellers (id),
        CONSTRAINT chk_seller_payments_amount CHECK (amount_xof > 0),
        CONSTRAINT chk_seller_payments_momo CHECK (method <> 'MOBILE_MONEY' OR (channel IS NOT NULL AND payer_phone IS NOT NULL)),
        CONSTRAINT chk_seller_payments_done CHECK (status = 'PENDING' OR completed_at IS NOT NULL)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);

  await sql
    .raw(
      `CREATE TABLE t_seller_passes (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        seller_id BIGINT UNSIGNED NOT NULL,
        plan ENUM('MONTH','YEAR') NOT NULL,
        starts_at DATETIME(3) NOT NULL,
        ends_at DATETIME(3) NOT NULL,
        price_xof INT UNSIGNED NOT NULL,
        payment_id BIGINT UNSIGNED NULL,
        granted_by_admin_id BIGINT UNSIGNED NULL,
        note VARCHAR(255) NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_seller_passes_payment (payment_id),
        KEY ix_seller_passes_seller (seller_id, ends_at),
        CONSTRAINT fk_seller_passes_seller FOREIGN KEY (seller_id) REFERENCES t_sellers (id),
        CONSTRAINT fk_seller_passes_payment FOREIGN KEY (payment_id) REFERENCES t_seller_payments (id),
        CONSTRAINT fk_seller_passes_admin FOREIGN KEY (granted_by_admin_id) REFERENCES t_admin_users (id),
        CONSTRAINT chk_seller_passes_period CHECK (ends_at > starts_at),
        CONSTRAINT chk_seller_passes_source CHECK ((payment_id IS NULL) <> (granted_by_admin_id IS NULL))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`DROP TABLE t_seller_passes`).execute(db);
  await sql.raw(`DROP TABLE t_seller_payments`).execute(db);
  await sql.raw(`DROP TABLE t_live_prices`).execute(db);
}
