'use client';

import { formatXof, type SessionMode, type SpaceDto } from '@bovann/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AfricaMap } from '@/components/AfricaMap';
import { useFlow } from '@/components/FlowProvider';
import { Icon } from '@/components/icons';
import { SiteHeader } from '@/components/SiteHeader';
import { Alert } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDuration } from '@/lib/dates';
import styles from './ModeChooser.module.css';

const OPTIONS: { mode: SessionMode; title: string; text: string; icon: 'video' | 'monitor' }[] = [
  {
    mode: 'IN_PERSON',
    title: 'En studio',
    text: 'Vous venez à Lomé : régie, plateau et éclairage professionnels.',
    icon: 'video',
  },
  {
    mode: 'VIRTUAL',
    title: 'Virtuel',
    text: 'Vous restez dans votre boutique : notre équipe et une assistante animent le live au studio.',
    icon: 'monitor',
  },
];

/** Screen 1: the brand stage and the choice of mode. One tap on a mode opens the calendar. */
export function ModeChooser() {
  const router = useRouter();
  const { update } = useFlow();
  const [space, setSpace] = useState<SpaceDto | null>(null);
  const [fromXof, setFromXof] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .space()
      .then(async (s) => {
        setSpace(s);
        const catalogs = await Promise.all(s.modes.map((m) => api.packages(m)));
        setFromXof(Math.min(...catalogs.map((c) => c.unitPriceXof)));
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.'),
      );
  }, []);

  const offered = OPTIONS.filter((o) => !space || space.modes.includes(o.mode));

  function choose(mode: SessionMode) {
    update({ mode });
    router.push('/reserver/date');
  }

  const facts = [
    space ? `Lives de ${formatDuration(space.slotDurationMin)}` : null,
    fromXof ? `dès ${formatXof(fromXof)}` : null,
    'Réservation en 2 minutes',
    'Mobile Money ou carte',
  ].filter(Boolean);

  return (
    <div className={styles.landing}>
      <SiteHeader transparent />
      <main className={styles.stage}>
        <div className={styles.copy}>
          <p className={styles.kicker}>Studio de lives · Lomé, Togo</p>
          <h1 className={styles.title}>
            Votre produit en direct devant <span className={styles.accent}>toute l’Afrique.</span>
          </h1>
          <p className={styles.lead}>
            Une régie, un studio, une audience. Venez vendre depuis notre studio à Lomé, ou restez
            dans votre boutique et nous vous faisons passer en live.
          </p>

          {error ? (
            <Alert tone="error" title="Service indisponible">
              {error}
            </Alert>
          ) : null}

          <section aria-labelledby="mode-heading" className={styles.choose}>
            <h2 id="mode-heading" className={styles.chooseTitle}>
              Choisissez votre format&nbsp;:
            </h2>
            <div className={styles.cards}>
              {offered.map((o) => (
                <button
                  key={o.mode}
                  type="button"
                  className={styles.card}
                  onClick={() => choose(o.mode)}
                >
                  <span className={styles.cardTop}>
                    <span className={styles.cardIcon}>
                      <Icon name={o.icon} size={22} />
                    </span>
                    <Icon name="arrowUpRight" size={20} className={styles.cardArrow} />
                  </span>
                  <span className={styles.cardTitle}>{o.title}</span>
                  <span className={styles.cardText}>{o.text}</span>
                </button>
              ))}
            </div>
          </section>

          <p className={styles.facts}>
            {facts.map((f, i) => (
              <span key={f}>
                {i > 0 ? <span aria-hidden="true"> · </span> : null}
                {f}
              </span>
            ))}
          </p>
        </div>

        <div className={styles.visual}>
          <AfricaMap />
          <p className={styles.caption}>Le studio est à Lomé · Votre public est partout</p>
        </div>
      </main>
    </div>
  );
}
