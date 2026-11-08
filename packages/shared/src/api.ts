import type { SessionMode } from './domain';

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
