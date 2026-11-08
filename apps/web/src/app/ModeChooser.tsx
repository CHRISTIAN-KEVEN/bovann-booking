'use client';

import type { SessionMode, SpaceDto } from '@bovann/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useFlow } from '@/components/FlowProvider';
import { Icon } from '@/components/icons';
import { Alert, BottomBar, Screen, buttonClass } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import styles from './ModeChooser.module.css';

const OPTIONS: { mode: SessionMode; title: string; text: string; icon: 'video' | 'monitor' }[] = [
  {
    mode: 'IN_PERSON',
    title: 'En studio',
    text: 'Venez dans notre studio équipé à Lomé.',
    icon: 'video',
  },
  {
    mode: 'VIRTUAL',
    title: 'Virtuel',
    text: 'Vous participez à distance ; notre équipe gère le live depuis le studio, avec un assistant sur place.',
    icon: 'monitor',
  },
];

export function ModeChooser() {
  const router = useRouter();
  const { flow, ready, update } = useFlow();
  const [space, setSpace] = useState<SpaceDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SessionMode | undefined>(undefined);

  useEffect(() => {
    if (ready && flow.mode) setMode(flow.mode);
  }, [ready, flow.mode]);

  useEffect(() => {
    api
      .space()
      .then(setSpace)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.'),
      );
  }, []);

  const offered = OPTIONS.filter((o) => !space || space.modes.includes(o.mode));

  function next() {
    if (!mode) return;
    update({ mode });
    router.push('/reserver/date');
  }

  return (
    <Screen>
      <section className={styles.hero}>
        <span className={styles.badge}>
          <span className={styles.badgeDot} aria-hidden="true" />
          STUDIO LIVE · LOMÉ
        </span>
        <h1 className={styles.title}>Réservez votre session live</h1>
        <p className={styles.lead}>
          Choisissez une date, un créneau de 1h30 ou un forfait, et payez en ligne par Mobile Money
          ou carte.
        </p>
      </section>

      <main className={styles.main}>
        {error ? (
          <Alert tone="error" title="Service indisponible">
            {error}
          </Alert>
        ) : null}

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Comment souhaitez-vous faire votre live&nbsp;?</legend>
          {offered.map((o) => {
            const selected = mode === o.mode;
            return (
              <label
                key={o.mode}
                className={`${styles.option} ${selected ? styles.optionSelected : ''}`}
              >
                <span
                  className={`${styles.optionIcon} ${selected ? styles.optionIconSelected : ''}`}
                >
                  <Icon name={o.icon} size={22} />
                </span>
                <span className={styles.optionText}>
                  <span className={styles.optionTitle}>{o.title}</span>
                  <span className={styles.optionDesc}>{o.text}</span>
                  {o.mode === 'IN_PERSON' && space ? (
                    <span className={styles.optionMeta}>
                      <Icon name="pin" size={14} />
                      {space.address ?? space.name}
                    </span>
                  ) : null}
                </span>
                <input
                  type="radio"
                  name="mode"
                  value={o.mode}
                  checked={selected}
                  onChange={() => setMode(o.mode)}
                  className={styles.radio}
                />
              </label>
            );
          })}
        </fieldset>
        <p className={styles.note}>
          Les deux modes utilisent le même studio et le même calendrier.
        </p>
      </main>

      <BottomBar>
        <button type="button" className={buttonClass} onClick={next} disabled={!mode}>
          Continuer
        </button>
      </BottomBar>
    </Screen>
  );
}
