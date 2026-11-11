'use client';

import {
  LIVE_PLATFORM_LABELS,
  LIVE_PLATFORMS,
  type LiveCategoryDto,
  type LiveDto,
  type LivePlatform,
  type ReviewStatus,
} from '@bovann/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CategoryIcon } from '@/components/lives/CategoryIcon';
import { Flag } from '@/components/lives/Flag';
import { LiveCard, LiveCardSkeleton } from '@/components/lives/LiveCard';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { Link, useI18n, type TKey } from '@/i18n/I18nProvider';
import { api } from '@/lib/api';
import {
  applyFilters,
  countryCounts,
  filtersFromSearch,
  hasFilters,
  liveNow,
  lomeTime,
  nextOpening,
  NO_FILTERS,
  OTHER_CATEGORY,
  searchFromFilters,
  type LiveFilters,
} from '@/lib/lives';
import styles from './LiveWall.module.css';

/** The list is fetched again every minute (and when the visitor comes back to the tab). */
const REFRESH_MS = 60_000;

type Load =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; lives: LiveDto[]; categories: LiveCategoryDto[]; review: ReviewStatus };

/**
 * "En direct": every live on now. Filters by country, platform and category; the choice is kept
 * in the address (?pays=TG&plateforme=tiktok&categorie=mode) so a filtered wall can be shared.
 */
