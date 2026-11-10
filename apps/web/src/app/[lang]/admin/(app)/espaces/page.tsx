'use client';

import type { AdminSpaceDto, ClosureDto, OpeningHoursDayDto } from '@bovann/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useAdmin } from '@/components/admin/AdminShell';
import {
  adminStyles as styles,
  ConflictList,
  cx,
  Dialog,
  errorMessage,
  Field,
  LoadError,
  Loading,
  PageHeader,
  TimeSelect,
  useAsync,
  useToast,
} from '@/components/admin/ui';
import { Icon } from '@/components/icons';
import { adminApi } from '@/lib/admin-api';
import { todayIn } from '@/lib/admin-format';
import { formatDuration, formatLongDate } from '@/lib/dates';

const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

const LEAD_OPTIONS = [
  { value: 0, label: 'Jusqu’au début du créneau' },
  { value: 30, label: '30 min avant' },
  { value: 60, label: '1 h avant' },
  { value: 120, label: '2 h avant' },
  { value: 240, label: '4 h avant' },
  { value: 720, label: '12 h avant' },
  { value: 1440, label: '24 h avant' },
  { value: 2880, label: '48 h avant' },
];
const HORIZON_OPTIONS = [
  { value: 14, label: '2 semaines à l’avance' },
  { value: 30, label: '1 mois à l’avance' },
  { value: 60, label: '2 mois à l’avance' },
  { value: 90, label: '3 mois à l’avance' },
  { value: 180, label: '6 mois à l’avance' },
  { value: 365, label: '1 an à l’avance' },
];

function withCurrent(
  options: Array<{ value: number; label: string }>,
  current: number,
  unit: string,
) {
  return options.some((o) => o.value === current)
    ? options
    : [...options, { value: current, label: `${current} ${unit}` }].sort(
        (a, b) => a.value - b.value,
      );
}

/** Minutes between "HH:MM" times, for the slot count preview. */
function slotCount(opensAt: string, closesAt: string, slotMin: number): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Math.max(0, Math.floor((toMin(closesAt) - toMin(opensAt)) / slotMin));
}

export default function AdminSpacesPage() {
  const { spaces, space, setSpaceId, isOwner, reloadSpaces } = useAdmin();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Espaces & horaires"
        sub="Chaque espace a son propre calendrier, ses horaires et ses modes."
      />
      {!isOwner ? (
        <p className={styles.note}>Seul un administrateur peut modifier ces réglages.</p>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <section style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 className={styles.sectionTitle}>Espaces</h2>
          {spaces.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === space.id}
              onClick={() => setSpaceId(s.id)}
              className={styles.card}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 16,
                textAlign: 'left',
                font: 'inherit',
                cursor: 'pointer',
                ...(s.id === space.id
                  ? {
                      border: '2px solid var(--color-accent)',
                      background: 'var(--color-accent-soft)',
                    }
                  : {}),
              }}
            >
              <span
                style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' }}
              >
                <strong>{s.name}</strong>
                <span
                  className={cx(
                    styles.badge,
                    s.isActive ? styles.badge_success : styles.badge_neutral,
                  )}
                >
                  {s.isActive ? 'Actif' : 'Désactivé'}
                </span>
              </span>
              <span className={styles.cellSub}>
                {[s.inPersonEnabled && 'En studio', s.virtualEnabled && 'Virtuel']
                  .filter(Boolean)
                  .join(' + ')}
              </span>
            </button>
          ))}
          {isOwner ? (
            <button
              type="button"
              className={styles.btnSecondary}
              style={{ borderStyle: 'dashed', height: 56 }}
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" size={16} /> Ajouter un espace
            </button>
          ) : null}
        </section>
        <div
          style={{
            flex: '999 1 560px',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          <SpaceInfo
            key={`info-${space.id}`}
            space={space}
            canEdit={isOwner}
            onSaved={reloadSpaces}
          />
          <OpeningHours key={`hours-${space.id}`} space={space} canEdit={isOwner} />
          <Closures key={`closures-${space.id}`} space={space} canEdit={isOwner} />
        </div>
      </div>
      <NewSpaceDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (created) => {
          setCreating(false);
          await reloadSpaces();
          setSpaceId(created.id);
        }}
      />
    </>
  );
}

