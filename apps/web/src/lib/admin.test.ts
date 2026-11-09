import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminApi, setUnauthorizedHandler } from './admin-api';
import {
  addDays,
  bookingStatus,
  formatAmountInput,
  formatPhone,
  mondayOf,
  parseAmount,
  paymentMethodLabel,
  todayIn,
} from './admin-format';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('admin API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
  });

  it('sends the session cookie, and the CSRF header on changes only', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    await adminApi.me();
    await adminApi.deleteBlock(3);
    const [getUrl, getInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [delUrl, delInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(getUrl).toMatch(/\/api\/v1\/admin\/auth\/me$/);
    expect(getInit.credentials).toBe('include');
    expect(new Headers(getInit.headers).has('X-Bovann-Admin')).toBe(false);
    expect(delUrl).toMatch(/\/api\/v1\/admin\/blocks\/3$/);
    expect(delInit.method).toBe('DELETE');
    expect(new Headers(delInit.headers).get('X-Bovann-Admin')).toBe('1');
  });

  it('reports an ended session, except for a failed sign-in', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(401, { code: 'NOT_AUTHENTICATED', message: 'Session expirée' }),
        ),
    );
    const onEnded = vi.fn();
    setUnauthorizedHandler(onEnded);
    await expect(adminApi.bookings({ tab: 'ALL' })).rejects.toMatchObject({
      code: 'NOT_AUTHENTICATED',
    });
    expect(onEnded).toHaveBeenCalledTimes(1);
    await expect(adminApi.login('a@b.tg', 'x')).rejects.toBeTruthy();
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('builds list queries without empty parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await adminApi.bookings({ spaceId: 1, tab: 'UNPAID', q: '', page: 2 });
    expect(fetchMock.mock.calls[0]![0]).toMatch(/\/bookings\?spaceId=1&tab=UNPAID&page=2$/);
  });
});

describe('admin display helpers', () => {
  it('formats phone numbers for reading', () => {
    expect(formatPhone('+22890123456')).toBe('+228 90 12 34 56');
    expect(formatPhone('+33612345678')).toBe('+33 61 23 45 67 8');
    expect(formatPhone('not a phone')).toBe('not a phone');
  });

  it('gives each booking a status the studio can act on', () => {
    expect(
      bookingStatus({ status: 'CONFIRMED', refundStatus: 'NONE', paymentState: 'PAID' }).label,
    ).toBe('Confirmée');
    expect(
      bookingStatus({ status: 'CONFIRMED', refundStatus: 'NONE', paymentState: 'UNPAID' }),
    ).toEqual({
      label: 'Confirmée · à encaisser',
      tone: 'warning',
    });
    expect(
      bookingStatus({ status: 'CANCELLED', refundStatus: 'DUE', paymentState: 'PAID' }).label,
    ).toBe('À rembourser');
    expect(
      bookingStatus({ status: 'EXPIRED', refundStatus: 'NONE', paymentState: 'NONE' }).label,
    ).toBe('Abandonnée');
    expect(
      bookingStatus({ status: 'PENDING_PAYMENT', refundStatus: 'NONE', paymentState: 'PENDING' })
        .label,
    ).toBe('Paiement en cours');
  });

  it('names payment methods, with the mobile money operator', () => {
    expect(paymentMethodLabel('MOBILE_MONEY', 'TMONEY')).toBe('T-Money');
    expect(paymentMethodLabel('CASH')).toBe('Espèces');
    expect(paymentMethodLabel(null)).toBe('—');
  });

  it('reads amounts typed the French way', () => {
    expect(parseAmount('15 000')).toBe(15000);
    expect(parseAmount('15 000')).toBe(15000);
    expect(parseAmount('0')).toBe(0);
    expect(parseAmount('15,5')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(formatAmountInput(108000)).toBe('108 000');
  });

  it('works with studio-local dates', () => {
    expect(todayIn('Africa/Lome', new Date('2026-11-09T23:30:00Z'))).toBe('2026-11-09');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
  });
});
