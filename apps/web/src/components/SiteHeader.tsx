'use client';

import { Link, useI18n } from '@/i18n/I18nProvider';
import { Icon } from './icons';
import { LanguageSwitch } from './LanguageSwitch';
import { Logo } from './Logo';
import styles from './SiteHeader.module.css';

/** Brand bar shared by every customer screen, full width on every device. */
export function SiteHeader({ transparent = false }: { transparent?: boolean }) {
  const { t } = useI18n();
  return (
    <header className={`${styles.header} ${transparent ? styles.transparent : ''}`}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label={t('header.homeLabel')}>
          <Logo height={44} className={styles.logo} />
          <span className={styles.by}>{t('header.by')}</span>
        </Link>
        <div className={styles.right}>
          <span className={styles.place}>
            <span className={styles.liveDot} aria-hidden="true" />
            {t('header.place')}
          </span>
          <Link href="/mes-reservations" className={styles.mine}>
            <Icon name="bookings" size={18} />
            <span className={styles.mineLabel}>{t('header.myBooking')}</span>
          </Link>
          <LanguageSwitch />
        </div>
      </div>
    </header>
  );
}
