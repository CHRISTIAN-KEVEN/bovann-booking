import type { BookingDto, DayAvailabilityResponse } from '@bovann/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './api';
import {
  formatDuration,
  formatLongDate,
  formatMonth,
  formatShortDate,
  leadingBlanks,
  shiftMonth,
} from './dates';
import { composePhone, splitPhone, validateDetails } from './details';
import { firstMissingStep, updateFlow } from './flow';
import { bookingToIcs } from './ics';
import { suggestPackage, summarizeSlots, timesLabel } from './selection';
import { rememberToken, tokenFor } from './tokens';

describe('dates (French, studio-local)', () => {
  it('formats dates and months in French', () => {
    expect(formatLongDate('2026-11-12')).toBe('Jeudi 12 novembre');
    expect(formatLongDate('2026-11-12', true)).toBe('Jeudi 12 novembre 2026');
    expect(formatShortDate('2026-11-12')).toBe('Jeu. 12 nov.');
    expect(formatMonth('2026-11')).toBe('Novembre 2026');
  });

  it('starts weeks on Monday: 1 November 2026 is a Sunday', () => {
    expect(leadingBlanks('2026-11')).toBe(6);
    expect(leadingBlanks('2026-12')).toBe(1);
  });

  it('moves between months across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
  });

  it('formats durations like the design', () => {
    expect(formatDuration(90)).toBe('1h30');
    expect(formatDuration(360)).toBe('6h');
    expect(formatDuration(810)).toBe('13h30');
  });
});

const slot = (hhmm: string, endHhmm: string, status: 'AVAILABLE' | 'BOOKED' = 'AVAILABLE') => ({
  start: `2026-11-12T${hhmm}:00.000Z`,
  end: `2026-11-12T${endHhmm}:00.000Z`,
  startTime: hhmm,
  endTime: endHhmm,
  status,
});

const DAY: DayAvailabilityResponse = {
  date: '2026-11-12',
  mode: 'IN_PERSON',
  status: 'AVAILABLE',
  availableCount: 6,
  unitPriceXof: 15000,
  slots: [
    slot('08:00', '09:30'),
    slot('09:30', '11:00', 'BOOKED'),
    slot('12:30', '14:00'),
    slot('14:00', '15:30'),
    slot('20:00', '21:30'),
  ],
  packages: [
    {
      code: 'PACK_3H',
      name: 'Pack 3h',
      description: null,
      isFullDay: false,
      slotCount: 2,
      durationMin: 180,
      price: { listPriceXof: 30000, discountXof: 3000, totalXof: 27000, discountPercent: 10 },
      startOptions: [
        {
          start: '2026-11-12T12:30:00.000Z',
          end: '2026-11-12T15:30:00.000Z',
          startTime: '12:30',
          endTime: '15:30',
        },
      ],
    },
  ],
};

describe('day selection helpers', () => {
  it('merges back-to-back slots into ranges', () => {
    expect(
      timesLabel([slot('12:30', '14:00'), slot('14:00', '15:30'), slot('20:00', '21:30')]),
    ).toBe('12:30 – 15:30, 20:00 – 21:30');
  });

  it('prices single slots at the unit price', () => {
    expect(summarizeSlots(DAY, [DAY.slots[0]!.start, DAY.slots[4]!.start])).toEqual({
      label: '2 créneaux',
      timesLabel: '08:00 – 09:30, 20:00 – 21:30',
      slotCount: 2,
      listPriceXof: 30000,
      discountXof: 0,
      totalXof: 30000,
    });
    expect(summarizeSlots(DAY, [])).toBeNull();
  });

  it('suggests the cheaper package for consecutive slots only', () => {
    const consecutive = suggestPackage(DAY, [DAY.slots[2]!.start, DAY.slots[3]!.start]);
    expect(consecutive?.pkg.code).toBe('PACK_3H');
    expect(consecutive?.savingXof).toBe(3000);
    expect(suggestPackage(DAY, [DAY.slots[0]!.start, DAY.slots[4]!.start])).toBeNull();
    expect(suggestPackage(DAY, [DAY.slots[2]!.start])).toBeNull();
  });
});

