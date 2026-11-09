'use client';

import type { BookingDto, CreateBookingRequest, MobileMoneyChannel } from '@bovann/shared';
import { formatXof } from '@bovann/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFlow } from '@/components/FlowProvider';
import { Icon } from '@/components/icons';
import { SelectionCard } from '@/components/SelectionCard';
import { TURNSTILE_SITE_KEY, Turnstile } from '@/components/Turnstile';
import {
  Alert,
  Body,
  BottomBar,
  Screen,
  Spinner,
  StepHeader,
  buttonClass,
  buttonSecondaryClass,
} from '@/components/ui';
import { api, ApiError, PAYMENT_SIMULATION, SPACE_SLUG } from '@/lib/api';
import { COUNTRY_CODES, composePhone, isValidE164, splitPhone } from '@/lib/details';
import { rememberToken } from '@/lib/tokens';
import { useStepGuard } from '@/lib/useStepGuard';
import styles from './page.module.css';

type Phase =
  | { kind: 'form' }
  | { kind: 'submitting' }
  | { kind: 'waiting'; booking: BookingDto; instructions: string | null; deadline: number }
  | { kind: 'failed'; reason: 'PAYMENT_FAILED' | 'EXPIRED' | 'CANCELLED' };

const POLL_MS = 3000;

/** Screen 5: payment. "Payer" holds the slots for a few minutes and starts the payment. */
export default function PaymentPage() {
  const allowed = useStepGuard('/reserver/paiement');
  return allowed ? <Payment /> : null;
}

