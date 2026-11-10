'use client';

import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useMemo, type ComponentProps, type ReactNode } from 'react';
import { setApiLocale } from '@/lib/api-locale';
import { localizePath, type Locale } from './config';
import type { Messages } from './messages/fr';
import { translate, type MessageKey, type MessageTree, type Vars } from './translate';

export type TKey = MessageKey<Messages>;
export type T = (key: TKey, vars?: Vars) => string;

type Ctx = { locale: Locale; messages: Messages };
const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: ReactNode;
}) {
  // Set during render so the first API calls (made in effects) already use the right language.
  setApiLocale(locale);
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** The language of the page, its texts and a helper to build links in that language. */
export function useI18n(): { locale: Locale; t: T; path: (p: string) => string } {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  const { locale, messages } = ctx;
  return useMemo(
    () => ({
      locale,
      t: (key: TKey, vars?: Vars) =>
        translate(messages as unknown as MessageTree, locale, key, vars),
      path: (p: string) => localizePath(locale, p),
    }),
    [locale, messages],
  );
}

/** next/link that keeps the current language. External and `#` links pass through. */
export function Link({ href, ...rest }: ComponentProps<typeof NextLink> & { href: string }) {
  const { path } = useI18n();
  const target = href.startsWith('/') ? path(href) : href;
  return <NextLink href={target} {...rest} />;
}

/** useRouter whose push/replace keep the current language. */
export function useLocaleRouter() {
  const router = useRouter();
  const { path } = useI18n();
  return useMemo(
    () => ({
      ...router,
      push: (href: string) => router.push(href.startsWith('/') ? path(href) : href),
      replace: (href: string) => router.replace(href.startsWith('/') ? path(href) : href),
    }),
    [router, path],
  );
}
