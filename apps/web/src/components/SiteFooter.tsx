'use client';

import { Link, useI18n } from '@/i18n/I18nProvider';
import styles from './SiteFooter.module.css';

/** Links every customer page needs: the conditions and finding a booking. */
export function SiteFooter({ dark = false }: { dark?: boolean }) {
  const { t } = useI18n();
  return (
    <footer className={`${styles.footer} ${dark ? styles.dark : ''}`}>
      <div className={styles.inner}>
        <nav aria-label={t('footer.nav')} className={styles.links}>
          <Link href="/mes-reservations">{t('footer.find')}</Link>
          <Link href="/conditions">{t('footer.conditions')}</Link>
        </nav>
        <span className={styles.copy}>{t('footer.copy', { year: new Date().getFullYear() })}</span>
      </div>
    </footer>
  );
}
