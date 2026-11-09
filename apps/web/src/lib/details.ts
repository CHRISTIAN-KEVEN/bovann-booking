import type { CustomerDetails } from './flow';

/**
 * Customer details form: country codes, phone composition and validation
 * (French messages, same rules as the API so errors show before submitting).
 */

/** Countries offered for phone numbers: name (French), ISO code for the flag, dialling code. */
export const COUNTRY_CODES = [
  { code: '+228', iso: 'TG', name: 'Togo' },
  { code: '+229', iso: 'BJ', name: 'Bénin' },
  { code: '+233', iso: 'GH', name: 'Ghana' },
  { code: '+225', iso: 'CI', name: 'Côte d’Ivoire' },
  { code: '+226', iso: 'BF', name: 'Burkina Faso' },
  { code: '+227', iso: 'NE', name: 'Niger' },
  { code: '+221', iso: 'SN', name: 'Sénégal' },
  { code: '+223', iso: 'ML', name: 'Mali' },
  { code: '+234', iso: 'NG', name: 'Nigeria' },
  { code: '+237', iso: 'CM', name: 'Cameroun' },
  { code: '+33', iso: 'FR', name: 'France' },
  { code: '+1', iso: 'US', name: 'États-Unis / Canada' },
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

export function validateDetails(d: CustomerDetails): DetailsErrors {
  const errors: DetailsErrors = {};
  if (!d.fullName.trim()) errors.fullName = 'Indiquez votre nom complet.';
  else if (d.fullName.trim().length > 120)
    errors.fullName = 'Nom trop long (120 caractères maximum).';
  if (!isValidE164(d.phone)) errors.phone = 'Numéro invalide : vérifiez l’indicatif et le numéro.';
  if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim()))
    errors.email = 'Adresse e-mail invalide.';
  if (!d.businessName.trim()) errors.businessName = 'Indiquez le nom de votre entreprise.';
  else if (d.businessName.trim().length > 160)
    errors.businessName = 'Nom trop long (160 caractères maximum).';
  if (!d.businessSector) errors.businessSector = 'Choisissez votre secteur d’activité.';
  if (d.liveDescription.length > 1000)
    errors.liveDescription = 'Description trop longue (1000 caractères maximum).';
  if (!d.acceptTerms) errors.acceptTerms = 'Vous devez accepter les conditions de réservation.';
  return errors;
}
