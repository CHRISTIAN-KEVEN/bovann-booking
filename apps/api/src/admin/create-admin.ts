/* eslint-disable no-console -- command-line tool */
/**
 * Creates an administrator account from the command line (first account on a
 * new installation, or recovery if every administrator is locked out):
 *
 *   pnpm --filter @bovann/api admin:create -- --email owner@bovann.tg --name "Prénom Nom"
 *
 * Prints a temporary password once; it must be changed at the first sign-in.
 * If the email already exists, its password is reset and the account is made
 * an active administrator.
 */
import { parseArgs } from 'node:util';
import { createDb } from '../database/connection';
import { loadEnv } from '../config/env';
import { generateTemporaryPassword, hashPassword } from './auth/passwords';

async function main(): Promise<void> {
  // `pnpm admin:create -- --email …` passes the `--` through; accept it as well as the plain form.
  const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
  const { values } = parseArgs({
    args,
    options: { email: { type: 'string' }, name: { type: 'string' } },
  });
  const email = values.email?.trim().toLowerCase();
  const name = values.name?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name) {
    console.error('Usage: admin:create --email <email> --name "<full name>"');
    process.exit(1);
  }

  const env = loadEnv();
  const db = createDb({ url: env.DATABASE_URL, poolSize: 1 });
  try {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const existing = await db
      .selectFrom('t_admin_users')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirst();
    await db.transaction().execute(async (trx) => {
      let id = existing?.id;
      if (id) {
        await trx
          .updateTable('t_admin_users')
          .set({
            full_name: name,
            role: 'OWNER',
            is_active: true,
            password_hash: passwordHash,
            must_change_password: true,
            failed_login_count: 0,
            locked_until: null,
          })
          .where('id', '=', id)
          .execute();
        await trx
          .updateTable('t_admin_sessions')
          .set({ revoked_at: new Date() })
          .where('admin_user_id', '=', id)
          .where('revoked_at', 'is', null)
          .execute();
      } else {
        const result = await trx
          .insertInto('t_admin_users')
          .values({
            email,
            full_name: name,
            role: 'OWNER',
            password_hash: passwordHash,
            must_change_password: true,
          })
          .executeTakeFirstOrThrow();
        id = Number(result.insertId);
      }
      await trx
        .insertInto('t_audit_log')
        .values({
          actor_type: 'SYSTEM',
          action: existing ? 'ADMIN_RESET_FROM_CLI' : 'ADMIN_CREATED_FROM_CLI',
          entity: 'admin_user',
          entity_id: String(id),
        })
        .execute();
    });
    console.log(
      `${existing ? 'Password reset for' : 'Administrator created:'} ${email}\n` +
        `Temporary password (shown once, must be changed at first sign-in): ${temporaryPassword}`,
    );
  } finally {
    await db.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
