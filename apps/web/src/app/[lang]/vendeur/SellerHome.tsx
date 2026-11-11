'use client';

import type { SellerMe } from '@bovann/shared';
import { useEffect, useState } from 'react';
import { ButtonSpinner, Skeleton } from '@/components/ui';
import { Link, useI18n, useLocaleRouter } from '@/i18n/I18nProvider';
import { formatPhone } from '@/lib/admin-format';
import { ApiError } from '@/lib/api';
import { sellerApi } from '@/lib/seller-api';
import { SellerShell } from './SellerShell';
import styles from './seller.module.css';

/** "Mon espace vendeur": who is signed in, sign out. Posting a live is added next. */
export function SellerHome() {
  const { t } = useI18n();
  const router = useLocaleRouter();
  const [me, setMe] = useState<SellerMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    sellerApi
      .me()
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/vendeur/connexion');
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
  }, [router]);

  async function signOut() {
    setLeaving(true);
    try {
      await sellerApi.logout();
    } finally {
      router.replace('/en-direct');
    }
  }

  return (
    <SellerShell back="/en-direct">
      <h1 className={styles.title}>{t('seller.homeTitle')}</h1>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : !me ? (
        <Skeleton height={88} count={2} />
      ) : (
        <>
          <div className={styles.card}>
            <span className={styles.label}>{t('seller.signedInAs')}</span>
            <strong className={styles.cardTitle}>{formatPhone(me.phone)}</strong>
          </div>
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>{t('seller.postSoon')}</h2>
            <p className={styles.cardText}>{t('seller.postSoonText')}</p>
          </div>
          <div className={styles.actions}>
            <Link href="/en-direct" className={styles.primary}>
              {t('seller.seeLives')}
            </Link>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => void signOut()}
              disabled={leaving}
            >
              {leaving ? <ButtonSpinner /> : null}
              {t('seller.signOut')}
            </button>
          </div>
        </>
      )}
    </SellerShell>
  );
}