describe('booking flow state', () => {
  it('changing the date drops the slot choice and any booking in progress', () => {
    const flow = {
      mode: 'IN_PERSON' as const,
      date: '2026-11-12',
      selection: { type: 'SLOTS' as const, slotStarts: ['x'] },
      summary: {
        label: '1 créneau',
        timesLabel: '',
        slotCount: 1,
        listPriceXof: 1,
        discountXof: 0,
        totalXof: 1,
      },
      booking: { reference: 'BOV-2611-AAAAA', accessToken: 't' },
    };
    const next = updateFlow(flow, { date: '2026-11-13' });
    expect(next.selection).toBeUndefined();
    expect(next.summary).toBeUndefined();
    expect(next.booking).toBeUndefined();
    expect(updateFlow(flow, { month: '2026-12' }).selection).toBeDefined();
  });

  it('knows the first step still to complete', () => {
    expect(firstMissingStep({})).toBe('/');
    expect(firstMissingStep({ mode: 'VIRTUAL' })).toBe('/reserver/date');
    expect(firstMissingStep({ mode: 'VIRTUAL', date: '2026-11-12' })).toBe('/reserver/creneaux');
  });
});

describe('customer details', () => {
  it('composes and splits E.164 numbers, dropping a leading national 0', () => {
    expect(composePhone('+228', '90 12 34 56')).toBe('+22890123456');
    expect(composePhone('+33', '06 12 34 56 78')).toBe('+33612345678');
    expect(splitPhone('+22890123456')).toEqual({ countryCode: '+228', local: '90123456' });
  });

  it('reports every missing field in French', () => {
    const errors = validateDetails({
      fullName: ' ',
      phone: '+228',
      email: 'not-an-email',
      businessName: '',
      businessSector: '',
      liveDescription: '',
      acceptTerms: false,
    });
    expect(Object.keys(errors).sort()).toEqual([
      'acceptTerms',
      'businessName',
      'businessSector',
      'email',
      'fullName',
      'phone',
    ]);
    expect(errors.acceptTerms).toContain('conditions');
  });
});

describe('API client', () => {
  it('turns API errors into ApiError with the French message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 409,
          code: 'SLOT_UNAVAILABLE',
          message: 'Désolé, déjà réservé.',
        }),
        { status: 409 },
      ),
    );
    await expect(apiFetch('/bookings', {}, fetchMock)).rejects.toMatchObject({
      status: 409,
      code: 'SLOT_UNAVAILABLE',
      message: 'Désolé, déjà réservé.',
    });
  });

  it('explains network failures in French', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const error = await apiFetch('/spaces/x', {}, fetchMock).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toContain('connexion internet');
  });

  it('sends the booking token as a header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    await apiFetch('/bookings/BOV-2611-AAAAA', { token: 'secret' }, fetchMock);
    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get('X-Booking-Token')).toBe('secret');
  });
});

describe('tokens and calendar file', () => {
  it('remembers booking tokens in this browser', () => {
    rememberToken('BOV-2611-AAAAA', 'tok');
    expect(tokenFor('BOV-2611-AAAAA')).toBe('tok');
    expect(tokenFor('BOV-2611-BBBBB')).toBeUndefined();
  });

  it('builds a valid iCalendar event', () => {
    const booking = {
      reference: 'BOV-2611-AAAAA',
      mode: 'IN_PERSON',
      spaceName: 'Studio principal — Lomé',
      startTime: '12:30',
      endTime: '18:30',
      packageName: 'Pack 6h',
      slotCount: 4,
      slots: [
        {
          start: '2026-11-12T12:30:00.000Z',
          end: '2026-11-12T14:00:00.000Z',
          startTime: '12:30',
          endTime: '14:00',
        },
        {
          start: '2026-11-12T17:00:00.000Z',
          end: '2026-11-12T18:30:00.000Z',
          startTime: '17:00',
          endTime: '18:30',
        },
      ],
    } as BookingDto;
    const ics = bookingToIcs(booking, '2026-11-08T21:00:00.000Z');
    expect(ics).toContain('DTSTART:20261112T123000Z');
    expect(ics).toContain('DTEND:20261112T183000Z');
    expect(ics).toContain('UID:BOV-2611-AAAAA@bovann-ocd-live');
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
});
