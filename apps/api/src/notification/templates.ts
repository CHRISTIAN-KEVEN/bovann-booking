import { formatXof } from '@bovann/shared';
import type { NotificationPayload } from './payload';

/**
 * French email templates. Each returns a subject, an HTML body (table layout
 * and inline styles, which every mail client understands) and a plain-text
 * body for clients that don't show HTML. Every value from the database is
 * HTML-escaped.
 */

export const EMAIL_TEMPLATES = [
  'owner_booking_confirmed',
  'customer_booking_confirmed',
  'customer_booking_cancelled',
  'owner_late_payment_refund',
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export const TEMPLATE_LABELS_FR: Record<string, string> = {
  owner_booking_confirmed: 'Nouvelle réservation (gérants)',
  customer_booking_confirmed: 'Confirmation (client)',
  customer_booking_cancelled: 'Annulation (client)',
  owner_late_payment_refund: 'Remboursement à faire (gérants)',
};

export interface TemplateContext {
  /** Public website address, without trailing slash. */
  webUrl: string;
  contactPhone?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const NB = ' ';
const C = {
  ink: '#14151B',
  muted: '#5E6068',
  accent: '#C2410C',
  ground: '#F5F5F2',
  border: '#E3E3DE',
  live: '#F97316',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** '2026-11-12' → 'jeudi 12 novembre 2026'. */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

/** '2026-11-12' → 'jeu. 12 nov.' */
export function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

/** "+22890123456" → "+228 90 12 34 56". */
export function readablePhone(e164: string): string {
  const m = /^\+(1|2\d\d|3\d|4\d|[5-9]\d{1,2})(\d+)$/.exec(e164);
  return m ? `+${m[1]} ${m[2]!.replace(/(\d{2})(?=\d)/g, '$1 ')}` : e164;
}

/** Session times: one range, or the separate slots when they don't follow each other. */
export function timesOf(p: NotificationPayload): string {
  if (p.bookingType === 'SLOTS' && p.slotRanges && p.slotRanges.length > 1) {
    // Separate slots may not follow each other: list them.
    const consecutive = p.slotRanges.every(
      (r, i) => i === 0 || r.slice(0, 5) === p.slotRanges![i - 1]!.slice(-5),
    );
    if (!consecutive) return p.slotRanges.join(', ');
  }
  return `${p.startTime}–${p.endTime}`;
}

export function formulaOf(p: NotificationPayload): string {
  return p.packageName ?? `${p.slotCount} créneau${p.slotCount > 1 ? 'x' : ''}`;
}

function amountOf(xof: number): string {
  return xof === 0 ? 'Offert' : formatXof(xof);
}

type Row = [label: string, value: string, href?: string];

function layout(o: {
  preheader: string;
  title: string;
  intro: string[];
  sections: Array<{ heading: string; rows: Row[] }>;
  note?: string;
  button?: { label: string; href: string };
  footer: string;
}): string {
  const rows = (list: Row[]) =>
    list
      .map(
        ([label, value, href]) => `
            <tr>
              <td width="110" style="width:110px;padding:6px 12px 6px 0;color:${C.muted};font-size:14px;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>
              <td style="padding:6px 0;color:${C.ink};font-size:14px;font-weight:600;vertical-align:top">${
                href
                  ? `<a href="${escapeHtml(href)}" style="color:${C.accent};text-decoration:none">${escapeHtml(value)}</a>`
                  : escapeHtml(value)
              }</td>
            </tr>`,
      )
      .join('');
  const sections = o.sections
    .filter((s) => s.rows.length > 0)
    .map(
      (s) => `
        <tr><td style="padding:18px 28px 4px">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${C.muted}">${escapeHtml(s.heading)}</div>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:6px;border-collapse:collapse">${rows(s.rows)}
          </table>
        </td></tr>`,
    )
    .join('');
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(o.title)}</title></head>
<body style="margin:0;padding:0;background:${C.ground};font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(o.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.ground};padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${C.border};border-radius:14px;overflow:hidden">
        <tr><td style="background:${C.ink};padding:18px 28px;color:#ffffff;font-size:16px;font-weight:700">
          <span style="display:inline-block;width:10px;height:10px;border-radius:5px;background:${C.live};margin-right:8px"></span>Bovann OCD Live
        </td></tr>
        <tr><td style="padding:24px 28px 0">
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${C.ink}">${escapeHtml(o.title)}</h1>
          ${o.intro.map((p) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.55;color:${C.ink}">${escapeHtml(p)}</p>`).join('')}
        </td></tr>${sections}
        ${
          o.note
            ? `<tr><td style="padding:18px 28px 0"><div style="padding:12px 14px;border-radius:10px;background:#FFF7ED;border:1px solid #FED7AA;color:#9A3412;font-size:14px;line-height:1.5">${escapeHtml(o.note)}</div></td></tr>`
            : ''
        }
        ${
          o.button
            ? `<tr><td style="padding:22px 28px 0"><a href="${escapeHtml(o.button.href)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:${C.accent};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">${escapeHtml(o.button.label)}</a></td></tr>`
            : ''
        }
        <tr><td style="padding:24px 28px 26px;color:${C.muted};font-size:12px;line-height:1.5">${escapeHtml(o.footer)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function plain(o: {
  title: string;
  intro: string[];
  sections: Array<{ heading: string; rows: Row[] }>;
  note?: string;
  button?: { label: string; href: string };
  footer: string;
}): string {
  const lines = [o.title, '', ...o.intro, ''];
  for (const s of o.sections.filter((x) => x.rows.length > 0)) {
    lines.push(s.heading.toUpperCase());
    for (const [label, value] of s.rows) lines.push(`${label}${NB}: ${value}`);
    lines.push('');
  }
  if (o.note) lines.push(o.note, '');
  if (o.button) lines.push(`${o.button.label}${NB}: ${o.button.href}`, '');
  lines.push('—', o.footer);
  return lines.join('\n');
}

function build(
  subject: string,
  content: Parameters<typeof plain>[0] & { preheader: string },
): RenderedEmail {
  return { subject, html: layout(content), text: plain(content) };
}

function sessionRows(p: NotificationPayload, withPlace: boolean): Row[] {
  return [
    ['Date', longDate(p.date)],
    ['Horaire', timesOf(p)],
    ['Formule', formulaOf(p)],
    ['Mode', p.modeLabel],
    ...(withPlace && p.mode === 'IN_PERSON' && p.spaceAddress
      ? ([['Adresse', p.spaceAddress]] as Row[])
      : []),
    ['Espace', p.spaceName],
    ['Référence', p.reference],
  ];
}

function customerRows(p: NotificationPayload): Row[] {
  const c = p.customer;
  return [
    ['Nom', c.fullName],
    ['Entreprise', c.businessName],
    ['Secteur', c.businessSector],
    ['Téléphone', readablePhone(c.phone), `tel:${c.phone}`],
    ...(c.email ? ([['E-mail', c.email, `mailto:${c.email}`]] as Row[]) : []),
  ];
}

const OWNER_FOOTER =
  'E-mail automatique envoyé aux gérants de l’espace. Les adresses qui le reçoivent se règlent dans l’administration, rubrique Paramètres.';

function customerFooter(ctx: TemplateContext): string {
  return ctx.contactPhone
    ? `Une question${NB}? Appelez le studio au ${ctx.contactPhone}. Cet e-mail est envoyé automatiquement : merci de ne pas y répondre si vous attendez une réponse rapide.`
    : 'Cet e-mail est envoyé automatiquement par Bovann OCD Live.';
}

export function renderEmail(
  template: string,
  p: NotificationPayload,
  ctx: TemplateContext,
): RenderedEmail {
  const admin = { label: 'Ouvrir l’administration', href: `${ctx.webUrl}/admin` };
  switch (template) {
    case 'owner_booking_confirmed': {
      const how =
        p.source === 'ADMIN'
          ? 'Réservation ajoutée par le studio.'
          : p.totalXof === 0
            ? 'Réservation confirmée.'
            : `Réservation payée en ligne${NB}: ${amountOf(p.totalXof)}.`;
      return build(
        `Nouvelle réservation ${p.reference} · ${p.customer.businessName} · ${shortDate(p.date)} ${timesOf(p)}`,
        {
          preheader: `${p.customer.fullName} (${p.customer.businessName}), ${longDate(p.date)}, ${timesOf(p)}`,
          title: 'Nouvelle réservation confirmée',
          intro: [
            `${p.customer.fullName} (${p.customer.businessName}) a réservé le ${longDate(p.date)}, ${timesOf(p)}, ${p.modeLabel.toLowerCase()}.`,
            how,
          ],
          sections: [
            { heading: 'Séance', rows: sessionRows(p, false) },
            { heading: 'Client', rows: customerRows(p) },
            ...(p.liveDescription
              ? [{ heading: 'Le live', rows: [['Description', p.liveDescription]] as Row[] }]
              : []),
            { heading: 'Montant', rows: [['Total', amountOf(p.totalXof)]] },
          ],
          note:
            p.mode === 'VIRTUAL'
              ? 'Séance virtuelle : prévoyez l’assistant qui modère le live au studio et contactez le client pour organiser la connexion.'
              : undefined,
          button: admin,
          footer: OWNER_FOOTER,
        },
      );
    }

    case 'customer_booking_confirmed':
      return build(`Réservation confirmée · ${p.reference}`, {
        preheader: `Votre séance du ${longDate(p.date)} à ${p.startTime} est confirmée.`,
        title: 'Votre réservation est confirmée',
        intro: [
          `Bonjour ${p.customer.fullName},`,
          `Merci${NB}! Votre séance au studio Bovann OCD Live est confirmée. Conservez cet e-mail${NB}: la référence vous sera demandée.`,
        ],
        sections: [
          { heading: 'Votre séance', rows: sessionRows(p, true) },
          { heading: 'Paiement', rows: [['Montant', amountOf(p.totalXof)]] },
        ],
        note: `${
          p.mode === 'VIRTUAL'
            ? 'Séance virtuelle : l’équipe du studio vous contactera avant la séance pour organiser la connexion.'
            : 'Merci d’arriver quelques minutes avant le début de votre séance.'
        } Pour annuler ou changer de date, contactez le studio au moins 48${NB}heures avant (conditions${NB}: ${ctx.webUrl}/conditions).`,
        button: {
          label: 'Voir ma réservation',
          href: `${ctx.webUrl}/mes-reservations?ref=${encodeURIComponent(p.reference)}`,
        },
        footer: customerFooter(ctx),
      });

    case 'customer_booking_cancelled':
      return build(`Réservation annulée · ${p.reference}`, {
        preheader: `Votre séance du ${longDate(p.date)} a été annulée.`,
        title: 'Votre réservation a été annulée',
        intro: [
          `Bonjour ${p.customer.fullName},`,
          `Le studio a annulé votre séance du ${longDate(p.date)}, ${timesOf(p)}. Nous sommes désolés pour ce contretemps.`,
        ],
        sections: [{ heading: 'Séance annulée', rows: sessionRows(p, false) }],
        note:
          p.refundXof && p.refundXof > 0
            ? `Vous serez remboursé de ${formatXof(p.refundXof)}. Le studio vous contactera au ${readablePhone(p.customer.phone)} pour le remboursement.`
            : undefined,
        footer: customerFooter(ctx),
      });

    case 'owner_late_payment_refund':
      return build(
        `À rembourser : ${p.reference} · ${formatXof(p.refundXof ?? p.totalXof)} · ${p.customer.fullName}`,
        {
          preheader: `Paiement reçu trop tard : ${formatXof(p.refundXof ?? p.totalXof)} à rendre à ${p.customer.fullName}.`,
          title: 'Paiement reçu trop tard : remboursement à faire',
          intro: [
            `${p.customer.fullName} a payé ${formatXof(p.refundXof ?? p.totalXof)} après la fin du délai de paiement, et ses créneaux ont été réservés entre-temps par un autre client.`,
            'La réservation n’est donc pas confirmée. Rendez l’argent au client, puis marquez le remboursement comme effectué dans l’administration (rubrique Paiements).',
          ],
          sections: [
            { heading: 'Séance demandée', rows: sessionRows(p, false) },
            { heading: 'Client', rows: customerRows(p) },
          ],
          button: { label: 'Voir les remboursements', href: `${ctx.webUrl}/admin/paiements` },
          footer: OWNER_FOOTER,
        },
      );

    default:
      throw new Error(`Unknown email template: ${template}`);
  }
}

/** A short email to check the sending settings from the admin. */
export function renderTestEmail(to: string, ctx: TemplateContext): RenderedEmail {
  return build('Test d’envoi · Bovann OCD Live', {
    preheader: 'Les e-mails de réservation partent correctement.',
    title: 'Les e-mails fonctionnent',
    intro: [
      `Ce message de test a été envoyé à ${to} depuis l’administration.`,
      'Si vous le recevez, les gérants et les clients recevront aussi les e-mails de réservation. Pensez à vérifier le dossier « Spam » la première fois.',
    ],
    sections: [],
    button: { label: 'Ouvrir l’administration', href: `${ctx.webUrl}/admin` },
    footer: OWNER_FOOTER,
  });
}
