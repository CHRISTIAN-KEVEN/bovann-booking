import {
  PAYMENT_METHOD_LABELS_FR,
  formatXof,
  type BookingStatus,
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
}

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
export function paymentLine(d: ReceiptData): { label: string; detail: string | null } {
  if (d.totalXof === 0) return { label: 'Offert', detail: null };
  if (!d.payment) return { label: 'À régler au studio', detail: null };
  const method = PAYMENT_METHOD_LABELS_FR[d.payment.method];
  const channel = d.payment.channel
    ? (CHANNEL_LABELS[d.payment.channel] ?? d.payment.channel)
    : null;
  const how = channel ? `${method} (${channel})` : method;
  const when = d.payment.paidAt ? ` le ${dateTimeIn(d.payment.paidAt, d.timezone)}` : '';
  return { label: 'Payé', detail: `Payé${when} par ${how}.` };
}

/** "9 novembre 2026 à 14:32" in the studio's time zone. */
export function dateTimeIn(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')} à ${get('hour')}:${get('minute')}`;
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
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    info: {
      Title: `Reçu de réservation ${b.reference}`,
      Author: 'OCD Live — Bovann Group',
      Subject: 'Reçu de réservation',
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
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(t('par Bovann Group · Lomé, Togo'));
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(INK)
    .text(t('REÇU DE RÉSERVATION'), left, 50, { width, align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(MUTED)
    .text(t(`N° ${b.reference}`), { width, align: 'right' })
    .text(t(`Émis le ${dateTimeIn(ctx.issuedAt, d.timezone)}`), { width, align: 'right' });

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
    .text(t('VOTRE RÉFÉRENCE (à présenter au studio)'), left + 16, y + 12);
  doc
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor(INK)
    .text(b.reference, left + 16, y + 28);
  const pay = paymentLine(d);
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(pay.label === 'À régler au studio' ? '#92400e' : '#166534')
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

  section('Votre live');
  row('Date', longDate(b.date));
  row('Horaire', timesOf(b));
  row('Formule', formulaOf(b));
  row('Mode', b.modeLabel);
  row(
    'Lieu',
    b.mode === 'IN_PERSON'
      ? [b.spaceName, b.spaceAddress].filter(Boolean).join(', ')
      : 'À distance : le studio vous contacte pour organiser la connexion.',
  );
  y += 8;

  section('Client');
  row('Nom', b.customer.fullName);
  row('Entreprise', `${b.customer.businessName} (${b.customer.businessSector})`);
  row('Téléphone', readablePhone(b.customer.phone));
  if (b.customer.email) row('E-mail', b.customer.email);
  y += 8;

  section('Montant');
  row('Prix des créneaux', formatXof(d.listPriceXof));
  if (d.discountXof > 0) row('Remise forfait', `- ${formatXof(d.discountXof)}`);
  doc
    .moveTo(left, y)
    .lineTo(left + width, y)
    .lineWidth(0.8)
    .strokeColor(LINE)
    .stroke();
  y += 8;
  row(d.payment || d.totalXof === 0 ? 'Total payé' : 'Total à régler', formatXof(d.totalXof), true);
  if (pay.detail) row('Paiement', pay.detail);
  if (d.payment?.providerRef) row('Réf. de transaction', d.payment.providerRef);
  y += 12;

  // How to find the booking again, and the cancellation rule.
  const boxTop = y;
  const phone = readablePhone(b.customer.phone);
  const lines = [
    `Retrouver votre réservation : ${ctx.webUrl}/mes-reservations, avec la référence ${b.reference} et le numéro ${phone}.`,
    `Annulation ou changement de date : contactez le studio au moins 48 heures avant le live (conditions : ${ctx.webUrl}/conditions).`,
  ];
  if (ctx.contactPhone) lines.push(`Contact du studio : ${ctx.contactPhone}.`);
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
    .text(
      t('Ce reçu confirme votre réservation. Il ne constitue pas une facture.'),
      left,
      doc.page.height - 64,
      { width, align: 'center', lineBreak: false },
    );

  doc.end();
  return done;
}
