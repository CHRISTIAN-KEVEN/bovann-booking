import type { AdminBookingDetail } from '@bovann/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookingDrawer } from './BookingDrawer';

const detail: AdminBookingDetail = {
  id: 5,
  reference: 'BOV-2611-ABCDE',
  status: 'CONFIRMED',
  source: 'ONLINE',
  mode: 'IN_PERSON',
  spaceId: 1,
  spaceName: 'Studio principal — Lomé',
  date: '2026-11-12',
  startTime: '12:30',
  endTime: '18:30',
  startsAt: '2026-11-12T12:30:00.000Z',
  bookingType: 'PACKAGE',
  packageName: 'Pack 6h',
  slotCount: 4,
  totalXof: 51000,
  listPriceXof: 60000,
  discountXof: 9000,
  paymentState: 'PAID',
  paymentMethod: 'MOBILE_MONEY',
  paymentChannel: 'TMONEY',
  refundStatus: 'NONE',
  customer: {
    id: 9,
    fullName: 'Afi Mensah',
    businessName: 'Boutique Afi Mode',
    businessSector: 'Mode & beauté',
    phone: '+22890123456',
    email: 'afi@example.tg',
  },
  createdAt: '2026-11-09T10:00:00.000Z',
  slots: [],
  liveDescription: null,
  adminNote: null,
  holdExpiresAt: null,
  confirmedAt: '2026-11-09T10:02:00.000Z',
  cancelledAt: null,
  cancelReason: null,
  createdBy: null,
  cancelledBy: null,
  refund: { status: 'NONE', amountXof: null, refundedAt: null, note: null },
  payments: [
    {
      id: 1,
      provider: 'mock',
      method: 'MOBILE_MONEY',
      channel: 'TMONEY',
      amountXof: 51000,
      status: 'SUCCEEDED',
      note: null,
      createdAt: '2026-11-09T10:00:00.000Z',
      succeededAt: '2026-11-09T10:02:00.000Z',
      recordedBy: null,
    },
  ],
  history: [
    {
      at: '2026-11-09T10:02:00.000Z',
      action: 'BOOKING_CONFIRMED',
      label: 'Paiement reçu, réservation confirmée',
      actor: 'Paiement',
    },
  ],
  notifications: [],
  can: { cancel: true, recordPayment: false, markRefunded: false },
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('Booking panel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('cancels a paid booking with a reason and the amount to refund', async () => {
    const cancelled: AdminBookingDetail = {
      ...detail,
      status: 'CANCELLED',
      refundStatus: 'DUE',
      refund: { status: 'DUE', amountXof: 51000, refundedAt: null, note: null },
      can: { cancel: false, recordPayment: false, markRefunded: true },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(detail))
      .mockResolvedValueOnce(json(cancelled));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn();
    render(<BookingDrawer bookingId={5} onClose={() => {}} onChanged={onChanged} />);

    expect(await screen.findByText('Afi Mensah')).toBeInTheDocument();
    expect(screen.getByText('+228 90 12 34 56')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Annuler la réservation' }));

    // The amount paid is proposed for the refund; a reason is required.
    expect(screen.getByLabelText('Montant à rembourser')).toHaveValue('51 000');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmer l’annulation' }));
    expect(screen.getByRole('alert')).toHaveTextContent('motif');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await userEvent.type(
      screen.getByLabelText('Motif (visible dans l’historique)'),
      'Panne au studio',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirmer l’annulation' }));
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toMatch(/\/admin\/bookings\/5\/cancel$/);
    expect(JSON.parse(String(init.body))).toEqual({
      reason: 'Panne au studio',
      refundAmountXof: 51000,
    });
    expect(
      await screen.findByRole('button', { name: 'Marquer comme remboursée' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/À rembourser : 51/)).toBeInTheDocument();
  });
});
