'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useFlow } from '@/components/FlowProvider';
import { SelectionCard } from '@/components/SelectionCard';
import {
  Alert,
  Body,
  BottomBar,
  PageTitle,
  Screen,
  StepHeader,
  buttonClass,
} from '@/components/ui';
import {
  COUNTRY_CODES,
  SECTORS,
  composePhone,
  splitPhone,
  validateDetails,
  type DetailsErrors,
} from '@/lib/details';
import type { CustomerDetails } from '@/lib/flow';
import { useStepGuard } from '@/lib/useStepGuard';
import styles from './page.module.css';

const EMPTY: CustomerDetails = {
  fullName: '',
  phone: '',
  email: '',
  businessName: '',
  businessSector: '',
  liveDescription: '',
  acceptTerms: false,
};

/** Screen 4: who is booking (business details required, email optional). */
export default function DetailsPage() {
  const allowed = useStepGuard('/reserver/informations');
  const { flow } = useFlow();
  // Render the form only once saved progress is loaded, so it starts pre-filled.
  if (!allowed || !flow.summary || !flow.date || !flow.mode) return null;
  return <DetailsForm />;
}

function DetailsForm() {
  const router = useRouter();
  const { flow, update } = useFlow();
  const initial = flow.details ?? EMPTY;
  const initialPhone = initial.phone
    ? splitPhone(initial.phone)
    : { countryCode: '+228', local: '' };

  const [form, setForm] = useState<CustomerDetails>(initial);
  const [countryCode, setCountryCode] = useState(initialPhone.countryCode);
  const [localPhone, setLocalPhone] = useState(initialPhone.local);
  const [errors, setErrors] = useState<DetailsErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const set = <K extends keyof CustomerDetails>(key: K, value: CustomerDetails[K]) => {
    const next = { ...form, [key]: value };
    setForm(next);
    if (submitted)
      setErrors(validateDetails({ ...next, phone: composePhone(countryCode, localPhone) }));
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    const details: CustomerDetails = {
      ...form,
      fullName: form.fullName.trim(),
      email: form.email.trim(),
      businessName: form.businessName.trim(),
      liveDescription: form.liveDescription.trim(),
      phone: composePhone(countryCode, localPhone),
    };
    const found = validateDetails(details);
    setErrors(found);
    setSubmitted(true);
    if (Object.keys(found).length > 0) {
      const first = Object.keys(found)[0];
      document.getElementById(`field-${first}`)?.focus();
      return;
    }
    update({ details });
    router.push('/reserver/paiement');
  }

  const err = (key: keyof CustomerDetails) =>
    errors[key] ? (
      <span id={`error-${key}`} className={styles.error}>
        {errors[key]}
      </span>
    ) : null;
  const describedBy = (key: keyof CustomerDetails, hint?: string) =>
    [errors[key] ? `error-${key}` : null, hint].filter(Boolean).join(' ') || undefined;

  return (
    <Screen>
      <StepHeader step={4} label="Vos informations" backHref="/reserver/creneaux" />
      <form onSubmit={submit} noValidate className={styles.form}>
        <Body>
          <SelectionCard summary={flow.summary!} date={flow.date!} mode={flow.mode!} />
          <PageTitle>Vos informations</PageTitle>

          {submitted && Object.keys(errors).length > 0 ? (
            <Alert tone="error">Certaines informations sont manquantes ou incorrectes.</Alert>
          ) : null}

          <div className={styles.field}>
            <label htmlFor="field-fullName">
              Nom complet <span className={styles.req}>*</span>
            </label>
            <input
              id="field-fullName"
              autoComplete="name"
              value={form.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              aria-invalid={Boolean(errors.fullName)}
              aria-describedby={describedBy('fullName')}
            />
            {err('fullName')}
          </div>

          <div className={styles.field}>
            <label htmlFor="field-phone">
              Téléphone (WhatsApp) <span className={styles.req}>*</span>
            </label>
            <div className={styles.phoneRow}>
              <select
                aria-label="Indicatif du pays"
                value={countryCode}
                onChange={(e) => {
                  setCountryCode(e.target.value);
                  if (submitted)
                    setErrors(
                      validateDetails({ ...form, phone: composePhone(e.target.value, localPhone) }),
                    );
                }}
              >
                {COUNTRY_CODES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
              <input
                id="field-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="90 00 00 00"
                value={localPhone}
                onChange={(e) => {
                  setLocalPhone(e.target.value);
                  if (submitted)
                    setErrors(
                      validateDetails({
                        ...form,
                        phone: composePhone(countryCode, e.target.value),
                      }),
                    );
                }}
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={describedBy('phone', 'hint-phone')}
              />
            </div>
            <span id="hint-phone" className={styles.hint}>
              Votre confirmation sera envoyée par SMS / WhatsApp.
            </span>
            {err('phone')}
          </div>

          <div className={styles.field}>
            <label htmlFor="field-businessName">
              Nom de l’entreprise <span className={styles.req}>*</span>
            </label>
            <input
              id="field-businessName"
              autoComplete="organization"
              placeholder="Ex. : Boutique Afi Mode"
              value={form.businessName}
              onChange={(e) => set('businessName', e.target.value)}
              aria-invalid={Boolean(errors.businessName)}
              aria-describedby={describedBy('businessName')}
            />
            {err('businessName')}
          </div>

          <div className={styles.field}>
            <label htmlFor="field-businessSector">
              Secteur d’activité <span className={styles.req}>*</span>
            </label>
            <select
              id="field-businessSector"
              value={form.businessSector}
              onChange={(e) => set('businessSector', e.target.value)}
              aria-invalid={Boolean(errors.businessSector)}
              aria-describedby={describedBy('businessSector')}
            >
              <option value="">Sélectionnez…</option>
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {err('businessSector')}
          </div>

          <div className={styles.field}>
            <label htmlFor="field-email">
              E-mail <span className={styles.optional}>(facultatif)</span>
            </label>
            <input
              id="field-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="vous@exemple.com"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={describedBy('email')}
            />
            {err('email')}
          </div>

          <div className={styles.field}>
            <label htmlFor="field-liveDescription">
              Décrivez votre live <span className={styles.optional}>(facultatif)</span>
            </label>
            <textarea
              id="field-liveDescription"
              rows={3}
              maxLength={1000}
              placeholder="Produits présentés, plateforme (Facebook, TikTok…), besoins particuliers"
              value={form.liveDescription}
              onChange={(e) => set('liveDescription', e.target.value)}
              aria-describedby={describedBy('liveDescription')}
            />
            {err('liveDescription')}
          </div>

          <div className={styles.field}>
            <label className={styles.terms}>
              <input
                id="field-acceptTerms"
                type="checkbox"
                checked={form.acceptTerms}
                onChange={(e) => set('acceptTerms', e.target.checked)}
                aria-invalid={Boolean(errors.acceptTerms)}
                aria-describedby={describedBy('acceptTerms')}
              />
              <span>
                J’accepte les{' '}
                <Link href="/conditions" target="_blank" rel="noopener">
                  conditions de réservation et d’annulation
                </Link>{' '}
                du studio.
              </span>
            </label>
            {err('acceptTerms')}
          </div>
        </Body>
        <BottomBar step={4}>
          <button type="submit" className={buttonClass}>
            Passer au paiement
          </button>
        </BottomBar>
      </form>
    </Screen>
  );
}
