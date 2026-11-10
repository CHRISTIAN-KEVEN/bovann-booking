import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import type { Locale } from '@/i18n/config';
import { I18nProvider, type TKey } from '@/i18n/I18nProvider';
import { MESSAGES } from '@/i18n/messages';
import { translate, type MessageTree, type Vars } from '@/i18n/translate';

/** `t` for unit tests, in French unless told otherwise. */
export function tFor(locale: Locale = 'fr') {
  return (key: TKey, vars?: Vars) =>
    translate(MESSAGES[locale] as unknown as MessageTree, locale, key, vars);
}

/** Renders inside the language provider (French by default). */
export function renderI18n(
  ui: ReactElement,
  { locale = 'fr', ...options }: RenderOptions & { locale?: Locale } = {},
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider locale={locale} messages={MESSAGES[locale]}>
      {children}
    </I18nProvider>
  );
  return render(ui, { wrapper, ...options });
}
