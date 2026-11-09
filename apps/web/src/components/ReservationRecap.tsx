'use client';

import { SESSION_MODE_LABELS_FR, formatXof } from '@bovann/shared';
import Link from 'next/link';
import { formatLongDate } from '@/lib/dates';
import { useFlow } from './FlowProvider';
import styles from './ui.module.css';

/**
 * Desktop-only recap at the top of the side panel: what the customer chose in the steps before
 * the current one. Hidden on phones, where the bottom bar stays as it was.
 */
export function ReservationRecap({ step, locked = false }: { step: number; locked?: boolean }) {
  const { flow } = useFlow();
  const rows: { label: string; value: string; href?: string }[] = [];
  if (step > 1 && flow.mode)
    rows.push({ label: 'Mode', value: SESSION_MODE_LABELS_FR[flow.mode], href: '/' });
  if (step > 2 && flow.date)
    rows.push({ label: 'Date', value: formatLongDate(flow.date), href: '/reserver/date' });
  if (step > 3 && flow.summary)
    rows.push({
      label: flow.summary.label,
      value: flow.summary.timesLabel,
      href: '/reserver/creneaux',
    });

  return (
    <div className={styles.recap}>
      <h2 className={styles.recapTitle}>Votre réservation</h2>
      {rows.length ? (
        <dl className={styles.recapRows}>
          {rows.map((r) => (
            <div key={r.label} className={styles.recapRow}>
              <dt>{r.label}</dt>
              <dd>
                {r.value}
                {r.href && !locked ? (
                  <Link href={r.href} className={styles.recapEdit}>
                    Modifier
                  </Link>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {step > 3 && flow.summary ? (
        <div className={styles.recapTotal}>
          <span>Total</span>
          <strong>{formatXof(flow.summary.totalXof)}</strong>
        </div>
      ) : null}
    </div>
  );
}
