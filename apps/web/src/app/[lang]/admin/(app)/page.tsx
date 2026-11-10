'use client';

import { formatXof, type AdminBookingTab, type ScheduleSlotDto } from '@bovann/shared';
import { useCallback, useEffect, useState } from 'react';
import { BookingDrawer } from '@/components/admin/BookingDrawer';
import { useAdmin } from '@/components/admin/AdminShell';
import { NewBookingDialog, type NewBookingPreset } from '@/components/admin/NewBookingDialog';
import { ScheduleKey, SlotCell } from '@/components/admin/Schedule';
import { BlockDialog, SlotMenu, type BlockPreset } from '@/components/admin/SlotActions';
import {
  adminStyles as styles,
  Badge,
  cx,
  Empty,
  LoadError,
  Loading,
  PageHeader,
  Pagination,
  Segmented,
  StatTile,
  Tabs,
  useAsync,
} from '@/components/admin/ui';
import { Icon } from '@/components/icons';
import { adminApi } from '@/lib/admin-api';
import {
  addDays,
  bookingStatus,
  formatPhone,
  paymentMethodLabel,
  paymentStateLabel,
  SESSION_MODE_LABELS_FR,
  todayIn,
} from '@/lib/admin-format';
import { formatLongDate, formatShortDate } from '@/lib/dates';

type Tab = AdminBookingTab | 'ABANDONED';
type When = 'upcoming' | 'past' | 'all';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'ALL', label: 'Toutes' },
  { value: 'CONFIRMED', label: 'Confirmées' },
  { value: 'PENDING', label: 'Paiement en cours' },
  { value: 'UNPAID', label: 'À encaisser' },
  { value: 'REFUND_DUE', label: 'À rembourser' },
  { value: 'CANCELLED', label: 'Annulées' },
  { value: 'ABANDONED', label: 'Abandonnées' },
];

