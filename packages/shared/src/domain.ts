/**
 * Domain vocabulary shared by the API and the web app.
 * Values mirror the MySQL ENUM columns exactly: change both together.
 */

export const SESSION_MODES = ['IN_PERSON', 'VIRTUAL'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

export const BOOKING_TYPES = ['SLOTS', 'PACKAGE'] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];

export const BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const PAYMENT_METHODS = ['MOBILE_MONEY', 'CARD', 'CASH', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Methods a customer can choose online; the others are recorded by the studio. */
export const ONLINE_PAYMENT_METHODS = ['MOBILE_MONEY', 'CARD'] as const;
export type OnlinePaymentMethod = (typeof ONLINE_PAYMENT_METHODS)[number];

export const BOOKING_SOURCES = ['ONLINE', 'ADMIN'] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

export const REFUND_STATUSES = ['NONE', 'DUE', 'DONE'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'INITIATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const ADMIN_ROLES = ['OWNER', 'STAFF'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** French labels used in the UI and in notification emails. */
export const SESSION_MODE_LABELS_FR: Record<SessionMode, string> = {
  IN_PERSON: 'En studio',
  VIRTUAL: 'Virtuel',
};

export const PAYMENT_METHOD_LABELS_FR: Record<PaymentMethod, string> = {
  MOBILE_MONEY: 'Mobile Money',
  CARD: 'Carte bancaire',
  CASH: 'Espèces',
  BANK_TRANSFER: 'Virement',
  OTHER: 'Autre',
};

export const ADMIN_ROLE_LABELS_FR: Record<AdminRole, string> = {
  OWNER: 'Administrateur',
  STAFF: 'Équipe',
};

export const BOOKING_STATUS_LABELS_FR: Record<BookingStatus, string> = {
  PENDING_PAYMENT: 'En attente de paiement',
  CONFIRMED: 'Confirmée',
  CANCELLED: 'Annulée',
  EXPIRED: 'Expirée',
  REFUNDED: 'Remboursée',
};

/** All amounts are whole West African CFA francs (XOF has no minor unit). */
export const CURRENCY = 'XOF' as const;
