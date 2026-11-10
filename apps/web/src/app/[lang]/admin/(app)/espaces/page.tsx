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
import { useI18n, type T, type TKey } from '@/i18n/I18nProvider';
import { adminApi } from '@/lib/admin-api';
import { todayIn } from '@/lib/admin-format';
import { formatDuration, formatLongDate, weekdayNames } from '@/lib/dates';

const LEAD_OPTIONS = [0, 30, 60, 120, 240, 720, 1440, 2880];
const HORIZON_OPTIONS = [14, 30, 60, 90, 180, 365];

/** The usual choices, plus the current value if it is another one. */
function withCurrent(
  options: number[],
  current: number,
  label: (n: number) => string,
): Array<{ value: number; label: string }> {
  const values = options.includes(current) ? options : [...options, current].sort((a, b) => a - b);
  return values.map((value) => ({ value, label: label(value) }));
}

const leadLabel = (t: T) => (n: number) =>
  LEAD_OPTIONS.includes(n) ? t(`spaces.lead.${n}` as TKey) : t('spaces.leadOther', { n });
const horizonLabel = (t: T) => (n: number) =>
  HORIZON_OPTIONS.includes(n) ? t(`spaces.horizon.${n}` as TKey) : t('spaces.horizonOther', { n });

/** Minutes between "HH:MM" times, for the slot count preview. */
function slotCount(opensAt: string, closesAt: string, slotMin: number): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Math.max(0, Math.floor((toMin(closesAt) - toMin(opensAt)) / slotMin));
}

