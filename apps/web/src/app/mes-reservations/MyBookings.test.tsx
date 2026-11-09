import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import { ApiError } from '@/lib/api';
import { MyBookings } from './MyBookings';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const booking = vi.fn();
const lookupBooking = vi.fn();
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return {
    ...real,
    api: {
      booking: (r: string, t: string) => booking(r, t),
      lookupBooking: (r: string, p: string) => lookupBooking(r, p),
    },
  };
});

const TOKENS = 'bovann.booking-tokens.v1';

function dto(reference: string, date: string, status = 'CONFIRMED') {
  return {
    reference,
    status,
    mode: 'IN_PERSON',
    spaceName: 'Studio',
    date,
    startTime: '08:00',
    endTime: '09:30',
    slots: [
      {
        start: `${date}T08:00:00.000Z`,
        end: `${date}T09:30:00.000Z`,
        startTime: '08:00',
        endTime: '09:30',
      },
    ],
    bookingType: 'SLOTS',
    packageName: null,
    slotCount: 1,
    price: { listPriceXof: 15000, discountXof: 0, totalXof: 15000 },
    holdExpiresAt: null,
    holdSecondsLeft: null,
    customer: { fullName: 'Afi', businessName: 'Afi Mode' },
    payment: null,
  };
}

describe('Mes réservations', () => {
  beforeEach(() => {
    push.mockClear();
    booking.mockReset();
    lookupBooking.mockReset();
    localStorage.clear();
  });

  it('lists the bookings saved on this device, upcoming first, and forgets dead tokens', async () => {
    localStorage.setItem(
      TOKENS,
      JSON.stringify({ 'BOV-2001-AAAAA': 't1', 'BOV-2999-BBBBB': 't2', 'BOV-2999-CCCCC': 't3' }),
    );
    booking.mockImplementation((ref: string) =>
      ref === 'BOV-2001-AAAAA'
        ? Promise.resolve(dto(ref, '2020-01-10'))
        : ref === 'BOV-2999-BBBBB'
          ? Promise.resolve(dto(ref, '2999-03-02'))
          : Promise.reject(new ApiError(404, 'BOOKING_NOT_FOUND', 'Réservation introuvable.')),
    );
    render(<MyBookings />);
    const links = await screen.findAllByRole('link', { name: /BOV-/ });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/reservation/BOV-2999-BBBBB',
      '/reservation/BOV-2001-AAAAA',
    ]);
    expect(screen.getByText('Passées ou annulées')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(TOKENS)!)).not.toHaveProperty('BOV-2999-CCCCC');
  });

  it('says so when nothing is saved on this device', async () => {
    render(<MyBookings />);
    expect(
      await screen.findByText('Aucune réservation enregistrée sur cet appareil.'),
    ).toBeInTheDocument();
  });

  it('finds a booking with reference and phone, then remembers it on this device', async () => {
    lookupBooking.mockResolvedValue({
      booking: dto('BOV-2611-7KQ4M', '2026-11-12'),
      accessToken: 'new-token',
    });
    render(<MyBookings />);
    await userEvent.type(screen.getByLabelText('Référence'), 'bov-2611-7kq4m');
    await userEvent.type(screen.getByLabelText('Téléphone'), '90 12 34 56');
    await userEvent.click(screen.getByRole('button', { name: 'Retrouver ma réservation' }));
    expect(lookupBooking).toHaveBeenCalledWith('BOV-2611-7KQ4M', '+22890123456');
    expect(push).toHaveBeenCalledWith('/reservation/BOV-2611-7KQ4M');
    expect(JSON.parse(localStorage.getItem(TOKENS)!)['BOV-2611-7KQ4M']).toBe('new-token');
  });

  it('checks the fields before asking the server, and shows the server answer', async () => {
    render(<MyBookings />);
    await userEvent.click(screen.getByRole('button', { name: 'Retrouver ma réservation' }));
    expect(screen.getByText(/Indiquez la référence reçue/)).toBeInTheDocument();
    expect(lookupBooking).not.toHaveBeenCalled();

    lookupBooking.mockRejectedValue(
      new ApiError(404, 'BOOKING_NOT_FOUND', 'Aucune réservation ne correspond.'),
    );
    await userEvent.type(screen.getByLabelText('Référence'), 'BOV-2611-7KQ4M');
    await userEvent.type(screen.getByLabelText('Téléphone'), '90123456');
    await userEvent.click(screen.getByRole('button', { name: 'Retrouver ma réservation' }));
    expect(await screen.findByText('Aucune réservation ne correspond.')).toBeInTheDocument();
  });
});