function Payment() {
  const router = useRouter();
  const { flow, update } = useFlow();
  const details = flow.details!;
  const summary = flow.summary!;
  const defaultPayer = splitPhone(details.phone);

  const [phase, setPhase] = useState<Phase>(
    flow.booking ? { kind: 'submitting' } : { kind: 'form' },
  );
  const [method, setMethod] = useState<'MOBILE_MONEY' | 'CARD'>('MOBILE_MONEY');
  const [channel, setChannel] = useState<MobileMoneyChannel>('TMONEY');
  const [payerCode, setPayerCode] = useState(defaultPayer.countryCode);
  const [payerLocal, setPayerLocal] = useState(defaultPayer.local);
  const [captcha, setCaptcha] = useState<string | undefined>(undefined);
  const [error, setError] = useState<{ message: string; slotTaken: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const onToken = useCallback((t: string | undefined) => setCaptcha(t), []);

  const payerPhone = composePhone(payerCode, payerLocal);
  const payerValid = method === 'CARD' || isValidE164(payerPhone);
  const captchaReady = !TURNSTILE_SITE_KEY || Boolean(captcha);

  const toWaiting = useCallback((booking: BookingDto, instructions: string | null) => {
    setPhase({
      kind: 'waiting',
      booking,
      instructions,
      deadline: Date.now() + (booking.holdSecondsLeft ?? 0) * 1000,
    });
  }, []);

  // Coming back to this page with a booking in progress (reload, back button).
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !flow.booking) return;
    resumed.current = true;
    api
      .booking(flow.booking.reference, flow.booking.accessToken)
      .then((b) => {
        if (b.status === 'CONFIRMED') router.replace(`/reservation/${b.reference}`);
        else if (b.status === 'PENDING_PAYMENT') toWaiting(b, null);
        else {
          update({ booking: undefined });
          setPhase({ kind: 'failed', reason: b.status === 'EXPIRED' ? 'EXPIRED' : 'CANCELLED' });
        }
      })
      .catch(() => {
        update({ booking: undefined });
        setPhase({ kind: 'form' });
      });
  }, [flow.booking, router, toWaiting, update]);

  // Countdown and status polling while waiting for the payment.
  const waiting = phase.kind === 'waiting' ? phase : null;
  useEffect(() => {
    if (!waiting) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      api
        .booking(waiting.booking.reference, flow.booking?.accessToken ?? '')
        .then((b) => {
          if (b.status === 'CONFIRMED') router.push(`/reservation/${b.reference}`);
          else if (b.status !== 'PENDING_PAYMENT') {
            update({ booking: undefined });
            setPhase({
              kind: 'failed',
              reason:
                b.status === 'EXPIRED'
                  ? 'EXPIRED'
                  : b.payment?.status === 'FAILED'
                    ? 'PAYMENT_FAILED'
                    : 'CANCELLED',
            });
          }
        })
        .catch(() => undefined); // transient network error: keep polling
    }, POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [waiting, flow.booking?.accessToken, router, update]);

  const secondsLeft = waiting ? Math.max(0, Math.round((waiting.deadline - now) / 1000)) : 0;
  useEffect(() => {
    if (waiting && secondsLeft === 0) {
      update({ booking: undefined });
      setPhase({ kind: 'failed', reason: 'EXPIRED' });
    }
  }, [waiting, secondsLeft, update]);

  async function pay() {
    setError(null);
    setPhase({ kind: 'submitting' });
    const request: CreateBookingRequest = {
      spaceSlug: SPACE_SLUG,
      mode: flow.mode!,
      selection: flow.selection!,
      customer: {
        fullName: details.fullName,
        phone: details.phone,
        email: details.email || null,
        businessName: details.businessName,
        businessSector: details.businessSector,
      },
      liveDescription: details.liveDescription || null,
      acceptTerms: true,
      payment:
        method === 'CARD' ? { method: 'CARD' } : { method: 'MOBILE_MONEY', channel, payerPhone },
      captchaToken: captcha,
    };
    try {
      const res = await api.createBooking(request);
      rememberToken(res.booking.reference, res.accessToken);
      update({ booking: { reference: res.booking.reference, accessToken: res.accessToken } });
      if (res.payment.redirectUrl) {
        window.location.assign(res.payment.redirectUrl);
        return;
      }
      toWaiting(res.booking, res.payment.instructions);
    } catch (e) {
      const apiError = e instanceof ApiError ? e : null;
      setError({
        message: apiError?.message ?? 'Une erreur est survenue. Veuillez réessayer.',
        slotTaken:
          apiError?.code === 'SLOT_UNAVAILABLE' || apiError?.code === 'PACKAGE_DOES_NOT_FIT',
      });
      setPhase({ kind: 'form' });
    }
  }

  async function cancel() {
    if (flow.booking) {
      await api
        .cancelBooking(flow.booking.reference, flow.booking.accessToken)
        .catch(() => undefined);
    }
    update({ booking: undefined });
    router.push('/reserver/creneaux');
  }

  function chooseOtherTime() {
    update({ selection: undefined, summary: undefined, booking: undefined });
    router.push('/reserver/creneaux');
  }

  async function simulate(outcome: 'succeed' | 'fail') {
    if (!waiting) return;
    await api.simulatePayment(waiting.booking.reference, outcome).catch(() => undefined);
  }

  // ------------------------------------------------------------ waiting
  if (waiting) {
    const mm = String(Math.floor(secondsLeft / 60));
    const ss = String(secondsLeft % 60).padStart(2, '0');
    return (
      <Screen>
        <StepHeader step={5} label="Paiement" backHref="/reserver/informations" />
        <Body>
          <div className={styles.waiting} aria-live="polite">
            <span className={styles.waitingIcon} aria-hidden="true">
              <Icon name={method === 'CARD' ? 'card' : 'phone'} size={30} />
            </span>
            <h1 className={styles.waitingTitle}>
              {method === 'CARD'
                ? 'Finalisez le paiement par carte'
                : 'Validez le paiement sur votre téléphone'}
            </h1>
            <p className={styles.waitingText}>
              {waiting.instructions ??
                `Une demande de ${formatXof(waiting.booking.price.totalXof)} a été envoyée. Confirmez-la avec votre code secret.`}
            </p>
            <div
              className={styles.timer}
              role="timer"
              aria-label={`Temps restant : ${mm} minutes ${ss} secondes`}
            >
              <Icon name="clock" size={16} />
              Créneaux réservés pour vous encore {mm}:{ss}
            </div>
            <Spinner label="En attente de la confirmation du paiement…" />
          </div>
          <SelectionCard summary={summary} date={flow.date!} mode={flow.mode!} editable={false} />
          {PAYMENT_SIMULATION ? (
            <div className={styles.simulation}>
              <strong>Mode démonstration : paiement simulé</strong>
              <div className={styles.simulationButtons}>
                <button
                  type="button"
                  className={buttonSecondaryClass}
                  onClick={() => simulate('succeed')}
                >
                  Simuler un paiement réussi
                </button>
                <button
                  type="button"
                  className={buttonSecondaryClass}
                  onClick={() => simulate('fail')}
                >
                  Simuler un échec
                </button>
              </div>
            </div>
          ) : null}
        </Body>
        <BottomBar>
          <button type="button" className={buttonSecondaryClass} onClick={cancel}>
            Annuler et libérer les créneaux
          </button>
        </BottomBar>
      </Screen>
    );
  }

  // ------------------------------------------------------------ form / failed
  const failed = phase.kind === 'failed' ? phase : null;
  return (
    <Screen>
      <StepHeader step={5} label="Paiement" backHref="/reserver/informations" />
      <Body>
        {failed ? (
          <Alert
            tone="warning"
            title={
              failed.reason === 'EXPIRED'
                ? 'Le délai de paiement est écoulé'
                : failed.reason === 'PAYMENT_FAILED'
                  ? 'Le paiement n’a pas abouti'
                  : 'Réservation annulée'
            }
          >
            Vos créneaux ont été libérés. Vous pouvez réessayer : s’ils sont toujours disponibles,
            ils seront de nouveau réservés pour vous.
          </Alert>
        ) : null}

        {error ? (
          <Alert
            tone="error"
            action={
              error.slotTaken ? (
                <button type="button" className={buttonSecondaryClass} onClick={chooseOtherTime}>
                  Choisir un autre horaire
                </button>
              ) : null
            }
          >
            {error.message}
          </Alert>
        ) : null}

        <section className={styles.recap} aria-labelledby="recap-title">
          <h2 id="recap-title" className={styles.sectionTitle}>
            Récapitulatif
          </h2>
          <SelectionCard summary={summary} date={flow.date!} mode={flow.mode!} />
          <dl className={styles.amounts}>
            {summary.discountXof > 0 ? (
              <>
                <div>
                  <dt>{summary.slotCount} créneaux à l’unité</dt>
                  <dd className={styles.strike}>{formatXof(summary.listPriceXof)}</dd>
                </div>
                <div>
                  <dt>Réduction forfait</dt>
                  <dd className={styles.saving}>−{formatXof(summary.discountXof)}</dd>
                </div>
              </>
            ) : null}
            <div className={styles.total}>
              <dt>Total</dt>
              <dd>{formatXof(summary.totalXof)}</dd>
            </div>
          </dl>
        </section>

        <fieldset className={styles.methods}>
          <legend className={styles.sectionTitle}>Moyen de paiement</legend>

          <div
            className={`${styles.method} ${method === 'MOBILE_MONEY' ? styles.methodSelected : ''}`}
          >
            <label className={styles.methodRow}>
              <input
                type="radio"
                name="method"
                checked={method === 'MOBILE_MONEY'}
                onChange={() => setMethod('MOBILE_MONEY')}
                className={styles.radio}
              />
              <span className={styles.methodText}>
                <strong>Mobile Money</strong>
                <span>T-Money ou Flooz</span>
              </span>
              <Icon name="phone" size={22} />
            </label>
            {method === 'MOBILE_MONEY' ? (
              <div className={styles.methodBody}>
                <div className={styles.channels} role="group" aria-label="Opérateur">
                  {(['TMONEY', 'FLOOZ'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={channel === c}
                      className={`${styles.channel} ${channel === c ? styles.channelSelected : ''}`}
                      onClick={() => setChannel(c)}
                    >
                      {c === 'TMONEY' ? 'T-Money' : 'Flooz'}
                    </button>
                  ))}
                </div>
                <label htmlFor="payer-phone" className={styles.fieldLabel}>
                  Numéro Mobile Money
                </label>
                <div className={styles.phoneRow}>
                  <select
                    aria-label="Indicatif du pays"
                    value={payerCode}
                    onChange={(e) => setPayerCode(e.target.value)}
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                  <input
                    id="payer-phone"
                    type="tel"
                    inputMode="tel"
                    value={payerLocal}
                    onChange={(e) => setPayerLocal(e.target.value)}
                    aria-invalid={!payerValid}
                  />
                </div>
                <span className={styles.hint}>
                  {payerValid
                    ? 'Vous recevrez une demande de validation sur ce téléphone.'
                    : 'Numéro invalide : vérifiez l’indicatif et le numéro.'}
                </span>
              </div>
            ) : null}
          </div>

          <div className={`${styles.method} ${method === 'CARD' ? styles.methodSelected : ''}`}>
            <label className={styles.methodRow}>
              <input
                type="radio"
                name="method"
                checked={method === 'CARD'}
                onChange={() => setMethod('CARD')}
                className={styles.radio}
              />
              <span className={styles.methodText}>
                <strong>Carte bancaire</strong>
                <span>Visa, Mastercard</span>
              </span>
              <Icon name="card" size={22} />
            </label>
          </div>
        </fieldset>

        <Turnstile onToken={onToken} />

        <p className={styles.secure}>
          <Icon name="lock" size={14} />
          En appuyant sur « Payer », vos créneaux sont réservés pour vous quelques minutes, le temps
          du paiement.
        </p>
      </Body>
      <BottomBar>
        <button
          type="button"
          className={buttonClass}
          onClick={pay}
          disabled={phase.kind === 'submitting' || !payerValid || !captchaReady}
        >
          {phase.kind === 'submitting'
            ? 'Réservation en cours…'
            : `Payer ${formatXof(summary.totalXof)}`}
        </button>
      </BottomBar>
    </Screen>
  );
}
