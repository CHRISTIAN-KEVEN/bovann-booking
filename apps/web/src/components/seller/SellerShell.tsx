'use client';

import type { ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { Link, useI18n } from '@/i18n/I18nProvider';
import styles from './seller.module.css';

/** Seller screens: brand header, one narrow column (one question per screen), a back button. */
export function SellerShell({
  children,
  back,
  onBack,
  top,
}: {
  children: ReactNode;
  back?: string;
  onBack?: () => void;
  /** Shown next to the back button (e.g. a step progress bar). */
  top?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <SiteHeader />
      <main className={styles.main}>
        <div className={styles.column}>
          <div className={styles.topRow}>
            {onBack ? (
              <button
                type="button"
                className={styles.back}
                onClick={onBack}
                aria-label={t('steps.back')}
              >
                <Icon name="back" size={24} />
              </button>
            ) : back ? (
              <Link href={back} className={styles.back} aria-label={t('steps.back')}>
                <Icon name="back" size={24} />
              </Link>
            ) : null}
            {top}
          </div>
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
