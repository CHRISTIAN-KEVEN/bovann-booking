'use client';

import type { SellerLivesResponse, SellerMe, SellerPaymentDto } from '@bovann/shared';
import { useEffect, useState } from 'react';
import { SellerPayPanel } from '@/components/seller/SellerPayPanel';
import { SellerShell } from '@/components/seller/SellerShell';
import seller from '@/components/seller/seller.module.css';
import { Skeleton } from '@/components/ui';
import { Link, useI18n, useLocaleRouter } from '@/i18n/I18nProvider';
import { ApiError } from '@/lib/api';
import { sellerApi } from '@/lib/seller-api';

/** "Prendre un pass": monthly or annual, paid like a live (simulated until Phase 4). */
export function PassPurchase() {
  const { t } = useI18n();
  const router = useLocaleRouter();
  const [data, setData] = useState<{ me: SellerMe; mine: SellerLivesResponse } | null>(null);
  const [paid, setPaid] = useState<SellerPaymentDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([sellerApi.me(), sellerApi.lives()])
      .then(([me, mine]) => setData({ me, mine }))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/vendeur/connexion?suite=/vendeur/pass');
        } else setError(err instanceof Error ? err.message : String(err));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  return (
    <SellerShell back="/vendeur">
      <div className={seller.titleBlock}>
        <h1 className={seller.title}>
          {data?.mine.pass ? t('pay.extendPass') : t('pay.passTitle')}
        </h1>
        <p className={seller.lead}>{t('pay.passLead')}</p>
      </div>
      {error ? (
        <p className={seller.error} role="alert">
          {error}
        </p>
      ) : paid ? (
        <>
          <p className={seller.card} role="status">
            <strong className={seller.cardTitle}>{t('pay.paidPass')}</strong>
          </p>
          <div className={seller.actions}>
            <Link href="/vendeur" className={seller.primary}>
              {t('post.mySpace')}
            </Link>
          </div>
        </>
      ) : !data ? (
        <Skeleton height={72} count={3} />
      ) : (
        <SellerPayPanel
          plans={['PASS_YEAR', 'PASS_MONTH']}
          liveId={null}
          prices={data.mine.prices}
          pass={data.mine.pass}
          phone={data.me.phone}
          onPaid={setPaid}
        />
      )}
    </SellerShell>
  );
}
