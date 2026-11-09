'use client';

import {
  formatXof,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS_FR,
  type AdminBookingDetail,
  type PaymentMethod,
} from '@bovann/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { adminApi } from '@/lib/admin-api';
import {
  bookingStatus,
  formatAmountInput,
  formatDateTime,
  formatPhone,
  parseAmount,
  paymentMethodLabel,
  paymentStateLabel,
  PAYMENT_STATUS_LABELS,
  SESSION_MODE_LABELS_FR,
} from '@/lib/admin-format';
import { formatLongDate } from '@/lib/dates';
import {
  AmountInput,
  Badge,
  cx,
  Dialog,
  errorMessage,
  Field,
  LoadError,
  Loading,
  adminStyles as styles,
  useToast,
} from './ui';

type Mode = 'view' | 'pay' | 'cancel' | 'refund';

const NOTIFICATION_STATUS = {
  PENDING: { label: 'En attente', tone: 'warning' },
  SENDING: { label: 'En cours', tone: 'warning' },
  SENT: { label: 'Envoyé', tone: 'success' },
  FAILED: { label: 'Échec', tone: 'danger' },
} as const;

/** Booking detail in a side panel, with the actions the signed-in admin may take. */
export function BookingDrawer({
  bookingId,
  onClose,
  onChanged,
}: {
  bookingId: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [booking, setBooking] = useState<AdminBookingDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reload, setReload] = useState(0);

  // payment / cancel / refund form values
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [channel, setChannel] = useState('TMONEY');
  const [payNote, setPayNote] = useState('');
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState('');
  const [refundNote, setRefundNote] = useState('');

  useEffect(() => {
    if (bookingId === null) return;
    let cancelled = false;
    setError(null);
    adminApi.booking(bookingId).then(
      (b) => {
        if (cancelled) return;
        setBooking(b);
        setNote(b.adminNote ?? '');
      },
      (err: unknown) => !cancelled && setError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [bookingId, reload]);

  useEffect(() => {
    if (bookingId === null) {
      setBooking(null);
      setMode('view');
      setFormError(null);
    }
  }, [bookingId]);

  function startMode(next: Mode) {
    setFormError(null);
    if (next === 'cancel' && booking) {
      const paid = booking.payments.find((p) => p.status === 'SUCCEEDED')?.amountXof ?? 0;
      setRefund(formatAmountInput(paid));
      setReason('');
    }
    setMode(next);
  }

  async function run(action: () => Promise<AdminBookingDetail>, success: string) {
    setBusy(true);
    setFormError(null);
    try {
      const updated = await action();
      setBooking(updated);
      setNote(updated.adminNote ?? '');
      setMode('view');
      toast(success);
      onChanged();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submitPayment(e: FormEvent) {
    e.preventDefault();
    if (!booking) return;
    void run(
      () =>
        adminApi.recordPayment(booking.id, {
          method,
          channel: method === 'MOBILE_MONEY' ? channel : null,
          note: payNote.trim() || null,
        }),
      'Paiement enregistré.',
    );
  }

  function submitCancel(e: FormEvent) {
    e.preventDefault();
    if (!booking) return;
    if (!reason.trim()) {
      setFormError('Indiquez le motif de l’annulation.');
      return;
    }
    const amount = refund.trim() === '' ? 0 : parseAmount(refund);
    if (amount === null) {
      setFormError('Montant à rembourser invalide.');
      return;
    }
    void run(
      () => adminApi.cancelBooking(booking.id, { reason: reason.trim(), refundAmountXof: amount }),
      'Réservation annulée, créneaux libérés.',
    );
  }

  function submitRefund(e: FormEvent) {
    e.preventDefault();
    if (!booking) return;
    void run(
      () => adminApi.markRefunded(booking.id, refundNote.trim() || null),
      'Remboursement enregistré.',
    );
  }

  async function retryEmail(id: number) {
    setBusy(true);
    try {
      await adminApi.retryNotification(id);
      toast('E-mail remis dans la file d’envoi.');
      setReload((r) => r + 1);
    } catch (err) {
      toast(errorMessage(err), true);
    } finally {
      setBusy(false);
    }
  }

  function saveNote() {
    if (!booking) return;
    void run(() => adminApi.updateNote(booking.id, note.trim() || null), 'Note enregistrée.');
  }

  const status = booking ? bookingStatus(booking) : null;
  const paid = booking?.payments.find((p) => p.status === 'SUCCEEDED');

  const footer =
    booking && mode === 'view' ? (
      <>
        {booking.can.markRefunded ? (
          <button type="button" className={styles.btn} onClick={() => startMode('refund')}>
            Marquer comme remboursée
          </button>
        ) : null}
        {booking.can.recordPayment ? (
          <button type="button" className={styles.btn} onClick={() => startMode('pay')}>
            Enregistrer le paiement
          </button>
        ) : null}
        {booking.can.cancel ? (
          <button type="button" className={styles.btnSecondary} onClick={() => startMode('cancel')}>
            Annuler la réservation
          </button>
        ) : null}
      </>
    ) : undefined;

  return (
    <Dialog
      open={bookingId !== null}
      onClose={onClose}
      title={booking ? `Réservation ${booking.reference}` : 'Réservation'}
      footer={footer}
    >
      {error ? (
        <LoadError error={error} onRetry={() => setReload((r) => r + 1)} />
      ) : !booking ? (
        <Loading />
      ) : (
        <>
          <div className={styles.actions}>
            <Badge tone={status!.tone}>{status!.label}</Badge>
            <Badge tone="neutral">
              {booking.source === 'ADMIN' ? 'Ajoutée par le studio' : 'En ligne'}
            </Badge>
          </div>

          {mode === 'pay' ? (
            <form className={styles.section} onSubmit={submitPayment}>
              <h3 className={styles.sectionTitle}>
                Enregistrer le paiement · {formatXof(booking.totalXof)}
              </h3>
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
              <Field
                label="Note (facultatif)"
                hint="Par exemple&nbsp;: numéro de transaction, reçu…"
              >
                {(p) => (
                  <input
                    {...p}
                    className={styles.input}
                    value={payNote}
                    onChange={(e) => setPayNote(e.target.value)}
                  />
                )}
              </Field>
              {formError ? (
                <div className={styles.banner} role="alert">
                  {formError}
                </div>
              ) : null}
              <div className={styles.formActions}>
                <button type="submit" className={styles.btn} disabled={busy}>
                  {busy ? 'Enregistrement…' : 'Confirmer le paiement'}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setMode('view')}
                >
                  Retour
                </button>
              </div>
            </form>
          ) : null}

          {mode === 'cancel' ? (
            <form className={styles.section} onSubmit={submitCancel}>
              <h3 className={styles.sectionTitle}>Annuler la réservation</h3>
              <p className={styles.note}>
                Les créneaux seront libérés immédiatement.
                {booking.customer.email ? ' Le client sera prévenu par e-mail.' : ''}
              </p>
              <Field label="Motif (visible dans l’historique)">
                {(p) => (
                  <textarea
                    {...p}
                    className={styles.textarea}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                )}
              </Field>
              {paid ? (
                <Field
                  label="Montant à rembourser"
                  hint={`Payé\u00a0: ${formatXof(paid.amountXof)}. Mettez 0 si rien n’est remboursé.`}
                >
                  {(p) => <AmountInput {...p} value={refund} onChange={setRefund} />}
                </Field>
              ) : (
                <p className={styles.note}>Aucun paiement reçu&nbsp;: rien à rembourser.</p>
              )}
              {formError ? (
                <div className={styles.banner} role="alert">
                  {formError}
                </div>
              ) : null}
              <div className={styles.formActions}>
                <button type="submit" className={styles.btnDanger} disabled={busy}>
                  {busy ? 'Annulation…' : 'Confirmer l’annulation'}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setMode('view')}
                >
                  Retour
                </button>
              </div>
            </form>
          ) : null}

          {mode === 'refund' ? (
            <form className={styles.section} onSubmit={submitRefund}>
              <h3 className={styles.sectionTitle}>
                Remboursement de {formatXof(booking.refund.amountXof ?? 0)}
              </h3>
              <p className={styles.note}>
                Confirmez une fois l’argent rendu au client ({booking.customer.fullName},{' '}
                {formatPhone(booking.customer.phone)}).
              </p>
              <Field
                label="Commentaire (facultatif)"
                hint="Par exemple&nbsp;: «&nbsp;Renvoyé par T-Money, réf. 123&nbsp;»."
              >
                {(p) => (
                  <input
                    {...p}
                    className={styles.input}
                    value={refundNote}
                    onChange={(e) => setRefundNote(e.target.value)}
                  />
                )}
              </Field>
              {formError ? (
                <div className={styles.banner} role="alert">
                  {formError}
                </div>
              ) : null}
              <div className={styles.formActions}>
                <button type="submit" className={styles.btn} disabled={busy}>
                  {busy ? 'Enregistrement…' : 'Remboursement effectué'}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setMode('view')}
                >
                  Retour
                </button>
              </div>
            </form>
          ) : null}

          {booking.refund.status === 'DUE' && mode === 'view' ? (
            <div className={styles.banner}>
              À rembourser : {formatXof(booking.refund.amountXof ?? 0)}
            </div>
          ) : null}

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Séance</h3>
            <dl className={styles.dl}>
              <dt>Date</dt>
              <dd>{formatLongDate(booking.date, true)}</dd>
              <dt>Horaire</dt>
              <dd>
                {booking.bookingType === 'PACKAGE'
                  ? `${booking.startTime} – ${booking.endTime}`
                  : booking.slots.map((s) => `${s.startTime}–${s.endTime}`).join(', ')}
              </dd>
              <dt>Formule</dt>
              <dd>
                {booking.packageName ??
                  `${booking.slotCount} créneau${booking.slotCount > 1 ? 'x' : ''}`}
              </dd>
              <dt>Mode</dt>
              <dd>{SESSION_MODE_LABELS_FR[booking.mode]}</dd>
              <dt>Espace</dt>
              <dd>{booking.spaceName}</dd>
            </dl>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Client</h3>
            <dl className={styles.dl}>
              <dt>Nom</dt>
              <dd>{booking.customer.fullName}</dd>
              <dt>Entreprise</dt>
              <dd>
                {booking.customer.businessName} · {booking.customer.businessSector}
              </dd>
              <dt>Téléphone</dt>
              <dd>
                <a href={`tel:${booking.customer.phone}`}>{formatPhone(booking.customer.phone)}</a>
              </dd>
              <dt>E-mail</dt>
              <dd>
                {booking.customer.email ? (
                  <a href={`mailto:${booking.customer.email}`}>{booking.customer.email}</a>
                ) : (
                  <span className={styles.muted}>Non renseigné</span>
                )}
              </dd>
              {booking.liveDescription ? (
                <>
                  <dt>Le live</dt>
                  <dd>{booking.liveDescription}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Paiement</h3>
            <dl className={styles.dl}>
              {booking.discountXof > 0 ? (
                <>
                  <dt>Prix à l’unité</dt>
                  <dd>{formatXof(booking.listPriceXof)}</dd>
                  <dt>Réduction</dt>
                  <dd>−{formatXof(booking.discountXof)}</dd>
                </>
              ) : null}
              <dt>Total</dt>
              <dd>
                <strong>{formatXof(booking.totalXof)}</strong>
              </dd>
              <dt>État</dt>
              <dd>{paymentStateLabel(booking.paymentState)}</dd>
            </dl>
            {booking.payments.length > 0 ? (
              <ul className={styles.timeline}>
                {booking.payments.map((p) => (
                  <li key={p.id}>
                    <span>
                      {paymentMethodLabel(p.method, p.channel)} · {formatXof(p.amountXof)} ·{' '}
                      <Badge tone={PAYMENT_STATUS_LABELS[p.status].tone}>
                        {PAYMENT_STATUS_LABELS[p.status].label}
                      </Badge>
                    </span>
                    <span className={styles.cellSub}>
                      {formatDateTime(p.succeededAt ?? p.createdAt)}
                      {p.recordedBy ? ` · enregistré par ${p.recordedBy}` : ''}
                      {p.note ? ` · ${p.note}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {booking.refund.status === 'DONE' ? (
              <p className={styles.note}>
                Remboursé : {formatXof(booking.refund.amountXof ?? 0)}
                {booking.refund.refundedAt
                  ? ` le ${formatDateTime(booking.refund.refundedAt)}`
                  : ''}
                {booking.refund.note ? ` · ${booking.refund.note}` : ''}
              </p>
            ) : null}
          </section>

          {booking.cancelledAt ? (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Annulation</h3>
              <p className={styles.note}>
                {formatDateTime(booking.cancelledAt)}
                {booking.cancelledBy ? ` par ${booking.cancelledBy}` : ''}
                {booking.cancelledBy && booking.cancelReason ? ` · ${booking.cancelReason}` : ''}
              </p>
            </section>
          ) : null}

          {booking.notifications.length > 0 ? (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>E-mails</h3>
              <ul className={styles.timeline}>
                {booking.notifications.map((n) => (
                  <li key={n.id}>
                    <span>
                      {n.label} · {n.recipient}{' '}
                      <Badge tone={NOTIFICATION_STATUS[n.status].tone}>
                        {NOTIFICATION_STATUS[n.status].label}
                      </Badge>
                    </span>
                    <span className={styles.cellSub}>
                      {n.sentAt
                        ? `Envoyé le ${formatDateTime(n.sentAt)}`
                        : n.status === 'FAILED'
                          ? `Échec après ${n.attempts} tentative${n.attempts > 1 ? 's' : ''}`
                          : n.attempts > 0
                            ? `Nouvelle tentative prévue (${n.attempts} échec${n.attempts > 1 ? 's' : ''})`
                            : 'En file d’attente'}
                      {n.lastError && n.status !== 'SENT' ? ` · ${n.lastError}` : ''}
                    </span>
                    {n.status === 'FAILED' ? (
                      <span>
                        <button
                          type="button"
                          className={cx(styles.btnSecondary, styles.btnSmall)}
                          onClick={() => retryEmail(n.id)}
                          disabled={busy}
                        >
                          Renvoyer
                        </button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Note interne</h3>
            <textarea
              className={styles.textarea}
              aria-label="Note interne (visible uniquement par le studio)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Visible uniquement par l’équipe du studio"
            />
            {note !== (booking.adminNote ?? '') ? (
              <div>
                <button
                  type="button"
                  className={cx(styles.btnSecondary, styles.btnSmall)}
                  onClick={saveNote}
                  disabled={busy}
                >
                  Enregistrer la note
                </button>
              </div>
            ) : null}
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Historique</h3>
            <ul className={styles.timeline}>
              {booking.history.map((h, i) => (
                <li key={i}>
                  <span>{h.label}</span>
                  <span className={styles.cellSub}>
                    {formatDateTime(h.at)} · {h.actor}
                  </span>
                </li>
              ))}
              {booking.createdBy && booking.history.length === 0 ? (
                <li>Ajoutée par {booking.createdBy}</li>
              ) : null}
            </ul>
          </section>
        </>
      )}
    </Dialog>
  );
}
