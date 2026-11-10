import type { BookingSelectionInput } from './api';
import type {
  AdminRole,
  BookingSource,
  BookingStatus,
  BookingType,
  PaymentMethod,
  PaymentStatus,
  RefundStatus,
  SessionMode,
} from './domain';

/**
 * Admin API contracts (/api/v1/admin/*). Instants are ISO 8601 UTC strings;
 * `date`/`time` fields are local to the space, ready to display.
 */

// ------------------------------------------------------------------ auth

export interface AdminMe {
  id: number;
  email: string;
  fullName: string;
  role: AdminRole;
  /** A temporary password was set: every other endpoint refuses until it is changed. */
  mustChangePassword: boolean;
}

export interface AdminLoginRequest {
  email: string;
  password: string;
}

export interface AdminChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Minimum length of an admin password (passphrases welcome). */
export const ADMIN_PASSWORD_MIN_LENGTH = 10;

/** Every state-changing admin request must carry this header (CSRF protection). */
export const ADMIN_CSRF_HEADER = 'X-Bovann-Admin';

// ------------------------------------------------------------------ spaces & settings

export interface AdminSpaceDto {
  id: number;
  slug: string;
  name: string;
  /** English name, shown on the English site (null: the French name is used). */
  nameEn: string | null;
  address: string | null;
  timezone: string;
  slotDurationMin: number;
  minLeadMin: number;
  horizonDays: number;
  holdDurationMin: number;
  fewSlotsThreshold: number;
  inPersonEnabled: boolean;
  virtualEnabled: boolean;
  isActive: boolean;
}

export type AdminSpaceUpdate = Partial<
  Pick<
    AdminSpaceDto,
    | 'name'
    | 'nameEn'
    | 'address'
    | 'minLeadMin'
    | 'horizonDays'
    | 'holdDurationMin'
    | 'fewSlotsThreshold'
    | 'inPersonEnabled'
    | 'virtualEnabled'
    | 'isActive'
  >
>;

export interface AdminSpaceCreate {
  name: string;
  nameEn?: string | null;
  address?: string | null;
  inPersonEnabled: boolean;
  virtualEnabled: boolean;
}

export interface OpeningHoursDayDto {
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
  isOpen: boolean;
  /** 'HH:MM' local time. */
  opensAt: string;
  closesAt: string;
  /** Slots this day yields with the space's slot duration (read-only). */
  slotCount: number;
}

export interface OpeningHoursUpdate {
  days: Array<Pick<OpeningHoursDayDto, 'weekday' | 'isOpen' | 'opensAt' | 'closesAt'>>;
}

export interface ClosureDto {
  id: number;
  startsAt: string;
  endsAt: string;
  /** Local display values. */
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  reason: string | null;
}

export interface ClosureCreate {
  /** First and last local day (inclusive). */
  startDate: string;
  endDate: string;
  /** Omit both for whole days. */
  startTime?: string;
  endTime?: string;
  reason?: string | null;
}

export interface OwnerRecipientDto {
  id: number;
  email: string;
  name: string | null;
  isActive: boolean;
}

export interface OwnerRecipientCreate {
  email: string;
  name?: string | null;
}

/** A booking that stops a settings change; the admin must move or cancel it first. */
export interface ConflictingBookingDto {
  id: number;
  reference: string;
  date: string;
  startTime: string;
  endTime: string;
  customerName: string;
}

// ------------------------------------------------------------------ packages & prices

export interface AdminPackageDto {
  id: number;
  code: string;
  name: string;
  /** English name, shown on the English site (null: the French name is used). */
  nameEn: string | null;
  description: string | null;
  isFullDay: boolean;
  /** Null for the full-day package (it covers the whole day). */
  slotCount: number | null;
  isActive: boolean;
  sortOrder: number;
  /** Current price per mode; a missing mode means the package isn't offered in that mode. */
  prices: Partial<Record<SessionMode, number>>;
  /** Bookings starting in the future made with this package. */
  upcomingBookings: number;
}

