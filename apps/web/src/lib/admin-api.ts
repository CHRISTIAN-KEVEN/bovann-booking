import {
  ADMIN_CSRF_HEADER,
  type AdminBookingDetail,
  type AdminBookingListResponse,
  type AdminBookingTab,
  type AdminCancelRequest,
  type AdminCreateBookingRequest,
  type AdminCustomerDetail,
  type AdminCustomerListResponse,
  type AdminDashboardStats,
  type AdminDayOptionsResponse,
  type AdminLiveCreate,
  type AdminLiveDto,
  type AdminLiveListResponse,
  type AdminLiveTab,
  type AdminReviewHours,
  type ReviewPeriod,
  type LiveCategoryDto,
  type AdminMe,
  type AdminPackageInput,
  type AdminPackagesResponse,
  type AdminPaymentListResponse,
  type AdminRecordPaymentRequest,
  type AdminSpaceCreate,
  type AdminSpaceDto,
  type AdminSpaceUpdate,
  type AdminUserCreate,
  type AdminUserDto,
  type AdminUserUpdate,
  type ClosureCreate,
  type ClosureDto,
  type CustomerLookupDto,
  type NotificationSettingsDto,
  type OpeningHoursDayDto,
  type OpeningHoursUpdate,
  type OwnerRecipientDto,
  type PaymentStatus,
  type ScheduleResponse,
  type SessionMode,
  type TemporaryPasswordResponse,
} from '@bovann/shared';
import { apiFetch } from './api';

/**
 * Admin API client. The session is an httpOnly cookie, so every call sends
 * credentials; every change carries the CSRF header the API requires.
 * A 401 anywhere means the session ended: listeners send the admin to sign-in.
 */

type Unauthorized = () => void;
let onUnauthorized: Unauthorized | null = null;

/** The admin shell registers how to react when the session ends. */
export function setUnauthorizedHandler(handler: Unauthorized | null): void {
  onUnauthorized = handler;
}

async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== 'GET') headers.set(ADMIN_CSRF_HEADER, '1');
  try {
    return await apiFetch<T>(`/admin${path}`, { ...init, headers, credentials: 'include' });
  } catch (error) {
    const status = (error as { status?: number }).status;
    const isLogin = path === '/auth/login';
    if (status === 401 && !isLogin) onUnauthorized?.();
    throw error;
  }
}

const send = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
});

