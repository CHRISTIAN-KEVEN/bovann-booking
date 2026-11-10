'use client';

import {
  discountPercent,
  formatXof,
  type AdminPackageDto,
  type AdminPackagesResponse,
  type SessionMode,
} from '@bovann/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useAdmin } from '@/components/admin/AdminShell';
import {
  adminStyles as styles,
  AmountInput,
  Badge,
  cx,
  Empty,
  errorMessage,
  Field,
  LoadError,
  Loading,
  PageHeader,
  useAsync,
  useToast,
} from '@/components/admin/ui';
import { Icon } from '@/components/icons';
import { useI18n, type T, type TKey } from '@/i18n/I18nProvider';
import { adminApi } from '@/lib/admin-api';
import { formatAmountInput, parseAmount } from '@/lib/admin-format';
import { ApiError } from '@/lib/api';
import { formatDuration } from '@/lib/dates';

type Editing = { kind: 'new' } | { kind: 'edit'; pkg: AdminPackageDto } | null;

const MODES: SessionMode[] = ['IN_PERSON', 'VIRTUAL'];
const modeLabel = (t: T, mode: SessionMode) => t(`packages.mode.${mode}` as TKey);
const modeLower = (t: T, mode: SessionMode) => t(`packages.modeLower.${mode}` as TKey);

function slotsOf(p: AdminPackageDto, fullDay: number): number {
  return p.isFullDay ? fullDay : (p.slotCount ?? 0);
}

