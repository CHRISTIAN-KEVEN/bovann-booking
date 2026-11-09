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
import { adminApi } from '@/lib/admin-api';
import { formatAmountInput, parseAmount } from '@/lib/admin-format';
import { ApiError } from '@/lib/api';
import { formatDuration } from '@/lib/dates';

type Editing = { kind: 'new' } | { kind: 'edit'; pkg: AdminPackageDto } | null;

const MODES: Array<{ mode: SessionMode; label: string }> = [
  { mode: 'IN_PERSON', label: 'En studio' },
  { mode: 'VIRTUAL', label: 'Virtuel' },
];

function slotsOf(p: AdminPackageDto, fullDay: number): number {
  return p.isFullDay ? fullDay : (p.slotCount ?? 0);
}

export default function AdminPackagesPage() {
  const { space, isOwner } = useAdmin();
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
          ? `«\u00a0${p.name}\u00a0» n’est plus proposé.`
          : `«\u00a0${p.name}\u00a0» est de nouveau proposé.`,
      );
    } catch (err) {
      toast(errorMessage(err), true);
    }
  }

  return (
    <>
      <PageHeader
        title="Forfaits & prix"
        sub="Les forfaits longs doivent rester moins chers que les créneaux à l’unité."
        actions={
          isOwner ? (
            <button
              type="button"
              className={styles.btn}
              onClick={() => setEditing({ kind: 'new' })}
            >
              <Icon name="plus" size={16} /> Nouveau forfait
            </button>
          ) : null
        }
      />

      {!isOwner ? (
        <p className={styles.note}>
          Seul un administrateur peut modifier les forfaits et les prix.
        </p>
      ) : null}

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
                <Empty>
                  Aucun forfait&nbsp;: ajoutez au moins le créneau unique pour ouvrir les
                  réservations.
                </Empty>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table} style={{ minWidth: 620 }}>
                    <thead>
                      <tr>
                        <th>Forfait</th>
                        <th>Créneaux</th>
                        <th>Prix</th>
                        <th>Réduction</th>
                        <th>Modes</th>
                        <th>Proposé</th>
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
                                <span className={styles.cellSub}>
                                  {p.isFullDay
                                    ? 'Toute la journée'
                                    : formatDuration(n * space.slotDurationMin)}
                                </span>
                              </div>
                            </td>
                            <td>{p.isFullDay ? `${n} (tous)` : n}</td>
                            <td>
                              <div className={styles.cellStack}>
                                {MODES.filter((m) => p.prices[m.mode]).map((m) => (
                                  <span key={m.mode}>
                                    <span style={{ fontWeight: 600 }}>
                                      {formatXof(p.prices[m.mode]!)}
                                    </span>
                                    {p.prices.IN_PERSON && p.prices.VIRTUAL ? (
                                      <span className={styles.cellSub}>
                                        {' '}
                                        · {m.label.toLowerCase()}
                                      </span>
                                    ) : null}
                                  </span>
                                ))}
                                {u && n > 1 ? (
                                  <span
                                    className={styles.cellSub}
                                    style={{ textDecoration: 'line-through' }}
                                  >
                                    {formatXof(u * n)}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td>
                              {n === 1 ? (
                                <Badge tone="neutral">Prix de base</Badge>
                              ) : pct > 0 ? (
                                <Badge tone="success">−{pct} %</Badge>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className={styles.cellSub}>
                              {MODES.filter((m) => p.prices[m.mode])
                                .map((m) => m.label)
                                .join(' · ') || '—'}
                            </td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                role="switch"
                                aria-label={`${p.name} proposé aux clients`}
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
  const [studio, setStudio] = useState(formatAmountInput(single?.prices.IN_PERSON));
  const [virtual, setVirtual] = useState(formatAmountInput(single?.prices.VIRTUAL));
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
      setError('Prix invalide.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await adminApi.updatePackage(single!.id, {
        prices: { IN_PERSON: s, VIRTUAL: v },
      });
      onSaved(next);
      toast('Prix de base enregistré.');
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
        <span style={{ fontSize: 15, fontWeight: 700 }}>Prix de base d’un créneau</span>
        <span className={styles.cellSub}>
          Sert de référence pour calculer les réductions des forfaits.
        </span>
      </div>
      <Field label="En studio">
        {(p) => <AmountInput {...p} value={studio} onChange={setStudio} disabled={!canEdit} />}
      </Field>
      <Field label="Virtuel">
        {(p) => <AmountInput {...p} value={virtual} onChange={setVirtual} disabled={!canEdit} />}
      </Field>
      {canEdit && changed ? (
        <button type="submit" className={styles.btn} disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
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
  const pkg = editing.kind === 'edit' ? editing.pkg : null;
  const isFullDay = pkg?.isFullDay ?? false;
  const [name, setName] = useState(pkg?.name ?? '');
  const [count, setCount] = useState(pkg?.slotCount ?? 3);
  const [offered, setOffered] = useState<Record<SessionMode, boolean>>({
    IN_PERSON: pkg ? pkg.prices.IN_PERSON !== undefined : true,
    VIRTUAL: pkg ? pkg.prices.VIRTUAL !== undefined : true,
  });
  const [prices, setPrices] = useState<Record<SessionMode, string>>({
    IN_PERSON: formatAmountInput(pkg?.prices.IN_PERSON),
    VIRTUAL: formatAmountInput(pkg?.prices.VIRTUAL),
  });
  const [error, setError] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setError(null), [name, count, prices, offered]);

  const n = isFullDay ? catalog.fullDaySlotCount : count;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(['Indiquez le nom du forfait.']);
      return;
    }
    const out: Partial<Record<SessionMode, number | null>> = {};
    for (const { mode } of MODES) {
      if (!offered[mode]) {
        out[mode] = null;
        continue;
      }
      const v = parseAmount(prices[mode]);
      if (v === null || v < 100) {
        setError([`Indiquez un prix valide (${mode === 'IN_PERSON' ? 'en studio' : 'virtuel'}).`]);
        return;
      }
      out[mode] = v;
    }
    if (!offered.IN_PERSON && !offered.VIRTUAL) {
      setError(['Proposez ce forfait dans au moins un mode.']);
      return;
    }
    setBusy(true);
    try {
      const next = pkg
        ? await adminApi.updatePackage(pkg.id, {
            name: name.trim(),
            ...(isFullDay ? {} : { slotCount: count }),
            prices: out,
          })
        : await create({ name: name.trim(), slotCount: count, prices: out });
      onSaved(
        next,
        pkg ? `«\u00a0${name.trim()}\u00a0» enregistré.` : `«\u00a0${name.trim()}\u00a0» créé.`,
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
      aria-label={pkg ? `Modifier ${pkg.name}` : 'Nouveau forfait'}
    >
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>
          {pkg ? `Modifier\u00a0: ${pkg.name}` : 'Nouveau forfait'}
        </h2>
        <button type="button" className={styles.iconBtn} aria-label="Fermer" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <Field label="Nom affiché">
        {(p) => (
          <input
            {...p}
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <div className={styles.grid2} style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <div className={styles.field}>
          <span className={styles.label} id="pk-count">
            Nombre de créneaux
          </span>
          {isFullDay ? (
            <span className={styles.readonly}>Tous ({n})</span>
          ) : (
            <div className={styles.amount} role="group" aria-labelledby="pk-count">
              <button
                type="button"
                aria-label="Un créneau de moins"
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
                aria-label="Un créneau de plus"
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
          <span className={styles.label}>Durée totale</span>
          <span className={styles.readonly}>
            {isFullDay ? 'Journée' : formatDuration(n * slotDurationMin)}
          </span>
        </div>
      </div>

      {MODES.map(({ mode, label }) => {
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
              Proposé {label.toLowerCase()}
            </label>
            {offered[mode] ? (
              <>
                <AmountInput
                  aria-label={`Prix ${label.toLowerCase()}`}
                  value={prices[mode]}
                  onChange={(v) => setPrices((p) => ({ ...p, [mode]: v }))}
                />
                {list !== null && n > 1 && price !== null ? (
                  <div
                    className={cx(styles.calc, saving !== null && saving <= 0 && styles.calcBad)}
                  >
                    <span>
                      {n} × {formatXof(u!)} = <strong>{formatXof(list)}</strong> à l’unité
                    </span>
                    {saving !== null && saving > 0 ? (
                      <span>
                        Le client économise{' '}
                        <strong>
                          {formatXof(saving)} (−{discountPercent(price, u!, n)} %)
                        </strong>
                      </span>
                    ) : (
                      <span>Ce prix n’est pas inférieur au total à l’unité.</span>
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
        <span>
          Enregistrement refusé si le prix est égal ou supérieur au total à l’unité, ou plus cher
          par créneau qu’un forfait plus court. Un changement de prix s’applique aux nouvelles
          réservations&nbsp;; les réservations existantes gardent leur prix.
        </span>
      </div>
      {pkg && pkg.upcomingBookings > 0 ? (
        <p className={styles.note}>
          {pkg.upcomingBookings} réservation{pkg.upcomingBookings > 1 ? 's' : ''} à venir avec ce
          forfait (non concernée{pkg.upcomingBookings > 1 ? 's' : ''} par les modifications).
        </p>
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
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button type="button" className={styles.btnSecondary} onClick={onClose}>
          Annuler
        </button>
      </div>
    </form>
  );
}
