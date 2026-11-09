'use client';

import { formatXof, type PaymentStatus } from '@bovann/shared';
import { useState } from 'react';
import { BookingDrawer } from '@/components/admin/BookingDrawer';
import { useAdmin } from '@/components/admin/AdminShell';
import {
  adminStyles as styles,
  Badge,
  cx,
  Empty,
  LoadError,
  Loading,
  PageHeader,
  Pagination,
  Tabs,
  useAsync,
} from '@/components/admin/ui';
import { adminApi } from '@/lib/admin-api';
import {
  formatDateTime,
  formatPhone,
  paymentMethodLabel,
  PAYMENT_STATUS_LABELS,
} from '@/lib/admin-format';
import { formatShortDate } from '@/lib/dates';

type Filter = 'ALL' | PaymentStatus;

export default function AdminPaymentsPage() {
  const { space, isOwner, refreshCounters } = useAdmin();
  const [filter, setFilter] = useState<Filter>('SUCCEEDED');
  const [page, setPage] = useState(1);
  const [bookingId, setBookingId] = useState<number | null>(null);

  const refunds = useAsync(
    () => adminApi.bookings({ spaceId: space.id, tab: 'REFUND_DUE', when: 'all', pageSize: 100 }),
    `refunds-${space.id}`,
  );
  const payments = useAsync(
    () =>
      adminApi.payments({
        spaceId: space.id,
        status: filter === 'ALL' ? undefined : filter,
        page,
      }),
    `${space.id}|${filter}|${page}`,
  );

  function refresh() {
    refunds.reload();
    payments.reload();
    refreshCounters();
  }

  return (
    <>
      <PageHeader
        title="Paiements"
        sub="Paiements reçus en ligne ou enregistrés par le studio, et remboursements à effectuer."
      />

      <section className={cx(styles.card, styles.cardPad)} aria-label="Remboursements à effectuer">
        <h2 className={styles.cardTitle}>Remboursements à effectuer</h2>
        {refunds.error ? (
          <LoadError error={refunds.error} onRetry={refunds.reload} />
        ) : !refunds.data ? (
          <Loading />
        ) : refunds.data.items.length === 0 ? (
          <p className={styles.note}>Aucun remboursement en attente.</p>
        ) : (
          <>
            <p className={styles.note}>
              Rendez l’argent au client (Mobile Money, espèces…), puis ouvrez la réservation pour
              confirmer le remboursement.
              {isOwner ? '' : ' Seul un administrateur peut le confirmer.'}
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table} style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th>Réservation</th>
                    <th>Client</th>
                    <th>Séance</th>
                    <th className={styles.right}>Montant payé</th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.data.items.map((b) => (
                    <tr
                      key={b.id}
                      className={styles.rowClickable}
                      onClick={() => setBookingId(b.id)}
                    >
                      <td className={styles.ref}>{b.reference}</td>
                      <td>
                        <div className={styles.cellStack}>
                          <span style={{ fontWeight: 600 }}>{b.customer.fullName}</span>
                          <span className={styles.cellSub}>{formatPhone(b.customer.phone)}</span>
                        </div>
                      </td>
                      <td>
                        {formatShortDate(b.date)} {b.startTime}
                      </td>
                      <td className={styles.right}>{formatXof(b.totalXof)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className={styles.card} aria-label="Historique des paiements">
        <div className={styles.toolbar}>
          <Tabs
            label="Filtrer les paiements"
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setPage(1);
            }}
            options={[
              { value: 'SUCCEEDED', label: 'Reçus' },
              { value: 'PENDING', label: 'En attente' },
              { value: 'FAILED', label: 'Échoués' },
              { value: 'ALL', label: 'Tous' },
            ]}
          />
        </div>
        {payments.error ? (
          <LoadError error={payments.error} onRetry={payments.reload} />
        ) : !payments.data ? (
          <Loading />
        ) : payments.data.items.length === 0 ? (
          <Empty>Aucun paiement dans cette vue.</Empty>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table} style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Réservation</th>
                    <th>Client</th>
                    <th>Moyen</th>
                    <th className={styles.right}>Montant</th>
                    <th>État</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.data.items.map((p) => (
                    <tr
                      key={p.id}
                      className={styles.rowClickable}
                      onClick={() => setBookingId(p.booking.id)}
                    >
                      <td>{formatDateTime(p.succeededAt ?? p.createdAt)}</td>
                      <td className={styles.ref}>{p.booking.reference}</td>
                      <td>
                        <div className={styles.cellStack}>
                          <span>{p.booking.customerName}</span>
                          <span className={styles.cellSub}>{p.booking.businessName}</span>
                        </div>
                      </td>
                      <td>
                        <div className={styles.cellStack}>
                          <span>{paymentMethodLabel(p.method, p.channel)}</span>
                          <span className={styles.cellSub}>
                            {p.provider === 'manual'
                              ? `Enregistré par ${p.recordedBy ?? 'le studio'}`
                              : 'En ligne'}
                          </span>
                        </div>
                      </td>
                      <td className={styles.right}>{formatXof(p.amountXof)}</td>
                      <td>
                        <Badge tone={PAYMENT_STATUS_LABELS[p.status].tone}>
                          {PAYMENT_STATUS_LABELS[p.status].label}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={payments.data.page}
              pageSize={payments.data.pageSize}
              total={payments.data.total}
              onPage={setPage}
            />
          </>
        )}
      </section>

      <BookingDrawer bookingId={bookingId} onClose={() => setBookingId(null)} onChanged={refresh} />
    </>
  );
}
