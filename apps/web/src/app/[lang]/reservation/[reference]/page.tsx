'use client';

import type { BookingDto } from '@bovann/shared';
import { BOOKING_STATUS_LABELS, SESSION_MODE_LABELS, formatXof } from '@bovann/shared';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useFlow } from '@/components/FlowProvider';
import { Icon } from '@/components/icons';
import {
  Alert,
  Body,
  BottomBar,
  Screen,
  SkeletonBlock,
  buttonClass,
  buttonDarkClass,
  buttonSecondaryClass,
  ButtonSpinner,
} from '@/components/ui';
import { Link, useI18n, useLocaleRouter } from '@/i18n/I18nProvider';
import { api, ApiError } from '@/lib/api';
import { formatLongDate } from '@/lib/dates';
import { bookingToIcs } from '@/lib/ics';
import { selectionLabel, timesLabel } from '@/lib/selection';
import { tokenFor } from '@/lib/tokens';
import styles from './page.module.css';

/** Screen 6: confirmation, reachable later from the same browser. */
export default function BookingPage() {
  const params = useParams<{ reference: string }>();
  const reference = decodeURIComponent(params.reference);
  const router = useLocaleRouter();
  const { t, locale } = useI18n();
  const { flow, ready, reset } = useFlow();
  const [booking, setBooking] = useState<BookingDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<'idle' | 'loading' | { error: string }>('idle');

  useEffect(() => {
    if (!ready) return;
    const token =
      flow.booking?.reference === reference ? flow.booking.accessToken : tokenFor(reference);
    if (!token) {
      setError(t('confirmation.notOnDevice'));
      return;
    }
    setToken(token);
    api
      .booking(reference, token)
      .then((b) => {
        if (b.status === 'PENDING_PAYMENT') router.replace('/reserver/paiement');
        else setBooking(b);
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : t('common.genericError')),
      );
  }, [ready, reference, flow.booking, router, t]);

  function downloadCalendar() {
    if (!booking) return;
    const blob = new Blob([bookingToIcs(booking, t, locale)], {
      type: 'text/calendar;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bovann-${booking.reference}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadReceipt() {
    if (!booking || !token) return;
    setReceipt('loading');
    try {
      const blob = await api.receipt(booking.reference, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${t('confirmation.receiptFile')}-${booking.reference}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Some mobile browsers read the file after click() returns.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setReceipt('idle');
    } catch (e) {
      setReceipt({
        error: e instanceof ApiError ? e.message : t('confirmation.downloadFailed'),
      });
    }
  }

  function newBooking() {
    reset();
    router.push('/');
  }

  if (error) {
    return (
      <Screen layout="single">
        <Body>
          <Alert tone="error" title={t('confirmation.notFound')}>
            {error}
          </Alert>
          <Link
            href={`/mes-reservations?ref=${encodeURIComponent(reference)}`}
            className={buttonClass}
          >
            {t('confirmation.find')}
          </Link>
          <Link href="/" className={buttonSecondaryClass}>
            {t('confirmation.home')}
          </Link>
        </Body>
      </Screen>
    );
  }

  if (!booking) {
    return (
      <Screen layout="single">
        <Body>
          <div className={styles.loading} role="status" aria-label={t('confirmation.loading')}>
            <SkeletonBlock className={styles.skCircle} />
            <SkeletonBlock className={styles.skTitle} />
            <SkeletonBlock className={styles.skLine} />
            <SkeletonBlock className={styles.skCard} />
            <SkeletonBlock className={styles.skButton} />
          </div>
        </Body>
      </Screen>
    );
  }

  const confirmed = booking.status === 'CONFIRMED';
  return (
    <Screen layout="single">
      <Body>
        <div className={styles.head}>
          {confirmed ? (
            <span className={styles.success} aria-hidden="true">
              <Icon name="check" size={32} strokeWidth={2.5} />
            </span>
          ) : null}
          <h1 className={styles.title}>
            {confirmed
              ? t('confirmation.confirmed')
              : BOOKING_STATUS_LABELS[locale][booking.status]}
          </h1>
          <p className={styles.lead}>
            {confirmed ? t('confirmation.confirmedLead') : t('confirmation.inactiveLead')}
          </p>
        </div>

        <section className={styles.card} aria-label={t('confirmation.details')}>
          <div className={styles.cardHead}>
            <span>{t('confirmation.reference')}</span>
            <strong>{booking.reference}</strong>
          </div>
          <dl className={styles.rows}>
            <div>
              <dt>{t('confirmation.formula')}</dt>
              <dd>{selectionLabel(booking, t)}</dd>
            </div>
            <div>
              <dt>{t('common.date')}</dt>
              <dd>{formatLongDate(booking.date, true, locale)}</dd>
            </div>
            <div>
              <dt>{t('confirmation.time')}</dt>
              <dd>{timesLabel(booking.slots)}</dd>
            </div>
            <div>
              <dt>{t('common.mode')}</dt>
              <dd>{SESSION_MODE_LABELS[locale][booking.mode]}</dd>
            </div>
            <div>
              <dt>{confirmed ? t('confirmation.paid') : t('confirmation.amount')}</dt>
              <dd>
                <strong>{formatXof(booking.price.totalXof, locale)}</strong>
              </dd>
            </div>
          </dl>
          <div className={styles.place}>
            <Icon name={booking.mode === 'IN_PERSON' ? 'pin' : 'monitor'} size={16} />
            <span>
              <strong>{booking.spaceName}</strong>
              <br />
              {booking.mode === 'IN_PERSON'
                ? t('confirmation.inPersonNote')
                : t('confirmation.virtualNote')}
            </span>
          </div>
        </section>

        {confirmed ? (
          <div className={styles.actions}>
            <button
              type="button"
              className={buttonClass}
              onClick={downloadReceipt}
              disabled={receipt === 'loading'}
            >
              {receipt === 'loading' ? <ButtonSpinner /> : <Icon name="download" size={18} />}
              {receipt === 'loading' ? t('confirmation.preparing') : t('confirmation.download')}
            </button>
            {typeof receipt === 'object' ? <Alert tone="error">{receipt.error}</Alert> : null}
            <p className={styles.keep}>
              {t('confirmation.keepBefore')}{' '}
              <Link href="/mes-reservations">{t('confirmation.keepLink')}</Link>{' '}
              {t('confirmation.keepAfter')}
            </p>
            <button type="button" className={buttonSecondaryClass} onClick={downloadCalendar}>
              <Icon name="calendar" size={16} />
              {t('confirmation.calendar')}
            </button>
          </div>
        ) : null}
      </Body>
      <BottomBar>
        <button type="button" className={buttonDarkClass} onClick={newBooking}>
          {t('confirmation.another')}
        </button>
      </BottomBar>
    </Screen>
  );
}
