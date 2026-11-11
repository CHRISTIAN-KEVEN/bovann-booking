'use client';

import type { SellerLiveDto, SellerMe } from '@bovann/shared';
import { useCallback, useEffect, useState } from 'react';
import { CategoryIcon } from '@/components/lives/CategoryIcon';
import { SellerShell } from '@/components/seller/SellerShell';
import styles from '@/components/seller/seller.module.css';
import { ButtonSpinner, Skeleton } from '@/components/ui';
import { Link, useI18n, useLocaleRouter, type TKey } from '@/i18n/I18nProvider';
import { formatPhone } from '@/lib/admin-format';
import { ApiError } from '@/lib/api';
import { CATEGORY_HUES, initialsOf, lomeTime } from '@/lib/lives';
import { sellerApi } from '@/lib/seller-api';
import local from './SellerHome.module.css';

/** "Mon espace vendeur": post a live, follow my lives, end one early, sign out. */
export function SellerHome() {
  const { t, locale } = useI18n();
  const router = useLocaleRouter();
  const [me, setMe] = useState<SellerMe | null>(null);
  const [lives, setLives] = useState<SellerLiveDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<number | 'logout' | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const [account, mine] = await Promise.all([sellerApi.me(), sellerApi.lives()]);
      setMe(account);
      setLives(mine.lives);
      setNow(Date.now());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/vendeur/connexion');
      else setError(err instanceof Error ? err.message : String(err));
    }
  }, [router]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function end(live: SellerLiveDto) {
    setWorking(live.id);
    setNotice(null);
    try {
      await sellerApi.end(live.id);
      if (live.status === 'APPROVED') setNotice(t('seller.ended'));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(null);
    }
  }

  async function signOut() {
    setWorking('logout');
    try {
      await sellerApi.logout();
    } finally {
      router.replace('/en-direct');
    }
  }

  const statusKey = (live: SellerLiveDto): TKey => {
    if (live.status === 'APPROVED' && Date.parse(live.endsAt) <= now) {
      return 'seller.status.APPROVED_DONE';
    }
    return `seller.status.${live.status}` as TKey;
  };
  const tone = (live: SellerLiveDto) =>
    live.status === 'PENDING'
      ? local.pending
      : live.status === 'APPROVED' && Date.parse(live.endsAt) > now
        ? local.online
        : live.status === 'REJECTED' || live.status === 'REMOVED'
          ? local.refused
          : local.done;

  return (
    <SellerShell back="/en-direct">
      <h1 className={styles.title}>{t('seller.homeTitle')}</h1>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {!me || !lives ? (
        error ? null : (
          <Skeleton height={88} count={3} />
        )
      ) : (
        <>
          <Link href="/en-direct/publier" className={styles.primary}>
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="2.2" />
              <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
            </svg>
            {t('seller.postLive')}
          </Link>

          {notice ? (
            <p className={local.notice} role="status">
              {notice}
            </p>
          ) : null}

          <section className={local.section} aria-labelledby="my-lives">
            <h2 id="my-lives" className={styles.cardTitle}>
              {t('seller.myLives')}
            </h2>
            {lives.length === 0 ? (
              <p className={styles.cardText}>{t('seller.noLives')}</p>
            ) : (
              <ul className={local.list}>
                {lives.map((live) => {
                  const online = live.status === 'APPROVED' && Date.parse(live.endsAt) > now;
                  return (
                    <li key={live.id} className={local.item}>
                      <span
                        className={local.avatar}
                        style={{ background: CATEGORY_HUES[live.categoryIcon] }}
                        aria-hidden="true"
                      >
                        {initialsOf(live.sellerName)}
                      </span>
                      <div className={local.body}>
                        <strong className={local.name}>{live.sellerName}</strong>
                        <span className={local.meta}>
                          <CategoryIcon icon={live.categoryIcon} size={15} />
                          {live.categoryLabel} · {lomeTime(live.createdAt, locale)}
                        </span>
                        <span className={`${local.status} ${tone(live)}`}>
                          {t(statusKey(live))}
                          {online
                            ? ` · ${t('seller.until', { time: lomeTime(live.endsAt, locale) })}`
                            : ''}
                        </span>
                        {live.status === 'REJECTED' && live.rejectReason ? (
                          <span className={local.reason}>{live.rejectReason}</span>
                        ) : null}
                      </div>
                      {online || live.status === 'PENDING' ? (
                        <button
                          type="button"
                          className={local.action}
                          onClick={() => void end(live)}
                          disabled={working === live.id}
                        >
                          {working === live.id ? <ButtonSpinner /> : null}
                          {online ? t('seller.end') : t('seller.withdraw')}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className={styles.card}>
            <span className={styles.label}>{t('seller.signedInAs')}</span>
            <strong className={styles.cardTitle}>{formatPhone(me.phone)}</strong>
          </div>

          <div className={styles.actions}>
            <Link href="/en-direct" className={styles.secondary}>
              {t('seller.seeLives')}
            </Link>
            <button
              type="button"
              className={styles.link}
              onClick={() => void signOut()}
              disabled={working === 'logout'}
            >
              {t('seller.signOut')}
            </button>
          </div>
        </>
      )}
    </SellerShell>
  );
}