function query(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export interface BookingListParams {
  spaceId?: number;
  tab?: AdminBookingTab | 'ABANDONED';
  q?: string;
  when?: 'upcoming' | 'past' | 'all';
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export const adminApi = {
  // auth
  login: (email: string, password: string) =>
    adminFetch<AdminMe>('/auth/login', send('POST', { email, password })),
  logout: () => adminFetch<void>('/auth/logout', send('POST')),
  me: () => adminFetch<AdminMe>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    adminFetch<AdminMe>('/auth/password', send('POST', { currentPassword, newPassword })),

  // spaces & planning
  spaces: () => adminFetch<AdminSpaceDto[]>('/spaces'),
  createSpace: (input: AdminSpaceCreate) =>
    adminFetch<AdminSpaceDto>('/spaces', send('POST', input)),
  updateSpace: (id: number, input: AdminSpaceUpdate) =>
    adminFetch<AdminSpaceDto>(`/spaces/${id}`, send('PATCH', input)),
  stats: (spaceId: number) => adminFetch<AdminDashboardStats>(`/spaces/${spaceId}/stats`),
  schedule: (spaceId: number, from: string, days = 1) =>
    adminFetch<ScheduleResponse>(`/spaces/${spaceId}/schedule${query({ from, days })}`),
  dayOptions: (spaceId: number, date: string, mode: SessionMode) =>
    adminFetch<AdminDayOptionsResponse>(`/spaces/${spaceId}/day-options${query({ date, mode })}`),
  createBlock: (spaceId: number, slotStarts: string[], reason: string) =>
    adminFetch<{ id: number }>(`/spaces/${spaceId}/blocks`, send('POST', { slotStarts, reason })),
  deleteBlock: (blockId: number) => adminFetch<void>(`/blocks/${blockId}`, send('DELETE')),

  // hours, closures, recipients
  openingHours: (spaceId: number) =>
    adminFetch<OpeningHoursDayDto[]>(`/spaces/${spaceId}/opening-hours`),
  updateOpeningHours: (spaceId: number, input: OpeningHoursUpdate) =>
    adminFetch<OpeningHoursDayDto[]>(`/spaces/${spaceId}/opening-hours`, send('PUT', input)),
  closures: (spaceId: number) => adminFetch<ClosureDto[]>(`/spaces/${spaceId}/closures`),
  createClosure: (spaceId: number, input: ClosureCreate) =>
    adminFetch<ClosureDto>(`/spaces/${spaceId}/closures`, send('POST', input)),
  deleteClosure: (id: number) => adminFetch<void>(`/closures/${id}`, send('DELETE')),
  recipients: (spaceId: number) => adminFetch<OwnerRecipientDto[]>(`/spaces/${spaceId}/recipients`),
  addRecipient: (spaceId: number, email: string, name: string | null) =>
    adminFetch<OwnerRecipientDto[]>(`/spaces/${spaceId}/recipients`, send('POST', { email, name })),
  updateRecipient: (id: number, isActive: boolean) =>
    adminFetch<OwnerRecipientDto[]>(`/recipients/${id}`, send('PATCH', { isActive })),
  deleteRecipient: (id: number) =>
    adminFetch<OwnerRecipientDto[]>(`/recipients/${id}`, send('DELETE')),

  // packages
  packages: (spaceId: number) => adminFetch<AdminPackagesResponse>(`/spaces/${spaceId}/packages`),
  createPackage: (spaceId: number, input: AdminPackageInput) =>
    adminFetch<AdminPackagesResponse>(`/spaces/${spaceId}/packages`, send('POST', input)),
  updatePackage: (id: number, input: Partial<AdminPackageInput>) =>
    adminFetch<AdminPackagesResponse>(`/packages/${id}`, send('PATCH', input)),

  // bookings
  bookings: (params: BookingListParams) =>
    adminFetch<AdminBookingListResponse>(`/bookings${query({ ...params })}`),
  booking: (id: number) => adminFetch<AdminBookingDetail>(`/bookings/${id}`),
  createBooking: (input: AdminCreateBookingRequest) =>
    adminFetch<AdminBookingDetail>('/bookings', send('POST', input)),
  updateNote: (id: number, adminNote: string | null) =>
    adminFetch<AdminBookingDetail>(`/bookings/${id}/note`, send('PATCH', { adminNote })),
  recordPayment: (id: number, input: AdminRecordPaymentRequest) =>
    adminFetch<AdminBookingDetail>(`/bookings/${id}/payments`, send('POST', input)),
  cancelBooking: (id: number, input: AdminCancelRequest) =>
    adminFetch<AdminBookingDetail>(`/bookings/${id}/cancel`, send('POST', input)),
  markRefunded: (id: number, note: string | null) =>
    adminFetch<AdminBookingDetail>(`/bookings/${id}/refund`, send('POST', { note })),

  // customers, payments
  customers: (q: string, page: number) =>
    adminFetch<AdminCustomerListResponse>(`/customers${query({ q, page, pageSize: 25 })}`),
  customer: (id: number) => adminFetch<AdminCustomerDetail>(`/customers/${id}`),
  lookupCustomer: (phone: string) =>
    adminFetch<{ customer: CustomerLookupDto | null }>(`/customers/lookup${query({ phone })}`),
  payments: (params: { status?: PaymentStatus; spaceId?: number; page?: number }) =>
    adminFetch<AdminPaymentListResponse>(`/payments${query({ ...params, pageSize: 25 })}`),

  // emails
  notificationSettings: () => adminFetch<NotificationSettingsDto>('/notifications/settings'),
  sendTestEmail: (to?: string) =>
    adminFetch<{ to: string }>('/notifications/test', send('POST', to ? { to } : {})),
  retryNotification: (id: number) => adminFetch<void>(`/notifications/${id}/retry`, send('POST')),

  // users
  users: () => adminFetch<AdminUserDto[]>('/users'),
  createUser: (input: AdminUserCreate) =>
    adminFetch<TemporaryPasswordResponse>('/users', send('POST', input)),
  updateUser: (id: number, input: AdminUserUpdate) =>
    adminFetch<AdminUserDto>(`/users/${id}`, send('PATCH', input)),
  resetPassword: (id: number) =>
    adminFetch<TemporaryPasswordResponse>(`/users/${id}/reset-password`, send('POST')),

  // lives ("En direct")
  lives: (tab: AdminLiveTab) => adminFetch<AdminLiveListResponse>(`/lives?tab=${tab}`),
  liveCategories: () => adminFetch<LiveCategoryDto[]>('/lives/categories'),
  createLive: (input: AdminLiveCreate) => adminFetch<AdminLiveDto>('/lives', send('POST', input)),
  livesPendingCount: () => adminFetch<{ count: number }>('/lives/pending-count'),
  approveLive: (id: number) => adminFetch<AdminLiveDto>(`/lives/${id}/approve`, send('POST')),
  rejectLive: (id: number, reason: string) =>
    adminFetch<AdminLiveDto>(`/lives/${id}/reject`, send('POST', { reason })),
  reviewHours: () => adminFetch<AdminReviewHours>('/review-hours'),
  setReviewHours: (periods: ReviewPeriod[]) =>
    adminFetch<AdminReviewHours>('/review-hours', send('PUT', { periods })),
  removeLive: (id: number, reason: string | null) =>
    adminFetch<AdminLiveDto>(`/lives/${id}/remove`, send('POST', { reason })),
};