function SpaceInfo({
  space,
  canEdit,
  onSaved,
}: {
  space: AdminSpaceDto;
  canEdit: boolean;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [form, setForm] = useState(space);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AdminSpaceDto>(key: K, value: AdminSpaceDto[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const changed = JSON.stringify(form) !== JSON.stringify(space);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Indiquez le nom de l’espace.');
      return;
    }
    if (!form.inPersonEnabled && !form.virtualEnabled) {
      setError('Proposez au moins un mode\u00a0: en studio ou virtuel.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.updateSpace(space.id, {
        name: form.name.trim(),
        address: form.address?.trim() || null,
        inPersonEnabled: form.inPersonEnabled,
        virtualEnabled: form.virtualEnabled,
        minLeadMin: form.minLeadMin,
        horizonDays: form.horizonDays,
        holdDurationMin: form.holdDurationMin,
        fewSlotsThreshold: form.fewSlotsThreshold,
        isActive: form.isActive,
      });
      await onSaved();
      toast('Réglages enregistrés.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={cx(styles.card, styles.cardPad)} onSubmit={save}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Informations</h2>
        {canEdit && changed ? (
          <button type="submit" className={styles.btn} disabled={busy}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        ) : null}
      </div>
      <fieldset className={styles.fieldset} disabled={!canEdit} style={{ gap: 14 }}>
        <div className={styles.grid2}>
          <Field label="Nom de l’espace">
            {(p) => (
              <input
                {...p}
                className={styles.input}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            )}
          </Field>
          <Field label="Adresse (en studio)">
            {(p) => (
              <input
                {...p}
                className={styles.input}
                value={form.address ?? ''}
                placeholder="Rue, quartier, Lomé"
                onChange={(e) => set('address', e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Modes proposés</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <label className={styles.checkCard}>
              <input
                type="checkbox"
                checked={form.inPersonEnabled}
                onChange={(e) => set('inPersonEnabled', e.target.checked)}
              />
              En studio (Lomé)
            </label>
            <label className={styles.checkCard}>
              <input
                type="checkbox"
                checked={form.virtualEnabled}
                onChange={(e) => set('virtualEnabled', e.target.checked)}
              />
              Virtuel
            </label>
          </div>
        </div>
        <div className={styles.grid2}>
          <div className={styles.field}>
            <span className={styles.label}>Durée d’un créneau</span>
            <span className={styles.readonly}>{formatDuration(space.slotDurationMin)}</span>
          </div>
          <Field label="Réserver au plus tard">
            {(p) => (
              <select
                {...p}
                className={styles.select}
                value={form.minLeadMin}
                onChange={(e) => set('minLeadMin', Number(e.target.value))}
              >
                {withCurrent(LEAD_OPTIONS, form.minLeadMin, 'min avant').map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Ouvert à la réservation">
            {(p) => (
              <select
                {...p}
                className={styles.select}
                value={form.horizonDays}
                onChange={(e) => set('horizonDays', Number(e.target.value))}
              >
                {withCurrent(HORIZON_OPTIONS, form.horizonDays, 'jours à l’avance').map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Délai pour payer"
            hint="Les créneaux sont libérés si le client n’a pas payé à temps."
          >
            {(p) => (
              <select
                {...p}
                className={styles.select}
                value={form.holdDurationMin}
                onChange={(e) => set('holdDurationMin', Number(e.target.value))}
              >
                {Array.from({ length: 14 }, (_, i) => i + 2).map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label="Afficher «&nbsp;presque complet&nbsp;»"
            hint="Dans le calendrier des clients."
          >
            {(p) => (
              <select
                {...p}
                className={styles.select}
                value={form.fewSlotsThreshold}
                onChange={(e) => set('fewSlotsThreshold', Number(e.target.value))}
              >
                <option value={0}>Jamais</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    Dès {n} créneau{n > 1 ? 'x' : ''} restant{n > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
          />
          Espace ouvert aux réservations en ligne
        </label>
      </fieldset>
      {error ? (
        <div className={styles.banner} role="alert">
          {error}
        </div>
      ) : null}
    </form>
  );
}

function OpeningHours({ space, canEdit }: { space: AdminSpaceDto; canEdit: boolean }) {
  const toast = useToast();
  const hours = useAsync(() => adminApi.openingHours(space.id), `hours-${space.id}`);
  const [rows, setRows] = useState<OpeningHoursDayDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hours.data) setRows(hours.data);
  }, [hours.data]);

  const changed = rows && hours.data && JSON.stringify(rows) !== JSON.stringify(hours.data);
  const update = (weekday: number, patch: Partial<OpeningHoursDayDto>) =>
    setRows((list) => list?.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)) ?? null);

  async function save() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await adminApi.updateOpeningHours(space.id, {
        days: rows.map(({ weekday, isOpen, opensAt, closesAt }) => ({
          weekday,
          isOpen,
          opensAt,
          closesAt,
        })),
      });
      hours.setData(saved);
      toast('Horaires enregistrés.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cx(styles.card, styles.cardPad)}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Horaires d’ouverture</h2>
        <span className={styles.cellSub}>
          Les créneaux sont générés automatiquement toutes les{' '}
          {formatDuration(space.slotDurationMin)}.
        </span>
      </div>
      {hours.error ? (
        <LoadError error={hours.error} onRetry={hours.reload} />
      ) : !rows ? (
        <Loading />
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table} style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Jour</th>
                  <th>Ouvert</th>
                  <th>Ouverture</th>
                  <th>Fermeture</th>
                  <th>Créneaux</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const n = r.isOpen ? slotCount(r.opensAt, r.closesAt, space.slotDurationMin) : 0;
                  const day = WEEKDAYS[r.weekday - 1]!;
                  return (
                    <tr key={r.weekday}>
                      <td style={{ fontWeight: 600 }}>{day}</td>
                      <td>
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={`${day} ouvert`}
                          checked={r.isOpen}
                          disabled={!canEdit}
                          onChange={(e) => update(r.weekday, { isOpen: e.target.checked })}
                          style={{ width: 20, height: 20, accentColor: 'var(--color-accent)' }}
                        />
                      </td>
                      <td>
                        <TimeSelect
                          aria-label={`${day} : ouverture`}
                          style={{ height: 38, width: 110 }}
                          value={r.opensAt}
                          disabled={!canEdit || !r.isOpen}
                          onChange={(v) => update(r.weekday, { opensAt: v })}
                        />
                      </td>
                      <td>
                        <TimeSelect
                          aria-label={`${day} : fermeture`}
                          style={{ height: 38, width: 110 }}
                          value={r.closesAt}
                          disabled={!canEdit || !r.isOpen}
                          onChange={(v) => update(r.weekday, { closesAt: v })}
                        />
                      </td>
                      <td className={styles.muted}>
                        {r.isOpen ? `${n} créneau${n > 1 ? 'x' : ''}` : 'Fermé'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {error ? (
            <div
              className={styles.banner}
              role="alert"
              style={{ flexDirection: 'column', alignItems: 'flex-start' }}
            >
              <span>{errorMessage(error)}</span>
              <ConflictList error={error} />
            </div>
          ) : null}
          {canEdit && changed ? (
            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={save} disabled={busy}>
                {busy ? 'Enregistrement…' : 'Enregistrer les horaires'}
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => {
                  setRows(hours.data ?? null);
                  setError(null);
                }}
              >
                Annuler
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function Closures({ space, canEdit }: { space: AdminSpaceDto; canEdit: boolean }) {
  const toast = useToast();
  const closures = useAsync(() => adminApi.closures(space.id), `closures-${space.id}`);
  const [adding, setAdding] = useState(false);

  async function remove(c: ClosureDto) {
    try {
      await adminApi.deleteClosure(c.id);
      closures.reload();
      toast('Fermeture supprimée\u00a0: les créneaux sont de nouveau réservables.');
    } catch (err) {
      toast(errorMessage(err), true);
    }
  }

  return (
    <section className={cx(styles.card, styles.cardPad)}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Fermetures exceptionnelles</h2>
        {canEdit ? (
          <button type="button" className={styles.btnSecondary} onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> Ajouter une fermeture
          </button>
        ) : null}
      </div>
      {closures.error ? (
        <LoadError error={closures.error} onRetry={closures.reload} />
      ) : !closures.data ? (
        <Loading />
      ) : closures.data.length === 0 ? (
        <p className={styles.note}>Aucune fermeture prévue.</p>
      ) : (
        closures.data.map((c) => (
          <div
            key={c.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 14px',
              borderRadius: 10,
              background: 'var(--color-ground)',
            }}
          >
            <span className={styles.cellStack}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {c.startDate === c.endDate
                  ? formatLongDate(c.startDate, true)
                  : `Du ${formatLongDate(c.startDate)} au ${formatLongDate(c.endDate, true)}`}
              </span>
              <span className={styles.cellSub}>
                {c.allDay ? 'Journée entière' : `${c.startTime} – ${c.endTime}`}
                {c.reason ? ` · ${c.reason}` : ''}
              </span>
            </span>
            {canEdit ? (
              <button
                type="button"
                className={styles.iconBtn}
                aria-label="Supprimer la fermeture"
                onClick={() => remove(c)}
              >
                <Icon name="trash" size={16} />
              </button>
            ) : null}
          </div>
        ))
      )}
      <ClosureDialog
        open={adding}
        space={space}
        onClose={() => setAdding(false)}
        onCreated={() => {
          setAdding(false);
          closures.reload();
          toast('Fermeture ajoutée.');
        }}
      />
    </section>
  );
}

function ClosureDialog({
  open,
  space,
  onClose,
  onCreated,
}: {
  open: boolean;
  space: AdminSpaceDto;
  onClose: () => void;
  onCreated: () => void;
}) {
  const today = todayIn(space.timezone);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('12:00');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStartDate(today);
    setEndDate(today);
    setAllDay(true);
    setReason('');
    setError(null);
  }, [open, today]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.createClosure(space.id, {
        startDate,
        endDate: endDate < startDate ? startDate : endDate,
        ...(allDay ? {} : { startTime, endTime }),
        reason: reason.trim() || null,
      });
      onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="modal"
      title="Ajouter une fermeture"
      footer={
        <>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="closure-form" className={styles.btn} disabled={busy}>
            {busy ? 'Enregistrement…' : 'Ajouter'}
          </button>
        </>
      }
    >
      <form id="closure-form" className={styles.section} onSubmit={submit} noValidate>
        <div className={styles.grid2}>
          <Field label="Du">
            {(p) => (
              <input
                {...p}
                type="date"
                min={today}
                className={styles.input}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            )}
          </Field>
          <Field label="Au (inclus)">
            {(p) => (
              <input
                {...p}
                type="date"
                min={startDate}
                className={styles.input}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            )}
          </Field>
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          Journée entière
        </label>
        {!allDay ? (
          <div className={styles.grid2}>
            <Field label="De">
              {(p) => <TimeSelect {...p} value={startTime} onChange={setStartTime} />}
            </Field>
            <Field label="À">
              {(p) => <TimeSelect {...p} value={endTime} onChange={setEndTime} />}
            </Field>
          </div>
        ) : null}
        <Field label="Motif (facultatif)">
          {(p) => (
            <input
              {...p}
              className={styles.input}
              value={reason}
              placeholder="Jour férié, travaux…"
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <p className={styles.note}>Les clients verront ces jours ou ces heures comme fermés.</p>
        {error ? (
          <div
            className={styles.banner}
            role="alert"
            style={{ flexDirection: 'column', alignItems: 'flex-start' }}
          >
            <span>{errorMessage(error)}</span>
            <ConflictList error={error} />
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}

function NewSpaceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (space: AdminSpaceDto) => void;
}) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [inPerson, setInPerson] = useState(true);
  const [virtual, setVirtual] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setAddress('');
    setInPerson(true);
    setVirtual(true);
    setError(null);
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Indiquez le nom de l’espace.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await adminApi.createSpace({
          name: name.trim(),
          address: address.trim() || null,
          inPersonEnabled: inPerson,
          virtualEnabled: virtual,
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="modal"
      title="Ajouter un espace"
      footer={
        <>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="space-form" className={styles.btn} disabled={busy}>
            {busy ? 'Création…' : 'Créer l’espace'}
          </button>
        </>
      }
    >
      <form id="space-form" className={styles.section} onSubmit={submit} noValidate>
        <Field label="Nom">
          {(p) => (
            <input
              {...p}
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Adresse (facultatif)">
          {(p) => (
            <input
              {...p}
              className={styles.input}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          )}
        </Field>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={inPerson}
            onChange={(e) => setInPerson(e.target.checked)}
          />
          En studio
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={virtual} onChange={(e) => setVirtual(e.target.checked)} />
          Virtuel
        </label>
        <p className={styles.note}>
          Le nouvel espace est ouvert de 08:00 à 21:30 tous les jours. Ajoutez ensuite ses forfaits
          et ses prix&nbsp;: les clients ne peuvent pas réserver tant qu’il n’a pas de prix. Le site
          de réservation affiche aujourd’hui un seul espace (le studio principal).
        </p>
        {error ? (
          <div className={styles.banner} role="alert">
            {error}
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
