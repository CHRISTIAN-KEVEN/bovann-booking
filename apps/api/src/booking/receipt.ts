import {
  PAYMENT_METHOD_LABELS,
  SESSION_MODE_LABELS,
  formatXof,
  type BookingStatus,
  type Locale,
  type PaymentMethod,
} from '@bovann/shared';
import type { Kysely } from 'kysely';
import PDFDocument from 'pdfkit';
import type { Database } from '../database/schema';
import { buildNotificationPayload, type NotificationPayload } from '../notification/payload';
import { formulaOf, longDate, readablePhone, timesOf } from '../notification/templates';

/**
 * Booking receipt ("Reçu de réservation") for customers: a one-page PDF with the reference, the
 * session, what was paid and how to find the booking again. It is not an invoice (no tax
 * details); Bovann Group issues invoices separately if a customer needs one.
 */
export interface ReceiptData {
  booking: NotificationPayload;
  status: BookingStatus;
  timezone: string;
  listPriceXof: number;
  discountXof: number;
  totalXof: number;
  payment: {
    method: PaymentMethod;
    channel: string | null;
    paidAt: Date | null;
    providerRef: string | null;
  } | null;
}

export interface ReceiptContext {
  /** Public website address, without trailing slash. */
  webUrl: string;
  contactPhone?: string;
  issuedAt: Date;
  /** Language of the receipt: the page's language when it is downloaded. French by default. */
  locale?: Locale;
}

/** The receipt's texts. French is the reference. */
const TEXT = {
  fr: {
    free: 'Offert',
    unpaid: 'À régler au studio',
    paid: 'Payé',
    paidDetail: (when: string, how: string) => `Payé${when ? ` le ${when}` : ''} par ${how}.`,
    at: 'à',
    title: (ref: string) => `Reçu de réservation ${ref}`,
    subject: 'Reçu de réservation',
    by: 'par Bovann Group · Lomé, Togo',
    heading: 'REÇU DE RÉSERVATION',
    number: (ref: string) => `N° ${ref}`,
    issued: (when: string) => `Émis le ${when}`,
    yourRef: 'VOTRE RÉFÉRENCE (à présenter au studio)',
    yourLive: 'Votre live',
    date: 'Date',
    time: 'Horaire',
    formula: 'Formule',
    mode: 'Mode',
    place: 'Lieu',
    remote: 'À distance : le studio vous contacte pour organiser la connexion.',
    client: 'Client',
    name: 'Nom',
    business: 'Entreprise',
    phone: 'Téléphone',
    email: 'E-mail',
    amount: 'Montant',
    slotsPrice: 'Prix des créneaux',
    discount: 'Remise forfait',
    totalPaid: 'Total payé',
    totalDue: 'Total à régler',
    payment: 'Paiement',
    transaction: 'Réf. de transaction',
    find: (url: string, ref: string, phone: string) =>
      `Retrouver votre réservation : ${url}/mes-reservations, avec la référence ${ref} et le numéro ${phone}.`,
    cancel: (url: string) =>
      `Annulation ou changement de date : contactez le studio au moins 48 heures avant le live (conditions : ${url}/conditions).`,
    contact: (phone: string) => `Contact du studio : ${phone}.`,
    notInvoice: 'Ce reçu confirme votre réservation. Il ne constitue pas une facture.',
  },
  en: {
    free: 'Free',
    unpaid: 'To pay at the studio',
    paid: 'Paid',
    paidDetail: (when: string, how: string) => `Paid${when ? ` on ${when}` : ''} by ${how}.`,
    at: 'at',
    title: (ref: string) => `Booking receipt ${ref}`,
    subject: 'Booking receipt',
    by: 'by Bovann Group · Lomé, Togo',
    heading: 'BOOKING RECEIPT',
    number: (ref: string) => `No. ${ref}`,
    issued: (when: string) => `Issued on ${when}`,
    yourRef: 'YOUR REFERENCE (show it at the studio)',
    yourLive: 'Your live',
    date: 'Date',
    time: 'Time',
    formula: 'Option',
    mode: 'Mode',
    place: 'Place',
    remote: 'Remote: the studio will contact you to set up the connection.',
    client: 'Customer',
    name: 'Name',
    business: 'Business',
    phone: 'Phone',
    email: 'Email',
    amount: 'Amount',
    slotsPrice: 'Price of the slots',
    discount: 'Package discount',
    totalPaid: 'Total paid',
    totalDue: 'Total to pay',
    payment: 'Payment',
    transaction: 'Transaction ref.',
    find: (url: string, ref: string, phone: string) =>
      `Find your booking: ${url}/en/mes-reservations, with the reference ${ref} and the number ${phone}.`,
    cancel: (url: string) =>
      `To cancel or change the date: contact the studio at least 48 hours before the live (terms: ${url}/en/conditions).`,
    contact: (phone: string) => `Studio contact: ${phone}.`,
    notInvoice: 'This receipt confirms your booking. It is not an invoice.',
  },
} satisfies Record<Locale, unknown>;

