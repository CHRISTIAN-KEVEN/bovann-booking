'use client';

import type { ScheduleSlotDto } from '@bovann/shared';
import { useState } from 'react';
import { BookingDrawer } from '@/components/admin/BookingDrawer';
import { useAdmin } from '@/components/admin/AdminShell';
import { NewBookingDialog, type NewBookingPreset } from '@/components/admin/NewBookingDialog';
import { ScheduleKey, SlotCell } from '@/components/admin/Schedule';
import { BlockDialog, SlotMenu, type BlockPreset } from '@/components/admin/SlotActions';
import {
  adminStyles as styles,
  cx,
  LoadError,
  Loading,
  PageHeader,
  useAsync,
} from '@/components/admin/ui';
import { Icon } from '@/components/icons';
import { useI18n } from '@/i18n/I18nProvider';
import { adminApi } from '@/lib/admin-api';
import { addDays, mondayOf, todayIn } from '@/lib/admin-format';
import { formatShortDate } from '@/lib/dates';

/** Week planning: every slot of the week, at a glance. */
export default function AdminCalendarPage() {
  const { space, refreshCounters } = useAdmin();
  const { t, locale } = useI18n();
  const today = todayIn(space.timezone);
  const [monday, setMonday] = useState(() => mondayOf(today));
  const [openId, setOpenId] = useState<number | null>(null);
  const [newPreset, setNewPreset] = useState<NewBookingPreset | null>(null);
  const [blockPreset, setBlockPreset] = useState<BlockPreset | null>(null);
  const [menu, setMenu] = useState<{ slot: ScheduleSlotDto; date: string } | null>(null);

  const week = useAsync(() => adminApi.schedule(space.id, monday, 7), `${space.id}-${monday}`);

  function refresh() {
    week.reload();
    refreshCounters();
  }

  const days = week.data?.days ?? [];
  // Rows: every distinct start time of the week (days may have different hours).
  const times = [...new Set(days.flatMap((d) => d.slots.map((s) => s.startTime)))].sort();
  const bookedCount = days.reduce(
    (n, d) => n + d.slots.filter((s) => s.state === 'BOOKED').length,
    0,
  );
  const blockSize =
    menu?.slot.block && days.length
      ? days.flatMap((d) => d.slots).filter((s) => s.block?.id === menu.slot.block!.id).length
      : 0;

  return (
    <>
      <PageHeader
        title={t('calendar.title')}
        sub={`${t('calendar.week', {
          from: formatShortDate(monday, locale),
          to: formatShortDate(addDays(monday, 6), locale),
        })}${week.data ? t('calendar.booked', { count: bookedCount }) : ''}`}
        actions={
          <>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label={t('calendar.prev')}
              onClick={() => setMonday((m) => addDays(m, -7))}
            >
              <Icon name="back" size={16} />
            </button>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => setMonday(mondayOf(today))}
              disabled={monday === mondayOf(today)}
            >
              {t('calendar.thisWeek')}
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              aria-label={t('calendar.next')}
              onClick={() => setMonday((m) => addDays(m, 7))}
            >
              <Icon name="next" size={16} />
            </button>
          </>
        }
      />

      <section className={cx(styles.card, styles.cardPad)} aria-label={t('calendar.plan')}>
        <ScheduleKey />
        {week.error ? (
          <LoadError error={week.error} onRetry={week.reload} />
        ) : !week.data ? (
          <Loading />
        ) : (
          <div className={styles.tableWrap}>
            <div className={styles.week} role="grid" aria-label={t('calendar.grid')}>
              <div role="row" style={{ display: 'contents' }}>
                <span />
                {days.map((d) => (
                  <span
                    key={d.date}
                    role="columnheader"
                    className={cx(styles.weekHead, d.date === today && styles.weekHeadToday)}
                  >
                    {formatShortDate(d.date, locale)}
                    {d.date === today ? t('calendar.today') : ''}
                    {!d.isOpen ? (
                      <span className={styles.cellSub}>{t('calendar.closed')}</span>
                    ) : null}
                  </span>
                ))}
              </div>
              {times.map((time) => (
                <div key={time} role="row" style={{ display: 'contents' }}>
                  <span role="rowheader" className={styles.weekTime}>
                    {time}
                  </span>
                  {days.map((d) => {
                    const slot = d.slots.find((s) => s.startTime === time);
                    return slot ? (
                      <div role="gridcell" key={d.date} style={{ display: 'grid' }}>
                        <SlotCell
                          slot={slot}
                          onSelect={(s) =>
                            s.booking ? setOpenId(s.booking.id) : setMenu({ slot: s, date: d.date })
                          }
                        />
                      </div>
                    ) : (
                      <div role="gridcell" key={d.date} className={styles.weekCellEmpty} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
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
        slot={menu?.slot ?? null}
        date={menu?.date ?? today}
        blockSize={blockSize}
        onClose={() => setMenu(null)}
        onBook={(s) => {
          const date = menu!.date;
          setMenu(null);
          setNewPreset({ date, slotStart: s.start });
        }}
        onBlock={(s) => {
          const date = menu!.date;
          setMenu(null);
          setBlockPreset({ date, slotStart: s.start });
        }}
        onUnblocked={() => {
          setMenu(null);
          refresh();
        }}
      />
    </>
  );
}