export default function AdminSpacesPage() {
  const { spaces, space, setSpaceId, isOwner, reloadSpaces } = useAdmin();
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader title={t('spaces.title')} sub={t('spaces.sub')} />
      {!isOwner ? <p className={styles.note}>{t('spaces.ownerOnly')}</p> : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <section style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 className={styles.sectionTitle}>{t('spaces.list')}</h2>
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
                  {s.isActive ? t('spaces.active') : t('spaces.inactive')}
                </span>
              </span>
              <span className={styles.cellSub}>
                {[
                  s.inPersonEnabled && t('spaces.inPerson'),
                  s.virtualEnabled && t('spaces.virtual'),
                ]
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
              <Icon name="plus" size={16} /> {t('spaces.add')}
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
  const { t } = useI18n();
  const [form, setForm] = useState(space);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AdminSpaceDto>(key: K, value: AdminSpaceDto[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const changed = JSON.stringify(form) !== JSON.stringify(space);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError(t('spaces.nameRequired'));
      return;
    }
    if (!form.inPersonEnabled && !form.virtualEnabled) {
      setError(t('spaces.oneMode'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.updateSpace(space.id, {
        name: form.name.trim(),
        nameEn: form.nameEn?.trim() || null,
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
      toast(t('spaces.saved'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={cx(styles.card, styles.cardPad)} onSubmit={save}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>{t('spaces.info')}</h2>
        {canEdit && changed ? (
          <button type="submit" className={styles.btn} disabled={busy}>
            {busy ? t('spaces.saving') : t('spaces.save')}
          </button>
        ) : null}
      </div>
      <fieldset className={styles.fieldset} disabled={!canEdit} style={{ gap: 14 }}>
        <div className={styles.grid2}>
          <Field label={t('spaces.name')}>
            {(p) => (
              <input
                {...p}
                className={styles.input}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('spaces.nameEn')}>
            {(p) => (
              <input
                {...p}
                lang="en"
                maxLength={120}
                className={styles.input}
                value={form.nameEn ?? ''}
                onChange={(e) => set('nameEn', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('spaces.address')}>
            {(p) => (
              <input
                {...p}
                className={styles.input}
                value={form.address ?? ''}
                placeholder={t('spaces.addressPlaceholder')}
                onChange={(e) => set('address', e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className={styles.field}>
          <span className={styles.label}>{t('spaces.modes')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <label className={styles.checkCard}>
              <input
                type="checkbox"
                checked={form.inPersonEnabled}
                onChange={(e) => set('inPersonEnabled', e.target.checked)}
              />
              {t('spaces.inPersonLome')}
            </label>
            <label className={styles.checkCard}>
              <input
                type="checkbox"
                checked={form.virtualEnabled}
                onChange={(e) => set('virtualEnabled', e.target.checked)}
              />
              {t('spaces.virtual')}
            </label>
          </div>
        </div>
        <div className={styles.grid2}>
          <div className={styles.field}>
            <span className={styles.label}>{t('spaces.slotLength')}</span>
            <span className={styles.readonly}>{formatDuration(space.slotDurationMin)}</span>
          </div>
          <Field label={t('spaces.latest')}>
            {(p) => (
              <select
                {...p}
                className={styles.select}
                value={form.minLeadMin}
                onChange={(e) => set('minLeadMin', Number(e.target.value))}
              >
                {withCurrent(LEAD_OPTIONS, form.minLeadMin, leadLabel(t)).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('spaces.open')}>
            {(p) => (
              <select
                {...p}
                className={styles.select}
                value={form.horizonDays}
                onChange={(e) => set('horizonDays', Number(e.target.value))}
              >
                {withCurrent(HORIZON_OPTIONS, form.horizonDays, horizonLabel(t)).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('spaces.hold')} hint={t('spaces.holdHint')}>
            {(p) => (
              <select
                {...p}
                className={styles.select}
                value={form.holdDurationMin}
                onChange={(e) => set('holdDurationMin', Number(e.target.value))}
              >
                {Array.from({ length: 14 }, (_, i) => i + 2).map((m) => (
                  <option key={m} value={m}>
                    {t('spaces.minutes', { n: m })}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('spaces.few')} hint={t('spaces.fewHint')}>
            {(p) => (
              <select
                {...p}
                className={styles.select}
                value={form.fewSlotsThreshold}
                onChange={(e) => set('fewSlotsThreshold', Number(e.target.value))}
              >
                <option value={0}>{t('spaces.never')}</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {t('spaces.fewFrom', { count: n })}
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
          {t('spaces.online')}
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
  const { t, locale } = useI18n();
  const weekdays = weekdayNames(locale);
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
      toast(t('spaces.hoursSaved'));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cx(styles.card, styles.cardPad)}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>{t('spaces.hours')}</h2>
        <span className={styles.cellSub}>
          {t('spaces.hoursSub', { length: formatDuration(space.slotDurationMin) })}
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
                  <th>{t('spaces.colDay')}</th>
                  <th>{t('spaces.colOpen')}</th>
                  <th>{t('spaces.colOpens')}</th>
                  <th>{t('spaces.colCloses')}</th>
                  <th>{t('spaces.colSlots')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const n = r.isOpen ? slotCount(r.opensAt, r.closesAt, space.slotDurationMin) : 0;
                  const day = weekdays[r.weekday - 1]!;
                  return (
                    <tr key={r.weekday}>
                      <td style={{ fontWeight: 600 }}>{day}</td>
                      <td>
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={t('spaces.dayOpen', { day })}
                          checked={r.isOpen}
                          disabled={!canEdit}
                          onChange={(e) => update(r.weekday, { isOpen: e.target.checked })}
                          style={{ width: 20, height: 20, accentColor: 'var(--color-accent)' }}
                        />
                      </td>
                      <td>
                        <TimeSelect
                          aria-label={t('spaces.dayOpens', { day })}
                          style={{ height: 38, width: 110 }}
                          value={r.opensAt}
                          disabled={!canEdit || !r.isOpen}
                          onChange={(v) => update(r.weekday, { opensAt: v })}
                        />
                      </td>
                      <td>
                        <TimeSelect
                          aria-label={t('spaces.dayCloses', { day })}
                          style={{ height: 38, width: 110 }}
                          value={r.closesAt}
                          disabled={!canEdit || !r.isOpen}
                          onChange={(v) => update(r.weekday, { closesAt: v })}
                        />
                      </td>
                      <td className={styles.muted}>
                        {r.isOpen ? t('spaces.slots', { count: n }) : t('spaces.closed')}
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
                {busy ? t('spaces.saving') : t('spaces.saveHours')}
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => {
                  setRows(hours.data ?? null);
                  setError(null);
                }}
              >
                {t('spaces.cancel')}
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
  const { t, locale } = useI18n();
  const closures = useAsync(() => adminApi.closures(space.id), `closures-${space.id}`);
  const [adding, setAdding] = useState(false);

  async function remove(c: ClosureDto) {
    try {
      await adminApi.deleteClosure(c.id);
      closures.reload();
      toast(t('spaces.closureRemoved'));
    } catch (err) {
      toast(errorMessage(err), true);
    }
  }

  return (
    <section className={cx(styles.card, styles.cardPad)}>
      <div className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>{t('spaces.closures')}</h2>
        {canEdit ? (
          <button type="button" className={styles.btnSecondary} onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> {t('spaces.addClosure')}
          </button>
        ) : null}
      </div>
      {closures.error ? (
        <LoadError error={closures.error} onRetry={closures.reload} />
      ) : !closures.data ? (
        <Loading />
      ) : closures.data.length === 0 ? (
        <p className={styles.note}>{t('spaces.noClosures')}</p>
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
                  ? formatLongDate(c.startDate, true, locale)
                  : t('spaces.fromTo', {
                      from: formatLongDate(c.startDate, false, locale),
                      to: formatLongDate(c.endDate, true, locale),
                    })}
              </span>
              <span className={styles.cellSub}>
                {c.allDay ? t('spaces.allDay') : `${c.startTime} – ${c.endTime}`}
                {c.reason ? ` · ${c.reason}` : ''}
              </span>
            </span>
            {canEdit ? (
              <button
                type="button"
                className={styles.iconBtn}
                aria-label={t('spaces.removeClosure')}
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
          toast(t('spaces.closureAdded'));
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
  const { t } = useI18n();
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
      title={t('spaces.addClosure')}
      footer={
        <>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            {t('spaces.cancel')}
          </button>
          <button type="submit" form="closure-form" className={styles.btn} disabled={busy}>
            {busy ? t('spaces.saving') : t('spaces.adding')}
          </button>
        </>
      }
    >
      <form id="closure-form" className={styles.section} onSubmit={submit} noValidate>
        <div className={styles.grid2}>
          <Field label={t('spaces.from')}>
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
          <Field label={t('spaces.toIncl')}>
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
          {t('spaces.allDay')}
        </label>
        {!allDay ? (
          <div className={styles.grid2}>
            <Field label={t('spaces.timeFrom')}>
              {(p) => <TimeSelect {...p} value={startTime} onChange={setStartTime} />}
            </Field>
            <Field label={t('spaces.timeTo')}>
              {(p) => <TimeSelect {...p} value={endTime} onChange={setEndTime} />}
            </Field>
          </div>
        ) : null}
        <Field label={t('spaces.reason')}>
          {(p) => (
            <input
              {...p}
              className={styles.input}
              value={reason}
              placeholder={t('spaces.reasonPlaceholder')}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
        <p className={styles.note}>{t('spaces.closureNote')}</p>
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
  const { t } = useI18n();
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
      setError(t('spaces.nameRequired'));
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
      title={t('spaces.add')}
      footer={
        <>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            {t('spaces.cancel')}
          </button>
          <button type="submit" form="space-form" className={styles.btn} disabled={busy}>
            {busy ? t('spaces.creating') : t('spaces.create')}
          </button>
        </>
      }
    >
      <form id="space-form" className={styles.section} onSubmit={submit} noValidate>
        <Field label={t('spaces.nameShort')}>
          {(p) => (
            <input
              {...p}
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('spaces.addressOptional')}>
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
          {t('spaces.inPerson')}
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={virtual} onChange={(e) => setVirtual(e.target.checked)} />
          {t('spaces.virtual')}
        </label>
        <p className={styles.note}>{t('spaces.newNote')}</p>
        {error ? (
          <div className={styles.banner} role="alert">
            {error}
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
