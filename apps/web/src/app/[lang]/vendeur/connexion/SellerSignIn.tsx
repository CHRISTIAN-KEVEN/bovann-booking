'use client';

import type { OtpChannel, SellerCodeResponse } from '@bovann/shared';
import { useEffect, useRef, useState } from 'react';
import { Flag } from '@/components/lives/Flag';
import { CountrySelect } from '@/components/CountrySelect';
import { ButtonSpinner } from '@/components/ui';
import { Link, useI18n, useLocaleRouter } from '@/i18n/I18nProvider';
import { formatPhone } from '@/lib/admin-format';
import { ApiError } from '@/lib/api';
import { COUNTRY_CODES, composePhone, isValidE164 } from '@/lib/details';
import { safeNext, sellerApi } from '@/lib/seller-api';
import { SellerShell } from '@/components/seller/SellerShell';
import styles from '@/components/seller/seller.module.css';

type Step =
  | { name: 'phone' }
  | { name: 'code'; phone: string; channel: OtpChannel; resendAt: number; devCode?: string };

/**
 * Seller sign-in, one question per screen: the phone number (and WhatsApp or SMS), then the
 * 6-digit code. No password. After sign-in the seller goes back where they came from
 * (`?suite=/…`), otherwise to their space.
 */
export function SellerSignIn() {
  const { t } = useI18n();
  const router = useLocaleRouter();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>({ name: 'phone' });
  const [country, setCountry] = useState<string>(COUNTRY_CODES[0].code);
  const [local, setLocal] = useState('');
  const [channel, setChannel] = useState<OtpChannel>('WHATSAPP');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sellerApi
      .status()
      .then((s) => setAvailable(s.available))
      .catch(() => setAvailable(true)); // the next call will show the real error
    // Already signed in: go on.
    sellerApi
      .me()
      .then(() => router.replace(next()))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  useEffect(() => {
    if (step.name !== 'code') return;
    codeInput.current?.focus();
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [step]);

  function next(): string {
    return safeNext(new URLSearchParams(window.location.search).get('suite')) ?? '/vendeur';
  }

  async function sendCode(phone: string, via: OtpChannel) {
    setBusy(true);
    setError(null);
    try {
      const sent: SellerCodeResponse = await sellerApi.requestCode(phone, via);
      setCode('');
      setStep({
        name: 'code',
        phone: sent.phone,
        channel: sent.channel,
        resendAt: Date.now() + sent.resendInSec * 1000,
        devCode: sent.devCode,
      });
      setNow(Date.now());
    } catch (err) {
      if (err instanceof ApiError && err.code === 'OTP_UNAVAILABLE') setAvailable(false);
      setError(err instanceof Error ? err.message : String(err));
      // Already sent recently: show the code screen with the right countdown.
      if (err instanceof ApiError && err.code === 'OTP_TOO_SOON' && step.name === 'phone') {
        const retry = (err.details as { retryInSec?: number } | undefined)?.retryInSec ?? 60;
        setStep({ name: 'code', phone, channel: via, resendAt: Date.now() + retry * 1000 });
      }
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    if (step.name !== 'code') return;
    if (!/^\d{6}$/.test(value)) {
      setError(t('seller.errors.code'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sellerApi.verify(step.phone, value);
      router.replace(next());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCode('');
      codeInput.current?.focus();
      setBusy(false);
    }
  }

  function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    const phone = composePhone(country, local);
    if (!local.trim() || !isValidE164(phone)) {
      setError(t('seller.errors.phone'));
      return;
    }
    void sendCode(phone, channel);
  }

  if (available === false) {
    return (
      <SellerShell>
        <div className={styles.icon} aria-hidden="true">
          <LockChatIcon />
        </div>
        <h1 className={styles.title}>{t('seller.closedTitle')}</h1>
        <p className={styles.lead}>{t('seller.closedText')}</p>
        <div className={styles.actions}>
          <Link href="/en-direct" className={styles.primary}>
            {t('seller.seeLives')}
          </Link>
        </div>
      </SellerShell>
    );
  }

  if (step.name === 'phone') {
    return (
      <SellerShell back="/en-direct">
        <form className={styles.form} onSubmit={submitPhone} noValidate>
          <div className={styles.icon} aria-hidden="true">
            <LockChatIcon />
          </div>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>{t('seller.phoneTitle')}</h1>
            <p className={styles.lead}>{t('seller.phoneLead')}</p>
          </div>

          <div className={styles.field}>
            <label htmlFor="seller-phone" className={styles.label}>
              {t('seller.phoneLabel')}
            </label>
            <div className={`${styles.phoneRow} ${error ? styles.invalid : ''}`}>
              <CountrySelect value={country} onChange={setCountry} className={styles.country} />
              <input
                id="seller-phone"
                className={styles.phoneInput}
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={t('seller.phonePlaceholder')}
                value={local}
                onChange={(e) => {
                  setLocal(e.target.value);
                  setError(null);
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'seller-error' : undefined}
              />
            </div>
          </div>

          <fieldset className={styles.fieldset}>
            <legend className={styles.label}>{t('seller.channel')}</legend>
            <div className={styles.channels}>
              {(['WHATSAPP', 'SMS'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={channel === c}
                  className={styles.channel}
                  onClick={() => setChannel(c)}
                >
                  {c === 'WHATSAPP' ? <WhatsAppIcon /> : <SmsIcon />}
                  {c === 'WHATSAPP' ? t('seller.whatsapp') : t('seller.sms')}
                </button>
              ))}
            </div>
          </fieldset>

          {error ? (
            <p id="seller-error" className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? <ButtonSpinner /> : null}
              {t('seller.sendCode')}
            </button>
          </div>
        </form>
      </SellerShell>
    );
  }

  const wait = Math.max(0, Math.ceil((step.resendAt - now) / 1000));
  const iso = COUNTRY_CODES.find((c) => step.phone.startsWith(c.code))?.iso;
  const other: OtpChannel = step.channel === 'WHATSAPP' ? 'SMS' : 'WHATSAPP';

  return (
    <SellerShell
      onBack={() => {
        setStep({ name: 'phone' });
        setError(null);
      }}
    >
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void verify(code);
        }}
        noValidate
      >
        <div className={styles.icon} aria-hidden="true">
          <LockChatIcon />
        </div>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{t('seller.codeTitle')}</h1>
          <p className={styles.lead}>{t(`seller.sentTo.${step.channel}`)}</p>
          <div className={styles.sentTo}>
            {iso ? <Flag code={iso} width={24} /> : null}
            <strong>{formatPhone(step.phone)}</strong>
            <button
              type="button"
              className={styles.link}
              onClick={() => {
                setStep({ name: 'phone' });
                setError(null);
              }}
            >
              {t('seller.change')}
            </button>
          </div>
        </div>

        {step.devCode ? (
          <p className={styles.devCode}>
            {t('seller.devCode', { code: step.devCode })}
            <button
              type="button"
              className={styles.link}
              onClick={() => {
                setCode(step.devCode!);
                void verify(step.devCode!);
              }}
            >
              {t('seller.devFill')}
            </button>
          </p>
        ) : null}

        <div className={styles.field}>
          <label htmlFor="seller-code" className={styles.label}>
            {t('seller.codeLabel')}
          </label>
          {/* One real input (works with SMS autofill and screen readers) over six boxes. */}
          <div className={styles.codeWrap}>
            <div className={styles.codeBoxes} aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <span
                  key={i}
                  className={`${styles.codeBox} ${
                    code[i] ? styles.codeBoxFilled : i === code.length ? styles.codeBoxCurrent : ''
                  } ${error ? styles.codeBoxError : ''}`}
                >
                  {code[i] ?? ''}
                </span>
              ))}
            </div>
            <input
              ref={codeInput}
              id="seller-code"
              className={styles.codeInput}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(digits);
                setError(null);
                if (digits.length === 6) void verify(digits);
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'seller-error code-help' : 'code-help'}
              disabled={busy}
            />
          </div>
          <span id="code-help" className={styles.hint}>
            {t('seller.codeHelp')}
          </span>
        </div>

        {error ? (
          <p id="seller-error" className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.resendCard}>
          {wait > 0 ? (
            <span className={styles.resendWait}>
              <ClockIcon />
              {t('seller.resendIn', {
                time: `${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, '0')}`,
              })}
            </span>
          ) : (
            <button
              type="button"
              className={styles.link}
              disabled={busy}
              onClick={() => void sendCode(step.phone, step.channel)}
            >
              {t('seller.resend')}
            </button>
          )}
          <button
            type="button"
            className={styles.link}
            disabled={busy || wait > 0}
            onClick={() => void sendCode(step.phone, other)}
          >
            {other === 'SMS' ? t('seller.useSms') : t('seller.useWhatsapp')}
          </button>
        </div>

        <div className={styles.actions}>
          <button type="submit" className={styles.primary} disabled={busy || code.length < 6}>
            {busy ? <ButtonSpinner /> : null}
            {t('seller.validate')}
          </button>
        </div>
      </form>
    </SellerShell>
  );
}

function LockChatIcon() {
  return (
    <svg
      width="38"
      height="38"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.4-4A8 8 0 1 1 20 11.5Z" />
      <rect x="9" y="10.5" width="6" height="5" rx="1" />
      <path d="M10.2 10.5V9.2a1.8 1.8 0 0 1 3.6 0v1.3" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.4-4A8 8 0 1 1 20 11.5Z" />
      <path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 1c-1-.5-2.5-2-3-3l1-1-1-2L9 8.5Z" />
    </svg>
  );
}

function SmsIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="13" rx="3" />
      <path d="M8 21l3-4M7.5 10.5h.01M12 10.5h.01M16.5 10.5h.01" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
