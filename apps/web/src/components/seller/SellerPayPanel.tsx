'use client';

import {
  formatXof,
  type LivePrices,
  type SellerPassDto,
  type SellerPaymentDto,
  type SellerPaymentPurpose,
} from '@bovann/shared';
import { useEffect, useState } from 'react';
import { CountrySelect } from '@/components/CountrySelect';
import { Icon } from '@/components/icons';
import { ButtonSpinner, Spinner } from '@/components/ui';
import { useI18n } from '@/i18n/I18nProvider';
import { PAYMENT_SIMULATION } from '@/lib/api';
import { COUNTRY_CODES, composePhone, isValidE164, splitPhone } from '@/lib/details';
import { sellerApi } from '@/lib/seller-api';
import seller from './seller.module.css';
import styles from './SellerPayPanel.module.css';

type Phase =
  | { kind: 'choose'; error?: string }
  | { kind: 'submitting' }
  | { kind: 'waiting'; payment: SellerPaymentDto };

/**
 * Pay for a pass (monthly or annual): needed to post lives.
 * Mobile Money (T-Money, Flooz) or card, through the same provider contract as bookings.
 * While payments are simulated, two buttons decide the outcome, as in the booking flow.
 */
export function SellerPayPanel({
  plans = ['PASS_YEAR', 'PASS_MONTH'],
  prices,
  pass,
  phone,
  onPaid,
}: {
  plans?: SellerPaymentPurpose[];
  prices: LivePrices;
  pass: SellerPassDto | null;
  phone: string;
  onPaid: (payment: SellerPaymentDto) => void;
}) {
  const { t, locale } = useI18n();
  const [plan, setPlan] = useState<SellerPaymentPurpose>(plans[0]!);
  const [method, setMethod] = useState<'MOBILE_MONEY' | 'CARD'>('MOBILE_MONEY');
  const [channel, setChannel] = useState<'TMONEY' | 'FLOOZ'>('TMONEY');
  const initial = splitPhone(phone);
  const [payerCode, setPayerCode] = useState<string>(initial.countryCode || COUNTRY_CODES[0].code);
  const [payerLocal, setPayerLocal] = useState(initial.local);
  const [phase, setPhase] = useState<Phase>({ kind: 'choose' });
  const [simulating, setSimulating] = useState<'succeed' | 'fail' | null>(null);
  const payer = composePhone(payerCode, payerLocal);
  const payerValid = method === 'CARD' || isValidE164(payer);

  const amount = (p: SellerPaymentPurpose) =>
    p === 'PASS_MONTH' ? prices.passMonthXof : prices.passYearXof;

  // Follow the payment until the provider answers.
  useEffect(() => {
    if (phase.kind !== 'waiting') return;
    let stopped = false;
    const check = async () => {
      try {
        const payment = await sellerApi.payment(phase.payment.id);
        if (stopped) return;
        if (payment.status === 'SUCCEEDED') onPaid(payment);
        else if (payment.status === 'FAILED') setPhase({ kind: 'choose', error: t('pay.failed') });
        else if (payment.status === 'CANCELLED') {
          setPhase({ kind: 'choose', error: t('pay.cancelled') });
        }
      } catch {
        /* the next check will tell */
      }
    };
    const timer = window.setInterval(() => void check(), 3000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [phase, onPaid, t]);

  async function pay() {
    setPhase({ kind: 'submitting' });
    try {
      const payment = await sellerApi.pay({
        purpose: plan,
        method,
        channel: method === 'MOBILE_MONEY' ? channel : null,
        payerPhone: method === 'MOBILE_MONEY' ? payer : null,
      });
      setPhase({ kind: 'waiting', payment });
    } catch (err) {
      setPhase({ kind: 'choose', error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function simulate(outcome: 'succeed' | 'fail') {
    if (phase.kind !== 'waiting') return;
    setSimulating(outcome);
    await sellerApi.simulatePayment(phase.payment.id, outcome).catch(() => undefined);
    try {
      const payment = await sellerApi.payment(phase.payment.id);
      if (payment.status === 'SUCCEEDED') onPaid(payment);
      else if (payment.status === 'FAILED') setPhase({ kind: 'choose', error: t('pay.failed') });
    } finally {
      setSimulating(null);
    }
  }

  if (phase.kind === 'waiting') {
    const p = phase.payment;
    return (
      <div className={seller.form}>
        <div className={styles.waitCard} role="status" aria-live="polite">
          <span className={styles.waitIcon} aria-hidden="true">
            <Icon name={p.method === 'CARD' ? 'card' : 'phone'} size={28} />
          </span>
          <strong className={styles.waitTitle}>
            {p.method === 'CARD' ? t('pay.waitingCard') : t('pay.waitingPhone')}
          </strong>
          <span className={styles.waitAmount}>{formatXof(p.amountXof, locale)}</span>
          {p.instructions ? <p className={seller.cardText}>{p.instructions}</p> : null}
          <Spinner label={t('pay.waiting')} />
        </div>
        {PAYMENT_SIMULATION ? (
          <div className={styles.simulation}>
            <strong>{t('payment.demo')}</strong>
            <div className={styles.simulationButtons}>
              <button
                type="button"
                className={seller.secondary}
                onClick={() => void simulate('succeed')}
                disabled={simulating !== null}
              >
                {simulating === 'succeed' ? <ButtonSpinner /> : null}
                {t('payment.simulateOk')}
              </button>
              <button
                type="button"
                className={seller.secondary}
                onClick={() => void simulate('fail')}
                disabled={simulating !== null}
              >
                {simulating === 'fail' ? <ButtonSpinner /> : null}
                {t('payment.simulateFail')}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  const planText: Record<SellerPaymentPurpose, { title: string; sub: string; per: string }> = {
    PASS_MONTH: { title: t('pay.planMonth'), sub: t('pay.planMonthSub'), per: t('pay.perMonth') },
    PASS_YEAR: { title: t('pay.planYear'), sub: t('pay.planYearSub'), per: t('pay.perYear') },
  };
  const dateFmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Lome',
  });

  return (
    <form
      className={seller.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (payerValid) void pay();
      }}
      noValidate
    >
      <fieldset className={seller.fieldset}>
        <legend className={styles.srOnly}>{t('pay.plans')}</legend>
        <div className={styles.plans}>
          {plans.map((p) => (
            <label key={p} className={`${styles.plan} ${plan === p ? styles.planOn : ''}`}>
              <input
                type="radio"
                name="plan"
                value={p}
                checked={plan === p}
                onChange={() => setPlan(p)}
                className={styles.radio}
              />
              <span className={styles.dot} aria-hidden="true">
                {plan === p ? <Icon name="check" size={14} /> : null}
              </span>
              <span className={styles.planText}>
                <strong>{planText[p].title}</strong>
                <span>{planText[p].sub}</span>
              </span>
              <span className={styles.price}>
                <strong>{formatXof(amount(p), locale)}</strong>
                <span>{planText[p].per}</span>
              </span>
              {p === 'PASS_YEAR' && plans.length > 1 ? (
                <span className={styles.tag}>{t('pay.cheapest')}</span>
              ) : null}
            </label>
          ))}
        </div>
      </fieldset>
      {pass ? (
        <p className={seller.hint}>
          {t('pay.extends', { date: dateFmt.format(new Date(pass.endsAt)) })}
        </p>
      ) : null}

      <fieldset className={seller.fieldset}>
        <legend className={seller.label}>{t('payment.method')}</legend>
        <div className={styles.methods}>
          {(['MOBILE_MONEY', 'CARD'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={method === m}
              className={styles.method}
              onClick={() => setMethod(m)}
            >
              <Icon name={m === 'CARD' ? 'card' : 'phone'} size={22} />
              <span className={styles.methodText}>
                <strong>{m === 'CARD' ? t('payment.card') : t('payment.mobileMoney')}</strong>
                <span>{m === 'CARD' ? 'Visa, Mastercard' : t('payment.mobileMoneySub')}</span>
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {method === 'MOBILE_MONEY' ? (
        <div className={styles.momo}>
          <div className={styles.channels} role="group" aria-label={t('payment.operator')}>
            {(['TMONEY', 'FLOOZ'] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={channel === c}
                className={styles.channel}
                onClick={() => setChannel(c)}
              >
                {c === 'TMONEY' ? 'T-Money' : 'Flooz'}
              </button>
            ))}
          </div>
          <label htmlFor="payer-phone" className={seller.label}>
            {t('payment.mmNumber')}
          </label>
          <div className={`${seller.phoneRow} ${payerValid ? '' : seller.invalid}`}>
            <CountrySelect value={payerCode} onChange={setPayerCode} className={seller.country} />
            <input
              id="payer-phone"
              className={seller.phoneInput}
              type="tel"
              inputMode="tel"
              value={payerLocal}
              onChange={(e) => setPayerLocal(e.target.value)}
              aria-invalid={!payerValid}
              aria-describedby="payer-hint"
            />
          </div>
          <span id="payer-hint" className={seller.hint}>
            {payerValid ? t('payment.mmHint') : t('validation.phoneInvalid')}
          </span>
        </div>
      ) : null}

      {phase.kind === 'choose' && phase.error ? (
        <p className={seller.error} role="alert">
          {phase.error}
        </p>
      ) : null}

      <div className={seller.actions}>
        <button
          type="submit"
          className={seller.primary}
          disabled={phase.kind === 'submitting' || !payerValid}
        >
          {phase.kind === 'submitting' ? <ButtonSpinner /> : null}
          {t('pay.pay', { amount: formatXof(amount(plan), locale) })}
        </button>
      </div>
    </form>
  );
}
