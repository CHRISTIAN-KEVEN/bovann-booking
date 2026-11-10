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
import { useI18n } from '@/i18n/I18nProvider';
import { adminApi } from '@/lib/admin-api';
import {
  formatDateTime,
  formatPhone,
  paymentMethodLabel,
  paymentStatusLabel,
} from '@/lib/admin-format';
import { formatShortDate } from '@/lib/dates';

type Filter = 'ALL' | PaymentStatus;

export default function AdminPaymentsPage() {
  const { space, isOwner, refreshCounters } = useAdmin();
  const { t, locale } = useI18n();
  const money = (n: number) => formatXof(n, locale);
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
      <PageHeader title={t('payments.title')} sub={t('payments.sub')} />

      <section className={cx(styles.card, styles.cardPad)} aria-label={t('payments.refunds')}>
        <h2 className={styles.cardTitle}>{t('payments.refunds')}</h2>
        {refunds.error ? (
          <LoadError error={refunds.error} onRetry={refunds.reload} />
        ) : !refunds.data ? (
          <Loading />
        ) : refunds.data.items.length === 0 ? (
          <p className={styles.note}>{t('payments.noRefunds')}</p>
        ) : (
          <>
            <p className={styles.note}>
              {t('payments.refundHow')}
              {isOwner ? '' : t('payments.ownerOnly')}
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table} style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th>{t('payments.colBooking')}</th>
                    <th>{t('payments.colClient')}</th>
                    <th>{t('payments.colSession')}</th>
                    <th className={styles.right}>{t('payments.colPaid')}</th>
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
                        {formatShortDate(b.date, locale)} {b.startTime}
                      </td>
                      <td className={styles.right}>{money(b.totalXof)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className={styles.card} aria-label={t('payments.history')}>
        <div className={styles.toolbar}>
          <Tabs
            label={t('payments.filter')}
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setPage(1);
            }}
            options={[
              { value: 'SUCCEEDED', label: t('payments.received') },
              { value: 'PENDING', label: t('payments.waiting') },
              { value: 'FAILED', label: t('payments.failed') },
              { value: 'ALL', label: t('payments.all') },
            ]}
          />
        </div>
        {payments.error ? (
          <LoadError error={payments.error} onRetry={payments.reload} />
        ) : !payments.data ? (
          <Loading />
        ) : payments.data.items.length === 0 ? (
          <Empty>{t('payments.none')}</Empty>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table} style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>{t('payments.colDate')}</th>
                    <th>{t('payments.colBooking')}</th>
                    <th>{t('payments.colClient')}</th>
                    <th>{t('payments.colMethod')}</th>
                    <th className={styles.right}>{t('payments.colAmount')}</th>
                    <th>{t('payments.colState')}</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.data.items.map((p) => (
                    <tr
                      key={p.id}
                      className={styles.rowClickable}
                      onClick={() => setBookingId(p.booking.id)}
                    >
                      <td>{formatDateTime(p.succeededAt ?? p.createdAt, undefined, locale)}</td>
                      <td className={styles.ref}>{p.booking.reference}</td>
                      <td>
                        <div className={styles.cellStack}>
                          <span>{p.booking.customerName}</span>
                          <span className={styles.cellSub}>{p.booking.businessName}</span>
                        </div>
                      </td>
                      <td>
                        <div className={styles.cellStack}>
                          <span>{paymentMethodLabel(p.method, p.channel, locale)}</span>
                          <span className={styles.cellSub}>
                            {p.provider === 'manual'
                              ? t('payments.recordedBy', {
                                  name: p.recordedBy ?? t('payments.theStudio'),
                                })
                              : t('payments.online')}
                          </span>
                        </div>
                      </td>
                      <td className={styles.right}>{money(p.amountXof)}</td>
                      <td>
                        <Badge tone={paymentStatusLabel(p.status, t).tone}>
                          {paymentStatusLabel(p.status, t).label}
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
