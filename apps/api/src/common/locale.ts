import { DEFAULT_LOCALE, isLocale, type Locale } from '@bovann/shared';
import type { Request } from 'express';

/**
 * The language a request asks for: the first of "fr" or "en" in Accept-Language
 * (the website sends exactly one), French otherwise.
 */
export function localeFromHeader(header: string | string[] | undefined): Locale {
  const value = Array.isArray(header) ? header.join(',') : (header ?? '');
  for (const part of value.split(',')) {
    const tag = part.trim().split(';')[0]!.trim().toLowerCase().slice(0, 2);
    if (isLocale(tag)) return tag;
  }
  return DEFAULT_LOCALE;
}

export function requestLocale(req: Pick<Request, 'headers'>): Locale {
  return localeFromHeader(req.headers['accept-language']);
}
