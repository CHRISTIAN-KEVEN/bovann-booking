'use client';

import type { DayAvailabilityResponse, DayPackageDto, StartOptionDto } from '@bovann/shared';
import { SESSION_MODE_LABELS_FR, formatXof } from '@bovann/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFlow } from '@/components/FlowProvider';
import { Icon } from '@/components/icons';
import {
  Alert,
  Body,
  BottomBar,
  PageTitle,
  Screen,
  Skeleton,
  StepHeader,
  buttonClass,
  buttonSecondaryClass,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDuration, formatLongDate } from '@/lib/dates';
import { suggestPackage, summarizePackage, summarizeSlots } from '@/lib/selection';
import { useStepGuard } from '@/lib/useStepGuard';
import styles from './page.module.css';

type Tab = 'SLOTS' | 'PACKAGE';

/** Screen 3: the slots of the chosen day, one by one or as a package. */
export default function SlotsPage() {
  const allowed = useStepGuard('/reserver/creneaux');
  // Render only once saved progress is loaded, so previous choices are restored.
  return allowed ? <SlotsChooser /> : null;
}

function SlotsChooser() {
  const router = useRouter();
  const { flow, update } = useFlow();
  const [day, setDay] = useState<DayAvailabilityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(flow.selection?.type ?? 'SLOTS');
  const [slots, setSlots] = useState<string[]>(
    flow.selection?.type === 'SLOTS' ? flow.selection.slotStarts : [],
  );
  const [pkgCode, setPkgCode] = useState<string | null>(
    flow.selection?.type === 'PACKAGE' ? flow.selection.packageCode : null,
  );
  const [pkgStart, setPkgStart] = useState<string | null>(
    flow.selection?.type === 'PACKAGE' ? flow.selection.start : null,
  );

  const load = useCallback(() => {
    if (!flow.date || !flow.mode) return;
    setError(null);
    api
      .day(flow.date, flow.mode)
      .then((d) => {
        setDay(d);
        // Drop choices that are no longer possible (taken since last visit).
        setSlots((current) =>
          current.filter((s) => d.slots.some((x) => x.start === s && x.status === 'AVAILABLE')),
        );
        setPkgStart((current) => {
          const pkg = d.packages.find((p) => p.code === pkgCode);
          return pkg?.startOptions.some((o) => o.start === current) ? current : null;
        });
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.'),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the day changes
  }, [flow.date, flow.mode]);

  useEffect(load, [load]);

  const packages = useMemo(
    () => day?.packages.filter((p) => !(p.slotCount === 1 && !p.isFullDay)) ?? [],
    [day],
  );
  const selectedPkg = packages.find((p) => p.code === pkgCode) ?? null;
  const selectedOption = selectedPkg?.startOptions.find((o) => o.start === pkgStart) ?? null;

  const summary = useMemo(() => {
    if (!day) return null;
    if (tab === 'SLOTS') return summarizeSlots(day, slots);
    return selectedPkg && selectedOption ? summarizePackage(selectedPkg, selectedOption) : null;
  }, [day, tab, slots, selectedPkg, selectedOption]);

  const suggestion = day && tab === 'SLOTS' ? suggestPackage(day, slots) : null;

  function toggleSlot(start: string) {
    setSlots((current) =>
      current.includes(start) ? current.filter((s) => s !== start) : [...current, start],
    );
  }

  function choosePackage(pkg: DayPackageDto) {
    setPkgCode(pkg.code);
    setPkgStart(pkg.startOptions.length === 1 ? pkg.startOptions[0]!.start : null);
  }

  function applySuggestion(pkg: DayPackageDto, option: StartOptionDto) {
    setTab('PACKAGE');
    setPkgCode(pkg.code);
    setPkgStart(option.start);
  }

  function next() {
    if (!summary) return;
    const selection =
      tab === 'SLOTS'
        ? { type: 'SLOTS' as const, slotStarts: [...slots].sort() }
        : { type: 'PACKAGE' as const, packageCode: pkgCode!, start: pkgStart! };
    update({ selection, summary });
    router.push('/reserver/informations');
  }

  return (
    <Screen>
      <StepHeader
        step={3}
        label={tab === 'SLOTS' ? 'Créneaux' : 'Forfait'}
        backHref="/reserver/date"
      />
      <Body>
        <PageTitle sub={`${flow.mode ? SESSION_MODE_LABELS_FR[flow.mode] : ''} · Créneaux de 1h30`}>
          {flow.date ? formatLongDate(flow.date) : ''}
        </PageTitle>

        <div className={styles.tabs} role="tablist" aria-label="Type de réservation">
          {(['SLOTS', 'PACKAGE'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'SLOTS' ? 'Créneaux à l’unité' : 'Forfaits'}
            </button>
          ))}
        </div>

        {error ? (
          <Alert
            tone="error"
            title="Impossible d’afficher les créneaux"
            action={
              <button type="button" className={buttonSecondaryClass} onClick={load}>
                Réessayer
              </button>
            }
          >
            {error}
          </Alert>
        ) : null}

        {!day && !error ? <Skeleton height={52} count={6} /> : null}

        {day && day.availableCount === 0 ? (
          <Alert tone="info" title="Plus aucun créneau ce jour-là">
            Choisissez une autre date.
          </Alert>
        ) : null}

        {day && tab === 'SLOTS' ? (
          <fieldset className={`${styles.list} ${styles.slotGrid}`}>
            <legend className={styles.srOnly}>Créneaux disponibles</legend>
            {day.slots.map((s) => {
              const available = s.status === 'AVAILABLE';
              const checked = slots.includes(s.start);
              return (
                <label
                  key={s.start}
                  className={`${styles.slot} ${checked ? styles.slotSelected : ''} ${!available ? styles.slotDisabled : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!available}
                    onChange={() => toggleSlot(s.start)}
                    className={styles.check}
                  />
                  <span className={styles.slotText}>
                    <span className={styles.slotTime}>
                      {s.startTime} – {s.endTime}
                    </span>
                    <span className={styles.slotSub}>
                      {available
                        ? checked
                          ? '1h30 · sélectionné'
                          : '1h30 · disponible'
                        : s.status === 'BOOKED'
                          ? 'Déjà réservé'
                          : 'Indisponible'}
                    </span>
                  </span>
                  <span className={styles.slotPrice}>
                    {available ? formatXof(day.unitPriceXof) : 'Indisponible'}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : null}

        {suggestion ? (
          <Alert
            tone="success"
            title={`${suggestion.pkg.slotCount} créneaux consécutifs`}
            action={
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => applySuggestion(suggestion.pkg, suggestion.option)}
              >
                Passer au {suggestion.pkg.name}
              </button>
            }
          >
            Le {suggestion.pkg.name} revient à {formatXof(suggestion.pkg.price.totalXof)}.
            Économisez {formatXof(suggestion.savingXof)}.
          </Alert>
        ) : null}

        {day && tab === 'PACKAGE' ? (
          <fieldset className={styles.list}>
            <legend className={styles.srOnly}>Forfaits</legend>
            {packages.map((p) => {
              const available = p.startOptions.length > 0;
              const selected = p.code === pkgCode && available;
              return (
                <div
                  key={p.code}
                  className={`${styles.pkg} ${selected ? styles.pkgSelected : ''} ${!available ? styles.pkgDisabled : ''}`}
                >
                  <label className={styles.pkgRow}>
                    <input
                      type="radio"
                      name="package"
                      checked={selected}
                      disabled={!available}
                      onChange={() => choosePackage(p)}
                      className={styles.check}
                    />
                    <span className={styles.slotText}>
                      <span className={styles.slotTime}>{p.name}</span>
                      <span className={styles.slotSub}>
                        {p.isFullDay
                          ? available
                            ? `Toute la journée · ${formatDuration(p.durationMin)}`
                            : 'Indisponible ce jour'
                          : `${p.slotCount} créneaux consécutifs · ${formatDuration(p.durationMin)}`}
                        {!p.isFullDay && !available ? ' · indisponible ce jour' : ''}
                      </span>
                    </span>
                    <span className={styles.pkgPrice}>
                      <span className={styles.slotPrice}>{formatXof(p.price.totalXof)}</span>
                      {p.price.discountPercent > 0 ? (
                        <span className={styles.pkgDiscount}>
                          <s>{formatXof(p.price.listPriceXof)}</s>
                          <span className={styles.badge}>−{p.price.discountPercent} %</span>
                        </span>
                      ) : null}
                    </span>
                  </label>
                  {selected && !p.isFullDay ? (
                    <div className={styles.starts}>
                      <span className={styles.startsLabel} id={`starts-${p.code}`}>
                        Heure de début
                      </span>
                      <div
                        className={styles.chips}
                        role="group"
                        aria-labelledby={`starts-${p.code}`}
                      >
                        {p.startOptions.map((o) => (
                          <button
                            key={o.start}
                            type="button"
                            aria-pressed={o.start === pkgStart}
                            className={`${styles.chip} ${o.start === pkgStart ? styles.chipSelected : ''}`}
                            onClick={() => setPkgStart(o.start)}
                          >
                            {o.startTime} – {o.endTime}
                          </button>
                        ))}
                      </div>
                      <span className={styles.slotSub}>
                        Seuls les débuts avec {p.slotCount} créneaux libres à la suite sont
                        proposés.
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <p className={styles.note}>
              Créneau unique (1h30)&nbsp;: {formatXof(day.unitPriceXof)}, dans l’onglet « Créneaux à
              l’unité ».
            </p>
          </fieldset>
        ) : null}
      </Body>

      <BottomBar
        step={3}
        summary={
          summary ? (
            <>
              <span className={styles.summaryLine}>
                {summary.label} · {summary.timesLabel}
              </span>
              <span className={styles.summaryPrice}>
                {formatXof(summary.totalXof)}
                {summary.discountXof > 0 ? (
                  <span className={styles.summarySaving}>−{formatXof(summary.discountXof)}</span>
                ) : null}
              </span>
            </>
          ) : (
            <span className={styles.summaryLine}>
              {tab === 'SLOTS'
                ? 'Sélectionnez un ou plusieurs créneaux'
                : 'Choisissez un forfait et une heure'}
            </span>
          )
        }
      >
        <button type="button" className={buttonClass} onClick={next} disabled={!summary}>
          Continuer
          <Icon name="next" size={18} />
        </button>
      </BottomBar>
    </Screen>
  );
}