const CHANNEL_LABELS: Record<string, string> = { TMONEY: 'T-Money', FLOOZ: 'Flooz' };

export async function loadReceiptData(
  db: Kysely<Database>,
  bookingId: number,
): Promise<ReceiptData> {
  const booking = await buildNotificationPayload(db, bookingId);
  const row = await db
    .selectFrom('t_bookings as b')
    .innerJoin('t_spaces as s', 's.id', 'b.space_id')
    .select(['b.status', 'b.list_price_xof', 'b.discount_xof', 'b.total_xof', 's.timezone'])
    .where('b.id', '=', bookingId)
    .executeTakeFirstOrThrow();
  const payment = await db
    .selectFrom('t_payments')
    .select(['method', 'channel', 'succeeded_at', 'provider', 'provider_ref'])
    .where('booking_id', '=', bookingId)
    .where('status', '=', 'SUCCEEDED')
    .executeTakeFirst();
  return {
    booking,
    status: row.status,
    timezone: row.timezone,
    listPriceXof: row.list_price_xof,
    discountXof: row.discount_xof,
    totalXof: row.total_xof,
    payment: payment
      ? {
          method: payment.method,
          channel: payment.channel,
          paidAt: payment.succeeded_at,
          // The simulated provider's references mean nothing to a customer.
          providerRef: payment.provider === 'mock' ? null : payment.provider_ref,
        }
      : null,
  };
}

/** What the receipt says about payment. */
export function paymentLine(
  d: ReceiptData,
  locale: Locale = 'fr',
): { label: string; detail: string | null; due: boolean } {
  const x = TEXT[locale];
  if (d.totalXof === 0) return { label: x.free, detail: null, due: false };
  if (!d.payment) return { label: x.unpaid, detail: null, due: true };
  const method = PAYMENT_METHOD_LABELS[locale][d.payment.method];
  const channel = d.payment.channel
    ? (CHANNEL_LABELS[d.payment.channel] ?? d.payment.channel)
    : null;
  const how = channel ? `${method} (${channel})` : method;
  const when = d.payment.paidAt ? dateTimeIn(d.payment.paidAt, d.timezone, locale) : '';
  return { label: x.paid, detail: x.paidDetail(when, how), due: false };
}

/** "9 novembre 2026 à 14:32" / "9 November 2026 at 14:32" in the studio's time zone. */
export function dateTimeIn(at: Date, timezone: string, locale: Locale = 'fr'): string {
  const parts = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')} ${TEXT[locale].at} ${get('hour')}:${get('minute')}`;
}

/**
 * The built-in PDF fonts only cover Western European characters: swap the few typographic
 * characters they lack for close equivalents.
 */
export function pdfText(s: string): string {
  return s
    .replace(/[\u202f\u2009\u2007]/g, '\u00a0')
    .replace(/\u2212/g, '-')
    .replace(/\u2011/g, '-');
}

const BRAND = '#c2410c';
const INK = '#14151b';
const MUTED = '#5b5d66';
const LINE = '#e4e2dc';

