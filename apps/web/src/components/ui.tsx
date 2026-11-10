import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { ReservationRecap } from './ReservationRecap';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import styles from './ui.module.css';

/**
 * Page shell for every customer screen. Phones: one column with the action bar at the bottom.
 * Desktop (>= 1024px): `flow` puts the step content on the left and the action bar, as a
 * "Votre réservation" panel, on the right; `single` is one centred column (confirmation).
 */
export function Screen({
  children,
  title,
  layout = 'flow',
}: {
  children: ReactNode;
  title?: string;
  layout?: 'flow' | 'single';
}) {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <div
        className={`${styles.screen} ${layout === 'flow' ? styles.screenFlow : styles.screenSingle}`}
      >
        {title ? <h1 className={styles.srOnly}>{title}</h1> : null}
        {children}
      </div>
      <SiteFooter />
    </div>
  );
}

export function StepHeader({
  step,
  label,
  backHref,
}: {
  step: number;
  label: string;
  backHref: string;
}) {
  return (
    <div className={styles.stepHeader}>
      <div className={styles.stepRow}>
        <Link href={backHref} className={styles.backLink} aria-label="Retour à l’étape précédente">
          <Icon name="back" size={22} />
        </Link>
        <span className={styles.stepLabel}>
          Étape {step} sur 5 · {label}
        </span>
      </div>
      <div
        className={styles.progress}
        role="progressbar"
        aria-label="Progression de la réservation"
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={step}
      >
        <div className={styles.progressFill} style={{ width: `${step * 20}%` }} />
      </div>
    </div>
  );
}

export function Body({ children, scroll = false }: { children: ReactNode; scroll?: boolean }) {
  return (
    <main className={scroll ? `${styles.body} ${styles.bodyScroll}` : styles.body}>{children}</main>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className={styles.titleBlock}>
      <h1 className={styles.title}>{children}</h1>
      {sub ? <p className={styles.subtitle}>{sub}</p> : null}
    </div>
  );
}

/**
 * Sticky action bar at the bottom of each step on phones; on desktop, the side panel.
 * `step` adds the desktop-only recap of the earlier choices; `locked` hides its edit links.
 */
export function BottomBar({
  children,
  summary,
  step,
  locked,
}: {
  /** Without an action (a step where tapping the content moves on), phones show no bar. */
  children?: ReactNode;
  summary?: ReactNode;
  step?: number;
  locked?: boolean;
}) {
  return (
    <footer className={`${styles.bottomBar} ${children ? '' : styles.bottomBarRecapOnly}`}>
      {step ? <ReservationRecap step={step} locked={locked} /> : null}
      {children ? (
        <div className={styles.bottomRow}>
          {summary ? <div className={styles.bottomSummary}>{summary}</div> : null}
          <div className={summary ? styles.bottomActionInline : styles.bottomAction}>
            {children}
          </div>
        </div>
      ) : null}
    </footer>
  );
}

type Tone = 'info' | 'success' | 'warning' | 'error';
const TONE_ICON: Record<Tone, IconName> = {
  info: 'alert',
  success: 'check',
  warning: 'alert',
  error: 'alert',
};

export function Alert({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={`${styles.alert} ${styles[`alert_${tone}`]}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon name={TONE_ICON[tone]} size={18} className={styles.alertIcon} />
      <div className={styles.alertContent}>
        {title ? <strong>{title}</strong> : null}
        {children ? <span>{children}</span> : null}
        {action}
      </div>
    </div>
  );
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className={styles.spinnerWrap} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ height = 52, count = 1 }: { height?: number; count?: number }) {
  return (
    <div className={styles.skeletonList} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.skeleton} style={{ height }} />
      ))}
    </div>
  );
}

/** Small spinner inside a button while its request runs (inherits the text colour). */
export function ButtonSpinner() {
  return <span className={styles.buttonSpinner} aria-hidden="true" />;
}

/** Placeholder block with the loading shimmer, sized by the caller's class. */
export function SkeletonBlock({ className, dark = false }: { className?: string; dark?: boolean }) {
  return (
    <span
      className={`${styles.skeleton} ${dark ? styles.skeletonDark : ''} ${className ?? ''}`}
      aria-hidden="true"
    />
  );
}

export const buttonClass = styles.button;
export const buttonSecondaryClass = styles.buttonSecondary;
export const buttonDarkClass = styles.buttonDark;
