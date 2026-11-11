/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema types */
import { sql, type Kysely } from 'kysely';

/**
 * Live directory: sellers post their live, staff review it during review hours.
 *
 * - t_lives gains the seller who posted it, the review (who, when, message on refusal) and the
 *   status CANCELLED (the seller withdrew a request before review). Every live comes from a
 *   seller or from staff.
 * - t_review_hours: the weekly periods when lives are submitted and reviewed (Lomé time).
 *   Seeded with the example given by the product owner (08:00–11:00 and 15:00–18:00),
 *   Monday to Saturday, until Bovann sets its own.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `ALTER TABLE t_lives
        MODIFY status ENUM('PENDING','APPROVED','REJECTED','CANCELLED','ENDED','REMOVED') NOT NULL DEFAULT 'PENDING',
        ADD COLUMN seller_id BIGINT UNSIGNED NULL AFTER id,
        ADD COLUMN reviewed_by_admin_id BIGINT UNSIGNED NULL AFTER created_by_admin_id,
        ADD COLUMN reviewed_at DATETIME(3) NULL AFTER reviewed_by_admin_id,
        ADD COLUMN reject_reason VARCHAR(255) NULL AFTER reviewed_at,
        ADD KEY ix_lives_seller (seller_id, created_at),
        ADD KEY ix_lives_pending (status, created_at),
        ADD CONSTRAINT fk_lives_seller FOREIGN KEY (seller_id) REFERENCES t_sellers (id),
        ADD CONSTRAINT fk_lives_reviewed_by FOREIGN KEY (reviewed_by_admin_id) REFERENCES t_admin_users (id),
        ADD CONSTRAINT chk_lives_source CHECK (seller_id IS NOT NULL OR created_by_admin_id IS NOT NULL),
        ADD CONSTRAINT chk_lives_rejected CHECK (status <> 'REJECTED' OR (reviewed_at IS NOT NULL AND reject_reason IS NOT NULL))`,
    )
    .execute(db);

  await sql
    .raw(
      `CREATE TABLE t_review_hours (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        weekday TINYINT UNSIGNED NOT NULL,
        opens_at TIME NOT NULL,
        closes_at TIME NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_review_hours (weekday, opens_at),
        CONSTRAINT chk_review_hours_weekday CHECK (weekday BETWEEN 1 AND 7),
        CONSTRAINT chk_review_hours_order CHECK (closes_at > opens_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);

  const periods = [];
  for (let weekday = 1; weekday <= 6; weekday++) {
    periods.push({ weekday, opens_at: '08:00:00', closes_at: '11:00:00' });
    periods.push({ weekday, opens_at: '15:00:00', closes_at: '18:00:00' });
  }
  await db.insertInto('t_review_hours').values(periods).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`DROP TABLE t_review_hours`).execute(db);
  await sql
    .raw(`DELETE FROM t_lives WHERE seller_id IS NOT NULL OR status = 'CANCELLED'`)
    .execute(db);
  await sql
    .raw(
      `ALTER TABLE t_lives
        DROP CHECK chk_lives_rejected,
        DROP CHECK chk_lives_source,
        DROP FOREIGN KEY fk_lives_reviewed_by,
        DROP FOREIGN KEY fk_lives_seller,
        DROP KEY ix_lives_pending,
        DROP KEY ix_lives_seller,
        DROP COLUMN reject_reason,
        DROP COLUMN reviewed_at,
        DROP COLUMN reviewed_by_admin_id,
        DROP COLUMN seller_id,
        MODIFY status ENUM('PENDING','APPROVED','REJECTED','ENDED','REMOVED') NOT NULL DEFAULT 'PENDING'`,
    )
    .execute(db);
}