export function renderReceiptPdf(d: ReceiptData, ctx: ReceiptContext): Promise<Buffer> {
  const b = d.booking;
  const locale: Locale = ctx.locale ?? 'fr';
  const x = TEXT[locale];
  const en = locale === 'en';
  const money = (n: number) => formatXof(n, locale);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    lang: locale,
    info: {
      Title: x.title(b.reference),
      Author: 'OCD Live — Bovann Group',
      Subject: x.subject,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = 48;
  const width = doc.page.width - 96;
  const t = (s: string) => pdfText(s);

  // Header: brand on the left, receipt number on the right.
  doc.font('Helvetica-Bold').fontSize(24).fillColor(BRAND).text('OCD Live', left, 48);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(t(x.by));
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(INK)
    .text(t(x.heading), left, 50, { width, align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(MUTED)
    .text(t(x.number(b.reference)), { width, align: 'right' })
    .text(t(x.issued(dateTimeIn(ctx.issuedAt, d.timezone, locale))), { width, align: 'right' });

  doc
    .moveTo(left, 104)
    .lineTo(left + width, 104)
    .lineWidth(1)
    .strokeColor(LINE)
    .stroke();

  // Reference block: the one thing the customer must keep.
  let y = 122;
  doc.roundedRect(left, y, width, 64, 8).fillColor('#fff4ea').fill();
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(MUTED)
    .text(t(x.yourRef), left + 16, y + 12);
  doc
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor(INK)
    .text(b.reference, left + 16, y + 28);
  const pay = paymentLine(d, locale);
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(pay.due ? '#92400e' : '#166534')
    .text(t(pay.label), left, y + 34, { width: width - 16, align: 'right' });
  y += 84;

  const section = (title: string) => {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND).text(t(title.toUpperCase()), left, y);
    y = doc.y + 6;
  };
  const row = (label: string, value: string, bold = false) => {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(t(label), left, y, { width: 150 });
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(10.5)
      .fillColor(INK)
      .text(t(value), left + 160, y, { width: width - 160 });
    y = Math.max(doc.y, y + 14) + 6;
  };

  section(x.yourLive);
  row(x.date, longDate(b.date, locale));
  row(x.time, timesOf(b));
  row(x.formula, formulaOf(b, locale));
  row(x.mode, en ? SESSION_MODE_LABELS.en[b.mode] : b.modeLabel);
  row(
    x.place,
    b.mode === 'IN_PERSON'
      ? [en ? (b.spaceNameEn ?? b.spaceName) : b.spaceName, b.spaceAddress]
          .filter(Boolean)
          .join(', ')
      : x.remote,
  );
  y += 8;

  section(x.client);
  row(x.name, b.customer.fullName);
  row(x.business, `${b.customer.businessName} (${b.customer.businessSector})`);
  row(x.phone, readablePhone(b.customer.phone));
  if (b.customer.email) row(x.email, b.customer.email);
  y += 8;

  section(x.amount);
  row(x.slotsPrice, money(d.listPriceXof));
  if (d.discountXof > 0) row(x.discount, `- ${money(d.discountXof)}`);
  doc
    .moveTo(left, y)
    .lineTo(left + width, y)
    .lineWidth(0.8)
    .strokeColor(LINE)
    .stroke();
  y += 8;
  row(d.payment || d.totalXof === 0 ? x.totalPaid : x.totalDue, money(d.totalXof), true);
  if (pay.detail) row(x.payment, pay.detail);
  if (d.payment?.providerRef) row(x.transaction, d.payment.providerRef);
  y += 12;

  // How to find the booking again, and the cancellation rule.
  const boxTop = y;
  const phone = readablePhone(b.customer.phone);
  const lines = [x.find(ctx.webUrl, b.reference, phone), x.cancel(ctx.webUrl)];
  if (ctx.contactPhone) lines.push(x.contact(ctx.contactPhone));
  doc.font('Helvetica').fontSize(9.5);
  const textHeight = lines.reduce(
    (h, l) => h + doc.heightOfString(t(l), { width: width - 32 }) + 6,
    0,
  );
  doc
    .roundedRect(left, boxTop, width, textHeight + 20, 8)
    .lineWidth(0.8)
    .strokeColor(LINE)
    .stroke();
  y = boxTop + 12;
  for (const l of lines) {
    doc.fillColor(INK).text(t(l), left + 16, y, { width: width - 32 });
    y = doc.y + 6;
  }

  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(t(x.notInvoice), left, doc.page.height - 64, {
      width,
      align: 'center',
      lineBreak: false,
    });

  doc.end();
  return done;
}
