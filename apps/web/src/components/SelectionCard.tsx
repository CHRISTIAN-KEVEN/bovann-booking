'use client';

import { SESSION_MODE_LABELS, formatXof, type SessionMode } from '@bovann/shared';
import { Link, useI18n } from '@/i18n/I18nProvider';
import { formatShortDate } from '@/lib/dates';
import type { SelectionSummary } from '@/lib/flow';
import { selectionLabel } from '@/lib/selection';
import styles from './SelectionCard.module.css';

/** Compact recap of the chosen slots, with a link back to change them. */
export function SelectionCard({
  summary,
  date,
  mode,
  editable = true,
}: {
  summary: SelectionSummary;
  date: string;
  mode: SessionMode;
  editable?: boolean;
}) {
  const { t, locale } = useI18n();
  return (
    <div className={styles.card}>
      <span className={styles.text}>
        <strong>
          {selectionLabel(summary, t)} · {formatXof(summary.totalXof, locale)}
        </strong>
        <span>
          {formatShortDate(date, locale)} · {summary.timesLabel} ·{' '}
          {SESSION_MODE_LABELS[locale][mode]}
        </span>
      </span>
      {editable ? (
        <Link href="/reserver/creneaux" className={styles.edit}>
          {t('common.edit')}
        </Link>
      ) : null}
    </div>
  );
}
