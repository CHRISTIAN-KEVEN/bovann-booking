import type { NotificationPayload } from '../notification/payload';
import { dateTimeIn, paymentLine, pdfText, renderReceiptPdf, type ReceiptData } from './receipt';

const booking: NotificationPayload = {
  reference: 'BOV-2611-7KQ4M',
  spaceId: 1,
  spaceName: 'Studio principal — Lomé',
  spaceAddress: 'Rue 123, Lomé',
  mode: 'IN_PERSON',
  modeLabel: 'En studio',
  date: '2026-11-12',
  startTime: '12:30',
  endTime: '18:30',
  bookingType: 'PACKAGE',
  packageName: 'Pack 6h',
  slotCount: 4,
  totalXof: 51000,
  liveDescription: null,
  customer: {
    fullName: 'Afi Mensah',
    phone: '+22890123456',
    email: null,
    businessName: 'Boutique Afi Mode',
    businessSector: 'Mode & beauté',
  },
};

const paid: ReceiptData = {
  booking,
  status: 'CONFIRMED',
  timezone: 'Africa/Lome',
  listPriceXof: 60000,
  discountXof: 9000,
  totalXof: 51000,
  payment: {
    method: 'MOBILE_MONEY',
    channel: 'TMONEY',
    paidAt: new Date('2026-11-09T14:32:00Z'),
    providerRef: null,
  },
};

describe('receipt', () => {
  it('describes how it was paid, in the studio time zone', () => {
    expect(paymentLine(paid)).toEqual({
      label: 'Payé',
      detail: 'Payé le 9 novembre 2026 à 14:32 par Mobile Money (T-Money).',
      due: false,
    });
    expect(paymentLine(paid, 'en')).toEqual({
      label: 'Paid',
      detail: 'Paid on 9 November 2026 at 14:32 by Mobile Money (T-Money).',
      due: false,
    });
    expect(paymentLine({ ...paid, payment: null })).toEqual({
      label: 'À régler au studio',
      detail: null,
      due: true,
    });
    expect(paymentLine({ ...paid, payment: null, totalXof: 0 }).label).toBe('Offert');
    expect(dateTimeIn(new Date('2026-11-09T23:30:00Z'), 'Africa/Lagos')).toBe(
      '10 novembre 2026 à 00:30',
    );
  });

  it('only uses characters the built-in PDF fonts can draw', () => {
    expect(pdfText('15\u202f000 FCFA \u2212 9\u2009000')).toBe('15\u00a0000 FCFA - 9\u00a0000');
  });

  it('renders a one-page PDF, also for a virtual unpaid booking with an email', async () => {
    for (const d of [
      paid,
      {
        ...paid,
        payment: null,
        booking: {
          ...booking,
          mode: 'VIRTUAL' as const,
          modeLabel: 'Virtuel',
          customer: { ...booking.customer, email: 'afi@example.tg' },
        },
      },
    ]) {
      const pdf = await renderReceiptPdf(d, {
        webUrl: 'https://reservation.example.tg',
        contactPhone: '+228 90 00 00 00',
        issuedAt: new Date('2026-11-10T08:00:00Z'),
      });
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
    }
  });
});
