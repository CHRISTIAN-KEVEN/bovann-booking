import type {
  BookingStatus,
  BookingType,
  PaymentMethod,
  PaymentStatus,
  SessionMode,
} from './domain';

/**
 * Public API contracts (JSON over HTTP). Shared by the API and the web app so
 * both sides compile against the same shapes. Instants are ISO 8601 strings in
 * UTC; local dates/times are in the space's time zone, ready to display.
 */

export type SlotStatus = 'AVAILABLE' | 'BOOKED' | 'CLOSED' | 'PAST' | 'OUT_OF_RANGE';
export type DayStatus = 'AVAILABLE' | 'FEW' | 'FULL' | 'CLOSED' | 'PAST' | 'OUT_OF_RANGE';

export interface SpaceDto {
  slug: string;
  name: string;
  address: string | null;
  timezone: string;
  slotDurationMin: number;
  modes: SessionMode[];
  booking: {
    minLeadMin: number;
    horizonDays: number;
    /** Local date ('YYYY-MM-DD') of today in the space's time zone. */
    today: string;
    /** Last local date that can be booked. */
    lastBookableDate: string;
  };
}

export interface PriceDto {
  listPriceXof: number;
  discountXof: number;
  totalXof: number;
  /** Saving versus buying the same slots one by one, in whole percent. */
  discountPercent: number;
}

export interface PackageDto {
  code: string;
  name: string;
  description: string | null;
  isFullDay: boolean;
  /** Slots covered. For a full-day package: the longest day of the week (catalog view). */
  slotCount: number;
  durationMin: number;
  price: PriceDto;
}

export interface PackagesResponse {
  mode: SessionMode;
  unitPriceXof: number;
  packages: PackageDto[];
}

export interface MonthDayDto {
  date: string;
  status: DayStatus;
  availableCount: number;
}

export interface MonthAvailabilityResponse {
  month: string;
  days: MonthDayDto[];
}

export interface SlotDto {
  start: string;
  end: string;
  /** 'HH:MM' local. */
  startTime: string;
  endTime: string;
  status: SlotStatus;
}

export interface StartOptionDto {
  start: string;
  end: string;
  startTime: string;
  endTime: string;
}

export interface DayPackageDto extends PackageDto {
  /** Start times at which this package fits on this day (empty = not available this day). */
  startOptions: StartOptionDto[];
}

export interface DayAvailabilityResponse {
  date: string;
  mode: SessionMode;
  status: DayStatus;
  availableCount: number;
  unitPriceXof: number;
  slots: SlotDto[];
  packages: DayPackageDto[];
}

// ---------------------------------------------------------------- bookings (Phase 3)

export const MOBILE_MONEY_CHANNELS = ['TMONEY', 'FLOOZ'] as const;
export type MobileMoneyChannel = (typeof MOBILE_MONEY_CHANNELS)[number];

export type BookingSelectionInput =
  { type: 'SLOTS'; slotStarts: string[] } | { type: 'PACKAGE'; packageCode: string; start: string };

export interface CreateBookingRequest {
  spaceSlug: string;
  mode: SessionMode;
  selection: BookingSelectionInput;
  customer: {
    fullName: string;
    /** E.164, for example "+22890123456". */
    phone: string;
    email?: string | null;
    businessName: string;
    businessSector: string;
  };
  liveDescription?: string | null;
  acceptTerms: true;
  payment:
    | { method: 'MOBILE_MONEY'; channel: MobileMoneyChannel; payerPhone: string }
    | { method: 'CARD' };
  /** Cloudflare Turnstile token (bot check). */
  captchaToken?: string;
}

export interface BookingDto {
  reference: string;
  status: BookingStatus;
  mode: SessionMode;
  spaceName: string;
  /** Local date of the booking. */
  date: string;
  startTime: string;
  endTime: string;
  slots: { start: string; end: string; startTime: string; endTime: string }[];
  bookingType: BookingType;
  packageName: string | null;
  slotCount: number;
  price: { listPriceXof: number; discountXof: number; totalXof: number };
  /** Set while the booking waits for payment. */
  holdExpiresAt: string | null;
  customer: { fullName: string; businessName: string };
  payment: {
    status: PaymentStatus;
    method: PaymentMethod;
    channel: string | null;
  } | null;
}

export interface CreateBookingResponse {
  booking: BookingDto;
  /**
   * Secret that lets this browser follow and cancel the booking. Send it back in
   * the X-Booking-Token header. Shown once; the server stores only its hash.
   */
  accessToken: string;
  payment: {
    status: PaymentStatus;
    /** Text to show while the customer approves the payment (e.g. on their phone). */
    instructions: string | null;
    /** For card payments: provider page to open. */
    redirectUrl: string | null;
  };
}
