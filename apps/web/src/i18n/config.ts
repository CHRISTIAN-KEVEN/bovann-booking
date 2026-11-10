import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from '@bovann/shared';

export { DEFAULT_LOCALE, LOCALES, isLocale, type Locale };

/**
 * French pages live at the plain address (`/reserver/date`), English ones under `/en`
 * (`/en/reserver/date`). The proxy maps the plain address to the `[lang]=fr` route internally.
 */
export function localizePath(locale: Locale, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return clean;
  return clean === '/' ? `/${locale}` : `/${locale}${clean}`;
}

/** The path without its language prefix, and the language it names. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const match = /^\/(fr|en)(?=\/|$)/.exec(pathname);
  if (!match) return { locale: DEFAULT_LOCALE, path: pathname || '/' };
  const locale = match[1] as Locale;
  return { locale, path: pathname.slice(match[0].length) || '/' };
}

/** BCP 47 tag for Intl APIs. */
export const INTL_LOCALE: Record<Locale, string> = { fr: 'fr-FR', en: 'en-GB' };
