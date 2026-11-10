'use client';

import { SESSION_MODE_LABELS, formatXof } from '@bovann/shared';
import { Link, useI18n } from '@/i18n/I18nProvider';
import { formatLongDate } from '@/lib/dates';
import { selectionLabel } from '@/lib/selection';
import { useFlow } from './FlowProvider';
import styles from './ui.module.css';

/**
 * Desktop-only recap at the top of the side panel: what the customer chose in the steps before
 * the current one. Hidden on phones, where the bottom bar stays as it was.
 */
export function ReservationRecap({ step, locked = false }: { step: number; locked?: boolean }) {
  const { flow } = useFlow();
  const { t, locale } = useI18n();
  const rows: { label: string; value: string; href?: string }[] = [];
  if (step > 1 && flow.mode)
    rows.push({
      label: t('common.mode'),
      value: SESSION_MODE_LABELS[locale][flow.mode],
      href: '/',
    });
  if (step > 2 && flow.date)
    rows.push({
      label: t('common.date'),
      value: formatLongDate(flow.date, false, locale),
      href: '/reserver/date',
    });
  if (step > 3 && flow.summary)
    rows.push({
      label: selectionLabel(flow.summary, t),
      value: flow.summary.timesLabel,
      href: '/reserver/creneaux',
    });

  return (
    <div className={styles.recap}>
      <h2 className={styles.recapTitle}>{t('recap.title')}</h2>
      {rows.length ? (
        <dl className={styles.recapRows}>
          {rows.map((r) => (
            <div key={r.href} className={styles.recapRow}>
              <dt>{r.label}</dt>
              <dd>
                {r.value}
                {r.href && !locked ? (
                  <Link href={r.href} className={styles.recapEdit}>
                    {t('common.edit')}
                  </Link>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {step > 3 && flow.summary ? (
        <div className={styles.recapTotal}>
          <span>{t('common.total')}</span>
          <strong>{formatXof(flow.summary.totalXof, locale)}</strong>
        </div>
      ) : null}
    </div>
  );
}
