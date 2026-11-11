import {
  SELLER_CSRF_HEADER,
  type OtpChannel,
  type SellerCodeResponse,
  type SellerMe,
} from '@bovann/shared';
import { apiFetch } from './api';

/**
 * Seller calls: the session travels in an httpOnly cookie (credentials: include) and every
 * change carries the CSRF header.
 */
function send(method: 'POST', body?: unknown): RequestInit {
  return {
    method,
    credentials: 'include',
    headers: { [SELLER_CSRF_HEADER]: '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export const sellerApi = {
  status: () => apiFetch<{ available: boolean }>('/seller/auth/status'),
  requestCode: (phone: string, channel: OtpChannel) =>
    apiFetch<SellerCodeResponse>('/seller/auth/code', send('POST', { phone, channel })),
  verify: (phone: string, code: string) =>
    apiFetch<SellerMe>('/seller/auth/verify', send('POST', { phone, code })),
  me: () => apiFetch<SellerMe>('/seller/me', { credentials: 'include' }),
  logout: () => apiFetch<null>('/seller/auth/logout', send('POST')),
};

/** Only paths on our own site are accepted as "where to go after sign-in". */
export function safeNext(value: string | null): string | null {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
    ? value
    : null;
}
