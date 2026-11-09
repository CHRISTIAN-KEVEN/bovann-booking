'use client';

import {
  formatXof,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS_FR,
  type AdminBookingDetail,
  type AdminDayOptionsResponse,
  type PaymentMethod,
  type SessionMode,
} from '@bovann/shared';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import {
  formatAmountInput,
  parseAmount,
  SESSION_MODE_LABELS_FR,
  todayIn,
} from '@/lib/admin-format';
import { COUNTRY_CODES, composePhone, isValidE164, SECTORS } from '@/lib/details';
import { useAdmin } from './AdminShell';
import {
  AmountInput,
  cx,
  Dialog,
  errorMessage,
  Field,
  Loading,
  Segmented,
  adminStyles as styles,
  useToast,
} from './ui';

export interface NewBookingPreset {
  date: string;
  slotStart?: string;
}

type Kind = 'SLOTS' | 'PACKAGE';

/**
 * A booking the studio takes itself (phone call, walk-in). Confirmed at once;
 * uses the same calendar as online bookings, so a slot can't be taken twice.
 */
export function NewBookingDialog({
  preset,
  onClose,
  onCreated,
}: {
  preset: NewBookingPreset | null;
  onClose: () => void;
  onCreated: (booking: AdminBookingDetail) => void;
}) {
  const { space } = useAdmin();
  const toast = useToast();
  const modes = useMemo<SessionMode[]>(
    () => [
      ...(space.inPersonEnabled ? (['IN_PERSON'] as const) : []),
      ...(space.virtualEnabled ? (['VIRTUAL'] as const) : []),
    ],
    [space],
  );

  const [date, setDate] = useState('');
  const [mode, setMode] = useState<SessionMode>('IN_PERSON');
  const [kind, setKind] = useState<Kind>('SLOTS');
  const [options, setOptions] = useState<AdminDayOptionsResponse | null>(null);
  const [optionsError, setOptionsError] = useState<unknown>(null);
  const [optionsTick, setOptionsTick] = useState(0);
  const [slots, setSlots] = useState<string[]>([]);
  const [packageCode, setPackageCode] = useState('');
  const [packageStart, setPackageStart] = useState('');

  const [countryCode, setCountryCode] = useState('+228');
  const [localPhone, setLocalPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessSector, setBusinessSector] = useState('');
  const [email, setEmail] = useState('');
  const [liveDescription, setLiveDescription] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [known, setKnown] = useState(false);

  const [negotiated, setNegotiated] = useState(false);
  const [price, setPrice] = useState('');
  const [paid, setPaid] = useState(true);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [channel, setChannel] = useState('TMONEY');

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset the form each time it opens.
  useEffect(() => {
    if (!preset) return;
    setDate(preset.date);
    setMode(modes[0] ?? 'IN_PERSON');
    setKind('SLOTS');
    setSlots(preset.slotStart ? [preset.slotStart] : []);
    setPackageCode('');
    setPackageStart('');
    setCountryCode('+228');
    setLocalPhone('');
    setFullName('');
    setBusinessName('');
    setBusinessSector('');
    setEmail('');
    setLiveDescription('');
    setAdminNote('');
    setKnown(false);
    setNegotiated(false);
    setPrice('');
    setPaid(true);
    setMethod('CASH');
    setErrors({});
    setSubmitError(null);
  }, [preset, modes]);

  useEffect(() => {
    if (!preset || !date) return;
    let cancelled = false;
    setOptions(null);
    setOptionsError(null);
    adminApi.dayOptions(space.id, date, mode).then(
      (o) => !cancelled && setOptions(o),
      (err: unknown) => !cancelled && setOptionsError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [preset, date, mode, space.id, optionsTick]);

  const selectedPackage = options?.packages.find((p) => p.code === packageCode) ?? null;
  const catalog = useMemo(() => {
    if (!options) return null;
    if (kind === 'SLOTS') {
      const n = slots.length;
      return n ? { list: n * options.unitPriceXof, total: n * options.unitPriceXof } : null;
    }
    return selectedPackage && packageStart
      ? { list: selectedPackage.listPriceXof, total: selectedPackage.totalXof }
      : null;
  }, [options, kind, slots, selectedPackage, packageStart]);

  const total = negotiated ? parseAmount(price) : (catalog?.total ?? null);

  function toggleSlot(start: string) {
    setSlots((list) => (list.includes(start) ? list.filter((s) => s !== start) : [...list, start]));
  }

  async function lookup() {
    const phone = composePhone(countryCode, localPhone);
    if (!isValidE164(phone)) return;
    try {
      const { customer } = await adminApi.lookupCustomer(phone);
      if (customer) {
        setKnown(true);
        setFullName((v) => v || customer.fullName);
        setBusinessName((v) => v || customer.businessName);
        setBusinessSector((v) => v || customer.businessSector);
        setEmail((v) => v || (customer.email ?? ''));
      } else {
        setKnown(false);
      }
    } catch {
      /* the lookup only pre-fills; ignore failures */
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const phone = composePhone(countryCode, localPhone);
    const next: Record<string, string> = {};
    if (kind === 'SLOTS' && slots.length === 0) next.selection = 'Choisissez au moins un créneau.';
    if (kind === 'PACKAGE' && (!packageCode || !packageStart))
      next.selection = 'Choisissez un forfait et son heure de début.';
    if (!isValidE164(phone)) next.phone = 'Numéro de téléphone invalide.';
    if (!fullName.trim()) next.fullName = 'Le nom est obligatoire.';
    if (!businessName.trim()) next.businessName = 'Le nom de l’entreprise est obligatoire.';
    if (!businessSector) next.businessSector = 'Choisissez le secteur.';
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      next.email = 'Adresse e-mail invalide.';
    if (negotiated && (total === null || (catalog && total > catalog.list)))
      next.price = catalog
        ? `Indiquez un montant entre 0 et ${formatXof(catalog.list)}.`
        : 'Montant invalide.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setBusy(true);
    setSubmitError(null);
    try {
      const created = await adminApi.createBooking({
        spaceId: space.id,
        mode,
        selection:
          kind === 'SLOTS'
            ? { type: 'SLOTS', slotStarts: slots }
            : { type: 'PACKAGE', packageCode, start: packageStart },
        customer: {
          fullName: fullName.trim(),
          phone,
          email: email.trim() || null,
          businessName: businessName.trim(),
          businessSector,
        },
        liveDescription: liveDescription.trim() || null,
        adminNote: adminNote.trim() || null,
        ...(negotiated && total !== null ? { totalXof: total } : {}),
        payment: paid
          ? { status: 'PAID', method, channel: method === 'MOBILE_MONEY' ? channel : null }
          : { status: 'UNPAID' },
      });
      toast(`Réservation ${created.reference} confirmée.`);
      onCreated(created);
    } catch (err) {
      setSubmitError(errorMessage(err));
      if ((err as { status?: number }).status === 409) {
        setSlots([]);
        setPackageStart('');
        setOptionsTick((t) => t + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  const minDate = todayIn(space.timezone);

  return (
    <Dialog
      open={preset !== null}
      onClose={onClose}
      title="Nouvelle réservation"
      footer={
        <>
          <span className={styles.muted} style={{ marginRight: 'auto', alignSelf: 'center' }}>
            {total !== null && catalog ? (total === 0 ? 'Gratuit' : formatXof(total)) : ''}
          </span>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="new-booking" className={styles.btn} disabled={busy}>
            {busy ? 'Enregistrement…' : 'Confirmer la réservation'}
          </button>
        </>
      }
    >
      <form
        id="new-booking"
        className={styles.section}
        onSubmit={submit}
        noValidate
        style={{ gap: 18 }}
      >
        {submitError ? (
          <div className={styles.banner} role="alert">
            {submitError}
          </div>
        ) : null}

        <div className={styles.grid2}>
          <Field label="Date">
            {(p) => (
              <input
                {...p}
                type="date"
                className={styles.input}
                min={minDate}
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setSlots([]);
                  setPackageStart('');
                }}
              />
            )}
          </Field>
          {modes.length > 1 ? (
            <div className={styles.field}>
              <span className={styles.label}>Mode</span>
              <Segmented
                label="Mode"
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  setSlots([]);
                  setPackageStart('');
                }}
                options={modes.map((m) => ({ value: m, label: SESSION_MODE_LABELS_FR[m] }))}
              />
            </div>
          ) : null}
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Formule</span>
          <Segmented
            label="Formule"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'SLOTS', label: 'Créneaux' },
              { value: 'PACKAGE', label: 'Forfait' },
            ]}
          />
        </div>

        {optionsError ? (
          <div className={styles.banner} role="alert">
            {errorMessage(optionsError)}
          </div>
        ) : !options ? (
          <Loading label="Chargement des disponibilités…" />
        ) : kind === 'SLOTS' ? (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>
              Créneaux ({formatXof(options.unitPriceXof)} l’unité)
            </legend>
            {options.slots.length === 0 ? (
              <p className={styles.note}>Le studio est fermé ce jour-là.</p>
            ) : (
              <div className={styles.chips}>
                {options.slots.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    className={styles.chip}
                    aria-pressed={slots.includes(s.start)}
                    disabled={!s.available}
                    onClick={() => toggleSlot(s.start)}
                  >
                    {s.startTime}–{s.endTime}
                  </button>
                ))}
              </div>
            )}
            {errors.selection ? <span className={styles.error}>{errors.selection}</span> : null}
          </fieldset>
        ) : (
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Forfait</legend>
            <div className={styles.chips}>
              {options.packages
                .filter((p) => p.slotCount > 1)
                .map((p) => (
                  <button
                    key={p.code}
                    type="button"
                    className={styles.chip}
                    aria-pressed={p.code === packageCode}
                    disabled={p.startOptions.length === 0}
                    onClick={() => {
                      setPackageCode(p.code);
                      setPackageStart('');
                    }}
                  >
                    {p.name} · {formatXof(p.totalXof)}
                  </button>
                ))}
            </div>
            {selectedPackage ? (
              <>
                <span className={styles.label}>Heure de début</span>
                <div className={styles.chips}>
                  {selectedPackage.startOptions.map((o) => (
                    <button
                      key={o.start}
                      type="button"
                      className={styles.chip}
                      aria-pressed={o.start === packageStart}
                      onClick={() => setPackageStart(o.start)}
                    >
                      {o.startTime}–{o.endTime}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            {errors.selection ? <span className={styles.error}>{errors.selection}</span> : null}
          </fieldset>
        )}

        <h3 className={styles.sectionTitle}>Client</h3>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="nb-phone">
            Téléphone
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              aria-label="Indicatif"
              className={styles.select}
              style={{ width: 140, flexShrink: 0 }}
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
            >
              {COUNTRY_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              id="nb-phone"
              className={cx(styles.input, errors.phone && styles.inputInvalid)}
              inputMode="tel"
              autoComplete="off"
              value={localPhone}
              onChange={(e) => setLocalPhone(e.target.value)}
              onBlur={lookup}
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby="nb-phone-help"
            />
          </div>
          <span id="nb-phone-help" className={errors.phone ? styles.error : styles.hint}>
            {errors.phone ??
              (known
                ? 'Client connu\u00a0: coordonnées pré-remplies.'
                : 'Un client déjà venu est reconnu par son numéro.')}
          </span>
        </div>
        <div className={styles.grid2}>
          <Field label="Nom complet" error={errors.fullName}>
            {(p) => (
              <input
                {...p}
                className={styles.input}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            )}
          </Field>
          <Field label="E-mail (facultatif)" error={errors.email}>
            {(p) => (
              <input
                {...p}
                type="email"
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Entreprise" error={errors.businessName}>
            {(p) => (
              <input
                {...p}
                className={styles.input}
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Secteur d’activité" error={errors.businessSector}>
            {(p) => (
              <select
                {...p}
                className={styles.select}
                value={businessSector}
                onChange={(e) => setBusinessSector(e.target.value)}
              >
                <option value="">Choisir…</option>
                {[...new Set([...SECTORS, ...(businessSector ? [businessSector] : [])])].map(
                  (s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ),
                )}
              </select>
            )}
          </Field>
        </div>
        <Field label="Le live (facultatif)">
          {(p) => (
            <textarea
              {...p}
              className={styles.textarea}
              value={liveDescription}
              onChange={(e) => setLiveDescription(e.target.value)}
            />
          )}
        </Field>

        <h3 className={styles.sectionTitle}>Prix et paiement</h3>
        {catalog ? (
          <p className={styles.note}>
            Prix catalogue&nbsp;: <strong>{formatXof(catalog.total)}</strong>
            {catalog.list > catalog.total
              ? ` (au lieu de ${formatXof(catalog.list)} à l’unité)`
              : ''}
          </p>
        ) : null}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={negotiated}
            onChange={(e) => {
              setNegotiated(e.target.checked);
              setPrice(formatAmountInput(catalog?.total ?? null));
            }}
          />
          Prix négocié ou gratuit
        </label>
        {negotiated ? (
          <Field label="Prix convenu" hint="0 pour une séance offerte." error={errors.price}>
            {(p) => <AmountInput {...p} value={price} onChange={setPrice} />}
          </Field>
        ) : null}
        {total === 0 ? (
          <p className={styles.note}>Séance offerte&nbsp;: aucun paiement à enregistrer.</p>
        ) : (
          <>
            <Segmented
              label="Paiement"
              value={paid ? 'PAID' : 'UNPAID'}
              onChange={(v) => setPaid(v === 'PAID')}
              options={[
                { value: 'PAID', label: 'Déjà payé' },
                { value: 'UNPAID', label: 'À encaisser plus tard' },
              ]}
            />
            {paid ? (
              <div className={styles.grid2}>
                <Field label="Moyen de paiement">
                  {(p) => (
                    <select
                      {...p}
                      className={styles.select}
                      value={method}
                      onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {PAYMENT_METHOD_LABELS_FR[m]}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                {method === 'MOBILE_MONEY' ? (
                  <Field label="Opérateur">
                    {(p) => (
                      <select
                        {...p}
                        className={styles.select}
                        value={channel}
                        onChange={(e) => setChannel(e.target.value)}
                      >
                        <option value="TMONEY">T-Money</option>
                        <option value="FLOOZ">Flooz</option>
                        <option value="OTHER">Autre</option>
                      </select>
                    )}
                  </Field>
                ) : null}
              </div>
            ) : null}
          </>
        )}
        <Field label="Note interne (facultatif)">
          {(p) => (
            <textarea
              {...p}
              className={styles.textarea}
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
