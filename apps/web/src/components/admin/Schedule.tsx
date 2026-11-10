'use client';

import type { ScheduleSlotDto } from '@bovann/shared';
import { useI18n, type T } from '@/i18n/I18nProvider';
import { cx, adminStyles as styles } from './ui';

export function slotLabel(slot: ScheduleSlotDto, t: T): string {
  switch (slot.state) {
    case 'BOOKED':
      return slot.booking?.customerName ?? t('schedule.booked');
    case 'PENDING':
      return t('schedule.pending');
    case 'BLOCKED':
      return slot.block?.reason || t('schedule.blocked');
    case 'CLOSED':
      return t('schedule.closed');
    default:
      return slot.isPast ? t('schedule.past') : t('schedule.free');
  }
}

export function ScheduleKey() {
  const { t } = useI18n();
  return (
    <div className={styles.key} aria-hidden="true">
      <span className={styles.keyItem}>
        <span className={styles.swatch} style={{ background: 'var(--color-accent)' }} />
        {t('schedule.booked')}
      </span>
      <span className={styles.keyItem}>
        <span className={styles.swatch} style={{ background: '#fdba74' }} />
        {t('schedule.pending')}
      </span>
      <span className={styles.keyItem}>
        <span className={styles.swatch} style={{ background: '#4b4d55' }} />
        {t('schedule.blocked')}
      </span>
      <span className={styles.keyItem}>
        <span
          className={styles.swatch}
          style={{ background: '#fff', border: '1px solid var(--color-border-strong)' }}
        />
        {t('schedule.free')}
      </span>
    </div>
  );
}

/** One slot of the planning; what a click does depends on its state. */
export function SlotCell({
  slot,
  onSelect,
}: {
  slot: ScheduleSlotDto;
  onSelect: (slot: ScheduleSlotDto) => void;
}) {
  const { t } = useI18n();
  const label = slotLabel(slot, t);
  const disabled = slot.state === 'CLOSED' || (slot.state === 'FREE' && slot.isPast);
  const action =
    slot.state === 'BOOKED' || slot.state === 'PENDING'
      ? t('schedule.seeBooking')
      : slot.state === 'BLOCKED'
        ? t('schedule.manageBlock')
        : t('schedule.bookOrBlock');
  const times = `${slot.startTime}–${slot.endTime}`;
  return (
    <button
      type="button"
      className={cx(styles.slot, styles[`slot_${slot.state}`], slot.isPast && styles.slotPast)}
      disabled={disabled}
      onClick={() => onSelect(slot)}
      aria-label={`${t('schedule.cellLabel', { times, label })}${disabled ? '' : `, ${action}`}`}
      title={slot.booking ? `${slot.booking.reference} · ${slot.booking.businessName}` : label}
    >
      <strong>{slot.startTime}</strong>
      <span className={styles.slotLabel}>{label}</span>
    </button>
  );
}
