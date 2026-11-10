'use client';

import type { DayAvailabilityResponse, DayPackageDto, StartOptionDto } from '@bovann/shared';
import { SESSION_MODE_LABELS, formatXof } from '@bovann/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFlow } from '@/components/FlowProvider';
import { Icon } from '@/components/icons';
import {
  Alert,
  Body,
  BottomBar,
  PageTitle,
  Screen,
  SkeletonBlock,
  StepHeader,
  buttonClass,
  buttonSecondaryClass,
} from '@/components/ui';
import { useI18n, useLocaleRouter } from '@/i18n/I18nProvider';
import { api, ApiError } from '@/lib/api';
import { formatDuration, formatLongDate } from '@/lib/dates';
import { selectionLabel, suggestPackage, summarizePackage, summarizeSlots } from '@/lib/selection';
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
  const router = useLocaleRouter();
  const { t, locale } = useI18n();
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
        setError(e instanceof ApiError ? e.message : t('common.genericError')),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the day changes
  }, [flow.date, flow.mode, locale]);

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
  const money = (n: number) => formatXof(n, locale);
  const first = day?.slots[0];
  const slotLength = formatDuration(
    first ? (Date.parse(first.end) - Date.parse(first.start)) / 60000 : 90,
  );

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
        label={tab === 'SLOTS' ? t('slots.stepSlots') : t('slots.stepPackage')}
        backHref="/reserver/date"
      />
      <Body>
        <PageTitle
          sub={t('slots.sub', {
            mode: flow.mode ? SESSION_MODE_LABELS[locale][flow.mode] : '',
            length: slotLength,
          })}
        >
          {flow.date ? formatLongDate(flow.date, false, locale) : ''}
        </PageTitle>

        <div className={styles.tabs} role="tablist" aria-label={t('slots.tabsLabel')}>
          {(['SLOTS', 'PACKAGE'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className={`${styles.tab} ${tab === k ? styles.tabActive : ''}`}
              onClick={() => setTab(k)}
            >
              {k === 'SLOTS' ? t('slots.tabSlots') : t('slots.tabPackages')}
            </button>
          ))}
        </div>

        {error ? (
          <Alert
            tone="error"
            title={t('slots.loadError')}
            action={
              <button type="button" className={buttonSecondaryClass} onClick={load}>
                {t('common.retry')}
              </button>
            }
          >
            {error}
          </Alert>
        ) : null}

        {!day && !error ? (
          <div
            className={`${styles.list} ${styles.slotGrid}`}
            role="status"
            aria-label={t('slots.loading')}
          >
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonBlock key={i} className={styles.slotSkeleton} />
            ))}
          </div>
        ) : null}

        {day && day.availableCount === 0 ? (
          <Alert tone="info" title={t('slots.noneTitle')}>
            {t('slots.noneText')}
          </Alert>
        ) : null}

        {day && tab === 'SLOTS' ? (
          <fieldset className={`${styles.list} ${styles.slotGrid}`}>
            <legend className={styles.srOnly}>{t('slots.available')}</legend>
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
                          ? t('slots.selected', { length: slotLength })
                          : t('slots.free', { length: slotLength })
                        : s.status === 'BOOKED'
                          ? t('slots.booked')
                          : t('slots.unavailable')}
                    </span>
                  </span>
                  <span className={styles.slotPrice}>
                    {available ? money(day.unitPriceXof) : t('slots.unavailable')}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : null}

        {suggestion ? (
          <Alert
            tone="success"
            title={t('slots.suggestTitle', { count: suggestion.pkg.slotCount })}
            action={
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => applySuggestion(suggestion.pkg, suggestion.option)}
              >
                {t('slots.suggestAction', { name: suggestion.pkg.name })}
              </button>
            }
          >
            {t('slots.suggestText', {
              name: suggestion.pkg.name,
              price: money(suggestion.pkg.price.totalXof),
              saving: money(suggestion.savingXof),
            })}
          </Alert>
        ) : null}

        {day && tab === 'PACKAGE' ? (
          <fieldset className={styles.list}>
            <legend className={styles.srOnly}>{t('slots.packages')}</legend>
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
                            ? t('slots.fullDay', { length: formatDuration(p.durationMin) })
                            : t('slots.fullDayUnavailable')
                          : t('slots.consecutive', {
                              count: p.slotCount,
                              length: formatDuration(p.durationMin),
                            })}
                        {!p.isFullDay && !available ? t('slots.unavailableThatDay') : ''}
                      </span>
                    </span>
                    <span className={styles.pkgPrice}>
                      <span className={styles.slotPrice}>{money(p.price.totalXof)}</span>
                      {p.price.discountPercent > 0 ? (
                        <span className={styles.pkgDiscount}>
                          <s>{money(p.price.listPriceXof)}</s>
                          <span className={styles.badge}>−{p.price.discountPercent} %</span>
                        </span>
                      ) : null}
                    </span>
                  </label>
                  {selected && !p.isFullDay ? (
                    <div className={styles.starts}>
                      <span className={styles.startsLabel} id={`starts-${p.code}`}>
                        {t('slots.startTime')}
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
                        {t('slots.startsNote', { count: p.slotCount })}
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <p className={styles.note}>
              {t('slots.singleNote', { length: slotLength, price: money(day.unitPriceXof) })}
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
                {selectionLabel(summary, t)} · {summary.timesLabel}
              </span>
              <span className={styles.summaryPrice}>
                {money(summary.totalXof)}
                {summary.discountXof > 0 ? (
                  <span className={styles.summarySaving}>−{money(summary.discountXof)}</span>
                ) : null}
              </span>
            </>
          ) : (
            <span className={styles.summaryLine}>
              {tab === 'SLOTS' ? t('slots.pickSlots') : t('slots.pickPackage')}
            </span>
          )
        }
      >
        <button type="button" className={buttonClass} onClick={next} disabled={!summary}>
          {t('common.continue')}
          <Icon name="next" size={18} />
        </button>
      </BottomBar>
    </Screen>
  );
}
