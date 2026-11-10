import {
  ADMIN_ROLE_LABELS,
  BOOKING_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  SESSION_MODE_LABELS,
  type AdminBookingListItem,
  type Locale,
  type AdminPaymentState,
  type PaymentMethod,
  type PaymentStatus,
} from '@bovann/shared';
import type { T, TKey } from '@/i18n/I18nProvider';

export { ADMIN_ROLE_LABELS, SESSION_MODE_LABELS };

export type Tone = 'success' | 'warning' | 'neutral' | 'danger' | 'info';

/** "+22890123456" → "+228 90 12 34 56" (pairs after the country code; good enough for display). */
export function formatPhone(e164: string): string {
  const match = /^\+(1|2\d\d|3\d|4\d|[5-9]\d{1,2})(\d+)$/.exec(e164);
  if (!match) return e164;
  const [, cc, rest] = match;
  return `+${cc} ${rest!.replace(/(\d{2})(?=\d)/g, '$1 ').trim()}`;
}

export function bookingStatus(
  item: Pick<AdminBookingListItem, 'status' | 'refundStatus' | 'paymentState'>,
  t: T,
  locale: Locale,
): {
  label: string;
  tone: Tone;
} {
  if (item.refundStatus === 'DUE') return { label: t('adminFormat.refundDue'), tone: 'danger' };
  switch (item.status) {
    case 'CONFIRMED':
      return item.paymentState === 'UNPAID'
        ? { label: t('adminFormat.confirmedUnpaid'), tone: 'warning' }
        : { label: t('adminFormat.confirmed'), tone: 'success' };
    case 'PENDING_PAYMENT':
      return item.paymentState === 'PENDING'
        ? { label: t('adminFormat.paying'), tone: 'warning' }
        : { label: t('adminFormat.abandoned'), tone: 'neutral' };
    case 'REFUNDED':
      return { label: t('adminFormat.refunded'), tone: 'neutral' };
    case 'EXPIRED':
      return { label: t('adminFormat.abandoned'), tone: 'neutral' };
    default:
      return { label: BOOKING_STATUS_LABELS[locale][item.status], tone: 'neutral' };
  }
}

export function paymentStateLabel(state: AdminPaymentState, t: T): string {
  return t(`adminFormat.paymentState.${state}` as TKey);
}

const CHANNEL_LABELS: Record<string, string> = { TMONEY: 'T-Money', FLOOZ: 'Flooz' };

/** "T-Money", "Carte bancaire", "Espèces"… */
export function paymentMethodLabel(
  method: PaymentMethod | null,
  channel: string | null | undefined,
  locale: Locale,
): string {
  if (!method) return '—';
  if (method === 'MOBILE_MONEY' && channel) return CHANNEL_LABELS[channel] ?? channel;
  return PAYMENT_METHOD_LABELS[locale][method];
}

const PAYMENT_STATUS_TONES: Record<PaymentStatus, Tone> = {
  INITIATED: 'neutral',
  PENDING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  REFUNDED: 'neutral',
};

export function paymentStatusLabel(status: PaymentStatus, t: T): { label: string; tone: Tone } {
  return {
    label: t(`adminFormat.paymentStatus.${status}` as TKey),
    tone: PAYMENT_STATUS_TONES[status],
  };
}

/** "12 nov. 2026 à 14:05" / "12 Nov 2026 at 14:05" in the studio's time zone. */
export function formatDateTime(
  iso: string,
  timeZone = 'Africa/Lome',
  locale: Locale = 'fr',
): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  })
    .format(new Date(iso))
    .replace(',', locale === 'en' ? ' at' : ' à');
}

/** "12 nov. 2026" / "12 Nov 2026" in the studio's time zone. */
export function formatDay(iso: string, timeZone = 'Africa/Lome', locale: Locale = 'fr'): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(iso));
}

/** Today's local date ('YYYY-MM-DD') in the studio's time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() || 7;
  return addDays(date, 1 - weekday);
}

/**
 * "15 000" (French) or "15,000" (English) typed by an admin → 15000; null when not a whole
 * positive amount. A comma or dot only counts as a thousands separator ("15,5" is refused).
 */
export function parseAmount(value: string): number | null {
  const compact = value.replace(/[\s\u00a0\u202f]/g, '');
  if (/[.,]/.test(compact) && !/^\d{1,3}([.,]\d{3})+$/.test(compact)) return null;
  const digits = compact.replace(/[.,]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

export function formatAmountInput(n: number | null | undefined, locale: Locale = 'fr'): string {
  if (n === null || n === undefined) return '';
  return locale === 'en'
    ? new Intl.NumberFormat('en-GB').format(n)
    : new Intl.NumberFormat('fr-FR').format(n).replace(/[\u00a0\u202f]/g, ' ');
}