export function LiveWall() {
  const { t, locale } = useI18n();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [filters, setFilters] = useState<LiveFilters>(NO_FILTERS);
  const [now, setNow] = useState(() => Date.now());
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);

  const fetchWall = useCallback(async () => {
    try {
      const wall = await api.lives();
      setLoad({
        state: 'ready',
        lives: wall.lives,
        categories: wall.categories,
        review: wall.review,
      });
      setNow(Date.now());
    } catch {
      setLoad((current) => (current.state === 'ready' ? current : { state: 'error' }));
    }
  }, []);

  // Language changes the category names: fetch again.
  useEffect(() => {
    void fetchWall();
  }, [fetchWall, locale]);

  useEffect(() => {
    setFilters(filtersFromSearch(new URLSearchParams(window.location.search)));
    const refresh = window.setInterval(() => void fetchWall(), REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchWall();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(refresh);
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchWall]);

  const update = (next: Partial<LiveFilters>) => {
    const merged = { ...filters, ...next };
    setFilters(merged);
    window.history.replaceState(null, '', window.location.pathname + searchFromFilters(merged));
  };

  const lives = useMemo(
    () => (load.state === 'ready' ? liveNow(load.lives, now) : []),
    [load, now],
  );
  const shown = useMemo(() => applyFilters(lives, filters), [lives, filters]);
  const countries = useMemo(() => countryCounts(lives, filters), [lives, filters]);
  const categories = load.state === 'ready' ? load.categories : [];
  const hasOther = lives.some((l) => l.categoryCode === null);
  const categoryOptions: Array<{ code: string; name: string; icon: LiveCategoryDto['icon'] }> = [
    ...categories,
    ...(hasOther || filters.category === OTHER_CATEGORY
      ? [{ code: OTHER_CATEGORY, name: t('lives.otherCategories'), icon: 'autre' as const }]
      : []),
  ];
  const currentCategory = categoryOptions.find((c) => c.code === filters.category);
  const countryName = (code: string) => t(`countries.${code}` as TKey);

  const openSheet = () => {
    setSheetOpen(true);
    sheet.current?.showModal();
  };
  const closeSheet = () => {
    sheet.current?.close();
  };
  const pickCategory = (code: string | null) => {
    update({ category: code });
    closeSheet();
  };

  const review = load.state === 'ready' ? load.review : null;
  const reviewLine = !review
    ? null
    : review.open && review.closesAt
      ? t('lives.reviewOpen', { time: lomeTime(review.closesAt, locale) })
      : review.nextOpensAt
        ? (() => {
            const next = nextOpening(review.nextOpensAt, now, locale, t);
            return t('lives.reviewClosed', {
              when: next.day ? `${next.day} ${next.time}` : next.time,
            });
          })()
        : t('lives.reviewNone');

  const heading = filters.country ? countryName(filters.country) : t('lives.everywhere');

  return (
    <div className={styles.page}>
      <SiteHeader section="lives" />
      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div className={styles.heroText}>
              {lives.length > 0 && (
                <p className={styles.count}>
                  <span className={styles.pulse} aria-hidden="true" />
                  {t('lives.liveCount', { count: lives.length })}
                </p>
              )}
              <h1 className={styles.title}>{t('lives.title')}</h1>
              <p className={styles.lead}>
                <span className={styles.narrowOnly}>{t('lives.lead')}</span>
                <span className={styles.wideOnly}>{t('lives.leadWide')}</span>
              </p>
            </div>
            {/* Computers: a card in the hero. Phones: the sticky button at the bottom. */}
            <aside className={styles.postCard}>
              <div className={styles.postHead}>
                <span className={styles.postIcon} aria-hidden="true">
                  <BroadcastIcon />
                </span>
                <div>
                  <strong className={styles.postTitle}>{t('lives.youLive')}</strong>
                  <span className={styles.postText}>{t('lives.showEveryone')}</span>
                </div>
              </div>
              <Link href="/en-direct/publier" className={styles.postButton}>
                {t('lives.post')}
              </Link>
              {reviewLine ? <span className={styles.postReview}>{reviewLine}</span> : null}
            </aside>
          </div>
        </section>

        <div className={styles.content}>
          {load.state === 'error' && (
            <div className={styles.state} role="alert">
              <h2 className={styles.stateTitle}>{t('lives.loadError')}</h2>
              <button type="button" className={styles.primary} onClick={() => void fetchWall()}>
                {t('common.retry')}
              </button>
            </div>
          )}

          {load.state !== 'error' && (
            <>
              {/* Countries: only those with lives, biggest first. */}
              <div className={styles.countries} role="group" aria-label={t('lives.countries')}>
                <button
                  type="button"
                  aria-pressed={!filters.country}
                  className={styles.chip}
                  onClick={() => update({ country: null })}
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
                  </svg>
                  <span className={styles.narrowOnly}>{t('lives.allCountries')}</span>
                  <span className={styles.wideOnly}>{t('lives.allCountriesWide')}</span>
                  <span className={styles.chipCount}>{countries.total}</span>
                </button>
                {countries.countries.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    aria-pressed={filters.country === c.code}
                    className={styles.chip}
                    onClick={() => update({ country: filters.country === c.code ? null : c.code })}
                  >
                    <Flag code={c.code} width={26} />
                    {countryName(c.code)}
                    <span className={styles.chipCount}>{c.count}</span>
                  </button>
                ))}
              </div>

              <div className={styles.filterRow}>
                <div className={styles.platforms} role="group" aria-label={t('lives.platform')}>
                  {([null, ...LIVE_PLATFORMS] as Array<LivePlatform | null>).map((p) => (
                    <button
                      key={p ?? 'all'}
                      type="button"
                      aria-pressed={filters.platform === p}
                      className={styles.segment}
                      onClick={() => update({ platform: p })}
                    >
                      {p ? (
                        LIVE_PLATFORM_LABELS[p]
                      ) : (
                        <>
                          <span className={styles.narrowOnly}>{t('lives.allPlatforms')}</span>
                          <span className={styles.wideOnly}>{t('lives.allPlatformsWide')}</span>
                        </>
                      )}
                    </button>
                  ))}
                </div>

                {/* Phones: one button opens the category sheet. */}
                <button
                  type="button"
                  className={`${styles.categoryButton} ${currentCategory ? styles.categoryButtonOn : ''}`}
                  onClick={openSheet}
                  aria-haspopup="dialog"
                >
                  {currentCategory ? (
                    <CategoryIcon icon={currentCategory.icon} size={20} />
                  ) : (
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
                      <circle cx="16" cy="7" r="2" />
                      <circle cx="10" cy="17" r="2" />
                    </svg>
                  )}
                  <span className={styles.categoryButtonLabel}>
                    {currentCategory?.name ?? t('lives.category')}
                  </span>
                </button>

                <div className={styles.categories} role="group" aria-label={t('lives.category')}>
                  {categoryOptions.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      aria-pressed={filters.category === c.code}
                      className={styles.pill}
                      onClick={() =>
                        update({ category: filters.category === c.code ? null : c.code })
                      }
                    >
                      <CategoryIcon icon={c.icon} size={18} />
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.resultsHead}>
                <h2 className={styles.resultsTitle}>
                  {heading} · {t('lives.resultCount', { count: shown.length })}
                </h2>
                <span className={styles.order}>{t('lives.newestFirst')}</span>
              </div>

              {load.state === 'loading' ? (
                <div className={styles.grid} aria-busy="true" aria-label={t('common.loading')}>
                  {Array.from({ length: 6 }, (_, i) => (
                    <LiveCardSkeleton key={i} />
                  ))}
                </div>
              ) : shown.length > 0 ? (
                <ul className={styles.grid}>
                  {shown.map((live) => (
                    <li key={live.id} className={styles.cell}>
                      <LiveCard live={live} now={now} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={styles.state}>
                  <span className={styles.stateIcon} aria-hidden="true">
                    <svg
                      width="34"
                      height="34"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <circle cx="12" cy="12" r="2.2" />
                      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
                    </svg>
                  </span>
                  {hasFilters(filters) && lives.length > 0 ? (
                    <>
                      <h2 className={styles.stateTitle}>{t('lives.noMatchTitle')}</h2>
                      <p className={styles.stateText}>{t('lives.noMatchText')}</p>
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={() => update(NO_FILTERS)}
                      >
                        {t('lives.showAll')}
                      </button>
                    </>
                  ) : (
                    <>
                      <h2 className={styles.stateTitle}>{t('lives.emptyTitle')}</h2>
                      <p className={styles.stateText}>{t('lives.emptyText')}</p>
                    </>
                  )}
                </div>
              )}
              <p className={styles.updated}>{t('lives.updated')}</p>
            </>
          )}
        </div>
      </main>
      <div className={styles.stickyPost}>
        <Link href="/en-direct/publier" className={styles.postButtonBig}>
          <BroadcastIcon />
          {t('lives.post')}
        </Link>
      </div>
      <SiteFooter />

      <dialog
        ref={sheet}
        className={styles.sheet}
        aria-labelledby="category-sheet-title"
        onClose={() => setSheetOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeSheet();
        }}
      >
        {sheetOpen && (
          <div className={styles.sheetBody}>
            <span className={styles.grabber} aria-hidden="true" />
            <div className={styles.sheetHead}>
              <h2 id="category-sheet-title" className={styles.sheetTitle}>
                {t('lives.chooseCategory')}
              </h2>
              <button
                type="button"
                className={styles.close}
                aria-label={t('common.close')}
                onClick={closeSheet}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className={styles.tiles}>
              <button
                type="button"
                aria-pressed={!filters.category}
                className={styles.tile}
                onClick={() => pickCategory(null)}
              >
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
                  <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
                  <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
                  <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
                </svg>
                {t('lives.allCategories')}
              </button>
              {categoryOptions.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  aria-pressed={filters.category === c.code}
                  className={styles.tile}
                  onClick={() => pickCategory(c.code)}
                >
                  <CategoryIcon icon={c.icon} size={28} />
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

function BroadcastIcon() {
  return (
    <svg
      width="24"
      height="24"
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
  );
}