export interface AdminPackagesResponse {
  packages: AdminPackageDto[];
  /** Slots in the longest opening day (size of the full-day package). */
  fullDaySlotCount: number;
}

export interface AdminPackageInput {
  name: string;
  nameEn?: string | null;
  description?: string | null;
  isFullDay?: boolean;
  slotCount?: number | null;
  isActive?: boolean;
  sortOrder?: number;
  prices: Partial<Record<SessionMode, number | null>>;
}

// ------------------------------------------------------------------ bookings

/** What the studio still has to do about money for a booking. */
export type AdminPaymentState = 'PAID' | 'UNPAID' | 'FREE' | 'PENDING' | 'NONE';

export interface AdminBookingListItem {
  id: number;
  reference: string;
  status: BookingStatus;
  source: BookingSource;
  mode: SessionMode;
  spaceId: number;
  date: string;
  startTime: string;
  endTime: string;
  startsAt: string;
  bookingType: BookingType;
  packageName: string | null;
  slotCount: number;
  totalXof: number;
  paymentState: AdminPaymentState;
  paymentMethod: PaymentMethod | null;
  paymentChannel: string | null;
  refundStatus: RefundStatus;
  customer: { id: number; fullName: string; businessName: string; phone: string };
  createdAt: string;
}

export interface AdminBookingListResponse {
  items: AdminBookingListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export type AdminBookingTab =
  'ALL' | 'CONFIRMED' | 'PENDING' | 'CANCELLED' | 'UNPAID' | 'REFUND_DUE';

export interface AdminPaymentDto {
  id: number;
  provider: string;
  method: PaymentMethod;
  channel: string | null;
  amountXof: number;
  status: PaymentStatus;
  note: string | null;
  createdAt: string;
  succeededAt: string | null;
  recordedBy: string | null;
}

export interface AdminHistoryEntry {
  at: string;
  action: string;
  /** French, ready to display. */
  label: string;
  actor: string;
}

export interface AdminBookingDetail extends AdminBookingListItem {
  spaceName: string;
  slots: Array<{ start: string; startTime: string; endTime: string }>;
  listPriceXof: number;
  discountXof: number;
  customer: AdminBookingListItem['customer'] & { email: string | null; businessSector: string };
  liveDescription: string | null;
  adminNote: string | null;
  holdExpiresAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdBy: string | null;
  cancelledBy: string | null;
  refund: {
    status: RefundStatus;
    amountXof: number | null;
    refundedAt: string | null;
    note: string | null;
  };
  payments: AdminPaymentDto[];
  history: AdminHistoryEntry[];
  /** Emails about this booking and whether they left (Phase 6). */
  notifications: AdminNotificationDto[];
  /** What the signed-in admin may do now. */
  can: { cancel: boolean; recordPayment: boolean; markRefunded: boolean };
}

export type ManualPaymentInput =
  | {
      status: 'PAID';
      method: PaymentMethod;
      channel?: string | null;
      note?: string | null;
    }
  | { status: 'UNPAID' };

export interface AdminCreateBookingRequest {
  spaceId: number;
  mode: SessionMode;
  selection: BookingSelectionInput;
  customer: {
    fullName: string;
    phone: string;
    email?: string | null;
    businessName: string;
    businessSector: string;
  };
  liveDescription?: string | null;
  adminNote?: string | null;
  /** Negotiated total (0 = free). Omit to use the catalog price. */
  totalXof?: number;
  /** Ignored when the total is 0. */
  payment: ManualPaymentInput;
}

export interface AdminCancelRequest {
  reason: string;
  /** Amount to give back. Defaults to everything paid; 0 = nothing to refund. */
  refundAmountXof?: number;
}

export interface AdminRecordPaymentRequest {
  method: PaymentMethod;
  channel?: string | null;
  note?: string | null;
}

export interface AdminMarkRefundedRequest {
  note?: string | null;
}

export interface CustomerLookupDto {
  id: number;
  fullName: string;
  phone: string;
  email: string | null;
  businessName: string;
  businessSector: string;
}

// ------------------------------------------------------------------ schedule & blocks

export type ScheduleSlotState = 'FREE' | 'BOOKED' | 'PENDING' | 'BLOCKED' | 'CLOSED';

export interface ScheduleSlotDto {
  start: string;
  end: string;
  startTime: string;
  endTime: string;
  state: ScheduleSlotState;
  /** The slot has already ended. */
  isPast: boolean;
  booking: {
    id: number;
    reference: string;
    customerName: string;
    businessName: string;
    mode: SessionMode;
  } | null;
  block: { id: number; reason: string } | null;
}

export interface ScheduleDayDto {
  date: string;
  isOpen: boolean;
  slots: ScheduleSlotDto[];
}

export interface ScheduleResponse {
  spaceId: number;
  today: string;
  days: ScheduleDayDto[];
}

export interface BlockCreate {
  slotStarts: string[];
  reason: string;
}

/** Bookable options on one day for a manual booking (no lead time or horizon). */
export interface AdminDayOptionsResponse {
  date: string;
  mode: SessionMode;
  unitPriceXof: number;
  slots: Array<{
    start: string;
    end: string;
    startTime: string;
    endTime: string;
    available: boolean;
  }>;
  packages: Array<{
    code: string;
    name: string;
    isFullDay: boolean;
    slotCount: number;
    listPriceXof: number;
    totalXof: number;
    startOptions: Array<{ start: string; startTime: string; endTime: string }>;
  }>;
}

// ------------------------------------------------------------------ dashboard, customers, payments

export interface AdminDashboardStats {
  /** Confirmed bookings starting today. */
  todayBookings: number;
  /** Booked slots ÷ open slots this week (Monday–Sunday), whole percent. */
  weekOccupancyPercent: number;
  /** Payments received this month minus refunds made this month. */
  collectedThisMonthXof: number;
  /** Confirmed bookings not yet paid (studio bookings marked unpaid). */
  unpaidCount: number;
  refundsDueCount: number;
}

export interface AdminCustomerListItem {
  id: number;
  fullName: string;
  phone: string;
  email: string | null;
  businessName: string;
  businessSector: string;
  bookingsCount: number;
  lastBookingAt: string | null;
  totalPaidXof: number;
}

export interface AdminCustomerListResponse {
  items: AdminCustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminCustomerDetail extends AdminCustomerListItem {
  createdAt: string;
  bookings: AdminBookingListItem[];
}

export interface AdminPaymentListItem extends AdminPaymentDto {
  booking: { id: number; reference: string; customerName: string; businessName: string };
}

export interface AdminPaymentListResponse {
  items: AdminPaymentListItem[];
  total: number;
  page: number;
  pageSize: number;
}

// ------------------------------------------------------------------ users

export interface AdminUserDto {
  id: number;
  email: string;
  fullName: string;
  role: AdminRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AdminUserCreate {
  email: string;
  fullName: string;
  role: AdminRole;
}

export type AdminUserUpdate = Partial<Pick<AdminUserDto, 'fullName' | 'role' | 'isActive'>>;

/** Returned once when an account is created or its password reset: show it, never store it. */
export interface TemporaryPasswordResponse {
  user: AdminUserDto;
  temporaryPassword: string;
}

// ---------------------------------------------------------------- notifications (Phase 6)

export interface AdminNotificationDto {
  id: number;
  template: string;
  /** French, ready to display ("Nouvelle réservation (gérants)"). */
  label: string;
  recipient: string;
  status: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';
  attempts: number;
  sentAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface NotificationSettingsDto {
  /** False until the server is configured to send emails. */
  enabled: boolean;
  from: string | null;
  pending: number;
  failed: number;
}
