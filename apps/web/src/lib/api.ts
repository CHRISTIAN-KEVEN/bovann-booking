import type {
  BookingDto,
  BookingLookupResponse,
  CreateBookingRequest,
  CreateBookingResponse,
  DayAvailabilityResponse,
  MonthAvailabilityResponse,
  PackagesResponse,
  SessionMode,
  SpaceDto,
} from '@bovann/shared';

/**
 * Typed client for the Bovann API. Every failure becomes an ApiError with a
 * stable `code` and a French `message` that can be shown as is.
 */

export const SPACE_SLUG = process.env.NEXT_PUBLIC_SPACE_SLUG ?? 'studio-principal-lome';
/**
 * API address. Empty by default: the browser calls `/api/...` on the website's own address and
 * the website forwards it (see next.config.ts), which works on localhost, a tunnel or a domain.
 */
const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

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

/** Downloads a file (e.g. the receipt PDF); errors come back in the usual JSON shape. */
export async function apiDownload(
  path: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Blob> {
  let res: Response;
  try {
    res = await fetchImpl(`${BASE_URL}/api/v1${path}`, {
      headers: { 'X-Booking-Token': token },
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
  }
  if (!res.ok) {
    const err = ((await res.json().catch(() => null)) ?? {}) as { code?: string; message?: string };
    throw new ApiError(
      res.status,
      err.code ?? 'HTTP_ERROR',
      err.message ?? 'Le téléchargement a échoué. Réessayez dans un instant.',
    );
  }
  return res.blob();
}

export const api = {
  space: () => apiFetch<SpaceDto>(`/spaces/${SPACE_SLUG}`),
  packages: (mode: SessionMode) =>
    apiFetch<PackagesResponse>(`/spaces/${SPACE_SLUG}/packages?mode=${mode}`),
  month: (month: string) =>
    apiFetch<MonthAvailabilityResponse>(`/spaces/${SPACE_SLUG}/availability?month=${month}`),
  day: (date: string, mode: SessionMode) =>
    apiFetch<DayAvailabilityResponse>(`/spaces/${SPACE_SLUG}/availability/${date}?mode=${mode}`),
  createBooking: (request: CreateBookingRequest) =>
    apiFetch<CreateBookingResponse>('/bookings', { method: 'POST', body: JSON.stringify(request) }),
  /** "Retrouver ma réservation": find a booking with its reference and phone (E.164). */
  lookupBooking: (reference: string, phone: string) =>
    apiFetch<BookingLookupResponse>('/bookings/lookup', {
      method: 'POST',
      body: JSON.stringify({ reference, phone }),
    }),
  booking: (reference: string, token: string) =>
    apiFetch<BookingDto>(`/bookings/${reference}`, { token }),
  /** Booking receipt (PDF), for confirmed bookings. */
  receipt: (reference: string, token: string) =>
    apiDownload(`/bookings/${reference}/receipt`, token),
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
