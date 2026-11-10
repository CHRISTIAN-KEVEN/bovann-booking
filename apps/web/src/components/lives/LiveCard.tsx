'use client';

import { LIVE_PLATFORM_LABELS, type LiveDto } from '@bovann/shared';
import { useI18n, type TKey } from '@/i18n/I18nProvider';
import { CATEGORY_HUES, initialsOf, sinceLabel } from '@/lib/lives';
import { CategoryIcon } from './CategoryIcon';
import { Flag } from './Flag';
import styles from './LiveCard.module.css';

/**
 * One live on the wall. The whole card is the link: it opens the live on TikTok or Facebook
 * in a new tab, without giving that page any access back to ours (noopener, noreferrer).
 */
export function LiveCard({ live, now }: { live: LiveDto; now: number }) {
  const { t } = useI18n();
  const platform = LIVE_PLATFORM_LABELS[live.platform];
  const country = t(`countries.${live.countryCode}` as TKey);
  const since = sinceLabel(live.startedAt, now, t);
  return (
    <a
      href={live.url}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      className={styles.card}
      aria-label={t('lives.cardLabel', {
        name: live.sellerName,
        platform,
        country,
        category: live.categoryLabel,
        time: since,
      })}
    >
      <span className={styles.cover} style={{ backgroundColor: CATEGORY_HUES[live.categoryIcon] }}>
        <span className={styles.liveTag}>
          <span className={styles.liveDot} />
          {t('lives.live')}
        </span>
        <span className={live.platform === 'TIKTOK' ? styles.tiktok : styles.facebook}>
          {platform}
        </span>
        <span className={styles.initials}>{initialsOf(live.sellerName)}</span>
        <span className={styles.since}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          {since}
        </span>
      </span>
      <span className={styles.body}>
        <strong className={styles.name}>{live.sellerName}</strong>
        <span className={styles.meta}>
          <CategoryIcon icon={live.categoryIcon} size={16} />
          <span className={styles.ellipsis}>{live.categoryLabel}</span>
        </span>
        <span className={styles.meta}>
          <Flag code={live.countryCode} width={18} />
          <span className={styles.ellipsis}>{country}</span>
        </span>
        <span className={styles.watch}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
          </svg>
          {t('lives.watch')}
        </span>
      </span>
    </a>
  );
}

export function LiveCardSkeleton() {
  return (
    <span className={`${styles.card} ${styles.skeleton}`} aria-hidden="true">
      <span className={styles.cover} />
      <span className={styles.body}>
        <span className={styles.bar} />
        <span className={styles.barShort} />
        <span className={styles.barShort} />
      </span>
    </span>
  );
}
