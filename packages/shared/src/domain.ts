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

export const PAYMENT_METHODS = ['MOBILE_MONEY', 'CARD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

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

export const BOOKING_STATUS_LABELS_FR: Record<BookingStatus, string> = {
  PENDING_PAYMENT: 'En attente de paiement',
  CONFIRMED: 'Confirmée',
  CANCELLED: 'Annulée',
  EXPIRED: 'Expirée',
  REFUNDED: 'Remboursée',
};

/** All amounts are whole West African CFA francs (XOF has no minor unit). */
export const CURRENCY = 'XOF' as const;
