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

describe('Retrouver ma réservation', () => {
  beforeEach(() => {
    push.mockClear();
    booking.mockReset();
    lookupBooking.mockReset();
    localStorage.clear();
  });

  it('never lists bookings saved in this browser (shared phones and computers)', () => {
    localStorage.setItem(
      TOKENS,
      JSON.stringify({ 'BOV-2611-AAAAA': 't1', 'BOV-2611-BBBBB': 't2' }),
    );
    render(<MyBookings />);
    expect(screen.queryByText(/BOV-2611-AAAAA|BOV-2611-BBBBB/)).toBeNull();
    expect(screen.queryAllByRole('link', { name: /BOV-/ })).toHaveLength(0);
    expect(booking).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retrouver ma réservation' })).toBeInTheDocument();
  });

  it('finds a booking with reference and phone, then opens it', async () => {
    lookupBooking.mockResolvedValue({
      booking: { reference: 'BOV-2611-7KQ4M' },
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
    expect(screen.getByText(/par exemple BOV-2611-7KQ4M/)).toBeInTheDocument();
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
