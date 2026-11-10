'use client';

import type { DayStatus, MonthAvailabilityResponse, SpaceDto } from '@bovann/shared';
import { SESSION_MODE_LABELS } from '@bovann/shared';
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
import { Link, useI18n, useLocaleRouter, type TKey } from '@/i18n/I18nProvider';
import { api, ApiError } from '@/lib/api';
import {
  formatLongDate,
  formatMonth,
  leadingBlanks,
  monthOf,
  shiftMonth,
  weekdayInitials,
} from '@/lib/dates';
import { useStepGuard } from '@/lib/useStepGuard';
import styles from './page.module.css';

const statusKey = (s: DayStatus) => `date.status.${s}` as TKey;

const BOOKABLE: DayStatus[] = ['AVAILABLE', 'FEW'];

/** Screen 2: month calendar. Tapping an open day goes straight to its slots. */
export default function DatePage() {
  const router = useLocaleRouter();
  const { t, locale } = useI18n();
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
        setError(e instanceof ApiError ? e.message : t('common.genericError')),
      );
  }, [t]);

  const loadMonth = useCallback(
    (m: string) => {
      setData(null);
      setError(null);
      api
        .month(m)
        .then(setData)
        .catch((e: unknown) =>
          setError(e instanceof ApiError ? e.message : t('common.genericError')),
        );
    },
    [t],
  );

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
      <StepHeader step={2} label={t('date.step')} backHref="/" />
      <Body>
        <div className={styles.titleRow}>
          <PageTitle>{t('date.title')}</PageTitle>
          {flow.mode ? (
            <Link
              href="/"
              className={styles.modeChip}
              aria-label={t('date.modeLabel', { mode: SESSION_MODE_LABELS[locale][flow.mode] })}
            >
              <Icon name={flow.mode === 'IN_PERSON' ? 'video' : 'monitor'} size={13} />
              {SESSION_MODE_LABELS[locale][flow.mode]}
            </Link>
          ) : null}
        </div>

        {error ? (
          <Alert
            tone="error"
            title={t('date.loadError')}
            action={
              month ? (
                <button
                  type="button"
                  className={buttonSecondaryClass}
                  onClick={() => loadMonth(month)}
                >
                  {t('common.retry')}
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
              aria-label={t('date.prevMonth')}
            >
              <Icon name="back" size={18} />
            </button>
            <h2 className={styles.monthLabel} aria-live="polite">
              {month ? formatMonth(month, locale) : '…'}
            </h2>
            <button
              type="button"
              className={styles.navButton}
              onClick={() => goMonth(1)}
              disabled={!month || !maxMonth || month >= maxMonth}
              aria-label={t('date.nextMonth')}
            >
              <Icon name="next" size={18} />
            </button>
          </div>

          <div className={styles.weekdays} aria-hidden="true">
            {weekdayInitials(locale).map((d, i) => (
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
                    aria-label={`${formatLongDate(d.date, false, locale)}, ${t(statusKey(d.status))}`}
                  >
                    <span>{dayNumber}</span>
                    <span className={styles.dot} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={styles.grid} role="status" aria-label={t('date.loadingDays')}>
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
              {t('date.legendAvailable')}
            </span>
            <span>
              <span className={`${styles.legendDot} ${styles.legendFew}`} aria-hidden="true" />
              {t('date.legendFew')}
            </span>
            <span>
              <span className={styles.legendStrike} aria-hidden="true">
                14
              </span>
              {t('date.legendFull')}
            </span>
          </div>
        </section>

        {data && !data.days.some((d) => BOOKABLE.includes(d.status)) ? (
          <Alert tone="info" title={t('date.noneTitle')}>
            {t('date.noneText')}
          </Alert>
        ) : data ? (
          <p className={styles.hint}>{t('date.hint')}</p>
        ) : null}
      </Body>
      <BottomBar step={2} />
    </Screen>
  );
}
