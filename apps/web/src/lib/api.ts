import type {
  BookingDto,
  CreateBookingRequest,
  CreateBookingResponse,
  DayAvailabilityResponse,
  MonthAvailabilityResponse,
  SessionMode,
  SpaceDto,
} from '@bovann/shared';

/**
 * Typed client for the Bovann API. Every failure becomes an ApiError with a
 * stable `code` and a French `message` that can be shown as is.
 */

export const SPACE_SLUG = process.env.NEXT_PUBLIC_SPACE_SLUG ?? 'studio-principal-lome';
const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const NETWORK_MESSAGE =
  'Impossible de joindre le service de réservation. Vérifiez votre connexion internet et réessayez.';

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (init.token) headers.set('X-Booking-Token', init.token);

  let res: Response;
  try {
    res = await fetchImpl(`${BASE_URL}/api/v1${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body ?? {}) as { code?: string; message?: string; details?: unknown };
    throw new ApiError(
      res.status,
      err.code ?? 'HTTP_ERROR',
      err.message ?? 'Une erreur est survenue. Veuillez réessayer.',
      err.details,
    );
  }
  return body as T;
}

export const api = {
  space: () => apiFetch<SpaceDto>(`/spaces/${SPACE_SLUG}`),
  month: (month: string) =>
    apiFetch<MonthAvailabilityResponse>(`/spaces/${SPACE_SLUG}/availability?month=${month}`),
  day: (date: string, mode: SessionMode) =>
    apiFetch<DayAvailabilityResponse>(`/spaces/${SPACE_SLUG}/availability/${date}?mode=${mode}`),
  createBooking: (request: CreateBookingRequest) =>
    apiFetch<CreateBookingResponse>('/bookings', { method: 'POST', body: JSON.stringify(request) }),
  booking: (reference: string, token: string) =>
    apiFetch<BookingDto>(`/bookings/${reference}`, { token }),
  cancelBooking: (reference: string, token: string) =>
    apiFetch<BookingDto>(`/bookings/${reference}/cancel`, { method: 'POST', token }),
  /** Development only: decide the outcome of a simulated payment. */
  simulatePayment: (reference: string, outcome: 'succeed' | 'fail') =>
    apiFetch<{ outcome: string }>(`/dev/payments/${reference}/${outcome}`, {
      method: 'POST',
      body: '{}',
    }),
};

/** True when payments are simulated (local development and demos). */
export const PAYMENT_SIMULATION = process.env.NEXT_PUBLIC_PAYMENT_SIMULATION === 'true';
