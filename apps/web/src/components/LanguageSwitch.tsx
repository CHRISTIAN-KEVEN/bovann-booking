'use client';

import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { LOCALES, localizePath, splitLocale, type Locale } from '@/i18n/config';
import { useI18n } from '@/i18n/I18nProvider';
import styles from './LanguageSwitch.module.css';

/** "FR | EN" pill. Keeps the page and its query string (?ref=…) when switching. */
export function LanguageSwitch({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const { locale, t } = useI18n();
  const { path } = splitLocale(usePathname() ?? '/');
  const href = (l: Locale) => localizePath(l, path);
  return (
    <nav aria-label={t('common.language')} className={`${styles.switch} ${styles[tone]}`}>
      {LOCALES.map((l) => (
        <NextLink
          key={l}
          href={href(l)}
          hrefLang={l}
          lang={l}
          aria-current={l === locale ? 'true' : undefined}
          className={`${styles.option} ${l === locale ? styles.current : ''}`}
          onClick={(e) => {
            // Keep ?ref=… and other parameters of the current page.
            const search = window.location.search;
            if (search) {
              e.preventDefault();
              window.location.assign(href(l) + search);
            }
          }}
        >
          {l.toUpperCase()}
        </NextLink>
      ))}
    </nav>
  );
}
