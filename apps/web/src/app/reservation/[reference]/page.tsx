'use client';

import type { BookingDto } from '@bovann/shared';
import { BOOKING_STATUS_LABELS_FR, SESSION_MODE_LABELS_FR, formatXof } from '@bovann/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
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
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatLongDate } from '@/lib/dates';
import { bookingToIcs } from '@/lib/ics';
import { timesLabel } from '@/lib/selection';
import { tokenFor } from '@/lib/tokens';
import styles from './page.module.css';

/** Screen 6: confirmation, reachable later from the same browser. */
export default function BookingPage() {
  const params = useParams<{ reference: string }>();
  const reference = decodeURIComponent(params.reference);
  const router = useRouter();
  const { flow, ready, reset } = useFlow();
  const [booking, setBooking] = useState<BookingDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const token =
      flow.booking?.reference === reference ? flow.booking.accessToken : tokenFor(reference);
    if (!token) {
      setError('Cette réservation n’est pas enregistrée sur cet appareil.');
      return;
    }
    api
      .booking(reference, token)
      .then((b) => {
        if (b.status === 'PENDING_PAYMENT') router.replace('/reserver/paiement');
        else setBooking(b);
      })
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'Une erreur est survenue.'),
      );
  }, [ready, reference, flow.booking, router]);

  function downloadCalendar() {
    if (!booking) return;
    const blob = new Blob([bookingToIcs(booking)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bovann-${booking.reference}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function newBooking() {
    reset();
    router.push('/');
  }

  if (error) {
    return (
      <Screen layout="single">
        <Body>
          <Alert tone="error" title="Réservation introuvable">
            {error}
          </Alert>
          <Link
            href={`/mes-reservations?ref=${encodeURIComponent(reference)}`}
            className={buttonClass}
          >
            Retrouver ma réservation
          </Link>
          <Link href="/" className={buttonSecondaryClass}>
            Retour à l’accueil
          </Link>
        </Body>
      </Screen>
    );
  }

  if (!booking) {
    return (
      <Screen layout="single">
        <Body>
          <div
            className={styles.loading}
            role="status"
            aria-label="Chargement de votre réservation…"
          >
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
            {confirmed ? 'Réservation confirmée' : BOOKING_STATUS_LABELS_FR[booking.status]}
          </h1>
          <p className={styles.lead}>
            {confirmed
              ? 'Paiement reçu. Le studio a été prévenu ; vous recevrez aussi un récapitulatif.'
              : 'Cette réservation n’est pas active. Vous pouvez en faire une nouvelle.'}
          </p>
        </div>

        <section className={styles.card} aria-label="Détails de la réservation">
          <div className={styles.cardHead}>
            <span>Référence</span>
            <strong>{booking.reference}</strong>
          </div>
          <dl className={styles.rows}>
            <div>
              <dt>Formule</dt>
              <dd>
                {booking.packageName ??
                  `${booking.slotCount} créneau${booking.slotCount > 1 ? 'x' : ''}`}
              </dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{formatLongDate(booking.date, true)}</dd>
            </div>
            <div>
              <dt>Horaire</dt>
              <dd>{timesLabel(booking.slots)}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{SESSION_MODE_LABELS_FR[booking.mode]}</dd>
            </div>
            <div>
              <dt>{confirmed ? 'Payé' : 'Montant'}</dt>
              <dd>
                <strong>{formatXof(booking.price.totalXof)}</strong>
              </dd>
            </div>
          </dl>
          <div className={styles.place}>
            <Icon name={booking.mode === 'IN_PERSON' ? 'pin' : 'monitor'} size={16} />
            <span>
              <strong>{booking.spaceName}</strong>
              <br />
              {booking.mode === 'IN_PERSON'
                ? 'Présentez votre référence à votre arrivée au studio.'
                : 'Le studio vous contactera pour organiser votre live à distance.'}
            </span>
          </div>
        </section>

        {confirmed ? (
          <button type="button" className={buttonSecondaryClass} onClick={downloadCalendar}>
            <Icon name="calendar" size={16} />
            Ajouter à mon calendrier
          </button>
        ) : null}
      </Body>
      <BottomBar>
        <button type="button" className={buttonDarkClass} onClick={newBooking}>
          Faire une autre réservation
        </button>
      </BottomBar>
    </Screen>
  );
}
