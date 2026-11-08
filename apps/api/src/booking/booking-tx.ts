import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../database/schema';

/** MySQL: deadlock detected; the transaction was rolled back and can be retried. */
const ER_LOCK_DEADLOCK = 1213;

const MAX_ATTEMPTS = 5;

/**
 * Runs `work` in a transaction, retrying (up to 5 attempts, with a short random
 * pause) when MySQL picks it as a deadlock victim. Bookings racing for the same
 * slots lock the same unique index entries, so occasional deadlocks are expected
 * and harmless: the retry then sees the winner's slots and answers 409.
 */
export async function inTransaction<T>(
  db: Kysely<Database>,
  work: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction().execute(work);
    } catch (error) {
      const errno = (error as { errno?: number }).errno;
      if (errno !== ER_LOCK_DEADLOCK || attempt >= MAX_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20 * attempt));
    }
  }
}

/** Releases the live slot locks of bookings (their t_booking_slots history stays). */
export async function releaseSlots(
  trx: Transaction<Database>,
  bookingIds: readonly number[],
): Promise<void> {
  if (bookingIds.length === 0) return;
  await trx
    .deleteFrom('t_slot_occupancies')
    .where('booking_id', 'in', [...bookingIds])
    .execute();
}

/** True when a MySQL duplicate-key error concerns the given unique index. */
export function isDuplicateOn(error: unknown, indexName: string): boolean {
  const e = error as { errno?: number; sqlMessage?: string; message?: string };
  return e.errno === 1062 && (e.sqlMessage ?? e.message ?? '').includes(indexName);
}
