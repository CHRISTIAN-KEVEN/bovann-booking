import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminUserCreate,
  AdminUserDto,
  AdminUserUpdate,
  TemporaryPasswordResponse,
} from '@bovann/shared';
import type { Kysely, Selectable } from 'kysely';
import { inTransaction, isDuplicateOn } from '../booking/booking-tx';
import { CLOCK, type Clock } from '../common/clock';
import { ApiError, badRequest, notFound } from '../common/errors';
import { DB } from '../database/database.module';
import type { AdminUsersTable, Database } from '../database/schema';
import { auditAdmin } from './admin-audit';
import { revokeAllSessions, type AdminPrincipal } from './auth/admin-auth.service';
import { generateTemporaryPassword, hashPassword } from './auth/passwords';

function toDto(u: Selectable<AdminUsersTable>): AdminUserDto {
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    isActive: u.is_active,
    mustChangePassword: u.must_change_password,
    lastLoginAt: u.last_login_at?.toISOString() ?? null,
    createdAt: u.created_at.toISOString(),
  };
}

/**
 * Admin accounts (administrators only). New accounts and password resets get a
 * temporary password, shown once to the administrator who passes it on; it
 * must be replaced at the first sign-in. When emails are sent (Phase 6) this
 * can become an emailed invitation link.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(): Promise<AdminUserDto[]> {
    const rows = await this.db
      .selectFrom('t_admin_users')
      .selectAll()
      .orderBy('is_active', 'desc')
      .orderBy('full_name')
      .execute();
    return rows.map(toDto);
  }

  async create(input: AdminUserCreate, admin: AdminPrincipal): Promise<TemporaryPasswordResponse> {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    try {
      const result = await this.db
        .insertInto('t_admin_users')
        .values({
          email: input.email,
          full_name: input.fullName,
          role: input.role,
          password_hash: passwordHash,
          must_change_password: true,
        })
        .executeTakeFirstOrThrow();
      const id = Number(result.insertId);
      await auditAdmin(this.db, admin.id, 'ADMIN_USER_CREATED', 'admin_user', id, {
        email: input.email,
        role: input.role,
      });
      return { user: await this.get(id), temporaryPassword };
    } catch (error) {
      if (isDuplicateOn(error, 'uq_admin_users_email')) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'EMAIL_TAKEN',
          'Un compte existe déjà avec cette adresse e-mail.',
        );
      }
      throw error;
    }
  }

  async update(
    userId: number,
    input: AdminUserUpdate,
    admin: AdminPrincipal,
  ): Promise<AdminUserDto> {
    const now = this.clock.now();
    await inTransaction(this.db, async (trx) => {
      // Lock every owner row: two administrators demoting each other at the same
      // time must not leave the studio without any administrator.
      const owners = await trx
        .selectFrom('t_admin_users')
        .select(['id', 'is_active'])
        .where('role', '=', 'OWNER')
        .forUpdate()
        .execute();
      const user = await trx
        .selectFrom('t_admin_users')
        .selectAll()
        .where('id', '=', userId)
        .forUpdate()
        .executeTakeFirst();
      if (!user) throw notFound('USER_NOT_FOUND', 'Ce compte n’existe pas.');

      if (userId === admin.id && (input.role === 'STAFF' || input.isActive === false)) {
        throw badRequest(
          'CANNOT_CHANGE_OWN_ACCESS',
          'Vous ne pouvez pas retirer vos propres droits ni désactiver votre compte.',
        );
      }
      const losesOwner =
        user.role === 'OWNER' &&
        user.is_active &&
        (input.role === 'STAFF' || input.isActive === false);
      const activeOwners = owners.filter((o) => o.is_active).length;
      if (losesOwner && activeOwners <= 1) {
        throw badRequest('LAST_OWNER', 'Il doit toujours rester au moins un administrateur actif.');
      }

      await trx
        .updateTable('t_admin_users')
        .set({
          ...(input.fullName !== undefined && { full_name: input.fullName }),
          ...(input.role !== undefined && { role: input.role }),
          ...(input.isActive !== undefined && { is_active: input.isActive }),
        })
        .where('id', '=', userId)
        .execute();
      if (input.isActive === false || (input.role && input.role !== user.role)) {
        // New rights apply at the next sign-in; a deactivated account is signed out now.
        await revokeAllSessions(trx, userId, now);
      }
      await auditAdmin(trx, admin.id, 'ADMIN_USER_UPDATED', 'admin_user', userId, { ...input });
    });
    return this.get(userId);
  }

  async resetPassword(userId: number, admin: AdminPrincipal): Promise<TemporaryPasswordResponse> {
    const user = await this.db
      .selectFrom('t_admin_users')
      .select(['id', 'is_active'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user) throw notFound('USER_NOT_FOUND', 'Ce compte n’existe pas.');
    if (userId === admin.id) {
      throw badRequest(
        'USE_CHANGE_PASSWORD',
        'Pour votre propre compte, utilisez « Changer mon mot de passe ».',
      );
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const now = this.clock.now();
    await inTransaction(this.db, async (trx) => {
      await trx
        .updateTable('t_admin_users')
        .set({
          password_hash: passwordHash,
          must_change_password: true,
          failed_login_count: 0,
          locked_until: null,
        })
        .where('id', '=', userId)
        .execute();
      await revokeAllSessions(trx, userId, now);
      await auditAdmin(trx, admin.id, 'ADMIN_USER_PASSWORD_RESET', 'admin_user', userId);
    });
    return { user: await this.get(userId), temporaryPassword };
  }

  private async get(id: number): Promise<AdminUserDto> {
    const row = await this.db
      .selectFrom('t_admin_users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return toDto(row);
  }
}
