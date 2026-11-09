import {
  ADMIN_ROLE_LABELS_FR,
  BOOKING_STATUS_LABELS_FR,
  PAYMENT_METHOD_LABELS_FR,
  SESSION_MODE_LABELS_FR,
  type AdminBookingListItem,
  type AdminPaymentState,
  type PaymentMethod,
  type PaymentStatus,
} from '@bovann/shared';

export { ADMIN_ROLE_LABELS_FR, SESSION_MODE_LABELS_FR };

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
): {
  label: string;
  tone: Tone;
} {
  if (item.refundStatus === 'DUE') return { label: 'À rembourser', tone: 'danger' };
  switch (item.status) {
    case 'CONFIRMED':
      return item.paymentState === 'UNPAID'
        ? { label: 'Confirmée · à encaisser', tone: 'warning' }
        : { label: 'Confirmée', tone: 'success' };
    case 'PENDING_PAYMENT':
      return item.paymentState === 'PENDING'
        ? { label: 'Paiement en cours', tone: 'warning' }
        : { label: 'Abandonnée', tone: 'neutral' };
    case 'REFUNDED':
      return { label: 'Remboursée', tone: 'neutral' };
    case 'EXPIRED':
      return { label: 'Abandonnée', tone: 'neutral' };
    default:
      return { label: BOOKING_STATUS_LABELS_FR[item.status], tone: 'neutral' };
  }
}

const PAYMENT_STATE_LABELS: Record<AdminPaymentState, string> = {
  PAID: 'Payé',
  UNPAID: 'À encaisser',
  FREE: 'Gratuit',
  PENDING: 'En cours',
  NONE: '—',
};

export function paymentStateLabel(state: AdminPaymentState): string {
  return PAYMENT_STATE_LABELS[state];
}

const CHANNEL_LABELS: Record<string, string> = { TMONEY: 'T-Money', FLOOZ: 'Flooz' };

/** "T-Money", "Carte bancaire", "Espèces"… */
export function paymentMethodLabel(method: PaymentMethod | null, channel?: string | null): string {
  if (!method) return '—';
  if (method === 'MOBILE_MONEY' && channel) return CHANNEL_LABELS[channel] ?? channel;
  return PAYMENT_METHOD_LABELS_FR[method];
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  INITIATED: { label: 'Initié', tone: 'neutral' },
  PENDING: { label: 'En attente', tone: 'warning' },
  SUCCEEDED: { label: 'Reçu', tone: 'success' },
  FAILED: { label: 'Échoué', tone: 'danger' },
  CANCELLED: { label: 'Annulé', tone: 'neutral' },
  REFUNDED: { label: 'Remboursé', tone: 'neutral' },
};

/** "12 nov. 2026 à 14:05" in the studio's time zone. */
export function formatDateTime(iso: string, timeZone = 'Africa/Lome'): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  })
    .format(new Date(iso))
    .replace(',', ' à');
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

/** "15 000" typed by an admin → 15000; null when not a whole positive amount. */
export function parseAmount(value: string): number | null {
  const digits = value.replace(/[\s\u00a0\u202f.]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

export function formatAmountInput(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return new Intl.NumberFormat('fr-FR').format(n).replace(/[\u00a0\u202f]/g, ' ');
}
