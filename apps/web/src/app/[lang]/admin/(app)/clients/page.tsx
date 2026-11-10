'use client';

import { formatXof } from '@bovann/shared';
import { useEffect, useState } from 'react';
import { BookingDrawer } from '@/components/admin/BookingDrawer';
import { useAdmin } from '@/components/admin/AdminShell';
import {
  adminStyles as styles,
  Badge,
  Dialog,
  Empty,
  LoadError,
  Loading,
  PageHeader,
  Pagination,
  useAsync,
} from '@/components/admin/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { adminApi } from '@/lib/admin-api';
import { bookingStatus, formatDay, formatPhone } from '@/lib/admin-format';
import { formatShortDate } from '@/lib/dates';
import { selectionLabel } from '@/lib/selection';

export default function AdminCustomersPage() {
  const { refreshCounters } = useAdmin();
  const { t, locale } = useI18n();
  const money = (n: number) => formatXof(n, locale);
  const day = (iso: string) => formatDay(iso, undefined, locale);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [bookingId, setBookingId] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const list = useAsync(() => adminApi.customers(q, page), `${q}|${page}`);
  const detail = useAsync(
    () => (customerId ? adminApi.customer(customerId) : Promise.resolve(null)),
    `c-${customerId}`,
  );

  return (
    <>
      <PageHeader title={t('clients.title')} sub={t('clients.sub')} />
      <section className={styles.card}>
        <div className={styles.toolbar}>
          <input
            type="search"
            className={styles.search}
            aria-label={t('clients.searchLabel')}
            placeholder={t('clients.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <Loading />
        ) : list.data.items.length === 0 ? (
          <Empty>{q ? t('clients.noMatch', { q }) : t('clients.none')}</Empty>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table} style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>{t('clients.colClient')}</th>
                    <th>{t('clients.colBusiness')}</th>
                    <th>{t('clients.colContact')}</th>
                    <th className={styles.right}>{t('clients.colBookings')}</th>
                    <th>{t('clients.colLast')}</th>
                    <th className={styles.right}>{t('clients.colPaid')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((c) => (
                    <tr
                      key={c.id}
                      className={styles.rowClickable}
                      onClick={() => setCustomerId(c.id)}
                    >
                      <td>
                        <button
                          type="button"
                          className={styles.linkButton}
                          style={{ fontWeight: 600, textDecoration: 'none' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCustomerId(c.id);
                          }}
                        >
                          {c.fullName}
                        </button>
                      </td>
                      <td>
                        <div className={styles.cellStack}>
                          <span>{c.businessName}</span>
                          <span className={styles.cellSub}>{c.businessSector}</span>
                        </div>
                      </td>
                      <td>
                        <div className={styles.cellStack}>
                          <span>{formatPhone(c.phone)}</span>
                          <span className={styles.cellSub}>{c.email ?? '—'}</span>
                        </div>
                      </td>
                      <td className={styles.right}>{c.bookingsCount}</td>
                      <td>{c.lastBookingAt ? day(c.lastBookingAt) : '—'}</td>
                      <td className={styles.right}>{money(c.totalPaidXof)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onPage={setPage}
            />
          </>
        )}
      </section>

      <Dialog
        open={customerId !== null && bookingId === null}
        onClose={() => setCustomerId(null)}
        title={detail.data?.fullName ?? t('clients.client')}
      >
        {detail.error ? (
          <LoadError error={detail.error} onRetry={detail.reload} />
        ) : !detail.data ? (
          <Loading />
        ) : (
          <>
            <dl className={styles.dl}>
              <dt>{t('clients.business')}</dt>
              <dd>
                {detail.data.businessName} · {detail.data.businessSector}
              </dd>
              <dt>{t('clients.phone')}</dt>
              <dd>
                <a href={`tel:${detail.data.phone}`}>{formatPhone(detail.data.phone)}</a>
              </dd>
              <dt>{t('clients.email')}</dt>
              <dd>
                {detail.data.email ? (
                  <a href={`mailto:${detail.data.email}`}>{detail.data.email}</a>
                ) : (
                  '—'
                )}
              </dd>
              <dt>{t('clients.paid')}</dt>
              <dd>{money(detail.data.totalPaidXof)}</dd>
              <dt>{t('clients.since')}</dt>
              <dd>{day(detail.data.createdAt)}</dd>
            </dl>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>{t('clients.bookings')}</h3>
              {detail.data.bookings.length === 0 ? (
                <p className={styles.note}>{t('clients.noBookings')}</p>
              ) : (
                <ul className={styles.timeline}>
                  {detail.data.bookings.map((b) => {
                    const s = bookingStatus(b, t, locale);
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          className={styles.linkButton}
                          onClick={() => setBookingId(b.id)}
                          style={{ fontWeight: 600 }}
                        >
                          {b.reference} · {formatShortDate(b.date, locale)} {b.startTime}–
                          {b.endTime}
                        </button>
                        <span className={styles.cellSub}>
                          {selectionLabel(b, t)} ·{' '}
                          {b.totalXof === 0 ? t('clients.free') : money(b.totalXof)} ·{' '}
                          <Badge tone={s.tone}>{s.label}</Badge>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </Dialog>

      <BookingDrawer
        bookingId={bookingId}
        onClose={() => setBookingId(null)}
        onChanged={() => {
          detail.reload();
          list.reload();
          refreshCounters();
        }}
      />
    </>
  );
}
