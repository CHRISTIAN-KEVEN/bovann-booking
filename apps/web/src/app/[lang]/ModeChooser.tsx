'use client';

import { formatXof, type SessionMode, type SpaceDto } from '@bovann/shared';
import { useEffect, useState } from 'react';
import { useFlow } from '@/components/FlowProvider';
import { Icon } from '@/components/icons';
import { LiveScene } from '@/components/LiveScene';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { Alert, SkeletonBlock } from '@/components/ui';
import { useI18n, useLocaleRouter, type TKey } from '@/i18n/I18nProvider';
import { api, ApiError } from '@/lib/api';
import { formatDuration } from '@/lib/dates';
import styles from './ModeChooser.module.css';

const OPTIONS: { mode: SessionMode; title: TKey; text: TKey; icon: 'video' | 'monitor' }[] = [
  { mode: 'IN_PERSON', title: 'home.inPersonTitle', text: 'home.inPersonText', icon: 'video' },
  { mode: 'VIRTUAL', title: 'home.virtualTitle', text: 'home.virtualText', icon: 'monitor' },
];

/** Screen 1: what the studio does, and the choice of mode. One tap on a mode opens the calendar. */
export function ModeChooser() {
  const router = useLocaleRouter();
  const { t, locale } = useI18n();
  const { update } = useFlow();
  const [space, setSpace] = useState<SpaceDto | null>(null);
  const [prices, setPrices] = useState<Partial<Record<SessionMode, number>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .space()
      .then(async (s) => {
        setSpace(s);
        const catalogs = await Promise.all(s.modes.map((m) => api.packages(m)));
        setPrices(Object.fromEntries(s.modes.map((m, i) => [m, catalogs[i]!.unitPriceXof])));
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : t('common.genericError')),
      );
    // Reload when the language changes: the API answers in the page's language.
  }, [locale, t]);

  const offered = OPTIONS.filter((o) => !space || space.modes.includes(o.mode));
  const slotLength = space ? formatDuration(space.slotDurationMin) : '1h30';

  function choose(mode: SessionMode) {
    update({ mode });
    router.push('/reserver/date');
  }

  return (
    <div className={styles.landing}>
      <SiteHeader />
      <main>
        <section className={styles.hero}>
          <div className={styles.copy}>
            <p className={styles.kicker}>
              <span className={styles.kickerDot} aria-hidden="true" />
              {t('home.kicker')}
            </p>
            <h1 className={styles.title}>
              {t('home.title')}
              <span className={styles.accent}> {t('home.titleAccent')}</span>
            </h1>
            <p className={styles.lead}>{t('home.lead')}</p>

            {error ? (
              <Alert tone="error" title={t('common.serviceDown')}>
                {error}
              </Alert>
            ) : null}

            <section aria-labelledby="mode-heading" className={styles.choose}>
              <h2 id="mode-heading" className={styles.chooseTitle}>
                {t('home.chooseTitle')}
              </h2>
              <div className={styles.options}>
                {offered.map((o) => (
                  <button
                    key={o.mode}
                    type="button"
                    className={styles.option}
                    onClick={() => choose(o.mode)}
                  >
                    <span className={styles.optionIcon}>
                      <Icon name={o.icon} size={22} />
                    </span>
                    <span className={styles.optionText}>
                      <span className={styles.optionTitle}>{t(o.title)}</span>
                      <span className={styles.optionDesc}>{t(o.text)}</span>
                    </span>
                    <span className={styles.optionPrice}>
                      {prices?.[o.mode] ? (
                        <>
                          <span className={styles.from}>{t('common.from')}</span>
                          <strong>{formatXof(prices[o.mode]!, locale)}</strong>
                        </>
                      ) : error ? null : (
                        <SkeletonBlock className={styles.priceSkeleton} />
                      )}
                    </span>
                    <Icon name="next" size={20} className={styles.optionChevron} />
                  </button>
                ))}
              </div>
            </section>
          </div>

          <LiveScene className={styles.scene} />
        </section>

        <section className={styles.how} aria-labelledby="how-heading">
          <h2 id="how-heading" className={styles.howTitle}>
            {t('home.howTitle')}
          </h2>
          <ol className={styles.steps}>
            <li>
              <span className={styles.stepNum}>1</span>
              <span>
                <strong>{t('home.step1Title')}</strong>
                <span>{t('home.step1Text', { length: slotLength })}</span>
              </span>
            </li>
            <li>
              <span className={styles.stepNum}>2</span>
              <span>
                <strong>{t('home.step2Title')}</strong>
                <span>{t('home.step2Text')}</span>
              </span>
            </li>
            <li>
              <span className={styles.stepNum}>3</span>
              <span>
                <strong>{t('home.step3Title')}</strong>
                <span>{t('home.step3Text')}</span>
              </span>
            </li>
          </ol>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
