'use client';

import { formatXof, type SessionMode, type SpaceDto } from '@bovann/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useFlow } from '@/components/FlowProvider';
import { Icon } from '@/components/icons';
import { LiveScene } from '@/components/LiveScene';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { Alert, SkeletonBlock } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDuration } from '@/lib/dates';
import styles from './ModeChooser.module.css';

const OPTIONS: { mode: SessionMode; title: string; text: string; icon: 'video' | 'monitor' }[] = [
  {
    mode: 'IN_PERSON',
    title: 'En studio',
    text: 'Vous venez à Lomé et vous vendez sur notre plateau.',
    icon: 'video',
  },
  {
    mode: 'VIRTUAL',
    title: 'Virtuel',
    text: 'Vous restez dans votre boutique ; notre équipe et une assistante animent le live au studio.',
    icon: 'monitor',
  },
];

/** Screen 1: what the studio does, and the choice of mode. One tap on a mode opens the calendar. */
export function ModeChooser() {
  const router = useRouter();
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
        setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.'),
      );
  }, []);

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
              Studio de live shopping à Lomé
            </p>
            <h1 className={styles.title}>
              Passez en direct.
              <span className={styles.accent}> On s’occupe du plateau.</span>
            </h1>
            <p className={styles.lead}>
              Un plateau équipé, une régie et une équipe pour vos lives de vente. Venez au studio,
              ou restez dans votre boutique&nbsp;: nous animons le live pour vous.
            </p>

            {error ? (
              <Alert tone="error" title="Service indisponible">
                {error}
              </Alert>
            ) : null}

            <section aria-labelledby="mode-heading" className={styles.choose}>
              <h2 id="mode-heading" className={styles.chooseTitle}>
                Comment voulez-vous faire votre live&nbsp;?
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
                      <span className={styles.optionTitle}>{o.title}</span>
                      <span className={styles.optionDesc}>{o.text}</span>
                    </span>
                    <span className={styles.optionPrice}>
                      {prices?.[o.mode] ? (
                        <>
                          <span className={styles.from}>dès</span>
                          <strong>{formatXof(prices[o.mode]!)}</strong>
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
            Comment ça marche
          </h2>
          <ol className={styles.steps}>
            <li>
              <span className={styles.stepNum}>1</span>
              <span>
                <strong>Choisissez votre créneau</strong>
                <span>
                  Lives de {slotLength}, ou un forfait pour plusieurs heures à prix réduit.
                </span>
              </span>
            </li>
            <li>
              <span className={styles.stepNum}>2</span>
              <span>
                <strong>Payez en ligne</strong>
                <span>Mobile Money (T-Money, Flooz) ou carte bancaire, en 2 minutes.</span>
              </span>
            </li>
            <li>
              <span className={styles.stepNum}>3</span>
              <span>
                <strong>Passez en direct</strong>
                <span>Le studio est prêt à l’heure dite&nbsp;; vous n’avez plus qu’à vendre.</span>
              </span>
            </li>
          </ol>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
