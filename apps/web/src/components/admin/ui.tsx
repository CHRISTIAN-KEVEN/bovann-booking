'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ApiError } from '@/lib/api';
import type { Tone } from '@/lib/admin-format';
import { Icon } from '../icons';
import styles from './admin.module.css';

export { styles as adminStyles };

export const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.cellStack}>
        <h1 className={styles.pageTitle}>{title}</h1>
        {sub ? <span className={styles.pageSub}>{sub}</span> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}

export function StatTile({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={cx(styles.stat, highlight && styles.statHighlight)}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cx(styles.badge, styles[`badge_${tone}`])}>{children}</span>;
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; count?: number }>;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={styles.tabs}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={cx(styles.tab, o.value === value && styles.tabActive)}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count ? ` (${o.count})` : ''}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className={styles.segmented}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Label + control + hint/error, wired for screen readers. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <span id={`${id}-error`} className={styles.error}>
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function AmountInput({
  id,
  value,
  onChange,
  disabled,
  ...aria
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-label'?: string;
}) {
  return (
    <span className={styles.amount}>
      <input
        id={id}
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        {...aria}
      />
      <span>FCFA</span>
    </span>
  );
}

/**
 * Side panel (`variant="panel"`) or centred modal, on the native <dialog>:
 * focus is trapped, Escape closes, the page behind is inert.
 */
export function Dialog({
  open,
  onClose,
  title,
  variant = 'panel',
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  variant?: 'panel' | 'modal';
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx(styles.dialog, variant === 'panel' ? styles.panel : styles.modal)}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // A click on the backdrop (outside the content) closes.
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className={styles.dialogBody}>
          <div className={styles.dialogHeader}>
            <h2 id={titleId} className={styles.dialogTitle}>
              {title}
            </h2>
            <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Fermer">
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className={styles.dialogContent}>{children}</div>
          {footer ? <div className={styles.dialogFooter}>{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className={styles.pagination} aria-label="Pages">
      <span>
        {from}–{to} sur {total}
      </span>
      <div className={styles.actions}>
        <button
          type="button"
          className={cx(styles.btnSecondary, styles.btnSmall)}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Précédent
        </button>
        <button
          type="button"
          className={cx(styles.btnSecondary, styles.btnSmall)}
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Suivant
        </button>
      </div>
    </nav>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <span>{children}</span>
      {action}
    </div>
  );
}

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className={styles.empty} role="alert">
      <span>{errorMessage(error)}</span>
      <button type="button" className={styles.btnSecondary} onClick={onRetry}>
        Réessayer
      </button>
    </div>
  );
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className={styles.empty} role="status">
      {label}
    </div>
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Une erreur est survenue. Réessayez.';
}

/** Bookings that stop a settings change (409 with details.bookings). */
export function ConflictList({ error }: { error: unknown }) {
  const bookings =
    error instanceof ApiError
      ? (
          error.details as
            | {
                bookings?: Array<{
                  reference: string;
                  date: string;
                  startTime: string;
                  endTime: string;
                  customerName: string;
                }>;
              }
            | undefined
        )?.bookings
      : undefined;
  if (!bookings?.length) return null;
  return (
    <ul className={styles.conflicts}>
      {bookings.map((b) => (
        <li key={b.reference}>
          {b.reference} · {b.date} {b.startTime}–{b.endTime} · {b.customerName}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- data loading

export interface Async<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (data: T) => void;
}

/** Loads data when `key` changes; keeps the previous data while reloading. */
export function useAsync<T>(load: () => Promise<T>, key: string): Async<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadRef.current().then(
      (result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

// ---------------------------------------------------------------- toasts

interface ToastItem {
  id: number;
  message: string;
  error: boolean;
}

const ToastContext = createContext<(message: string, error?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const show = useCallback((message: string, error = false) => {
    counter.current += 1;
    const id = counter.current;
    setItems((list) => [...list, { id, message, error }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={styles.toasts} role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx(styles.toast, t.error && styles.toastError)}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const TIMES = Array.from({ length: 24 * 4 }, (_, i) => {
  const h = String(Math.floor(i / 4)).padStart(2, '0');
  const m = String((i % 4) * 15).padStart(2, '0');
  return `${h}:${m}`;
});

/** 24-hour time picker in 15-minute steps (the native one follows the browser's locale). */
export function TimeSelect({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  const options = TIMES.includes(value) ? TIMES : [...TIMES, value].sort();
  return (
    <select
      {...rest}
      className={rest.className ?? styles.select}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
