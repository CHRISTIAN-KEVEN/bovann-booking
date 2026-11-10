/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema types */
import { sql, type Kysely } from 'kysely';

/**
 * Live directory "En direct" (product-owner decisions of 2026-11-10), first part: the wall.
 *
 * - t_categories: one list of business categories in French and English, with the icon the
 *   site draws. Lives use it now; the booking form moves to it with the categories work.
 *   "Autre" is not a row: a live then has no category_id and keeps the typed text instead.
 * - t_lives: a live listed on the wall. It is visible while APPROVED and
 *   starts_at <= now < ends_at, so an expired listing disappears without any job running.
 *   Sellers' own accounts and posting (PENDING → review) come next; for now staff list lives
 *   for sellers (created_by_admin_id).
 */
const CATEGORIES: Array<[string, string, string, string, number]> = [
  ['MODE', 'Mode', 'Fashion', 'mode', 10],
  ['BEAUTE', 'Beauté', 'Beauty', 'beaute', 20],
  ['ALIMENTATION', 'Alimentation', 'Food & drinks', 'food', 30],
  ['ELECTRONIQUE', 'Téléphones & électronique', 'Phones & electronics', 'elec', 40],
  ['MAISON', 'Maison & déco', 'Home & decor', 'maison', 50],
  ['SANTE', 'Santé & bien-être', 'Health & wellness', 'sante', 60],
  ['SERVICES', 'Services', 'Services', 'services', 70],
  ['EVENEMENTIEL', 'Événementiel', 'Events', 'event', 80],
];

export async function up(db: Kysely<any>): Promise<void> {
  await sql
    .raw(
      `CREATE TABLE t_categories (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        code VARCHAR(40) NOT NULL,
        name_fr VARCHAR(60) NOT NULL,
        name_en VARCHAR(60) NOT NULL,
        icon ENUM('mode','beaute','food','elec','maison','sante','services','event','autre') NOT NULL DEFAULT 'autre',
        sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 100,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_categories_code (code),
        CONSTRAINT chk_categories_code CHECK (REGEXP_LIKE(code, '^[A-Z0-9_]{2,40}$', 'c')),
        CONSTRAINT chk_categories_names CHECK (CHAR_LENGTH(TRIM(name_fr)) > 0 AND CHAR_LENGTH(TRIM(name_en)) > 0)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);

  await db
    .insertInto('t_categories')
    .values(
      CATEGORIES.map(([code, nameFr, nameEn, icon, sort]) => ({
        code,
        name_fr: nameFr,
        name_en: nameEn,
        icon,
        sort_order: sort,
      })),
    )
    .execute();

  await sql
    .raw(
      `CREATE TABLE t_lives (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        seller_name VARCHAR(60) NOT NULL,
        platform ENUM('TIKTOK','FACEBOOK') NOT NULL,
        url VARCHAR(500) NOT NULL,
        country_code CHAR(2) NOT NULL,
        category_id BIGINT UNSIGNED NULL,
        category_other VARCHAR(40) NULL,
        duration_min SMALLINT UNSIGNED NOT NULL,
        status ENUM('PENDING','APPROVED','REJECTED','ENDED','REMOVED') NOT NULL DEFAULT 'PENDING',
        starts_at DATETIME(3) NULL,
        ends_at DATETIME(3) NULL,
        created_by_admin_id BIGINT UNSIGNED NULL,
        ended_at DATETIME(3) NULL,
        ended_by_admin_id BIGINT UNSIGNED NULL,
        end_reason VARCHAR(255) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        KEY ix_lives_wall (status, ends_at, starts_at),
        KEY ix_lives_created (created_at),
        KEY ix_lives_url (url(191)),
        CONSTRAINT fk_lives_category FOREIGN KEY (category_id) REFERENCES t_categories (id),
        CONSTRAINT fk_lives_created_by FOREIGN KEY (created_by_admin_id) REFERENCES t_admin_users (id),
        CONSTRAINT fk_lives_ended_by FOREIGN KEY (ended_by_admin_id) REFERENCES t_admin_users (id),
        CONSTRAINT chk_lives_seller_name CHECK (CHAR_LENGTH(seller_name) BETWEEN 2 AND 60),
        CONSTRAINT chk_lives_url CHECK (url LIKE 'https://%'),
        CONSTRAINT chk_lives_country CHECK (REGEXP_LIKE(country_code, '^[A-Z]{2}$', 'c')),
        CONSTRAINT chk_lives_category CHECK (
          (category_id IS NOT NULL AND category_other IS NULL) OR
          (category_id IS NULL AND category_other IS NOT NULL AND CHAR_LENGTH(category_other) BETWEEN 2 AND 40)
        ),
        CONSTRAINT chk_lives_duration CHECK (duration_min BETWEEN 15 AND 720),
        CONSTRAINT chk_lives_listed CHECK (
          status NOT IN ('APPROVED','ENDED','REMOVED') OR
          (starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at)
        ),
        CONSTRAINT chk_lives_ended CHECK (status NOT IN ('ENDED','REMOVED') OR ended_at IS NOT NULL)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
    )
    .execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql.raw(`DROP TABLE t_lives`).execute(db);
  await sql.raw(`DROP TABLE t_categories`).execute(db);
}