export default function AdminPackagesPage() {
  const { space, isOwner } = useAdmin();
  const { t, locale } = useI18n();
  const money = (n: number) => formatXof(n, locale);
  const toast = useToast();
  const catalog = useAsync(() => adminApi.packages(space.id), `pk-${space.id}`);
  const [editing, setEditing] = useState<Editing>(null);

  const data = catalog.data;
  const single = data?.packages.find((p) => !p.isFullDay && p.slotCount === 1) ?? null;
  const unit = (mode: SessionMode) => single?.prices[mode];

  async function toggleActive(p: AdminPackageDto) {
    try {
      const next = await adminApi.updatePackage(p.id, { isActive: !p.isActive });
      catalog.setData(next);
      toast(
        p.isActive
          ? t('packages.withdrawn', { name: p.name })
          : t('packages.offeredAgain', { name: p.name }),
      );
    } catch (err) {
      toast(errorMessage(err), true);
    }
  }

  return (
    <>
      <PageHeader
        title={t('packages.title')}
        sub={t('packages.sub')}
        actions={
          isOwner ? (
            <button
              type="button"
              className={styles.btn}
              onClick={() => setEditing({ kind: 'new' })}
            >
              <Icon name="plus" size={16} /> {t('packages.new')}
            </button>
          ) : null
        }
      />

      {!isOwner ? <p className={styles.note}>{t('packages.ownerOnly')}</p> : null}

      {catalog.error ? (
        <LoadError error={catalog.error} onRetry={catalog.reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <BasePrice
            key={single?.id ?? 'none'}
            single={single}
            canEdit={isOwner}
            onSaved={catalog.setData}
          />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
            <section className={styles.card} style={{ flex: '999 1 520px', minWidth: 0 }}>
              {data.packages.length === 0 ? (
                <Empty>{t('packages.empty')}</Empty>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table} style={{ minWidth: 620 }}>
                    <thead>
                      <tr>
                        <th>{t('packages.colPackage')}</th>
                        <th>{t('packages.colSlots')}</th>
                        <th>{t('packages.colPrice')}</th>
                        <th>{t('packages.colDiscount')}</th>
                        <th>{t('packages.colModes')}</th>
                        <th>{t('packages.colOffered')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.packages.map((p) => {
                        const n = slotsOf(p, data.fullDaySlotCount);
                        const studio = p.prices.IN_PERSON;
                        const u = unit('IN_PERSON');
                        const pct = studio && u && n > 1 ? discountPercent(studio, u, n) : 0;
                        const selected = editing?.kind === 'edit' && editing.pkg.id === p.id;
                        return (
                          <tr
                            key={p.id}
                            className={cx(
                              isOwner && styles.rowClickable,
                              selected && styles.rowSelected,
                            )}
                            onClick={
                              isOwner ? () => setEditing({ kind: 'edit', pkg: p }) : undefined
                            }
                            style={p.isActive ? undefined : { opacity: 0.6 }}
                          >
                            <td>
                              <div className={styles.cellStack}>
                                <span style={{ fontWeight: 700 }}>{p.name}</span>
                                {p.nameEn ? (
                                  <span className={styles.cellSub} lang="en">
                                    {p.nameEn}
                                  </span>
                                ) : null}
                                <span className={styles.cellSub}>
                                  {p.isFullDay
                                    ? t('packages.allDay')
                                    : formatDuration(n * space.slotDurationMin)}
                                </span>
                              </div>
                            </td>
                            <td>{p.isFullDay ? t('packages.allCount', { count: n }) : n}</td>
                            <td>
                              <div className={styles.cellStack}>
                                {MODES.filter((m) => p.prices[m]).map((m) => (
                                  <span key={m}>
                                    <span style={{ fontWeight: 600 }}>{money(p.prices[m]!)}</span>
                                    {p.prices.IN_PERSON && p.prices.VIRTUAL ? (
                                      <span className={styles.cellSub}> · {modeLower(t, m)}</span>
                                    ) : null}
                                  </span>
                                ))}
                                {u && n > 1 ? (
                                  <span
                                    className={styles.cellSub}
                                    style={{ textDecoration: 'line-through' }}
                                  >
                                    {money(u * n)}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              {n === 1 ? (
                                <Badge tone="neutral">{t('packages.basePrice')}</Badge>
                              ) : pct > 0 ? (
                                <Badge tone="success">−{pct} %</Badge>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className={styles.cellSub}>
                              {MODES.filter((m) => p.prices[m])
                                .map((m) => modeLabel(t, m))
                                .join(' · ') || '—'}
                            </td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                role="switch"
                                aria-label={t('packages.offeredLabel', { name: p.name })}
                                checked={p.isActive}
                                disabled={!isOwner}
                                onChange={() => toggleActive(p)}
                                style={{
                                  width: 20,
                                  height: 20,
                                  accentColor: 'var(--color-accent)',
                                }}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {isOwner && editing ? (
              <PackageEditor
                key={editing.kind === 'edit' ? editing.pkg.id : 'new'}
                editing={editing}
                catalog={data}
                unit={unit}
                slotDurationMin={space.slotDurationMin}
                onClose={() => setEditing(null)}
                onSaved={(next, message) => {
                  catalog.setData(next);
                  setEditing(null);
                  toast(message);
                }}
                create={(input) => adminApi.createPackage(space.id, input)}
              />
            ) : null}
          </div>
        </>
      )}
    </>
  );
}

function BasePrice({
  single,
  canEdit,
  onSaved,
}: {
  single: AdminPackageDto | null;
  canEdit: boolean;
  onSaved: (next: AdminPackagesResponse) => void;
}) {
  const toast = useToast();
  const { t, locale } = useI18n();
  const [studio, setStudio] = useState(formatAmountInput(single?.prices.IN_PERSON, locale));
  const [virtual, setVirtual] = useState(formatAmountInput(single?.prices.VIRTUAL, locale));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!single) return null;
  const changed =
    parseAmount(studio) !== (single.prices.IN_PERSON ?? null) ||
    parseAmount(virtual) !== (single.prices.VIRTUAL ?? null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const s = studio.trim() ? parseAmount(studio) : null;
    const v = virtual.trim() ? parseAmount(virtual) : null;
    if ((studio.trim() && s === null) || (virtual.trim() && v === null)) {
      setError(t('packages.badPrice'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await adminApi.updatePackage(single!.id, {
        prices: { IN_PERSON: s, VIRTUAL: v },
      });
      onSaved(next);
      toast(t('packages.baseSaved'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.card}
      onSubmit={save}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        gap: '16px 28px',
        padding: '16px 18px',
      }}
    >
      <div className={styles.cellStack} style={{ flex: '1 1 220px', alignSelf: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{t('packages.baseTitle')}</span>
        <span className={styles.cellSub}>{t('packages.baseSub')}</span>
      </div>
      <Field label={modeLabel(t, 'IN_PERSON')}>
        {(p) => <AmountInput {...p} value={studio} onChange={setStudio} disabled={!canEdit} />}
      </Field>
      <Field label={modeLabel(t, 'VIRTUAL')}>
        {(p) => <AmountInput {...p} value={virtual} onChange={setVirtual} disabled={!canEdit} />}
      </Field>
      {canEdit && changed ? (
        <button type="submit" className={styles.btn} disabled={busy}>
          {busy ? t('packages.saving') : t('packages.save')}
        </button>
      ) : null}
      {error ? (
        <div className={styles.banner} role="alert" style={{ flexBasis: '100%' }}>
          {error}
        </div>
      ) : null}
    </form>
  );
}

function PackageEditor({
  editing,
  catalog,
  unit,
  slotDurationMin,
  onClose,
  onSaved,
  create,
}: {
  editing: NonNullable<Editing>;
  catalog: AdminPackagesResponse;
  unit: (mode: SessionMode) => number | undefined;
  slotDurationMin: number;
  onClose: () => void;
  onSaved: (next: AdminPackagesResponse, message: string) => void;
  create: (input: Parameters<typeof adminApi.createPackage>[1]) => Promise<AdminPackagesResponse>;
}) {
  const { t, locale } = useI18n();
  const money = (n: number) => formatXof(n, locale);
  const pkg = editing.kind === 'edit' ? editing.pkg : null;
  const isFullDay = pkg?.isFullDay ?? false;
  const [name, setName] = useState(pkg?.name ?? '');
  const [nameEn, setNameEn] = useState(pkg?.nameEn ?? '');
  const [count, setCount] = useState(pkg?.slotCount ?? 3);
  const [offered, setOffered] = useState<Record<SessionMode, boolean>>({
    IN_PERSON: pkg ? pkg.prices.IN_PERSON !== undefined : true,
    VIRTUAL: pkg ? pkg.prices.VIRTUAL !== undefined : true,
  });
  const [prices, setPrices] = useState<Record<SessionMode, string>>({
    IN_PERSON: formatAmountInput(pkg?.prices.IN_PERSON, locale),
    VIRTUAL: formatAmountInput(pkg?.prices.VIRTUAL, locale),
  });
  const [error, setError] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setError(null), [name, nameEn, count, prices, offered]);

  const n = isFullDay ? catalog.fullDaySlotCount : count;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError([t('packages.nameRequired')]);
      return;
    }
    const out: Partial<Record<SessionMode, number | null>> = {};
    for (const mode of MODES) {
      if (!offered[mode]) {
        out[mode] = null;
        continue;
      }
      const v = parseAmount(prices[mode]);
      if (v === null || v < 100) {
        setError([t('packages.priceRequired', { mode: modeLower(t, mode) })]);
        return;
      }
      out[mode] = v;
    }
    if (!offered.IN_PERSON && !offered.VIRTUAL) {
      setError([t('packages.oneMode')]);
      return;
    }
    setBusy(true);
    try {
      const next = pkg
        ? await adminApi.updatePackage(pkg.id, {
            name: name.trim(),
            nameEn: nameEn.trim() || null,
            ...(isFullDay ? {} : { slotCount: count }),
            prices: out,
          })
        : await create({
            name: name.trim(),
            nameEn: nameEn.trim() || null,
            slotCount: count,
            prices: out,
          });
      onSaved(
        next,
        pkg
          ? t('packages.saved', { name: name.trim() })
          : t('packages.created', { name: name.trim() }),
      );
    } catch (err) {
      const violations =
        err instanceof ApiError
          ? (err.details as { violations?: string[] } | undefined)?.violations
          : undefined;
      setError(violations?.length ? violations : [errorMessage(err)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className={styles.card}
      style={{
        flex: '1 1 360px',
        padding: 20,
        border: '2px solid var(--color-accent)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
      aria-label={pkg ? t('packages.editLabel', { name: pkg.name }) : t('packages.new')}
    >
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>
          {pkg ? t('packages.editTitle', { name: pkg.name }) : t('packages.new')}
        </h2>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={t('packages.close')}
          onClick={onClose}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <Field label={t('packages.name')}>
        {(p) => (
          <input
            {...p}
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('packages.nameEn')} hint={t('packages.nameEnHint')}>
        {(p) => (
          <input
            {...p}
            lang="en"
            className={styles.input}
            maxLength={120}
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
          />
        )}
      </Field>
      <div className={styles.grid2} style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <div className={styles.field}>
          <span className={styles.label} id="pk-count">
            {t('packages.slotCount')}
          </span>
          {isFullDay ? (
            <span className={styles.readonly}>{t('packages.all', { count: n })}</span>
          ) : (
            <div className={styles.amount} role="group" aria-labelledby="pk-count">
              <button
                type="button"
                aria-label={t('packages.less')}
                onClick={() => setCount((c) => Math.max(1, c - 1))}
                style={{
                  width: 44,
                  height: '100%',
                  border: 'none',
                  background: 'var(--color-ground)',
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                −
              </button>
              <input
                aria-labelledby="pk-count"
                inputMode="numeric"
                value={count}
                onChange={(e) => {
                  const v = Number(e.target.value.replace(/\D/g, ''));
                  if (v >= 1 && v <= 20) setCount(v);
                }}
                style={{ textAlign: 'center' }}
              />
              <button
                type="button"
                aria-label={t('packages.more')}
                onClick={() => setCount((c) => Math.min(20, c + 1))}
                style={{
                  width: 44,
                  height: '100%',
                  border: 'none',
                  background: 'var(--color-ground)',
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                +
              </button>
            </div>
          )}
        </div>
        <div className={styles.field}>
          <span className={styles.label}>{t('packages.duration')}</span>
          <span className={styles.readonly}>
            {isFullDay ? t('packages.fullDay') : formatDuration(n * slotDurationMin)}
          </span>
        </div>
      </div>

      {MODES.map((mode) => {
        const price = parseAmount(prices[mode]);
        const u = unit(mode);
        const list = u ? u * n : null;
        const saving = list !== null && price !== null ? list - price : null;
        return (
          <fieldset key={mode} className={styles.fieldset}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={offered[mode]}
                onChange={(e) => setOffered((o) => ({ ...o, [mode]: e.target.checked }))}
              />
              {t('packages.offeredIn', { mode: modeLower(t, mode) })}
            </label>
            {offered[mode] ? (
              <>
                <AmountInput
                  aria-label={t('packages.priceIn', { mode: modeLower(t, mode) })}
                  value={prices[mode]}
                  onChange={(v) => setPrices((p) => ({ ...p, [mode]: v }))}
                />
                {list !== null && n > 1 && price !== null ? (
                  <div
                    className={cx(styles.calc, saving !== null && saving <= 0 && styles.calcBad)}
                  >
                    <span>{t('packages.calc', { n, unit: money(u!), list: money(list) })}</span>
                    {saving !== null && saving > 0 ? (
                      <strong>
                        {t('packages.saves', {
                          amount: money(saving),
                          pct: discountPercent(price, u!, n),
                        })}
                      </strong>
                    ) : (
                      <span>{t('packages.notLower')}</span>
                    )}
                  </div>
                ) : null}
              </>
            ) : null}
          </fieldset>
        );
      })}

      <div className={styles.note} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Icon name="alert" size={14} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>{t('packages.rules')}</span>
      </div>
      {pkg && pkg.upcomingBookings > 0 ? (
        <p className={styles.note}>{t('packages.upcoming', { count: pkg.upcomingBookings })}</p>
      ) : null}
      {error ? (
        <div
          className={styles.banner}
          role="alert"
          style={{ flexDirection: 'column', alignItems: 'flex-start' }}
        >
          {error.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      ) : null}
      <div className={styles.formActions}>
        <button type="submit" className={styles.btn} disabled={busy}>
          {busy ? t('packages.saving') : t('packages.save')}
        </button>
        <button type="button" className={styles.btnSecondary} onClick={onClose}>
          {t('packages.cancel')}
        </button>
      </div>
    </form>
  );
}
