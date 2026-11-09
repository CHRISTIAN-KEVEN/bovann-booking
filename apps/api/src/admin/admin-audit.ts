import type { Kysely } from 'kysely';
import type { Database } from '../database/schema';

/** Records an admin action in the audit log (inside the caller's transaction when given one). */
export async function auditAdmin(
  db: Kysely<Database>,
  adminId: number,
  action: string,
  entity: string,
  entityId: number | string,
  data?: Record<string, unknown>,
): Promise<void> {
  await db
    .insertInto('t_audit_log')
    .values({
      actor_type: 'ADMIN',
      actor_id: adminId,
      action,
      entity,
      entity_id: String(entityId),
      data: data === undefined ? null : JSON.stringify(data),
    })
    .execute();
}
