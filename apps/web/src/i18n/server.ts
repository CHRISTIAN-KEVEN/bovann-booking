import { isLocale, type Locale } from './config';
import { MESSAGES } from './messages';
import { translate, type MessageTree, type Vars } from './translate';
import type { TKey } from './I18nProvider';

/** Texts for server components (page titles). */
export function serverT(locale: string) {
  const l: Locale = isLocale(locale) ? locale : 'fr';
  return (key: TKey, vars?: Vars) => translate(MESSAGES[l] as unknown as MessageTree, l, key, vars);
}
