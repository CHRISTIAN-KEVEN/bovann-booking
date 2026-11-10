'use client';

import type { DayStatus, MonthAvailabilityResponse, SpaceDto } from '@bovann/shared';
import { SESSION_MODE_LABELS_FR } from '@bovann/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useFlow } from '@/components/FlowProvider';
import { Icon } from '@/components/icons';
import {
  Alert,
  Body,
  BottomBar,
  PageTitle,
  Screen,
  SkeletonBlock,
  StepHeader,
  buttonSecondaryClass,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import {
  WEEKDAY_INITIALS,
  formatLongDate,
  formatMonth,
  leadingBlanks,
  monthOf,
  shiftMonth,
} from '@/lib/dates';
import { useStepGuard } from '@/lib/useStepGuard';
import styles from './page.module.css';

const STATUS_LABEL: Record<DayStatus, string> = {
  AVAILABLE: 'disponible',
  FEW: 'presque complet',
  FULL: 'complet',
  CLOSED: 'fermé',
  PAST: 'passé',
  OUT_OF_RANGE: 'pas encore ouvert à la réservation',
};

const BOOKABLE: DayStatus[] = ['AVAILABLE', 'FEW'];

/** Screen 2: month calendar. Tapping an open day goes straight to its slots. */
export default function DatePage() {
  const router = useRouter();
  const allowed = useStepGuard('/reserver/date');
  const { flow, update } = useFlow();
  const [space, setSpace] = useState<SpaceDto | null>(null);
  const [data, setData] = useState<MonthAvailabilityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const month = flow.month ?? (space ? monthOf(space.booking.today) : undefined);

  useEffect(() => {
    api
      .space()
      .then(setSpace)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.'),
      );
  }, []);

  const loadMonth = useCallback((m: string) => {
    setData(null);
    setError(null);
    api
      .month(m)
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.'),
      );
  }, []);

  useEffect(() => {
    if (month) loadMonth(month);
  }, [month, loadMonth]);

  if (!allowed) return null;

  const minMonth = space ? monthOf(space.booking.today) : undefined;
  const maxMonth = space ? monthOf(space.booking.lastBookableDate) : undefined;

  function goMonth(delta: number) {
    if (!month) return;
    update({ month: shiftMonth(month, delta) });
  }

  function openDay(date: string) {
    // Same date as before: the flow keeps the slots already picked.
    update({ date });
    router.push('/reserver/creneaux');
  }

  return (
    <Screen>
      <StepHeader step={2} label="Date" backHref="/" />
      <Body>
        <div className={styles.titleRow}>
          <PageTitle>Choisissez une date</PageTitle>
          {flow.mode ? (
            <Link
              href="/"
              className={styles.modeChip}
              aria-label={`Mode\u00a0: ${SESSION_MODE_LABELS_FR[flow.mode]}. Modifier`}
            >
              <Icon name={flow.mode === 'IN_PERSON' ? 'video' : 'monitor'} size={13} />
              {SESSION_MODE_LABELS_FR[flow.mode]}
            </Link>
          ) : null}
        </div>

        {error ? (
          <Alert
            tone="error"
            title="Impossible d’afficher le calendrier"
            action={
              month ? (
                <button
                  type="button"
                  className={buttonSecondaryClass}
                  onClick={() => loadMonth(month)}
                >
                  Réessayer
                </button>
              ) : null
            }
          >
            {error}
          </Alert>
        ) : null}

        <section className={styles.calendar} aria-label="Calendrier">
          <div className={styles.monthNav}>
            <button
              type="button"
              className={styles.navButton}
              onClick={() => goMonth(-1)}
              disabled={!month || !minMonth || month <= minMonth}
              aria-label="Mois précédent"
            >
              <Icon name="back" size={18} />
            </button>
            <h2 className={styles.monthLabel} aria-live="polite">
              {month ? formatMonth(month) : '…'}
            </h2>
            <button
              type="button"
              className={styles.navButton}
              onClick={() => goMonth(1)}
              disabled={!month || !maxMonth || month >= maxMonth}
              aria-label="Mois suivant"
            >
              <Icon name="next" size={18} />
            </button>
          </div>

          <div className={styles.weekdays} aria-hidden="true">
            {WEEKDAY_INITIALS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>

          {data && month ? (
            <div className={styles.grid} role="group" aria-label={`Jours de ${formatMonth(month)}`}>
              {Array.from({ length: leadingBlanks(month) }, (_, i) => (
                <span key={`b${i}`} aria-hidden="true" />
              ))}
              {data.days.map((d) => {
                const bookable = BOOKABLE.includes(d.status);
                const isSelected = d.date === flow.date;
                const dayNumber = Number(d.date.slice(8));
                return (
                  <button
                    key={d.date}
                    type="button"
                    aria-pressed={isSelected}
                    disabled={!bookable}
                    onClick={() => openDay(d.date)}
                    className={`${styles.day} ${styles[`day_${d.status}`]} ${isSelected ? styles.daySelected : ''}`}
                    aria-label={`${formatLongDate(d.date)}, ${STATUS_LABEL[d.status]}`}
                  >
                    <span>{dayNumber}</span>
                    <span className={styles.dot} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={styles.grid} role="status" aria-label="Chargement des disponibilités…">
              {Array.from({ length: 35 }, (_, i) => (
                <SkeletonBlock key={i} className={styles.daySkeleton} />
              ))}
            </div>
          )}

          <div className={styles.legend}>
            <span>
              <span
                className={`${styles.legendDot} ${styles.legendAvailable}`}
                aria-hidden="true"
              />
              Disponible
            </span>
            <span>
              <span className={`${styles.legendDot} ${styles.legendFew}`} aria-hidden="true" />
              Presque complet
            </span>
            <span>
              <span className={styles.legendStrike} aria-hidden="true">
                14
              </span>
              Complet
            </span>
          </div>
        </section>

        {data && !data.days.some((d) => BOOKABLE.includes(d.status)) ? (
          <Alert tone="info" title="Aucune disponibilité ce mois-ci">
            Essayez le mois suivant.
          </Alert>
        ) : data ? (
          <p className={styles.hint}>Sélectionnez un jour pour voir ses créneaux.</p>
        ) : null}
      </Body>
      <BottomBar step={2} />
    </Screen>
  );
}
