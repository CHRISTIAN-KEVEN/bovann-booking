'use client';

import type { ScheduleSlotDto } from '@bovann/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import { formatLongDate } from '@/lib/dates';
import { useAdmin } from './AdminShell';
import { Dialog, errorMessage, Field, Loading, adminStyles as styles, useToast } from './ui';

const REASONS = ['Maintenance', 'Tournage privé', 'Événement du studio', 'Congé de l’équipe'];

export interface BlockPreset {
  date: string;
  slotStart?: string;
}

/** Make slots unbookable for customers (maintenance, private event…). */
export function BlockDialog({
  preset,
  onClose,
  onDone,
}: {
  preset: BlockPreset | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { space } = useAdmin();
  const toast = useToast();
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<ScheduleSlotDto[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!preset) return;
    setDate(preset.date);
    setSelected(preset.slotStart ? [preset.slotStart] : []);
    setReason('');
    setError(null);
  }, [preset]);

  useEffect(() => {
    if (!preset || !date) return;
    let cancelled = false;
    setSlots(null);
    adminApi.schedule(space.id, date, 1).then(
      (s) => !cancelled && setSlots(s.days[0]?.slots ?? []),
      (err: unknown) => !cancelled && setError(errorMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [preset, date, space.id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (selected.length === 0) {
      setError('Choisissez au moins un créneau.');
      return;
    }
    if (!reason.trim()) {
      setError('Indiquez le motif.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.createBlock(space.id, selected, reason.trim());
      toast(`${selected.length} créneau${selected.length > 1 ? 'x bloqués' : ' bloqué'}.`);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={preset !== null}
      onClose={onClose}
      title="Bloquer des créneaux"
      variant="modal"
      footer={
        <>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="block-form" className={styles.btn} disabled={busy}>
            {busy ? 'Blocage…' : 'Bloquer'}
          </button>
        </>
      }
    >
      <form id="block-form" className={styles.section} onSubmit={submit} noValidate>
        <p className={styles.note}>
          Les créneaux bloqués ne peuvent plus être réservés en ligne. Les clients les voient
          simplement comme indisponibles.
        </p>
        <Field label="Date">
          {(p) => (
            <input
              {...p}
              type="date"
              className={styles.input}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSelected([]);
              }}
            />
          )}
        </Field>
        {!slots ? (
          <Loading />
        ) : slots.length === 0 ? (
          <p className={styles.note}>Le studio est fermé ce jour-là.</p>
        ) : (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Créneaux libres</legend>
            <div className={styles.chips}>
              {slots.map((s) => (
                <button
                  key={s.start}
                  type="button"
                  className={styles.chip}
                  aria-pressed={selected.includes(s.start)}
                  disabled={s.state !== 'FREE' || s.isPast}
                  onClick={() =>
                    setSelected((list) =>
                      list.includes(s.start)
                        ? list.filter((x) => x !== s.start)
                        : [...list, s.start],
                    )
                  }
                >
                  {s.startTime}–{s.endTime}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <Field label="Motif">
          {(p) => (
            <input
              {...p}
              className={styles.input}
              list="block-reasons"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <datalist id="block-reasons">
          {REASONS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        {error ? (
          <div className={styles.banner} role="alert">
            {error}
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}

/** What to do with a free or blocked slot clicked in the planning. */
export function SlotMenu({
  slot,
  date,
  blockSize,
  onClose,
  onBook,
  onBlock,
  onUnblocked,
}: {
  slot: ScheduleSlotDto | null;
  date: string;
  /** Slots covered by the same block (all are freed together). */
  blockSize: number;
  onClose: () => void;
  onBook: (slot: ScheduleSlotDto) => void;
  onBlock: (slot: ScheduleSlotDto) => void;
  onUnblocked: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [slot]);

  async function unblock() {
    if (!slot?.block) return;
    setBusy(true);
    try {
      await adminApi.deleteBlock(slot.block.id);
      toast(blockSize > 1 ? `${blockSize} créneaux débloqués.` : 'Créneau débloqué.');
      onUnblocked();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={slot !== null}
      onClose={onClose}
      variant="modal"
      title={slot ? `${formatLongDate(date)} · ${slot.startTime}–${slot.endTime}` : ''}
    >
      {slot?.state === 'BLOCKED' ? (
        <>
          <p>
            Créneau bloqué&nbsp;: <strong>{slot.block?.reason}</strong>
            {blockSize > 1 ? ` (blocage de ${blockSize} créneaux, débloqués ensemble)` : ''}
          </p>
          {error ? (
            <div className={styles.banner} role="alert">
              {error}
            </div>
          ) : null}
          <div className={styles.formActions}>
            <button type="button" className={styles.btn} onClick={unblock} disabled={busy}>
              {busy ? 'Déblocage…' : 'Débloquer'}
            </button>
            <button type="button" className={styles.btnSecondary} onClick={onClose}>
              Fermer
            </button>
          </div>
        </>
      ) : slot ? (
        <>
          <p className={styles.muted}>Ce créneau est libre.</p>
          <div className={styles.formActions}>
            <button type="button" className={styles.btn} onClick={() => onBook(slot)}>
              Réserver pour un client
            </button>
            <button type="button" className={styles.btnSecondary} onClick={() => onBlock(slot)}>
              Bloquer
            </button>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
