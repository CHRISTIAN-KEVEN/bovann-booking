import { isPermanentSendError } from './mailer';
import type { NotificationPayload } from './payload';
import { escapeHtml, longDate, readablePhone, renderEmail, renderTestEmail } from './templates';

const ctx = { webUrl: 'https://reservation.bovann.tg', contactPhone: '+228 90 00 00 00' };

function payload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    bookingId: 7,
    reference: 'BOV-2611-7KQ4M',
    spaceId: 1,
    spaceName: 'Studio principal — Lomé',
    spaceAddress: 'Rue 12, Tokoin, Lomé',
    mode: 'IN_PERSON',
    modeLabel: 'En studio',
    date: '2026-11-12',
    startTime: '12:30',
    endTime: '18:30',
    bookingType: 'PACKAGE',
    slotRanges: ['12:30–14:00', '14:00–15:30', '15:30–17:00', '17:00–18:30'],
    packageName: 'Pack 6h',
    slotCount: 4,
    totalXof: 51000,
    refundXof: null,
    source: 'ONLINE',
    liveDescription: 'Nouvelle collection <wax>',
    customer: {
      fullName: 'Afi Mensah',
      phone: '+22890123456',
      email: 'afi@example.tg',
      businessName: 'Boutique Afi & Fils',
      businessSector: 'Mode & beauté',
    },
    ...overrides,
  };
}

describe('email templates', () => {
  it('tells the owners who booked, with the business details and a link to the admin', () => {
    const email = renderEmail('owner_booking_confirmed', payload(), ctx);
    expect(email.subject).toBe(
      'Nouvelle réservation BOV-2611-7KQ4M · Boutique Afi & Fils · jeu. 12 nov. 12:30–18:30',
    );
    expect(email.html).toContain('Boutique Afi &amp; Fils');
    expect(email.html).toContain('Mode &amp; beauté');
    expect(email.html).toContain('href="tel:+22890123456"');
    expect(email.html).toContain('+228 90 12 34 56');
    expect(email.html).toContain('href="mailto:afi@example.tg"');
    expect(email.html).toContain('https://reservation.bovann.tg/admin');
    expect(email.text).toMatch(/Réservation payée en ligne\u00a0: 51\s000\sFCFA/);
    expect(email.text).toContain('Pack 6h');
  });

  it('escapes everything that comes from customers', () => {
    const email = renderEmail('owner_booking_confirmed', payload(), ctx);
    expect(email.html).toContain('Nouvelle collection &lt;wax&gt;');
    expect(email.html).not.toContain('<wax>');
    expect(escapeHtml(`<a href="x">'`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;');
  });

  it('says when the studio added the booking itself, and flags virtual sessions', () => {
    const email = renderEmail(
      'owner_booking_confirmed',
      payload({ source: 'ADMIN', mode: 'VIRTUAL', modeLabel: 'Virtuel' }),
      ctx,
    );
    expect(email.text).toContain('Réservation ajoutée par le studio.');
    expect(email.text).toContain('assistant qui modère le live');
  });

  it('lists separate single slots instead of one range', () => {
    const email = renderEmail(
      'customer_booking_confirmed',
      payload({
        bookingType: 'SLOTS',
        packageName: null,
        slotCount: 2,
        startTime: '08:00',
        endTime: '21:30',
        slotRanges: ['08:00–09:30', '20:00–21:30'],
      }),
      ctx,
    );
    expect(email.text).toContain('Horaire : 08:00–09:30, 20:00–21:30');
    expect(email.text).toContain('Formule : 2 créneaux');
  });

  it('confirms to the customer, with the address in studio and the contact phone', () => {
    const email = renderEmail('customer_booking_confirmed', payload(), ctx);
    expect(email.subject).toBe('Réservation confirmée · BOV-2611-7KQ4M');
    expect(email.text).toContain('Bonjour Afi Mensah,');
    expect(email.text).toContain('Adresse : Rue 12, Tokoin, Lomé');
    expect(email.text).toContain('jeudi 12 novembre 2026');
    expect(email.text).toContain('+228 90 00 00 00');
    expect(email.text).not.toContain('afi@example.tg'); // their own details aren't repeated
    // A way back to the booking from any device, and the cancellation rule.
    expect(email.html).toContain(
      'https://reservation.bovann.tg/mes-reservations?ref=BOV-2611-7KQ4M',
    );
    expect(email.text).toMatch(/au moins 48\sheures avant/);
    expect(email.text).toContain('https://reservation.bovann.tg/conditions');
  });

  it('tells the customer about a cancellation and the refund to come', () => {
    const refunded = renderEmail('customer_booking_cancelled', payload({ refundXof: 51000 }), ctx);
    expect(refunded.subject).toBe('Réservation annulée · BOV-2611-7KQ4M');
    expect(refunded.text).toMatch(/remboursé de 51\s000\sFCFA/);
    const none = renderEmail('customer_booking_cancelled', payload({ refundXof: null }), ctx);
    expect(none.text).not.toContain('remboursé');
  });

  it('asks the owners to refund a late payment', () => {
    const email = renderEmail('owner_late_payment_refund', payload({ refundXof: 15000 }), ctx);
    expect(email.subject).toMatch(/^À rembourser : BOV-2611-7KQ4M · 15\s000\sFCFA · Afi Mensah$/);
    expect(email.html).toContain('https://reservation.bovann.tg/admin/paiements');
  });

  it('renders emails queued before Phase 6 (fewer fields)', () => {
    const old = payload();
    delete old.slotRanges;
    delete old.bookingType;
    delete old.source;
    delete old.spaceAddress;
    expect(() => renderEmail('owner_booking_confirmed', old, ctx)).not.toThrow();
    expect(renderEmail('customer_booking_confirmed', old, ctx).text).toContain('12:30–18:30');
  });

  it('refuses an unknown template', () => {
    expect(() => renderEmail('nope', payload(), ctx)).toThrow(/Unknown email template/);
  });

  it('builds the test email', () => {
    expect(renderTestEmail('owner@bovann.tg', ctx).text).toContain('owner@bovann.tg');
  });

  it('formats French dates and phone numbers', () => {
    expect(longDate('2026-11-12')).toBe('jeudi 12 novembre 2026');
    expect(readablePhone('+22890123456')).toBe('+228 90 12 34 56');
  });
});

describe('sending errors', () => {
  it('gives up only when retrying cannot help', () => {
    expect(isPermanentSendError({ responseCode: 550, response: '550 5.1.1 User unknown' })).toBe(
      true,
    );
    expect(isPermanentSendError({ code: 'EENVELOPE' })).toBe(true);
    expect(
      isPermanentSendError({
        responseCode: 550,
        response: '550 5.4.5 Daily user sending quota exceeded',
      }),
    ).toBe(false);
    expect(isPermanentSendError({ responseCode: 421, response: '421 Try again later' })).toBe(
      false,
    );
    expect(isPermanentSendError({ code: 'ECONNECTION' })).toBe(false);
    expect(
      isPermanentSendError({
        responseCode: 535,
        response: '535 Username and Password not accepted',
      }),
    ).toBe(false);
  });
});
