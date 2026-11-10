'use client';

import {
  formatXof,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type AdminBookingDetail,
  type PaymentMethod,
} from '@bovann/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { useI18n, type TKey } from '@/i18n/I18nProvider';
import { adminApi } from '@/lib/admin-api';
import {
  bookingStatus,
  formatAmountInput,
  formatDateTime,
  formatPhone,
  parseAmount,
  paymentMethodLabel,
  paymentStateLabel,
  paymentStatusLabel,
  SESSION_MODE_LABELS,
} from '@/lib/admin-format';
import { formatLongDate } from '@/lib/dates';
import { selectionLabel } from '@/lib/selection';
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

const NOTIFICATION_TONE = {
  PENDING: 'warning',
  SENDING: 'warning',
  SENT: 'success',
  FAILED: 'danger',
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
  const { t, locale } = useI18n();
  const money = (n: number) => formatXof(n, locale);
  const when = (iso: string) => formatDateTime(iso, undefined, locale);
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
      setRefund(formatAmountInput(paid, locale));
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
      t('drawer.paymentSaved'),
    );
  }

  function submitCancel(e: FormEvent) {
    e.preventDefault();
    if (!booking) return;
    if (!reason.trim()) {
      setFormError(t('drawer.reasonRequired'));
      return;
    }
    const amount = refund.trim() === '' ? 0 : parseAmount(refund);
    if (amount === null) {
      setFormError(t('drawer.badRefund'));
      return;
    }
    void run(
      () => adminApi.cancelBooking(booking.id, { reason: reason.trim(), refundAmountXof: amount }),
      t('drawer.cancelled'),
    );
  }

  function submitRefund(e: FormEvent) {
    e.preventDefault();
    if (!booking) return;
    void run(
      () => adminApi.markRefunded(booking.id, refundNote.trim() || null),
      t('drawer.refundSaved'),
    );
  }

  async function retryEmail(id: number) {
    setBusy(true);
    try {
      await adminApi.retryNotification(id);
      toast(t('drawer.emailQueued'));
      setReload((r) => r + 1);
    } catch (err) {
      toast(errorMessage(err), true);
    } finally {
      setBusy(false);
    }
  }

  function saveNote() {
    if (!booking) return;
    void run(() => adminApi.updateNote(booking.id, note.trim() || null), t('drawer.noteSaved'));
  }

  const status = booking ? bookingStatus(booking, t, locale) : null;
  const paid = booking?.payments.find((p) => p.status === 'SUCCEEDED');

  const footer =
    booking && mode === 'view' ? (
      <>
        {booking.can.markRefunded ? (
          <button type="button" className={styles.btn} onClick={() => startMode('refund')}>
            {t('drawer.markRefunded')}
          </button>
        ) : null}
        {booking.can.recordPayment ? (
          <button type="button" className={styles.btn} onClick={() => startMode('pay')}>
            {t('drawer.recordPayment')}
          </button>
        ) : null}
        {booking.can.cancel ? (
          <button type="button" className={styles.btnSecondary} onClick={() => startMode('cancel')}>
            {t('drawer.cancelBooking')}
          </button>
        ) : null}
      </>
    ) : undefined;

  return (
    <Dialog
      open={bookingId !== null}
      onClose={onClose}
      title={booking ? t('drawer.title', { ref: booking.reference }) : t('drawer.titleShort')}
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
              {booking.source === 'ADMIN' ? t('drawer.byStudio') : t('drawer.online')}
            </Badge>
          </div>

          {mode === 'pay' ? (
            <form className={styles.section} onSubmit={submitPayment}>
              <h3 className={styles.sectionTitle}>
                {t('drawer.recordTitle', { amount: money(booking.totalXof) })}
              </h3>
              <Field label={t('drawer.method')}>
                {(p) => (
                  <select
                    {...p}
                    className={styles.select}
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[locale][m]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              {method === 'MOBILE_MONEY' ? (
                <Field label={t('drawer.operator')}>
                  {(p) => (
                    <select
                      {...p}
                      className={styles.select}
                      value={channel}
                      onChange={(e) => setChannel(e.target.value)}
                    >
                      <option value="TMONEY">T-Money</option>
                      <option value="FLOOZ">Flooz</option>
                      <option value="OTHER">{t('drawer.other')}</option>
                    </select>
                  )}
                </Field>
              ) : null}
              <Field label={t('drawer.noteOptional')} hint={t('drawer.noteHint')}>
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
                  {busy ? t('drawer.saving') : t('drawer.confirmPayment')}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setMode('view')}
                >
                  {t('drawer.back')}
                </button>
              </div>
            </form>
          ) : null}

          {mode === 'cancel' ? (
            <form className={styles.section} onSubmit={submitCancel}>
              <h3 className={styles.sectionTitle}>{t('drawer.cancelBooking')}</h3>
              <p className={styles.note}>
                {t('drawer.cancelNote')}
                {booking.customer.email ? t('drawer.cancelEmail') : ''}
              </p>
              <Field label={t('drawer.reason')}>
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
                  label={t('drawer.refundAmount')}
                  hint={t('drawer.refundHint', { amount: money(paid.amountXof) })}
                >
                  {(p) => <AmountInput {...p} value={refund} onChange={setRefund} />}
                </Field>
              ) : (
                <p className={styles.note}>{t('drawer.nothingPaid')}</p>
              )}
              {formError ? (
                <div className={styles.banner} role="alert">
                  {formError}
                </div>
              ) : null}
              <div className={styles.formActions}>
                <button type="submit" className={styles.btnDanger} disabled={busy}>
                  {busy ? t('drawer.cancelling') : t('drawer.confirmCancel')}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setMode('view')}
                >
                  {t('drawer.back')}
                </button>
              </div>
            </form>
          ) : null}

          {mode === 'refund' ? (
            <form className={styles.section} onSubmit={submitRefund}>
              <h3 className={styles.sectionTitle}>
                {t('drawer.refundTitle', { amount: money(booking.refund.amountXof ?? 0) })}
              </h3>
              <p className={styles.note}>
                {t('drawer.refundConfirm', {
                  name: booking.customer.fullName,
                  phone: formatPhone(booking.customer.phone),
                })}
              </p>
              <Field label={t('drawer.comment')} hint={t('drawer.commentHint')}>
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
                  {busy ? t('drawer.saving') : t('drawer.refundDone')}
                </button>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setMode('view')}
                >
                  {t('drawer.back')}
                </button>
              </div>
            </form>
          ) : null}

          {booking.refund.status === 'DUE' && mode === 'view' ? (
            <div className={styles.banner}>
              {t('drawer.toRefund', { amount: money(booking.refund.amountXof ?? 0) })}
            </div>
          ) : null}

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('drawer.session')}</h3>
            <dl className={styles.dl}>
              <dt>{t('drawer.date')}</dt>
              <dd>{formatLongDate(booking.date, true, locale)}</dd>
              <dt>{t('drawer.time')}</dt>
              <dd>
                {booking.bookingType === 'PACKAGE'
                  ? `${booking.startTime} – ${booking.endTime}`
                  : booking.slots.map((s) => `${s.startTime}–${s.endTime}`).join(', ')}
              </dd>
              <dt>{t('drawer.formula')}</dt>
              <dd>{selectionLabel(booking, t)}</dd>
              <dt>{t('drawer.mode')}</dt>
              <dd>{SESSION_MODE_LABELS[locale][booking.mode]}</dd>
              <dt>{t('drawer.space')}</dt>
              <dd>{booking.spaceName}</dd>
            </dl>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('drawer.client')}</h3>
            <dl className={styles.dl}>
              <dt>{t('drawer.name')}</dt>
              <dd>{booking.customer.fullName}</dd>
              <dt>{t('drawer.business')}</dt>
              <dd>
                {booking.customer.businessName} · {booking.customer.businessSector}
              </dd>
              <dt>{t('drawer.phone')}</dt>
              <dd>
                <a href={`tel:${booking.customer.phone}`}>{formatPhone(booking.customer.phone)}</a>
              </dd>
              <dt>{t('drawer.email')}</dt>
              <dd>
                {booking.customer.email ? (
                  <a href={`mailto:${booking.customer.email}`}>{booking.customer.email}</a>
                ) : (
                  <span className={styles.muted}>{t('drawer.notGiven')}</span>
                )}
              </dd>
              {booking.liveDescription ? (
                <>
                  <dt>{t('drawer.live')}</dt>
                  <dd>{booking.liveDescription}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('drawer.payment')}</h3>
            <dl className={styles.dl}>
              {booking.discountXof > 0 ? (
                <>
                  <dt>{t('drawer.unitPrice')}</dt>
                  <dd>{money(booking.listPriceXof)}</dd>
                  <dt>{t('drawer.discount')}</dt>
                  <dd>−{money(booking.discountXof)}</dd>
                </>
              ) : null}
              <dt>{t('drawer.total')}</dt>
              <dd>
                <strong>{money(booking.totalXof)}</strong>
              </dd>
              <dt>{t('drawer.state')}</dt>
              <dd>{paymentStateLabel(booking.paymentState, t)}</dd>
            </dl>
            {booking.payments.length > 0 ? (
              <ul className={styles.timeline}>
                {booking.payments.map((p) => (
                  <li key={p.id}>
                    <span>
                      {paymentMethodLabel(p.method, p.channel, locale)} · {money(p.amountXof)} ·{' '}
                      <Badge tone={paymentStatusLabel(p.status, t).tone}>
                        {paymentStatusLabel(p.status, t).label}
                      </Badge>
                    </span>
                    <span className={styles.cellSub}>
                      {when(p.succeededAt ?? p.createdAt)}
                      {p.recordedBy ? t('drawer.recordedBy', { name: p.recordedBy }) : ''}
                      {p.note ? ` · ${p.note}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {booking.refund.status === 'DONE' ? (
              <p className={styles.note}>
                {t('drawer.refunded', { amount: money(booking.refund.amountXof ?? 0) })}
                {booking.refund.refundedAt
                  ? t('drawer.on', { when: when(booking.refund.refundedAt) })
                  : ''}
                {booking.refund.note ? ` · ${booking.refund.note}` : ''}
              </p>
            ) : null}
          </section>

          {booking.cancelledAt ? (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>{t('drawer.cancellation')}</h3>
              <p className={styles.note}>
                {when(booking.cancelledAt)}
                {booking.cancelledBy ? t('drawer.by', { name: booking.cancelledBy }) : ''}
                {booking.cancelledBy && booking.cancelReason ? ` · ${booking.cancelReason}` : ''}
              </p>
            </section>
          ) : null}

          {booking.notifications.length > 0 ? (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>{t('drawer.emails')}</h3>
              <ul className={styles.timeline}>
                {booking.notifications.map((n) => (
                  <li key={n.id}>
                    <span>
                      {n.label} · {n.recipient}{' '}
                      <Badge tone={NOTIFICATION_TONE[n.status]}>
                        {t(`drawer.notif.${n.status}` as TKey)}
                      </Badge>
                    </span>
                    <span className={styles.cellSub}>
                      {n.sentAt
                        ? t('drawer.sentOn', { when: when(n.sentAt) })
                        : n.status === 'FAILED'
                          ? t('drawer.failedAfter', { count: n.attempts })
                          : n.attempts > 0
                            ? t('drawer.retryPlanned', { count: n.attempts })
                            : t('drawer.queued')}
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
                          {t('drawer.resend')}
                        </button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('drawer.internalNote')}</h3>
            <textarea
              className={styles.textarea}
              aria-label={t('drawer.internalLabel')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('drawer.internalPlaceholder')}
            />
            {note !== (booking.adminNote ?? '') ? (
              <div>
                <button
                  type="button"
                  className={cx(styles.btnSecondary, styles.btnSmall)}
                  onClick={saveNote}
                  disabled={busy}
                >
                  {t('drawer.saveNote')}
                </button>
              </div>
            ) : null}
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t('drawer.history')}</h3>
            <ul className={styles.timeline}>
              {booking.history.map((h, i) => (
                <li key={i}>
                  <span>{h.label}</span>
                  <span className={styles.cellSub}>
                    {when(h.at)} · {h.actor}
                  </span>
                </li>
              ))}
              {booking.createdBy && booking.history.length === 0 ? (
                <li>{t('drawer.addedBy', { name: booking.createdBy })}</li>
              ) : null}
            </ul>
          </section>
        </>
      )}
    </Dialog>
  );
}
