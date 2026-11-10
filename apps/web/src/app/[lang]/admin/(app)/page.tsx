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
import { useI18n, type TKey } from '@/i18n/I18nProvider';
import { adminApi } from '@/lib/admin-api';
import {
  addDays,
  bookingStatus,
  formatPhone,
  paymentMethodLabel,
  paymentStateLabel,
  SESSION_MODE_LABELS,
  todayIn,
} from '@/lib/admin-format';
import { formatLongDate, formatShortDate } from '@/lib/dates';
import { selectionLabel } from '@/lib/selection';

type Tab = AdminBookingTab | 'ABANDONED';
type When = 'upcoming' | 'past' | 'all';

const TABS: Tab[] = [
  'ALL',
  'CONFIRMED',
  'PENDING',
  'UNPAID',
  'REFUND_DUE',
  'CANCELLED',
  'ABANDONED',
];

export default function AdminBookingsPage() {
  const { space, refreshCounters } = useAdmin();
  const { t, locale } = useI18n();
  const money = (n: number) => formatXof(n, locale);
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
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
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
        title={t('adminBookings.title')}
        sub={space.name}
        actions={
          <>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => setBlockPreset({ date: day < today ? today : day })}
            >
              {t('adminBookings.block')}
            </button>
            <button
              type="button"
              className={styles.btn}
              onClick={() => setNewPreset({ date: day < today ? today : day })}
            >
              <Icon name="plus" size={16} /> {t('adminBookings.new')}
            </button>
          </>
        }
      />

      <div className={styles.stats}>
        <StatTile label={t('adminBookings.statToday')} value={stats.data?.todayBookings ?? '–'} />
        <StatTile
          label={t('adminBookings.statOccupancy')}
          value={stats.data ? `${stats.data.weekOccupancyPercent} %` : '–'}
        />
        <StatTile
          label={t('adminBookings.statCollected')}
          value={stats.data ? money(stats.data.collectedThisMonthXof) : '–'}
        />
        <StatTile
          label={t('adminBookings.statUnpaid')}
          value={stats.data?.unpaidCount ?? '–'}
          highlight={(stats.data?.unpaidCount ?? 0) > 0}
        />
      </div>

      {stats.data && stats.data.refundsDueCount > 0 ? (
        <div className={styles.banner}>
          <span>{t('adminBookings.refundsBanner', { count: stats.data.refundsDueCount })}</span>
          <button
            type="button"
            className={cx(styles.btnSecondary, styles.btnSmall)}
            onClick={() => {
              setTab('REFUND_DUE');
              setPage(1);
            }}
          >
            {t('adminBookings.see')}
          </button>
        </div>
      ) : null}

      <section className={cx(styles.card, styles.cardPad)} aria-label={t('adminBookings.dayPlan')}>
        <div className={styles.cardHeader}>
          <div className={styles.dayNav}>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label={t('adminBookings.prevDay')}
              onClick={() => setDay((d) => addDays(d, -1))}
            >
              <Icon name="back" size={16} />
            </button>
            <h2>{formatLongDate(day, true, locale)}</h2>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label={t('adminBookings.nextDay')}
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
                {t('adminBookings.today')}
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
          <Empty>{t('adminBookings.closedDay')}</Empty>
        ) : (
          <div className={styles.strip}>
            {daySlots.map((s) => (
              <SlotCell key={s.start} slot={s} onSelect={onSlot} />
            ))}
          </div>
        )}
      </section>

      <section className={styles.card} aria-label={t('adminBookings.list')}>
        <div className={styles.toolbar}>
          <Tabs
            label={t('adminBookings.filter')}
            value={tab}
            onChange={(next) => {
              setTab(next);
              setPage(1);
            }}
            options={TABS.map((value) => ({
              value,
              label: t(`adminBookings.tabs.${value}` as TKey),
            }))}
          />
          <input
            type="search"
            className={styles.search}
            aria-label={t('adminBookings.searchLabel')}
            placeholder={t('adminBookings.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {q || tab === 'REFUND_DUE' || tab === 'UNPAID' ? null : (
          <div style={{ padding: '12px 18px 0', maxWidth: 420 }}>
            <Segmented
              label={t('adminBookings.period')}
              value={when}
              onChange={(w) => {
                setWhen(w);
                setPage(1);
              }}
              options={[
                { value: 'upcoming', label: t('adminBookings.upcoming') },
                { value: 'past', label: t('adminBookings.past') },
                { value: 'all', label: t('adminBookings.allDates') },
              ]}
            />
          </div>
        )}
        {list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <Loading />
        ) : list.data.items.length === 0 ? (
          <Empty>{q ? t('adminBookings.noMatch', { q }) : t('adminBookings.none')}</Empty>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.table} style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th>{t('adminBookings.colRef')}</th>
                    <th>{t('adminBookings.colClient')}</th>
                    <th>{t('adminBookings.colDate')}</th>
                    <th>{t('adminBookings.colFormula')}</th>
                    <th>{t('adminBookings.colMode')}</th>
                    <th>{t('adminBookings.colPayment')}</th>
                    <th>{t('adminBookings.colStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((b) => {
                    const status = bookingStatus(b, t, locale);
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
                            <span>{formatShortDate(b.date, locale)}</span>
                            <span className={styles.cellSub}>
                              {b.startTime} – {b.endTime}
                            </span>
                          </div>
                        </td>
                        <td>{selectionLabel(b, t)}</td>
                        <td>{SESSION_MODE_LABELS[locale][b.mode]}</td>
                        <td>
                          <div className={styles.cellStack}>
                            <span style={{ fontWeight: 600 }}>
                              {b.totalXof === 0 ? t('adminBookings.free') : money(b.totalXof)}
                            </span>
                            <span className={styles.cellSub}>
                              {b.paymentState === 'PAID'
                                ? paymentMethodLabel(b.paymentMethod, b.paymentChannel, locale)
                                : paymentStateLabel(b.paymentState, t)}
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