export default function AdminBookingsPage() {
  const { space, refreshCounters } = useAdmin();
  const today = todayIn(space.timezone);

  const [day, setDay] = useState(today);
  const [tab, setTab] = useState<Tab>('ALL');
  const [when, setWhen] = useState<When>('upcoming');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const [openId, setOpenId] = useState<number | null>(null);
  const [newPreset, setNewPreset] = useState<NewBookingPreset | null>(null);
  const [blockPreset, setBlockPreset] = useState<BlockPreset | null>(null);
  const [menuSlot, setMenuSlot] = useState<ScheduleSlotDto | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const stats = useAsync(() => adminApi.stats(space.id), `stats-${space.id}`);
  const schedule = useAsync(() => adminApi.schedule(space.id, day, 1), `sched-${space.id}-${day}`);
  const listKey = `${space.id}|${tab}|${when}|${q}|${page}`;
  const list = useAsync(
    () =>
      adminApi.bookings({
        spaceId: space.id,
        tab,
        q: q || undefined,
        // Searching or looking at money to settle covers every date.
        when: q || tab === 'REFUND_DUE' || tab === 'UNPAID' ? 'all' : when,
        page,
        pageSize: 25,
      }),
    listKey,
  );

  const refresh = useCallback(() => {
    stats.reload();
    schedule.reload();
    list.reload();
    refreshCounters();
  }, [stats, schedule, list, refreshCounters]);

  function onSlot(slot: ScheduleSlotDto) {
    if (slot.booking) setOpenId(slot.booking.id);
    else setMenuSlot(slot);
  }

  const daySlots = schedule.data?.days[0]?.slots ?? [];
  const blockSize = menuSlot?.block
    ? daySlots.filter((s) => s.block?.id === menuSlot.block!.id).length
    : 0;

  return (
    <>
      <PageHeader
        title="Réservations"
        sub={space.name}
        actions={
          <>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => setBlockPreset({ date: day < today ? today : day })}
            >
              Bloquer des créneaux
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={() => setNewPreset({ date: day < today ? today : day })}
            >
              <Icon name="plus" size={16} /> Nouvelle réservation
            </button>
          </>
        }
      />

      <div className={styles.stats}>
        <StatTile label="Réservations aujourd’hui" value={stats.data?.todayBookings ?? '–'} />
        <StatTile
          label="Taux d’occupation (semaine)"
          value={stats.data ? `${stats.data.weekOccupancyPercent} %` : '–'}
        />
        <StatTile
          label="Encaissé ce mois"
          value={stats.data ? formatXof(stats.data.collectedThisMonthXof) : '–'}
        />
        <StatTile
          label="Paiements à encaisser"
          value={stats.data?.unpaidCount ?? '–'}
          highlight={(stats.data?.unpaidCount ?? 0) > 0}
        />
      </div>

      {stats.data && stats.data.refundsDueCount > 0 ? (
        <div className={styles.banner}>
          <span>
            {stats.data.refundsDueCount} remboursement
            {stats.data.refundsDueCount > 1 ? 's' : ''} à effectuer.
          </span>
          <button
            type="button"
            className={cx(styles.btnSecondary, styles.btnSmall)}
            onClick={() => {
              setTab('REFUND_DUE');
              setPage(1);
            }}
          >
            Voir
          </button>
        </div>
      ) : null}

      <section className={cx(styles.card, styles.cardPad)} aria-label="Planning du jour">
        <div className={styles.cardHeader}>
          <div className={styles.dayNav}>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Jour précédent"
              onClick={() => setDay((d) => addDays(d, -1))}
            >
              <Icon name="back" size={16} />
            </button>
            <h2>{formatLongDate(day, true)}</h2>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label="Jour suivant"
              onClick={() => setDay((d) => addDays(d, 1))}
            >
              <Icon name="next" size={16} />
            </button>
            {day !== today ? (
              <button
                type="button"
                className={cx(styles.btnGhost, styles.btnSmall)}
                onClick={() => setDay(today)}
              >
                Aujourd’hui
              </button>
            ) : null}
          </div>
          <ScheduleKey />
        </div>
        {schedule.error ? (
          <LoadError error={schedule.error} onRetry={schedule.reload} />
        ) : !schedule.data ? (
          <Loading />
        ) : daySlots.length === 0 ? (
          <Empty>Le studio est fermé ce jour-là.</Empty>
        ) : (
          <div className={styles.strip}>
            {daySlots.map((s) => (
              <SlotCell key={s.start} slot={s} onSelect={onSlot} />
            ))}
          </div>
        )}
      </section>

      <section className={styles.card} aria-label="Liste des réservations">
        <div className={styles.toolbar}>
          <Tabs
            label="Filtrer les réservations"
            value={tab}
            onChange={(t) => {
              setTab(t);
              setPage(1);
            }}
            options={TABS}
          />
          <input
            type="search"
            className={styles.search}
            aria-label="Rechercher une réservation"
            placeholder="Rechercher&nbsp;: nom, entreprise, téléphone, référence"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {q || tab === 'REFUND_DUE' || tab === 'UNPAID' ? null : (
          <div style={{ padding: '12px 18px 0', maxWidth: 420 }}>
            <Segmented
              label="Période"
              value={when}
              onChange={(w) => {
                setWhen(w);
                setPage(1);
              }}
              options={[
                { value: 'upcoming', label: 'À venir' },
                { value: 'past', label: 'Passées' },
                { value: 'all', label: 'Toutes les dates' },
              ]}
            />
          </div>
        )}
        {list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <Loading />
        ) : list.data.items.length === 0 ? (
          <Empty>
            {q
              ? `Aucune réservation ne correspond à «\u00a0${q}\u00a0».`
              : 'Aucune réservation dans cette vue.'}
          </Empty>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table} style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th>Référence</th>
                    <th>Client / entreprise</th>
                    <th>Date &amp; horaire</th>
                    <th>Formule</th>
                    <th>Mode</th>
                    <th>Paiement</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((b) => {
                    const status = bookingStatus(b);
                    return (
                      <tr
                        key={b.id}
                        className={styles.rowClickable}
                        onClick={() => setOpenId(b.id)}
                      >
                        <td>
                          <button
                            type="button"
                            className={cx(styles.linkButton, styles.ref)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenId(b.id);
                            }}
                          >
                            {b.reference}
                          </button>
                        </td>
                        <td>
                          <div className={styles.cellStack}>
                            <span style={{ fontWeight: 600 }}>{b.customer.fullName}</span>
                            <span className={styles.cellSub}>
                              {b.customer.businessName} · {formatPhone(b.customer.phone)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className={styles.cellStack}>
                            <span>{formatShortDate(b.date)}</span>
                            <span className={styles.cellSub}>
                              {b.startTime} – {b.endTime}
                            </span>
                          </div>
                        </td>
                        <td>
                          {b.packageName ?? `${b.slotCount} créneau${b.slotCount > 1 ? 'x' : ''}`}
                        </td>
                        <td>{SESSION_MODE_LABELS_FR[b.mode]}</td>
                        <td>
                          <div className={styles.cellStack}>
                            <span style={{ fontWeight: 600 }}>
                              {b.totalXof === 0 ? 'Gratuit' : formatXof(b.totalXof)}
                            </span>
                            <span className={styles.cellSub}>
                              {b.paymentState === 'PAID'
                                ? paymentMethodLabel(b.paymentMethod, b.paymentChannel)
                                : paymentStateLabel(b.paymentState)}
                            </span>
                          </div>
                        </td>
                        <td>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </td>
                      </tr>
                    );
                  })}
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

      <BookingDrawer bookingId={openId} onClose={() => setOpenId(null)} onChanged={refresh} />
      <NewBookingDialog
        preset={newPreset}
        onClose={() => setNewPreset(null)}
        onCreated={(b) => {
          setNewPreset(null);
          refresh();
          setOpenId(b.id);
        }}
      />
      <BlockDialog
        preset={blockPreset}
        onClose={() => setBlockPreset(null)}
        onDone={() => {
          setBlockPreset(null);
          refresh();
        }}
      />
      <SlotMenu
        slot={menuSlot}
        date={day}
        blockSize={blockSize}
        onClose={() => setMenuSlot(null)}
        onBook={(s) => {
          setMenuSlot(null);
          setNewPreset({ date: day, slotStart: s.start });
        }}
        onBlock={(s) => {
          setMenuSlot(null);
          setBlockPreset({ date: day, slotStart: s.start });
        }}
        onUnblocked={() => {
          setMenuSlot(null);
          refresh();
        }}
      />
    </>
  );
}
