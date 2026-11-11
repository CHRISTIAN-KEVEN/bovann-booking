'use client';

import { Link, useI18n } from '@/i18n/I18nProvider';
import { Icon } from './icons';
import { LanguageSwitch } from './LanguageSwitch';
import { Logo } from './Logo';
import styles from './SiteHeader.module.css';

/**
 * Brand bar shared by every customer screen, full width on every device.
 * Main pages (`section`) also show the two parts of the site: the lives wall and studio booking.
 */
export function SiteHeader({
  transparent = false,
  section,
}: {
  transparent?: boolean;
  section?: 'lives' | 'studio';
}) {
  const { t } = useI18n();
  return (
    <header className={`${styles.header} ${transparent ? styles.transparent : ''}`}>
      <div className={styles.inner}>
        <Link href="/" className={styles.brand} aria-label={t('header.homeLabel')}>
          <Logo height={44} className={styles.logo} />
          <span className={styles.by}>{t('header.by')}</span>
        </Link>
        {section && (
          <nav aria-label={t('header.sections')} className={styles.sections}>
            <Link
              href="/en-direct"
              aria-current={section === 'lives' ? 'page' : undefined}
              className={styles.section}
            >
              <span className={styles.pulse} aria-hidden="true" />
              {t('header.lives')}
            </Link>
            <Link
              href="/"
              aria-current={section === 'studio' ? 'page' : undefined}
              className={styles.section}
            >
              <Icon name="calendar" size={18} />
              {t('header.studio')}
            </Link>
          </nav>
        )}
        <div className={styles.right}>
          <span className={styles.place}>
            <span className={styles.liveDot} aria-hidden="true" />
            {t('header.place')}
          </span>
          {/* On the lives wall the account that matters is the seller's; elsewhere, the booking. */}
          {section === 'lives' ? (
            <Link href="/vendeur" className={styles.mine}>
              <Icon name="user" size={18} />
              <span className={styles.mineLabel}>{t('seller.account')}</span>
            </Link>
          ) : (
            <Link href="/mes-reservations" className={styles.mine}>
              <Icon name="bookings" size={18} />
              <span className={styles.mineLabel}>{t('header.myBooking')}</span>
            </Link>
          )}
          <LanguageSwitch />
        </div>
      </div>
    </header>
  );
}
