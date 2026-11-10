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
import { adminApi } from '@/lib/admin-api';
import { bookingStatus, formatDateTime, formatPhone } from '@/lib/admin-format';
import { formatShortDate } from '@/lib/dates';

export default function AdminCustomersPage() {
  const { refreshCounters } = useAdmin();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [bookingId, setBookingId] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const list = useAsync(() => adminApi.customers(q, page), `${q}|${page}`);
  const detail = useAsync(
    () => (customerId ? adminApi.customer(customerId) : Promise.resolve(null)),
    `c-${customerId}`,
  );

  return (
    <>
      <PageHeader
        title="Clients"
        sub="Les clients ayant au moins une réservation confirmée ou traitée."
      />
      <section className={styles.card}>
        <div className={styles.toolbar}>
          <input
            type="search"
            className={styles.search}
            aria-label="Rechercher un client"
            placeholder="Rechercher&nbsp;: nom, entreprise, téléphone, e-mail"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <Loading />
        ) : list.data.items.length === 0 ? (
          <Empty>
            {q
              ? `Aucun client ne correspond à «\u00a0${q}\u00a0».`
              : 'Aucun client pour le moment.'}
          </Empty>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table} style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Entreprise</th>
                    <th>Contact</th>
                    <th className={styles.right}>Réservations</th>
                    <th>Dernière séance</th>
                    <th className={styles.right}>Total payé</th>
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
                      <td>
                        {c.lastBookingAt ? formatDateTime(c.lastBookingAt).split(' à')[0] : '—'}
                      </td>
                      <td className={styles.right}>{formatXof(c.totalPaidXof)}</td>
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
        title={detail.data?.fullName ?? 'Client'}
      >
        {detail.error ? (
          <LoadError error={detail.error} onRetry={detail.reload} />
        ) : !detail.data ? (
          <Loading />
        ) : (
          <>
            <dl className={styles.dl}>
              <dt>Entreprise</dt>
              <dd>
                {detail.data.businessName} · {detail.data.businessSector}
              </dd>
              <dt>Téléphone</dt>
              <dd>
                <a href={`tel:${detail.data.phone}`}>{formatPhone(detail.data.phone)}</a>
              </dd>
              <dt>E-mail</dt>
              <dd>
                {detail.data.email ? (
                  <a href={`mailto:${detail.data.email}`}>{detail.data.email}</a>
                ) : (
                  '—'
                )}
              </dd>
              <dt>Total payé</dt>
              <dd>{formatXof(detail.data.totalPaidXof)}</dd>
              <dt>Client depuis</dt>
              <dd>{formatDateTime(detail.data.createdAt).split(' à')[0]}</dd>
            </dl>
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Réservations</h3>
              {detail.data.bookings.length === 0 ? (
                <p className={styles.note}>Aucune réservation.</p>
              ) : (
                <ul className={styles.timeline}>
                  {detail.data.bookings.map((b) => {
                    const s = bookingStatus(b);
                    return (
                      <li key={b.id}>
                        <button
                          type="button"
                          className={styles.linkButton}
                          onClick={() => setBookingId(b.id)}
                          style={{ fontWeight: 600 }}
                        >
                          {b.reference} · {formatShortDate(b.date)} {b.startTime}–{b.endTime}
                        </button>
                        <span className={styles.cellSub}>
                          {b.packageName ?? `${b.slotCount} créneau${b.slotCount > 1 ? 'x' : ''}`} ·{' '}
                          {b.totalXof === 0 ? 'Gratuit' : formatXof(b.totalXof)} ·{' '}
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
