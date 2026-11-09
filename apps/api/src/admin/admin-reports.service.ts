import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminCustomerDetail,
  AdminCustomerListItem,
  AdminCustomerListResponse,
  AdminPaymentListResponse,
  PaymentStatus,
} from '@bovann/shared';
import { sql, type Kysely } from 'kysely';
import { notFound } from '../common/errors';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';
import { AdminBookingsService } from './admin-bookings.service';

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** Read-only lists for the Clients and Paiements pages. */
@Injectable()
export class AdminReportsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    private readonly bookings: AdminBookingsService,
  ) {}

  async customers(
    q: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<AdminCustomerListResponse> {
    // Customers who only abandoned a payment are not shown: they never became clients.
    let base = this.db.selectFrom('t_customers as c').where(({ exists, selectFrom }) =>
      exists(
        selectFrom('t_bookings as b')
          .select('b.id')
          .whereRef('b.customer_id', '=', 'c.id')
          .where((eb) =>
            eb.or([
              eb('b.status', '=', 'CONFIRMED'),
              eb('b.status', '=', 'REFUNDED'),
              eb('b.cancelled_by_admin_id', 'is not', null),
              eb('b.refund_status', '<>', 'NONE'),
            ]),
          ),
      ),
    );
    const term = q?.trim();
    if (term) {
      const like = likePattern(term);
      const digits = term.replace(/\D/g, '');
      base = base.where((eb) =>
        eb.or([
          eb('c.full_name', 'like', like),
          eb('c.business_name', 'like', like),
          eb('c.email', 'like', like),
          ...(digits.length >= 3 ? [eb('c.phone_e164', 'like', `%${digits}%`)] : []),
        ]),
      );
    }
    const [count, rows] = await Promise.all([
      base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
      base
        .select([
          'c.id',
          'c.full_name',
          'c.phone_e164',
          'c.email',
          'c.business_name',
          'c.business_sector',
          sql<number>`(SELECT COUNT(*) FROM t_bookings b WHERE b.customer_id = c.id AND b.status IN ('CONFIRMED','REFUNDED'))`.as(
            'bookings_count',
          ),
          sql<Date | null>`(SELECT MAX(b.starts_at) FROM t_bookings b WHERE b.customer_id = c.id AND b.status = 'CONFIRMED')`.as(
            'last_booking_at',
          ),
          sql<number>`(SELECT COALESCE(SUM(p.amount_xof), 0) FROM t_payments p JOIN t_bookings b ON b.id = p.booking_id WHERE b.customer_id = c.id AND p.status = 'SUCCEEDED')`.as(
            'total_paid',
          ),
        ])
        .orderBy('c.updated_at', 'desc')
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute(),
    ]);
    return {
      items: rows.map((r): AdminCustomerListItem => ({
        id: r.id,
        fullName: r.full_name,
        phone: r.phone_e164,
        email: r.email,
        businessName: r.business_name,
        businessSector: r.business_sector,
        bookingsCount: Number(r.bookings_count),
        lastBookingAt: r.last_booking_at ? new Date(r.last_booking_at).toISOString() : null,
        totalPaidXof: Number(r.total_paid),
      })),
      total: Number(count.n),
      page,
      pageSize,
    };
  }

  async customer(customerId: number): Promise<AdminCustomerDetail> {
    const c = await this.db
      .selectFrom('t_customers')
      .selectAll()
      .where('id', '=', customerId)
      .executeTakeFirst();
    if (!c) throw notFound('CUSTOMER_NOT_FOUND', 'Client introuvable.');
    const [bookings, totals] = await Promise.all([
      this.bookings.list({
        customerId,
        tab: 'ALL',
        when: 'all',
        page: 1,
        pageSize: 100,
      }),
      this.db
        .selectFrom('t_bookings as b')
        .leftJoin('t_payments as p', (join) =>
          join.onRef('p.booking_id', '=', 'b.id').on('p.status', '=', 'SUCCEEDED'),
        )
        .select([
          sql<number>`COUNT(DISTINCT CASE WHEN b.status IN ('CONFIRMED','REFUNDED') THEN b.id END)`.as(
            'n',
          ),
          sql<Date | null>`MAX(CASE WHEN b.status = 'CONFIRMED' THEN b.starts_at END)`.as('last'),
          sql<number>`COALESCE(SUM(p.amount_xof), 0)`.as('paid'),
        ])
        .where('b.customer_id', '=', customerId)
        .executeTakeFirstOrThrow(),
    ]);
    return {
      id: c.id,
      fullName: c.full_name,
      phone: c.phone_e164,
      email: c.email,
      businessName: c.business_name,
      businessSector: c.business_sector,
      bookingsCount: Number(totals.n),
      lastBookingAt: totals.last ? new Date(totals.last).toISOString() : null,
      totalPaidXof: Number(totals.paid),
      createdAt: c.created_at.toISOString(),
      bookings: bookings.items,
    };
  }

  async payments(
    status: PaymentStatus | undefined,
    spaceId: number | undefined,
    page: number,
    pageSize: number,
  ): Promise<AdminPaymentListResponse> {
    let base = this.db
      .selectFrom('t_payments as p')
      .innerJoin('t_bookings as b', 'b.id', 'p.booking_id')
      .innerJoin('t_customers as c', 'c.id', 'b.customer_id')
      .leftJoin('t_admin_users as a', 'a.id', 'p.recorded_by_admin_id');
    if (status) base = base.where('p.status', '=', status);
    if (spaceId) base = base.where('b.space_id', '=', spaceId);
    const [count, rows] = await Promise.all([
      base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
      base
        .select([
          'p.id',
          'p.provider',
          'p.method',
          'p.channel',
          'p.amount_xof',
          'p.status',
          'p.note',
          'p.created_at',
          'p.succeeded_at',
          'a.full_name as recorded_by',
          'b.id as booking_id',
          'b.reference',
          'c.full_name',
          'c.business_name',
        ])
        .orderBy('p.created_at', 'desc')
        .orderBy('p.id', 'desc')
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute(),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        method: r.method,
        channel: r.channel,
        amountXof: r.amount_xof,
        status: r.status,
        note: r.note,
        createdAt: r.created_at.toISOString(),
        succeededAt: r.succeeded_at?.toISOString() ?? null,
        recordedBy: r.recorded_by,
        booking: {
          id: r.booking_id,
          reference: r.reference,
          customerName: r.full_name,
          businessName: r.business_name,
        },
      })),
      total: Number(count.n),
      page,
      pageSize,
    };
  }
}
