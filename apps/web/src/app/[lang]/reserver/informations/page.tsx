'use client';

import { useState, type FormEvent } from 'react';
import { CountrySelect } from '@/components/CountrySelect';
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
import { Link, useI18n, useLocaleRouter, type TKey } from '@/i18n/I18nProvider';
import {
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
  const router = useLocaleRouter();
  const { t } = useI18n();
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
      setErrors(validateDetails({ ...next, phone: composePhone(countryCode, localPhone) }, t));
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
    const found = validateDetails(details, t);
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
      <StepHeader step={4} label={t('details.step')} backHref="/reserver/creneaux" />
      <form onSubmit={submit} noValidate className={styles.form}>
        <Body>
          <SelectionCard summary={flow.summary!} date={flow.date!} mode={flow.mode!} />
          <PageTitle>{t('details.title')}</PageTitle>

          {submitted && Object.keys(errors).length > 0 ? (
            <Alert tone="error">{t('details.invalid')}</Alert>
          ) : null}

          <div className={styles.field}>
            <label htmlFor="field-fullName">
              {t('details.fullName')} <span className={styles.req}>*</span>
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
              {t('details.phone')} <span className={styles.req}>*</span>
            </label>
            <div className={styles.phoneRow}>
              <CountrySelect
                value={countryCode}
                onChange={(code) => {
                  setCountryCode(code);
                  if (submitted)
                    setErrors(
                      validateDetails({ ...form, phone: composePhone(code, localPhone) }, t),
                    );
                }}
              />
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
                      validateDetails(
                        { ...form, phone: composePhone(countryCode, e.target.value) },
                        t,
                      ),
                    );
                }}
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={describedBy('phone', 'hint-phone')}
              />
            </div>
            <span id="hint-phone" className={styles.hint}>
              {t('details.phoneHint')}
            </span>
            {err('phone')}
          </div>

          <div className={styles.field}>
            <label htmlFor="field-businessName">
              {t('details.businessName')} <span className={styles.req}>*</span>
            </label>
            <input
              id="field-businessName"
              autoComplete="organization"
              placeholder={t('details.businessPlaceholder')}
              value={form.businessName}
              onChange={(e) => set('businessName', e.target.value)}
              aria-invalid={Boolean(errors.businessName)}
              aria-describedby={describedBy('businessName')}
            />
            {err('businessName')}
          </div>

          <div className={styles.field}>
            <label htmlFor="field-businessSector">
              {t('details.sector')} <span className={styles.req}>*</span>
            </label>
            <select
              id="field-businessSector"
              value={form.businessSector}
              onChange={(e) => set('businessSector', e.target.value)}
              aria-invalid={Boolean(errors.businessSector)}
              aria-describedby={describedBy('businessSector')}
            >
              <option value="">{t('details.choose')}</option>
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {t(`sectors.${s}` as TKey)}
                </option>
              ))}
            </select>
            {err('businessSector')}
          </div>

          <div className={styles.field}>
            <label htmlFor="field-email">
              {t('details.email')} <span className={styles.optional}>{t('details.optional')}</span>
            </label>
            <input
              id="field-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t('details.emailPlaceholder')}
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={describedBy('email')}
            />
            {err('email')}
          </div>

          <div className={styles.field}>
            <label htmlFor="field-liveDescription">
              {t('details.description')}{' '}
              <span className={styles.optional}>{t('details.optional')}</span>
            </label>
            <textarea
              id="field-liveDescription"
              rows={3}
              maxLength={1000}
              placeholder={t('details.descriptionPlaceholder')}
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
                {t('details.termsBefore')}{' '}
                <Link href="/conditions" target="_blank" rel="noopener">
                  {t('details.termsLink')}
                </Link>
                {t('details.termsAfter') === '.' ? '.' : ` ${t('details.termsAfter')}`}
              </span>
            </label>
            {err('acceptTerms')}
          </div>
        </Body>
        <BottomBar step={4}>
          <button type="submit" className={buttonClass}>
            {t('details.submit')}
          </button>
        </BottomBar>
      </form>
    </Screen>
  );
}
