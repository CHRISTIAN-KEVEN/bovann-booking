import type { T } from '@/i18n/I18nProvider';
import type { CustomerDetails } from './flow';

/**
 * Customer details form: country codes, phone composition and validation
 * (messages in the page's language, same rules as the API so errors show before submitting).
 */

/** Countries offered for phone numbers: ISO code (flag and name, see `countries.*`) and dialling code. */
export const COUNTRY_CODES = [
  { code: '+228', iso: 'TG' },
  { code: '+229', iso: 'BJ' },
  { code: '+233', iso: 'GH' },
  { code: '+225', iso: 'CI' },
  { code: '+226', iso: 'BF' },
  { code: '+227', iso: 'NE' },
  { code: '+221', iso: 'SN' },
  { code: '+223', iso: 'ML' },
  { code: '+234', iso: 'NG' },
  { code: '+237', iso: 'CM' },
  { code: '+33', iso: 'FR' },
  { code: '+1', iso: 'US' },
] as const;

/**
 * Flag emoji from an ISO 3166 code ("TG" → 🇹🇬). Phones and Macs show the flag; Windows shows
 * the two letters instead, which still reads fine.
 */
export function flagOf(iso: string): string {
  return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export const SECTORS = [
  'Mode & beauté',
  'Alimentation & boissons',
  'Électronique & téléphonie',
  'Maison & décoration',
  'Santé & bien-être',
  'Services',
  'Événementiel',
  'Autre',
] as const;

/** "+228" + "90 12 34 56" → "+22890123456" (a leading national 0 is dropped). */
export function composePhone(countryCode: string, localNumber: string): string {
  const digits = localNumber.replace(/\D/g, '').replace(/^0+/, '');
  return `${countryCode}${digits}`;
}

/** Splits a stored E.164 number back into country code + local part for the form. */
export function splitPhone(e164: string): { countryCode: string; local: string } {
  const match = [...COUNTRY_CODES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((c) => e164.startsWith(c.code));
  return match
    ? { countryCode: match.code, local: e164.slice(match.code.length) }
    : { countryCode: '+228', local: '' };
}

export function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

export type DetailsErrors = Partial<Record<keyof CustomerDetails, string>>;

export function validateDetails(d: CustomerDetails, t: T): DetailsErrors {
  const errors: DetailsErrors = {};
  if (!d.fullName.trim()) errors.fullName = t('validation.fullNameRequired');
  else if (d.fullName.trim().length > 120) errors.fullName = t('validation.fullNameTooLong');
  if (!isValidE164(d.phone)) errors.phone = t('validation.phoneInvalid');
  if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim()))
    errors.email = t('validation.emailInvalid');
  if (!d.businessName.trim()) errors.businessName = t('validation.businessRequired');
  else if (d.businessName.trim().length > 160)
    errors.businessName = t('validation.businessTooLong');
  if (!d.businessSector) errors.businessSector = t('validation.sectorRequired');
  if (d.liveDescription.length > 1000) errors.liveDescription = t('validation.descriptionTooLong');
  if (!d.acceptTerms) errors.acceptTerms = t('validation.termsRequired');
  return errors;
}
