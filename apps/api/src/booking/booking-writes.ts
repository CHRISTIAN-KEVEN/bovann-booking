import type { Insertable, Transaction } from 'kysely';
import type { BookingsTable, Database } from '../database/schema';
import { isDuplicateOn, releaseSlots } from './booking-tx';
import { generateReference } from './domain/identifiers';

/**
 * Write steps shared by online bookings (customer presses "Payer") and studio
 * bookings (admin). Each runs inside the caller's transaction.
 */

export interface CustomerInput {
  fullName: string;
  phone: string;
  email?: string | null;
  businessName: string;
  businessSector: string;
}

/** One customer per phone; the latest details win, an existing email is kept if none is given. */
export async function upsertCustomer(
  trx: Transaction<Database>,
  input: CustomerInput,
): Promise<number> {
  await trx
    .insertInto('t_customers')
    .values({
      full_name: input.fullName,
      phone_e164: input.phone,
      email: input.email ?? null,
      business_name: input.businessName,
      business_sector: input.businessSector,
    })
    .onDuplicateKeyUpdate((eb) => ({
      full_name: input.fullName,
      business_name: input.businessName,
      business_sector: input.businessSector,
      email: eb.fn.coalesce(eb.val(input.email ?? null), eb.ref('email')),
    }))
    .execute();
  const customer = await trx
    .selectFrom('t_customers')
    .select('id')
    .where('phone_e164', '=', input.phone)
    .executeTakeFirstOrThrow();
  return customer.id;
}

/**
 * Frees requested slots still held by expired unpaid holds: finds them with a
 * plain read, then locks those bookings by primary key and re-checks (locking
 * real rows only keeps concurrent bookings deadlock-free). Returns their ids.
 */
export async function reclaimExpiredHolds(
  trx: Transaction<Database>,
  spaceId: number,
  slotStarts: readonly Date[],
  now: Date,
): Promise<number[]> {
  const candidates = await trx
    .selectFrom('t_slot_occupancies as o')
    .innerJoin('t_bookings as b', 'b.id', 'o.booking_id')
    .select('b.id')
    .distinct()
    .where('o.space_id', '=', spaceId)
    .where('o.slot_start', 'in', [...slotStarts])
    .where('b.status', '=', 'PENDING_PAYMENT')
    .where('b.hold_expires_at', '<=', now)
    .execute();
  if (candidates.length === 0) return [];
  const locked = await trx
    .selectFrom('t_bookings')
    .select('id')
    .where(
      'id',
      'in',
      candidates.map((c) => c.id),
    )
    .where('status', '=', 'PENDING_PAYMENT')
    .where('hold_expires_at', '<=', now)
    .forUpdate()
    .execute();
  const ids = locked.map((l) => l.id);
  if (ids.length > 0) {
    await releaseSlots(trx, ids);
    await trx.updateTable('t_bookings').set({ status: 'EXPIRED' }).where('id', 'in', ids).execute();
  }
  return ids;
}

/** Inserts the booking with a fresh reference (retrying the rare collision). */
export async function insertBooking(
  trx: Transaction<Database>,
  values: Omit<Insertable<BookingsTable>, 'reference'>,
  localDate: string,
): Promise<{ id: number; reference: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const reference = generateReference(localDate);
    try {
      const result = await trx
        .insertInto('t_bookings')
        .values({ ...values, reference })
        .executeTakeFirstOrThrow();
      return { id: Number(result.insertId), reference };
    } catch (error) {
      if (!isDuplicateOn(error, 'uq_bookings_reference')) throw error;
    }
  }
  throw new Error('Could not generate a unique booking reference');
}

/**
 * Records the booking's slots and takes their live locks. A slot taken in the
 * meantime raises a duplicate key on uq_slot_occupancies_slot (→ 409 upstream).
 */
export async function lockSlots(
  trx: Transaction<Database>,
  bookingId: number,
  spaceId: number,
  slotStarts: readonly Date[],
): Promise<void> {
  await trx
    .insertInto('t_booking_slots')
    .values(slotStarts.map((slot_start) => ({ booking_id: bookingId, slot_start })))
    .execute();
  await trx
    .insertInto('t_slot_occupancies')
    .values(
      slotStarts.map((slot_start) => ({ space_id: spaceId, slot_start, booking_id: bookingId })),
    )
    .execute();
}
