'use client';

import type { BookingDto } from '@bovann/shared';
import { BOOKING_STATUS_LABELS_FR, SESSION_MODE_LABELS_FR, formatXof } from '@bovann/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { CountrySelect } from '@/components/CountrySelect';
import { Icon } from '@/components/icons';
import {
  Alert,
  Body,
  ButtonSpinner,
  PageTitle,
  Screen,
  SkeletonBlock,
  buttonClass,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatLongDate } from '@/lib/dates';
import { COUNTRY_CODES, composePhone, isValidE164 } from '@/lib/details';
import { timesLabel } from '@/lib/selection';
import { forgetToken, rememberToken, rememberedBookings } from '@/lib/tokens';
import styles from './page.module.css';

const REFERENCE = /^BOV-\d{4}-[0-9A-Z]{5}$/;

/** Upcoming active bookings first (soonest first), then the rest (most recent first). */
function sortBookings(
  list: BookingDto[],
  now: number,
): { upcoming: BookingDto[]; past: BookingDto[] } {
  const end = (b: BookingDto) => Date.parse(b.slots[b.slots.length - 1]?.end ?? b.date);
  const active = (b: BookingDto) => b.status === 'CONFIRMED' || b.status === 'PENDING_PAYMENT';
  const upcoming = list.filter((b) => active(b) && end(b) > now);
  const past = list.filter((b) => !upcoming.includes(b));
  upcoming.sort((a, b) => a.slots[0]!.start.localeCompare(b.slots[0]!.start));
  past.sort((a, b) => b.slots[0]!.start.localeCompare(a.slots[0]!.start));
  return { upcoming, past };
}

function BookingCard({ b }: { b: BookingDto }) {
  const tone =
    b.status === 'CONFIRMED'
      ? styles.ok
      : b.status === 'PENDING_PAYMENT'
        ? styles.wait
        : styles.off;
  return (
    <Link href={`/reservation/${b.reference}`} className={styles.card}>
      <span className={styles.cardMain}>
        <span className={styles.cardDate}>{formatLongDate(b.date, true)}</span>
        <span className={styles.cardMeta}>
          {timesLabel(b.slots)} ·{' '}
          {b.packageName ?? `${b.slotCount} créneau${b.slotCount > 1 ? 'x' : ''}`} ·{' '}
          {SESSION_MODE_LABELS_FR[b.mode]}
        </span>
        <span className={styles.cardRef}>
          {b.reference} · {formatXof(b.price.totalXof)}
        </span>
      </span>
      <span className={`${styles.badge} ${tone}`}>{BOOKING_STATUS_LABELS_FR[b.status]}</span>
      <Icon name="next" size={18} className={styles.chevron} />
    </Link>
  );
}

/** "Mes réservations": no account. Bookings made on this device, and a lookup for the others. */
export function MyBookings() {
  const router = useRouter();
  const [bookings, setBookings] = useState<BookingDto[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reference, setReference] = useState('');
  const [countryCode, setCountryCode] = useState<string>(COUNTRY_CODES[0]!.code);
  const [localPhone, setLocalPhone] = useState('');
  const [errors, setErrors] = useState<{ reference?: string; phone?: string; form?: string }>({});
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    // Reference prefilled from links such as /mes-reservations?ref=BOV-2611-ABCDE.
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) setReference(ref.toUpperCase());

    const saved = rememberedBookings();
    Promise.allSettled(saved.map((s) => api.booking(s.reference, s.token))).then((results) => {
      const found: BookingDto[] = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') found.push(r.value);
        else if (r.reason instanceof ApiError && r.reason.status === 404)
          forgetToken(saved[i]!.reference);
        else setLoadError(true);
      });
      setBookings(found);
    });
  }, []);

  async function search(e: FormEvent) {
    e.preventDefault();
    const ref = reference.trim().toUpperCase();
    const phone = composePhone(countryCode, localPhone);
    const next: typeof errors = {};
    if (!REFERENCE.test(ref))
      next.reference = 'Indiquez la référence reçue à la réservation, par exemple BOV-2611-7KQ4M.';
    if (!isValidE164(phone)) next.phone = 'Indiquez le numéro utilisé pour réserver.';
    setErrors(next);
    if (next.reference || next.phone) return;

    setSearching(true);
    try {
      const res = await api.lookupBooking(ref, phone);
      rememberToken(res.booking.reference, res.accessToken);
      router.push(`/reservation/${res.booking.reference}`);
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : 'Une erreur est survenue.' });
      setSearching(false);
    }
  }

  const groups = bookings ? sortBookings(bookings, Date.now()) : null;

  return (
    <Screen layout="single">
      <Body>
        <PageTitle sub="Sans compte : vos réservations faites sur cet appareil, et celles que vous retrouvez avec leur référence.">
          Mes réservations
        </PageTitle>

        <section className={styles.section} aria-labelledby="device-heading">
          <h2 id="device-heading" className={styles.heading}>
            Sur cet appareil
          </h2>
          {!groups ? (
            <div className={styles.list} role="status" aria-label="Chargement de vos réservations…">
              <SkeletonBlock className={styles.cardSkeleton} />
              <SkeletonBlock className={styles.cardSkeleton} />
            </div>
          ) : groups.upcoming.length + groups.past.length === 0 ? (
            <div className={styles.empty}>
              <p>Aucune réservation enregistrée sur cet appareil.</p>
              <Link href="/" className={styles.emptyLink}>
                Réserver un live
              </Link>
            </div>
          ) : (
            <>
              {groups.upcoming.length ? (
                <div className={styles.list}>
                  {groups.upcoming.map((b) => (
                    <BookingCard key={b.reference} b={b} />
                  ))}
                </div>
              ) : null}
              {groups.past.length ? (
                <>
                  <h3 className={styles.subheading}>Passées ou annulées</h3>
                  <div className={styles.list}>
                    {groups.past.map((b) => (
                      <BookingCard key={b.reference} b={b} />
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
          {loadError ? (
            <Alert tone="warning">
              Certaines réservations n’ont pas pu être chargées. Vérifiez votre connexion et
              rechargez la page.
            </Alert>
          ) : null}
        </section>

        <section className={styles.section} aria-labelledby="find-heading">
          <h2 id="find-heading" className={styles.heading}>
            Retrouver une réservation
          </h2>
          <p className={styles.intro}>
            Réservé depuis un autre téléphone ou ordinateur&nbsp;? Indiquez la référence (dans votre
            confirmation) et le numéro de téléphone donné à la réservation.
          </p>
          <form className={styles.form} onSubmit={search} noValidate>
            <div className={styles.field}>
              <label htmlFor="lookup-ref">Référence</label>
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
              <label htmlFor="lookup-phone">Téléphone</label>
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
              {searching ? 'Recherche…' : 'Retrouver ma réservation'}
            </button>
          </form>
        </section>
      </Body>
    </Screen>
  );
}
