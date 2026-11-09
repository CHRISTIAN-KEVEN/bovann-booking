import type { CustomerDetails } from './flow';

/**
 * Customer details form: country codes, phone composition and validation
 * (French messages, same rules as the API so errors show before submitting).
 */

export const COUNTRY_CODES = [
  { code: '+228', label: 'Togo (+228)' },
  { code: '+229', label: 'Bénin (+229)' },
  { code: '+233', label: 'Ghana (+233)' },
  { code: '+225', label: 'Côte d’Ivoire (+225)' },
  { code: '+226', label: 'Burkina Faso (+226)' },
  { code: '+227', label: 'Niger (+227)' },
  { code: '+221', label: 'Sénégal (+221)' },
  { code: '+223', label: 'Mali (+223)' },
  { code: '+234', label: 'Nigeria (+234)' },
  { code: '+237', label: 'Cameroun (+237)' },
  { code: '+33', label: 'France (+33)' },
  { code: '+1', label: 'États-Unis / Canada (+1)' },
] as const;

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
