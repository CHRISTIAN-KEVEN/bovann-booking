'use client';

import type { ScheduleSlotDto } from '@bovann/shared';
import { cx, adminStyles as styles } from './ui';

export function slotLabel(slot: ScheduleSlotDto): string {
  switch (slot.state) {
    case 'BOOKED':
      return slot.booking?.customerName ?? 'Réservé';
    case 'PENDING':
      return 'Paiement en cours';
    case 'BLOCKED':
      return slot.block?.reason || 'Bloqué';
    case 'CLOSED':
      return 'Fermé';
    default:
      return slot.isPast ? 'Passé' : 'Libre';
  }
}

export function ScheduleKey() {
  return (
    <div className={styles.key} aria-hidden="true">
      <span className={styles.keyItem}>
        <span className={styles.swatch} style={{ background: 'var(--color-accent)' }} />
        Réservé
      </span>
      <span className={styles.keyItem}>
        <span className={styles.swatch} style={{ background: '#fdba74' }} />
        Paiement en cours
      </span>
      <span className={styles.keyItem}>
        <span className={styles.swatch} style={{ background: '#4b4d55' }} />
        Bloqué
      </span>
      <span className={styles.keyItem}>
        <span
          className={styles.swatch}
          style={{ background: '#fff', border: '1px solid var(--color-border-strong)' }}
        />
        Libre
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
  const label = slotLabel(slot);
  const disabled = slot.state === 'CLOSED' || (slot.state === 'FREE' && slot.isPast);
  const action =
    slot.state === 'BOOKED' || slot.state === 'PENDING'
      ? 'voir la réservation'
      : slot.state === 'BLOCKED'
        ? 'gérer le blocage'
        : 'réserver ou bloquer';
  return (
    <button
      type="button"
      className={cx(styles.slot, styles[`slot_${slot.state}`], slot.isPast && styles.slotPast)}
      disabled={disabled}
      onClick={() => onSelect(slot)}
      aria-label={`${slot.startTime}–${slot.endTime} : ${label}${disabled ? '' : `, ${action}`}`}
      title={slot.booking ? `${slot.booking.reference} · ${slot.booking.businessName}` : label}
    >
      <strong>{slot.startTime}</strong>
      <span className={styles.slotLabel}>{label}</span>
    </button>
  );
}
