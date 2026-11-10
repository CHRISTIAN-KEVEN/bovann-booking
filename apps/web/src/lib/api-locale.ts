import type { Locale } from '@bovann/shared';

/**
 * Language sent to the API (Accept-Language), so its messages, emails and receipt match the page.
 * Set by the I18nProvider; French until then. Kept apart from api.ts so tests can mock the client.
 */
let apiLocale: Locale = 'fr';

export function setApiLocale(locale: Locale): void {
  apiLocale = locale;
}

export function getApiLocale(): Locale {
  return apiLocale;
}
