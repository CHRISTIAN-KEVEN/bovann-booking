'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CountrySelect } from '@/components/CountrySelect';
import { Alert, Body, ButtonSpinner, PageTitle, Screen, buttonClass } from '@/components/ui';
import { Link, useI18n, useLocaleRouter } from '@/i18n/I18nProvider';
import { api, ApiError } from '@/lib/api';
import { COUNTRY_CODES, composePhone, isValidE164 } from '@/lib/details';
import { rememberToken } from '@/lib/tokens';
import styles from './page.module.css';

const REFERENCE = /^BOV-\d{4}-[0-9A-Z]{5}$/;

/**
 * "Retrouver ma réservation": find a booking with its reference and phone number.
 * Deliberately no list of the bookings saved in this browser (product owner, 2026-11-10): on a
 * shared phone or computer, the next person would see the previous customer's bookings. A
 * personal list comes later with a code sent to the customer's phone (SMS/WhatsApp provider).
 */
export function MyBookings() {
  const router = useLocaleRouter();
  const { t } = useI18n();
  const [reference, setReference] = useState('');
  const [countryCode, setCountryCode] = useState<string>(COUNTRY_CODES[0]!.code);
  const [localPhone, setLocalPhone] = useState('');
  const [errors, setErrors] = useState<{ reference?: string; phone?: string; form?: string }>({});
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    // Reference prefilled from links such as /mes-reservations?ref=BOV-2611-ABCDE (emails).
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) setReference(ref.toUpperCase());
  }, []);

  async function search(e: FormEvent) {
    e.preventDefault();
    const ref = reference.trim().toUpperCase();
    const phone = composePhone(countryCode, localPhone);
    const next: typeof errors = {};
    if (!REFERENCE.test(ref)) next.reference = t('find.refInvalid');
    if (!isValidE164(phone)) next.phone = t('find.phoneInvalid');
    setErrors(next);
    if (next.reference || next.phone) return;

    setSearching(true);
    try {
      const res = await api.lookupBooking(ref, phone);
      // Lets this browser open the booking page; nothing is listed from it later.
      rememberToken(res.booking.reference, res.accessToken);
      router.push(`/reservation/${res.booking.reference}`);
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : t('common.genericError') });
      setSearching(false);
    }
  }

  return (
    <Screen layout="single">
      <Body>
        <PageTitle sub={t('find.intro')}>{t('find.title')}</PageTitle>

        <form className={styles.form} onSubmit={search} noValidate>
          <div className={styles.field}>
            <label htmlFor="lookup-ref">{t('find.reference')}</label>
            <input
              id="lookup-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="BOV-2611-7KQ4M"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(errors.reference)}
              aria-describedby={errors.reference ? 'lookup-ref-error' : undefined}
            />
            {errors.reference ? (
              <span id="lookup-ref-error" className={styles.error}>
                {errors.reference}
              </span>
            ) : null}
          </div>
          <div className={styles.field}>
            <label htmlFor="lookup-phone">{t('find.phone')}</label>
            <div className={styles.phoneRow}>
              <CountrySelect value={countryCode} onChange={setCountryCode} />
              <input
                id="lookup-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="90 00 00 00"
                value={localPhone}
                onChange={(e) => setLocalPhone(e.target.value)}
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? 'lookup-phone-error' : undefined}
              />
            </div>
            {errors.phone ? (
              <span id="lookup-phone-error" className={styles.error}>
                {errors.phone}
              </span>
            ) : null}
          </div>
          {errors.form ? <Alert tone="error">{errors.form}</Alert> : null}
          <button type="submit" className={buttonClass} disabled={searching}>
            {searching ? <ButtonSpinner /> : null}
            {searching ? t('find.searching') : t('find.submit')}
          </button>
        </form>

        <p className={styles.help}>
          {t('find.noneYet')} <Link href="/">{t('find.book')}</Link>
        </p>
      </Body>
    </Screen>
  );
}
