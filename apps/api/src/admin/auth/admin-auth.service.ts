import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AdminMe, AdminRole } from '@bovann/shared';
import type { Kysely } from 'kysely';
import { CLOCK, type Clock } from '../../common/clock';
import { ApiError, badRequest } from '../../common/errors';
import { DB } from '../../database/database.module';
import type { Database } from '../../database/schema';
import { auditAdmin } from '../admin-audit';
import {
  dummyPasswordHash,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  passwordProblem,
  verifyPassword,
} from './passwords';

/** A session ends after this long without activity… */
export const SESSION_IDLE_MS = 12 * 60 * 60_000;
/** …and in any case this long after sign-in. */
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60_000;
/** Consecutive wrong passwords before the account locks. */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_DURATION_MS = 15 * 60_000;
/** last_seen_at is refreshed at most this often (avoids a write per request). */
const TOUCH_INTERVAL_MS = 5 * 60_000;

/** The signed-in admin, attached to each authenticated request. */
export interface AdminPrincipal {
  id: number;
  email: string;
  fullName: string;
  role: AdminRole;
  mustChangePassword: boolean;
  sessionId: number;
}

const INVALID_CREDENTIALS = () =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'E-mail ou mot de passe incorrect.');

@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Checks the credentials and opens a session. Returns the raw token for the cookie. */
  async login(
    email: string,
    password: string,
    client: { ip: string | null; userAgent: string | null },
  ): Promise<{ token: string; expiresAt: Date; me: AdminMe }> {
    const now = this.clock.now();
    const user = await this.db
      .selectFrom('t_admin_users')
      .selectAll()
      .where('email', '=', email.trim().toLowerCase())
      .executeTakeFirst();

    if (!user) {
      await verifyPassword(await dummyPasswordHash(), password);
      throw INVALID_CREDENTIALS();
    }
    if (user.locked_until && user.locked_until > now) {
      const minutes = Math.ceil((user.locked_until.getTime() - now.getTime()) / 60_000);
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'ACCOUNT_LOCKED', {
        fr: `Trop de tentatives incorrectes. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`,
        en: `Too many wrong attempts. Try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`,
      });
    }

    const valid = await verifyPassword(user.password_hash, password);
    if (!valid || !user.is_active) {
      if (user.is_active) {
        const failures = user.failed_login_count + 1;
        const lock = failures >= MAX_FAILED_LOGINS;
        await this.db
          .updateTable('t_admin_users')
          .set({
            failed_login_count: lock ? 0 : failures,
            locked_until: lock ? new Date(now.getTime() + LOCK_DURATION_MS) : null,
          })
          .where('id', '=', user.id)
          .execute();
        if (lock) {
          await auditAdmin(this.db, user.id, 'ADMIN_ACCOUNT_LOCKED', 'admin_user', user.id);
        }
      }
      throw INVALID_CREDENTIALS();
    }

    const session = generateSessionToken();
    const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('t_admin_users')
        .set({ failed_login_count: 0, locked_until: null, last_login_at: now })
        .where('id', '=', user.id)
        .execute();
      await trx
        .insertInto('t_admin_sessions')
        .values({
          admin_user_id: user.id,
          token_hash: session.hash,
          last_seen_at: now,
          expires_at: expiresAt,
          ip: client.ip?.slice(0, 45) ?? null,
          user_agent: client.userAgent?.slice(0, 255) ?? null,
        })
        .execute();
      await auditAdmin(trx, user.id, 'ADMIN_SIGNED_IN', 'admin_user', user.id);
    });

    return {
      token: session.token,
      expiresAt,
      me: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        mustChangePassword: user.must_change_password,
      },
    };
  }

  /** Resolves a cookie token to its admin, or null if the session is not valid any more. */
  async authenticate(token: string): Promise<AdminPrincipal | null> {
    const now = this.clock.now();
    const row = await this.db
      .selectFrom('t_admin_sessions as s')
      .innerJoin('t_admin_users as u', 'u.id', 's.admin_user_id')
      .select([
        's.id as session_id',
        's.last_seen_at',
        'u.id',
        'u.email',
        'u.full_name',
        'u.role',
        'u.must_change_password',
      ])
      .where('s.token_hash', '=', hashSessionToken(token))
      .where('s.revoked_at', 'is', null)
      .where('s.expires_at', '>', now)
      .where('s.last_seen_at', '>', new Date(now.getTime() - SESSION_IDLE_MS))
      .where('u.is_active', '=', true)
      .executeTakeFirst();
    if (!row) return null;

    if (now.getTime() - row.last_seen_at.getTime() > TOUCH_INTERVAL_MS) {
      await this.db
        .updateTable('t_admin_sessions')
        .set({ last_seen_at: now })
        .where('id', '=', row.session_id)
        .execute();
    }
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      mustChangePassword: row.must_change_password,
      sessionId: row.session_id,
    };
  }

  async logout(sessionId: number): Promise<void> {
    await this.db
      .updateTable('t_admin_sessions')
      .set({ revoked_at: this.clock.now() })
      .where('id', '=', sessionId)
      .where('revoked_at', 'is', null)
      .execute();
  }

  /** Changes the admin's own password; their other sessions are signed out. */
  async changePassword(
    admin: AdminPrincipal,
    currentPassword: string,
    newPassword: string,
  ): Promise<AdminMe> {
    const user = await this.db
      .selectFrom('t_admin_users')
      .select(['password_hash'])
      .where('id', '=', admin.id)
      .executeTakeFirstOrThrow();
    if (!(await verifyPassword(user.password_hash, currentPassword))) {
      throw badRequest('WRONG_PASSWORD', 'Le mot de passe actuel est incorrect.');
    }
    const problem = passwordProblem(newPassword, admin.email);
    if (problem) throw badRequest('WEAK_PASSWORD', problem);
    if (newPassword === currentPassword) {
      throw badRequest('SAME_PASSWORD', 'Choisissez un mot de passe différent de l’actuel.');
    }

    const now = this.clock.now();
    const passwordHash = await hashPassword(newPassword);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('t_admin_users')
        .set({ password_hash: passwordHash, must_change_password: false, password_changed_at: now })
        .where('id', '=', admin.id)
        .execute();
      await trx
        .updateTable('t_admin_sessions')
        .set({ revoked_at: now })
        .where('admin_user_id', '=', admin.id)
        .where('id', '<>', admin.sessionId)
        .where('revoked_at', 'is', null)
        .execute();
      await auditAdmin(trx, admin.id, 'ADMIN_PASSWORD_CHANGED', 'admin_user', admin.id);
    });
    return {
      id: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      role: admin.role,
      mustChangePassword: false,
    };
  }
}

/** Signs out every session of an admin (deactivation, password reset). */
export async function revokeAllSessions(
  db: Kysely<Database>,
  adminUserId: number,
  now: Date,
): Promise<void> {
  await db
    .updateTable('t_admin_sessions')
    .set({ revoked_at: now })
    .where('admin_user_id', '=', adminUserId)
    .where('revoked_at', 'is', null)
    .execute();
}
