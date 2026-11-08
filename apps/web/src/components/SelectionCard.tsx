import { SESSION_MODE_LABELS_FR, formatXof, type SessionMode } from '@bovann/shared';
import Link from 'next/link';
import { formatShortDate } from '@/lib/dates';
import type { SelectionSummary } from '@/lib/flow';
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
  return (
    <div className={styles.card}>
      <span className={styles.text}>
        <strong>
          {summary.label} · {formatXof(summary.totalXof)}
        </strong>
        <span>
          {formatShortDate(date)} · {summary.timesLabel} · {SESSION_MODE_LABELS_FR[mode]}
        </span>
      </span>
      {editable ? (
        <Link href="/reserver/creneaux" className={styles.edit}>
          Modifier
        </Link>
      ) : null}
    </div>
  );
}
