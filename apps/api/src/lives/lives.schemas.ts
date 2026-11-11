import {
  ADMIN_LIVE_TABS,
  MOBILE_MONEY_CHANNELS,
  PASS_PLANS,
  SELLER_PAYMENT_PURPOSES,
  CATEGORY_OTHER_MAX,
  checkLiveLink,
  cleanShortText,
  LIVE_COUNTRIES,
  LIVE_DURATIONS_MIN,
  SELLER_NAME_MAX,
  SELLER_NAME_MIN,
  type LiveLinkError,
} from '@bovann/shared';
import { z } from 'zod';

/** Messages for a refused live link (same wording as the web form). */
const LINK_ERRORS: Record<LiveLinkError, string> = {
  EMPTY: 'Le lien du live est obligatoire.',
  INVALID: 'Ce lien n’est pas valide. Copiez-le depuis TikTok ou Facebook.',
  NOT_ALLOWED: 'Seuls les liens TikTok et Facebook sont acceptés.',
  TOO_LONG: 'Ce lien est trop long.',
};

const sellerName = z
  .string({ message: 'Le nom du vendeur est obligatoire.' })
  .transform(cleanShortText)
  .pipe(
    z
      .string()
      .min(SELLER_NAME_MIN, 'Le nom du vendeur est obligatoire (2 caractères minimum).')
      .max(SELLER_NAME_MAX, 'Le nom du vendeur est trop long (60 caractères maximum).'),
  );

const liveLink = z.string({ message: LINK_ERRORS.EMPTY }).transform((value, ctx) => {
  const result = checkLiveLink(value);
  if (!result.ok) {
    ctx.addIssue({ code: 'custom', message: LINK_ERRORS[result.error] });
    return z.NEVER;
  }
  return result;
});

const categoryOther = z
  .string()
  .transform(cleanShortText)
  .pipe(
    z
      .string()
      .min(2, 'Écrivez votre catégorie (2 caractères minimum).')
      .max(CATEGORY_OTHER_MAX, 'Catégorie trop longue (40 caractères maximum).'),
  )
  .nullish();

export const liveCreateSchema = z
  .object({
    sellerName,
    url: liveLink,
    countryCode: z.enum(LIVE_COUNTRIES, { message: 'Choisissez le pays du vendeur.' }),
    categoryCode: z
      .string()
      .regex(/^[A-Z0-9_]{2,40}$/, 'Catégorie invalide.')
      .nullish(),
    categoryOther,
    durationMin: z
      .number({ message: 'Durée invalide : 1, 2, 3 ou 4 heures.' })
      .refine((v) => (LIVE_DURATIONS_MIN as readonly number[]).includes(v), {
        message: 'Durée invalide : 1, 2, 3 ou 4 heures.',
      }),
  })
  .strict()
  .refine((v) => Boolean(v.categoryCode) !== Boolean(v.categoryOther), {
    message: 'Choisissez une catégorie ou écrivez la vôtre.',
    path: ['categoryCode'],
  })
  .transform((v) => ({
    sellerName: v.sellerName,
    url: v.url.url,
    platform: v.url.platform,
    countryCode: v.countryCode,
    categoryCode: v.categoryCode ?? null,
    categoryOther: v.categoryCode ? null : (v.categoryOther ?? null),
    durationMin: v.durationMin,
  }));

export const liveRemoveSchema = z
  .object({
    reason: z
      .string()
      .transform(cleanShortText)
      .pipe(z.string().max(255, 'Texte trop long (255 caractères maximum).'))
      .nullish()
      .transform((v) => v || null),
  })
  .strict();

export const liveRejectSchema = z
  .object({
    reason: z
      .string({ message: 'Écrivez au vendeur pourquoi son live est refusé.' })
      .transform(cleanShortText)
      .pipe(
        z
          .string()
          .min(3, 'Écrivez au vendeur pourquoi son live est refusé.')
          .max(255, 'Texte trop long (255 caractères maximum).'),
      ),
  })
  .strict();

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure invalide (HH:MM).');

export const reviewHoursSchema = z
  .object({
    periods: z
      .array(
        z
          .object({
            weekday: z.number().int().min(1, 'Jour invalide.').max(7, 'Jour invalide.'),
            opensAt: time,
            closesAt: time,
          })
          .strict(),
      )
      .max(42, 'Trop de périodes.'),
  })
  .strict();

export const sellerPaymentSchema = z
  .object({
    purpose: z.enum(SELLER_PAYMENT_PURPOSES, { message: 'Choisissez ce que vous payez.' }),
    liveId: z.number().int().positive().nullable().default(null),
    method: z.enum(['MOBILE_MONEY', 'CARD'], { message: 'Choisissez un moyen de paiement.' }),
    channel: z.enum(MOBILE_MONEY_CHANNELS).nullable().default(null),
    payerPhone: z
      .string()
      .transform((v) => v.replace(/[\s.-]/g, ''))
      .pipe(z.string().regex(/^\+[1-9]\d{6,14}$/, 'Numéro de téléphone invalide.'))
      .nullable()
      .default(null),
  })
  .strict()
  .refine((v) => v.purpose !== 'LIVE' || v.liveId !== null, {
    message: 'Indiquez le live à payer.',
    path: ['liveId'],
  })
  .refine((v) => v.method !== 'MOBILE_MONEY' || (v.channel !== null && v.payerPhone !== null), {
    message: 'Choisissez l’opérateur et le numéro Mobile Money.',
    path: ['channel'],
  });

const amount = z
  .number({ message: 'Montant invalide.' })
  .int('Montant invalide.')
  .min(100, 'Montant trop petit (100 FCFA minimum).')
  .max(10_000_000, 'Montant trop grand.');

export const livePricesSchema = z
  .object({ passMonthXof: amount, passYearXof: amount, liveXof: amount })
  .strict();

export const passGrantSchema = z
  .object({
    plan: z.enum(PASS_PLANS, { message: 'Choisissez un pass mensuel ou annuel.' }),
    note: z
      .string()
      .transform(cleanShortText)
      .pipe(z.string().max(255, 'Texte trop long (255 caractères maximum).'))
      .nullish()
      .transform((v) => v || null),
  })
  .strict();

export const devPaymentFailSchema = z.object({ reason: z.string().max(255).default('DECLINED') });

export const adminLiveListSchema = z.object({
  tab: z.enum(ADMIN_LIVE_TABS, { message: 'Onglet invalide.' }).default('online'),
});
