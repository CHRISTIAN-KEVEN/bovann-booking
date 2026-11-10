/* eslint-disable no-console */
import { sql, type Kysely } from 'kysely';
import { loadEnv } from '../config/env';
import { createDb } from './connection';
import type { Database } from './schema';

/**
 * Seeds the reference data agreed with the product owner (2026-11-08).
 * Idempotent: running it again updates the seed rows instead of duplicating them.
 * It never touches bookings, customers or payments.
 *
 * Opening hours 08:00–21:30 every day are an ASSUMPTION still to be confirmed.
 * Owner notification recipients come from SEED_OWNER_EMAILS (comma-separated);
 * no address is invented.
 */

export const SEED_SPACE = {
  slug: 'studio-principal-lome',
  name: 'Studio principal — Lomé',
  name_en: 'Main studio — Lomé',
  address: null,
  timezone: 'Africa/Lome',
  slot_duration_min: 90,
} as const;

export const SEED_OPENING = { opens_at: '08:00:00', closes_at: '21:30:00' } as const;

export const SEED_PACKAGES = [
  {
    code: 'SLOT',
    name: 'Créneau unique',
    name_en: 'Single slot',
    slot_count: 1,
    is_full_day: false,
    price_xof: 15000,
    sort_order: 10,
  },
  {
    code: 'PACK_3H',
    name: 'Pack 3h',
    name_en: '3h package',
    slot_count: 2,
    is_full_day: false,
    price_xof: 27000,
    sort_order: 20,
  },
  {
    code: 'PACK_6H',
    name: 'Pack 6h',
    name_en: '6h package',
    slot_count: 4,
    is_full_day: false,
    price_xof: 51000,
    sort_order: 30,
  },
  {
    code: 'FULL_DAY',
    name: 'Journée',
    name_en: 'Full day',
    slot_count: null,
    is_full_day: true,
    price_xof: 108000,
    sort_order: 40,
  },
] as const;

const MODES = ['IN_PERSON', 'VIRTUAL'] as const;

export async function seed(db: Kysely<Database>, ownerEmails: string[] = []): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('t_spaces')
      .values(SEED_SPACE)
      .onDuplicateKeyUpdate({
        name: SEED_SPACE.name,
        // Keep an English name the admin has already changed.
        name_en: sql<string>`COALESCE(name_en, ${SEED_SPACE.name_en})`,
        timezone: SEED_SPACE.timezone,
      })
      .execute();

    const space = await trx
      .selectFrom('t_spaces')
      .select('id')
      .where('slug', '=', SEED_SPACE.slug)
      .executeTakeFirstOrThrow();

    for (let weekday = 1; weekday <= 7; weekday++) {
      await trx
        .insertInto('t_opening_hours')
        .values({ space_id: space.id, weekday, is_open: true, ...SEED_OPENING })
        .onDuplicateKeyUpdate({ ...SEED_OPENING, is_open: true })
        .execute();
    }

    for (const email of ownerEmails) {
      await trx
        .insertInto('t_space_owner_recipients')
        .values({ space_id: space.id, email })
        .onDuplicateKeyUpdate({ is_active: true })
        .execute();
    }

    for (const pkg of SEED_PACKAGES) {
      await trx
        .insertInto('t_packages')
        .values({
          space_id: space.id,
          code: pkg.code,
          name: pkg.name,
          name_en: pkg.name_en,
          slot_count: pkg.slot_count,
          is_full_day: pkg.is_full_day,
          sort_order: pkg.sort_order,
        })
        .onDuplicateKeyUpdate({
          name: pkg.name,
          name_en: sql<string>`COALESCE(name_en, ${pkg.name_en})`,
          sort_order: pkg.sort_order,
        })
        .execute();

      const row = await trx
        .selectFrom('t_packages')
        .select('id')
        .where('space_id', '=', space.id)
        .where('code', '=', pkg.code)
        .executeTakeFirstOrThrow();

      // Only create a price when none is current: an admin's later price change wins.
      for (const mode of MODES) {
        const current = await trx
          .selectFrom('t_package_prices')
          .select('id')
          .where('package_id', '=', row.id)
          .where('mode', '=', mode)
          .where('valid_to', 'is', null)
          .executeTakeFirst();
        if (!current) {
          await trx
            .insertInto('t_package_prices')
            .values({
              package_id: row.id,
              mode,
              price_xof: pkg.price_xof,
              valid_from: sql<Date>`CURRENT_TIMESTAMP(3)`,
            })
            .execute();
        }
      }
    }
  });
}

async function main(): Promise<void> {
  const env = loadEnv();
  const ownerEmails = (process.env.SEED_OWNER_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const db = createDb({ url: env.DATABASE_URL, poolSize: 1 });
  try {
    await seed(db, ownerEmails);
    console.log(
      `Seed applied: 1 space, 7 opening days, ${SEED_PACKAGES.length} packages × 2 modes` +
        (ownerEmails.length
          ? `, ${ownerEmails.length} owner recipient(s)`
          : ', no owner recipients'),
    );
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
