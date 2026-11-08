import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type {
  AdminRole,
  BookingStatus,
  BookingType,
  NotificationChannel,
  NotificationStatus,
  PaymentMethod,
  PaymentStatus,
  SessionMode,
} from '@bovann/shared';

/**
 * TypeScript view of the MySQL schema (migrations/*.ts are the source of truth).
 * Keep in sync with every migration; the integration test suite exercises
 * each table through these types.
 */

/** Column set by MySQL on insert (DEFAULT CURRENT_TIMESTAMP), never written by the app. */
type CreatedAt = ColumnType<Date, never, never>;
/** Column maintained by MySQL (ON UPDATE CURRENT_TIMESTAMP). */
type UpdatedAt = ColumnType<Date, never, never>;
/** STORED generated column: readable, never writable. */
type GeneratedAlways<T> = ColumnType<T, never, never>;
/** JSON column: objects in, objects out (mysql2 parses JSON automatically). */
type Json = ColumnType<unknown, string, string>;
/** TIME column, "HH:MM:SS". */
type Time = string;

export interface AdminUsersTable {
  id: Generated<number>;
  email: string;
  full_name: string;
  password_hash: string;
  role: Generated<AdminRole>;
  is_active: Generated<boolean>;
  last_login_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface SpacesTable {
  id: Generated<number>;
  slug: string;
  name: string;
  address: string | null;
  timezone: Generated<string>;
  slot_duration_min: Generated<number>;
  min_lead_min: Generated<number>;
  horizon_days: Generated<number>;
  hold_duration_min: Generated<number>;
  in_person_enabled: Generated<boolean>;
  virtual_enabled: Generated<boolean>;
  is_active: Generated<boolean>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface SpaceOwnerRecipientsTable {
  id: Generated<number>;
  space_id: number;
  email: string;
  name: string | null;
  is_active: Generated<boolean>;
  created_at: CreatedAt;
}

export interface OpeningHoursTable {
  id: Generated<number>;
  space_id: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
  is_open: Generated<boolean>;
  opens_at: Time;
  closes_at: Time;
}

export interface ClosuresTable {
  id: Generated<number>;
  space_id: number;
  starts_at: Date;
  ends_at: Date;
  reason: string | null;
  created_by: number | null;
  created_at: CreatedAt;
}

export interface PackagesTable {
  id: Generated<number>;
  space_id: number;
  code: string;
  name: string;
  description: string | null;
  is_full_day: Generated<boolean>;
  /** NULL for full-day packages (they take every slot of the day). */
  slot_count: number | null;
  is_active: Generated<boolean>;
  sort_order: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface PackagePricesTable {
  id: Generated<number>;
  package_id: number;
  mode: SessionMode;
  price_xof: number;
  valid_from: Date;
  valid_to: Date | null;
  is_current: GeneratedAlways<1 | null>;
  created_by: number | null;
  created_at: CreatedAt;
}

export interface CustomersTable {
  id: Generated<number>;
  full_name: string;
  phone_e164: string;
  email: string | null;
  business_name: string;
  business_sector: string;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface BookingsTable {
  id: Generated<number>;
  reference: string;
  space_id: number;
  customer_id: number;
  mode: SessionMode;
  booking_type: BookingType;
  package_id: number | null;
  package_name: string | null;
  slot_count: number;
  starts_at: Date;
  ends_at: Date;
  unit_price_xof: number;
  list_price_xof: number;
  discount_xof: Generated<number>;
  total_xof: number;
  currency: Generated<string>;
  status: Generated<BookingStatus>;
  hold_expires_at: Date | null;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  live_description: string | null;
  version: Generated<number>;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface BookingSlotsTable {
  booking_id: number;
  slot_start: Date;
}

export interface SlotBlocksTable {
  id: Generated<number>;
  space_id: number;
  reason: string;
  created_by: number | null;
  created_at: CreatedAt;
}

export interface SlotOccupanciesTable {
  id: Generated<number>;
  space_id: number;
  slot_start: Date;
  booking_id: number | null;
  block_id: number | null;
  created_at: CreatedAt;
}

export interface PaymentsTable {
  id: Generated<number>;
  booking_id: number;
  provider: string;
  provider_ref: string | null;
  idempotency_key: string;
  method: PaymentMethod;
  channel: string | null;
  payer_phone: string | null;
  amount_xof: number;
  currency: Generated<string>;
  status: Generated<PaymentStatus>;
  is_succeeded: GeneratedAlways<1 | null>;
  failure_reason: string | null;
  last_payload: Json | null;
  succeeded_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface PaymentEventsTable {
  id: Generated<number>;
  provider: string;
  provider_event_id: string;
  payment_id: number | null;
  type: string;
  signature_valid: boolean;
  payload: Json;
  received_at: CreatedAt;
  processed_at: Date | null;
}

export interface NotificationsTable {
  id: Generated<number>;
  booking_id: number | null;
  channel: NotificationChannel;
  template: string;
  recipient: string;
  payload: Json;
  status: Generated<NotificationStatus>;
  attempts: Generated<number>;
  next_attempt_at: Generated<Date>;
  last_error: string | null;
  sent_at: Date | null;
  created_at: CreatedAt;
  updated_at: UpdatedAt;
}

export interface AuditLogTable {
  id: Generated<number>;
  actor_type: 'ADMIN' | 'CUSTOMER' | 'SYSTEM' | 'PROVIDER';
  actor_id: number | null;
  action: string;
  entity: string;
  entity_id: string;
  data: Json | null;
  created_at: CreatedAt;
}

export interface Database {
  t_admin_users: AdminUsersTable;
  t_spaces: SpacesTable;
  t_space_owner_recipients: SpaceOwnerRecipientsTable;
  t_opening_hours: OpeningHoursTable;
  t_closures: ClosuresTable;
  t_packages: PackagesTable;
  t_package_prices: PackagePricesTable;
  t_customers: CustomersTable;
  t_bookings: BookingsTable;
  t_booking_slots: BookingSlotsTable;
  t_slot_blocks: SlotBlocksTable;
  t_slot_occupancies: SlotOccupanciesTable;
  t_payments: PaymentsTable;
  t_payment_events: PaymentEventsTable;
  t_notifications: NotificationsTable;
  t_audit_log: AuditLogTable;
}

export type Space = Selectable<SpacesTable>;
export type Package = Selectable<PackagesTable>;
export type Booking = Selectable<BookingsTable>;
export type NewBooking = Insertable<BookingsTable>;
export type BookingUpdate = Updateable<BookingsTable>;
export type Customer = Selectable<CustomersTable>;
