'use client';

import {
  checkLiveLink,
  cleanShortText,
  LIVE_COUNTRIES,
  LIVE_DURATIONS_MIN,
  LIVE_PLATFORM_LABELS,
  SELLER_NAME_MIN,
  type AdminLiveDto,
  type AdminSellerDto,
  type LivePrices,
  type PassPlan,
  formatXof,
  type AdminLiveTab,
  type LiveCategoryDto,
  type ReviewPeriod,
} from '@bovann/shared';
import { useEffect, useMemo, useState } from 'react';
import { useAdmin } from '@/components/admin/AdminShell';
import {
  adminStyles as styles,
  Badge,
  cx,
  Dialog,
  Empty,
  errorMessage,
  Field,
  LoadError,
  Loading,
  PageHeader,
  Tabs,
  TimeSelect,
  useAsync,
  useToast,
} from '@/components/admin/ui';
import { CategoryIcon } from '@/components/lives/CategoryIcon';
import { Flag } from '@/components/lives/Flag';
import { Icon } from '@/components/icons';
import { Link, useI18n, type TKey } from '@/i18n/I18nProvider';
import { adminApi } from '@/lib/admin-api';
import { weekdayNames } from '@/lib/dates';
import { formatAmountInput, formatPhone, parseAmount } from '@/lib/admin-format';
import { CATEGORY_HUES, initialsOf, lomeTime, nextOpening, OTHER_CATEGORY } from '@/lib/lives';
import local from './lives.module.css';

/** "Lives": what is on the "En direct" page now, and listing a live for a seller. */
type View = AdminLiveTab | 'sellers' | 'prices' | 'hours';
const LIST_TABS: AdminLiveTab[] = ['pending', 'awaiting', 'online', 'past'];

export default function AdminLivesPage() {
  const { t, locale } = useI18n();
  const { refreshCounters } = useAdmin();
  const toast = useToast();
  const [tab, setTab] = useState<View>('pending');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AdminLiveDto | null>(null);
  const [rejecting, setRejecting] = useState<AdminLiveDto | null>(null);
  const [approving, setApproving] = useState<number | null>(null);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const listTab: AdminLiveTab = LIST_TABS.includes(tab as AdminLiveTab)
    ? (tab as AdminLiveTab)
    : 'pending';
  const list = useAsync(() => adminApi.lives(listTab), listTab);
  const categories = useAsync(() => adminApi.liveCategories(), 'categories');
  const { reload } = list;

  useEffect(() => {
    if (list.data) setLoadedAt(Date.now());
  }, [list.data]);

  // The review queue refreshes by itself (sellers post at any moment during review hours).
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const refresh = window.setInterval(() => {
      if (document.visibilityState === 'visible' && listTab === 'pending') {
        reload();
        refreshCounters();
      }
    }, 20_000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(refresh);
    };
  }, [listTab, reload, refreshCounters]);

  async function approve(live: AdminLiveDto) {
    setApproving(live.id);
    try {
      await adminApi.approveLive(live.id);
      toast(t('adminLives.approved', { name: live.sellerName }));
    } catch (error) {
      toast(errorMessage(error), true);
    } finally {
      setApproving(null);
      reload();
      refreshCounters();
    }
  }

  const review = list.data?.review;
  const reviewChip = !review ? null : review.open && review.closesAt ? (
    <span className={cx(local.reviewChip, local.reviewOpen)}>
      <span className={local.reviewDot} />
      {t('adminLives.reviewOpen', { time: lomeTime(review.closesAt, locale) })}
    </span>
  ) : (
    <span className={local.reviewChip}>
      {review.nextOpensAt
        ? (() => {
            const next = nextOpening(review.nextOpensAt, now, locale, t);
            return t('adminLives.reviewClosed', {
              when: next.day ? `${next.day} ${next.time}` : next.time,
            });
          })()
        : t('adminLives.reviewNone')}
    </span>
  );

  return (
    <>
      <PageHeader
        title={t('adminLives.title')}
        sub={t('adminLives.sub')}
        actions={
          <>
            <Link href="/en-direct" target="_blank" className={styles.btnSecondary}>
              {t('adminLives.viewWall')}
            </Link>
            <button type="button" className={styles.btn} onClick={() => setAdding(true)}>
              <Icon name="plus" size={16} />
              {t('adminLives.add')}
            </button>
          </>
        }
      />

      <div className={local.statusRow}>
        {reviewChip}
        {tab === 'pending' && list.data ? (
          <span className={local.refreshed}>
            {t('adminLives.refreshed', { s: Math.max(0, Math.round((now - loadedAt) / 1000)) })}
          </span>
        ) : null}
      </div>

      <Tabs
        label={t('adminLives.tabs')}
        value={tab}
        onChange={setTab}
        options={[
          {
            value: 'pending',
            label: t('adminLives.pending'),
            count: list.data?.pendingCount,
          },
          {
            value: 'awaiting',
            label: t('adminLives.awaiting'),
            count: tab === 'awaiting' ? list.data?.lives.length : undefined,
          },
          {
            value: 'online',
            label: t('adminLives.online'),
            count: tab === 'online' ? list.data?.lives.length : undefined,
          },
          { value: 'past', label: t('adminLives.past') },
          { value: 'sellers', label: t('adminLives.sellers') },
          { value: 'prices', label: t('adminLives.prices') },
          { value: 'hours', label: t('adminLives.hours') },
        ]}
      />

      {tab === 'hours' ? (
        <ReviewHoursEditor />
      ) : tab === 'sellers' ? (
        <SellersPanel />
      ) : tab === 'prices' ? (
        <PricesEditor />
      ) : list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.lives.length === 0 ? (
        <Empty
          action={
            tab === 'online' ? (
              <button type="button" className={styles.btn} onClick={() => setAdding(true)}>
                {t('adminLives.add')}
              </button>
            ) : undefined
          }
        >
          {tab === 'pending'
            ? t('adminLives.emptyPending')
            : tab === 'awaiting'
              ? t('adminLives.emptyAwaiting')
              : tab === 'online'
                ? t('adminLives.empty')
                : t('adminLives.emptyPast')}
        </Empty>
      ) : (
        <ul className={local.list}>
          {list.data.lives.map((live) => (
            <LiveRow
              key={live.id}
              live={live}
              mode={tab}
              busy={approving === live.id}
              onRemove={() => setRemoving(live)}
              onApprove={() => void approve(live)}
              onReject={() => setRejecting(live)}
            />
          ))}
        </ul>
      )}

      <AddLiveDialog
        open={adding}
        categories={categories.data ?? []}
        onClose={() => setAdding(false)}
        onCreated={() => {
          setAdding(false);
          if (tab === 'online') list.reload();
          else setTab('online');
        }}
      />
      <RemoveLiveDialog
        live={removing}
        onClose={() => setRemoving(null)}
        onRemoved={() => {
          setRemoving(null);
          list.reload();
        }}
      />
      <RejectLiveDialog
        live={rejecting}
        onClose={() => setRejecting(null)}
        onRejected={() => {
          setRejecting(null);
          list.reload();
          refreshCounters();
        }}
      />
    </>
  );
}

function useTime() {
  const { space } = useAdmin();
  const { locale } = useI18n();
  return useMemo(() => {
    const time = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: space.timezone,
    });
    const day = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: space.timezone,
    });
    return {
      time: (iso: string) => time.format(new Date(iso)),
      day: (iso: string) => day.format(new Date(iso)),
    };
  }, [locale, space.timezone]);
}

function LiveRow({
  live,
  mode,
  busy,
  onRemove,
  onApprove,
  onReject,
}: {
  live: AdminLiveDto;
  mode: AdminLiveTab;
  busy: boolean;
  onRemove: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const online = mode === 'online';
  const pending = mode === 'pending' && live.status === 'PENDING';
  const { t } = useI18n();
  const fmt = useTime();
  const platform = LIVE_PLATFORM_LABELS[live.platform];
  return (
    <li className={cx(styles.card, local.row)}>
      <span className={local.avatar} style={{ background: CATEGORY_HUES[live.categoryIcon] }}>
        {initialsOf(live.sellerName)}
      </span>
      <div className={local.who}>
        <strong className={local.name}>{live.sellerName}</strong>
        <span className={local.sub}>
          {live.sellerPhone ? `${formatPhone(live.sellerPhone)} · ` : ''}
          {pending
            ? `${t('adminLives.sentAgo', { time: fmt.time(live.createdAt) })} · ${t('adminLives.durationLabel', { count: live.durationMin / 60 })}`
            : mode === 'awaiting' && live.paymentDueAt
              ? t('adminLives.payBefore', { time: fmt.time(live.paymentDueAt) })
              : online
                ? `${t('adminLives.startedAt', { time: fmt.time(live.startedAt) })} · ${t('adminLives.until', { time: fmt.time(live.endsAt) })}`
                : fmt.day(live.startedAt || live.createdAt)}
          {live.addedBy ? ` · ${t('adminLives.addedBy', { name: live.addedBy })}` : ''}
        </span>
      </div>
      <div className={local.details}>
        <span className={local.line}>
          <span className={live.platform === 'TIKTOK' ? local.tiktok : local.facebook}>
            {platform}
          </span>
          <span className={local.url}>{live.url.replace(/^https:\/\/(www\.)?/, '')}</span>
        </span>
        <span className={local.line}>
          <span className={local.inline}>
            <Flag code={live.countryCode} width={18} />
            {t(`countries.${live.countryCode}` as TKey)}
          </span>
          <span className={local.inline}>
            <CategoryIcon icon={live.categoryIcon} size={16} />
            {live.categoryLabel}
          </span>
        </span>
        {pending && live.categoryCode === null ? (
          <span className={local.newCategory}>
            {t('adminLives.newCategory', { name: live.categoryLabel })}
          </span>
        ) : null}
        {live.status === 'REJECTED' && live.rejectReason ? (
          <span className={local.sub}>
            {live.reviewedBy ? `${live.reviewedBy} · ` : ''}
            {live.rejectReason}
          </span>
        ) : null}
        {!online && live.status !== 'APPROVED' && live.endedBy ? (
          <span className={local.sub}>
            {t('adminLives.removedBy', { name: live.endedBy })}
            {live.endReason ? ` · ${live.endReason}` : ''}
          </span>
        ) : null}
      </div>
      <div className={local.actions}>
        {mode === 'past' && (
          <Badge
            tone={
              live.status === 'REMOVED' || live.status === 'REJECTED' || live.status === 'EXPIRED'
                ? 'danger'
                : 'neutral'
            }
          >
            {t(`adminLives.status.${live.status}` as TKey)}
          </Badge>
        )}
        <a
          href={live.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={cx(styles.btnSecondary, styles.btnSmall)}
        >
          {t('adminLives.openLive')}
          <Icon name="arrowUpRight" size={14} />
        </a>
        {online && (
          <button
            type="button"
            className={cx(styles.btnDanger, styles.btnSmall)}
            onClick={onRemove}
          >
            {t('adminLives.remove')}
          </button>
        )}
        {pending && (
          <>
            <button
              type="button"
              className={cx(styles.btnDanger, styles.btnSmall)}
              onClick={onReject}
              disabled={busy}
            >
              {t('adminLives.reject')}
            </button>
            <button
              type="button"
              className={cx(styles.btn, styles.btnSmall, local.approve)}
              onClick={onApprove}
              disabled={busy}
            >
              {t('adminLives.approve')}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- add

interface Draft {
  url: string;
  sellerName: string;
  countryCode: string;
  categoryCode: string | null;
  categoryOther: string;
  durationMin: number;
}

const EMPTY_DRAFT: Draft = {
  url: '',
  sellerName: '',
  countryCode: 'TG',
  categoryCode: null,
  categoryOther: '',
  durationMin: 120,
};

function AddLiveDialog({
  open,
  categories,
  onClose,
  onCreated,
}: {
  open: boolean;
  categories: LiveCategoryDto[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const link = draft.url.trim() ? checkLiveLink(draft.url) : null;

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(patch)) delete next[k as keyof Draft];
      return next;
    });
  };

  const onLink = (url: string) => {
    const result = url.trim() ? checkLiveLink(url) : null;
    // Fill the name from the account in the link until staff type one themselves.
    const account = result?.ok ? result.account?.replace(/^@/, '') : null;
    set(nameTouched || !account ? { url } : { url, sellerName: account });
  };

  const close = () => {
    setDraft(EMPTY_DRAFT);
    setErrors({});
    setSubmitError(null);
    setNameTouched(false);
    onClose();
  };

  async function submit() {
    const next: Partial<Record<keyof Draft, string>> = {};
    const checked = checkLiveLink(draft.url);
    if (!checked.ok) next.url = t(`adminLives.linkErrors.${checked.error}` as TKey);
    if (cleanShortText(draft.sellerName).length < SELLER_NAME_MIN)
      next.sellerName = t('adminLives.errors.name');
    if (!draft.countryCode) next.countryCode = t('adminLives.errors.country');
    if (!draft.categoryCode) next.categoryCode = t('adminLives.errors.category');
    else if (
      draft.categoryCode === OTHER_CATEGORY &&
      cleanShortText(draft.categoryOther).length < 2
    )
      next.categoryOther = t('adminLives.errors.other');
    setErrors(next);
    setSubmitError(null);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    try {
      const other = draft.categoryCode === OTHER_CATEGORY;
      const created = await adminApi.createLive({
        url: draft.url,
        sellerName: draft.sellerName,
        countryCode: draft.countryCode,
        categoryCode: other ? null : draft.categoryCode,
        categoryOther: other ? draft.categoryOther : null,
        durationMin: draft.durationMin,
      });
      toast(t('adminLives.form.created', { name: created.sellerName }));
      setDraft(EMPTY_DRAFT);
      setNameTouched(false);
      onCreated();
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const categoryChoices = [
    ...categories,
    { code: OTHER_CATEGORY, name: t('adminLives.form.other'), icon: 'autre' as const },
  ];

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('adminLives.form.title')}
      footer={
        <>
          <button type="button" className={styles.btnSecondary} onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className={styles.btn} onClick={submit} disabled={saving}>
            {t('adminLives.form.submit')}
          </button>
        </>
      }
    >
      <form
        className={local.form}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        <p className={styles.note}>{t('adminLives.form.intro')}</p>

        <Field
          label={t('adminLives.form.link')}
          hint={t('adminLives.form.linkHint')}
          error={errors.url}
        >
          {(props) => (
            <input
              {...props}
              className={cx(styles.input, errors.url && styles.inputInvalid)}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('adminLives.form.linkPlaceholder')}
              value={draft.url}
              onChange={(e) => onLink(e.target.value)}
            />
          )}
        </Field>
        {link?.ok && (
          <p className={local.detected}>
            <Icon name="check" size={16} />
            {t('adminLives.form.detected', { platform: LIVE_PLATFORM_LABELS[link.platform] })}
            {link.account ? ` · ${t('adminLives.form.account', { account: link.account })}` : ''}
          </p>
        )}

        <Field label={t('adminLives.form.sellerName')} error={errors.sellerName}>
          {(props) => (
            <input
              {...props}
              className={cx(styles.input, errors.sellerName && styles.inputInvalid)}
              maxLength={60}
              autoComplete="off"
              value={draft.sellerName}
              onChange={(e) => {
                setNameTouched(true);
                set({ sellerName: e.target.value });
              }}
            />
          )}
        </Field>

        <Field label={t('adminLives.form.country')} error={errors.countryCode}>
          {(props) => (
            <select
              {...props}
              className={styles.select}
              value={draft.countryCode}
              onChange={(e) => set({ countryCode: e.target.value })}
            >
              {LIVE_COUNTRIES.map((code) => (
                <option key={code} value={code}>
                  {t(`countries.${code}` as TKey)}
                </option>
              ))}
            </select>
          )}
        </Field>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{t('adminLives.form.category')}</legend>
          <div className={local.categories}>
            {categoryChoices.map((c) => (
              <button
                key={c.code}
                type="button"
                aria-pressed={draft.categoryCode === c.code}
                className={local.category}
                onClick={() => set({ categoryCode: c.code })}
              >
                <CategoryIcon icon={c.icon} size={22} />
                {c.name}
              </button>
            ))}
          </div>
          {errors.categoryCode ? <span className={styles.error}>{errors.categoryCode}</span> : null}
        </fieldset>
        {draft.categoryCode === OTHER_CATEGORY && (
          <Field label={t('adminLives.form.otherLabel')} error={errors.categoryOther}>
            {(props) => (
              <input
                {...props}
                className={cx(styles.input, errors.categoryOther && styles.inputInvalid)}
                maxLength={40}
                placeholder={t('adminLives.form.otherPlaceholder')}
                value={draft.categoryOther}
                onChange={(e) => set({ categoryOther: e.target.value })}
              />
            )}
          </Field>
        )}

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{t('adminLives.form.duration')}</legend>
          <div role="group" className={styles.segmented}>
            {LIVE_DURATIONS_MIN.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={draft.durationMin === m}
                onClick={() => set({ durationMin: m })}
              >
                {t('adminLives.form.hours', { count: m / 60 })}
              </button>
            ))}
          </div>
        </fieldset>

        {submitError ? (
          <p className={styles.error} role="alert">
            {submitError}
          </p>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- remove

const REASONS = ['ended', 'broken', 'wrongAccount', 'forbidden'] as const;

function RemoveLiveDialog({
  live,
  onClose,
  onRemoved,
}: {
  live: AdminLiveDto | null;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setReason(null);
    setNote('');
    setError(null);
    onClose();
  };

  async function confirm() {
    if (!live) return;
    setSaving(true);
    setError(null);
    const text = [
      reason ? t(`adminLives.removeDialog.reasons.${reason}` as TKey) : null,
      note.trim() || null,
    ]
      .filter(Boolean)
      .join(' — ');
    try {
      await adminApi.removeLive(live.id, text || null);
      toast(t('adminLives.removeDialog.done', { name: live.sellerName }));
      setReason(null);
      setNote('');
      onRemoved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={live !== null}
      onClose={close}
      variant="modal"
      title={t('adminLives.removeDialog.title')}
      footer={
        <>
          <button type="button" className={styles.btnSecondary} onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className={styles.btnDanger} onClick={confirm} disabled={saving}>
            {t('adminLives.removeDialog.confirm')}
          </button>
        </>
      }
    >
      {live && (
        <div className={local.form}>
          <p className={styles.note}>
            {t('adminLives.removeDialog.text', { name: live.sellerName })}
          </p>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>{t('adminLives.removeDialog.reason')}</legend>
            <div className={styles.chips}>
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={styles.chip}
                  aria-pressed={reason === r}
                  onClick={() => setReason(reason === r ? null : r)}
                >
                  {t(`adminLives.removeDialog.reasons.${r}` as TKey)}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label={t('adminLives.removeDialog.note')}>
            {(props) => (
              <input
                {...props}
                className={styles.input}
                maxLength={150}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- reject

const REJECT_REASONS = ['notStarted', 'broken', 'wrongAccount', 'forbidden'] as const;

function RejectLiveDialog({
  live,
  onClose,
  onRejected,
}: {
  live: AdminLiveDto | null;
  onClose: () => void;
  onRejected: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [reason, setReason] = useState<(typeof REJECT_REASONS)[number] | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setReason(null);
    setMessage('');
    setError(null);
    onClose();
  };

  async function confirm() {
    if (!live) return;
    setSaving(true);
    setError(null);
    try {
      await adminApi.rejectLive(live.id, message);
      toast(t('adminLives.rejectDialog.done', { name: live.sellerName }));
      setReason(null);
      setMessage('');
      onRejected();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={live !== null}
      onClose={close}
      variant="modal"
      title={t('adminLives.rejectDialog.title')}
      footer={
        <>
          <button type="button" className={styles.btnSecondary} onClick={close}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={styles.btnDanger}
            onClick={confirm}
            disabled={saving || message.trim().length < 3}
          >
            {t('adminLives.rejectDialog.confirm')}
          </button>
        </>
      }
    >
      {live && (
        <div className={local.form}>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>{t('adminLives.rejectDialog.why')}</legend>
            <div className={styles.chips}>
              {REJECT_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={styles.chip}
                  aria-pressed={reason === r}
                  onClick={() => {
                    setReason(r);
                    setMessage(t(`adminLives.rejectDialog.messages.${r}` as TKey));
                  }}
                >
                  {t(`adminLives.rejectDialog.reasons.${r}` as TKey)}
                </button>
              ))}
            </div>
          </fieldset>
          <Field
            label={t('adminLives.rejectDialog.message')}
            hint={t('adminLives.rejectDialog.messageHint')}
          >
            {(props) => (
              <textarea
                {...props}
                className={styles.textarea}
                rows={3}
                maxLength={255}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            )}
          </Field>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- review hours

function ReviewHoursEditor() {
  const { t, locale } = useI18n();
  const { isOwner } = useAdmin();
  const toast = useToast();
  const hours = useAsync(() => adminApi.reviewHours(), 'review-hours');
  const [periods, setPeriods] = useState<ReviewPeriod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const days = weekdayNames(locale);

  useEffect(() => {
    if (hours.data) setPeriods(hours.data.periods);
  }, [hours.data]);

  if (hours.error) return <LoadError error={hours.error} onRetry={hours.reload} />;
  if (!periods) return <Loading />;

  const update = (index: number, patch: Partial<ReviewPeriod>) =>
    setPeriods((list) => list!.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await adminApi.setReviewHours(periods!);
      setPeriods(saved.periods);
      toast(t('adminLives.hoursEditor.saved'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cx(styles.card, local.hours)}>
      <p className={styles.note}>{t('adminLives.hoursEditor.intro')}</p>
      {!isOwner ? <p className={styles.note}>{t('adminLives.hoursEditor.ownerOnly')}</p> : null}
      <ul className={local.days}>
        {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
          const indexed = periods
            .map((p, index) => ({ p, index }))
            .filter(({ p }) => p.weekday === weekday);
          return (
            <li key={weekday} className={local.day}>
              <strong className={local.dayName}>{days[weekday - 1]}</strong>
              <div className={local.dayPeriods}>
                {indexed.length === 0 ? (
                  <span className={local.sub}>{t('adminLives.hoursEditor.closedDay')}</span>
                ) : null}
                {indexed.map(({ p, index }) => (
                  <span key={index} className={local.period}>
                    <TimeSelect
                      value={p.opensAt}
                      onChange={(v) => update(index, { opensAt: v })}
                      disabled={!isOwner}
                      aria-label={`${days[weekday - 1]} ${t('adminLives.hoursEditor.from')}`}
                    />
                    <span aria-hidden="true">{t('adminLives.hoursEditor.to')}</span>
                    <TimeSelect
                      value={p.closesAt}
                      onChange={(v) => update(index, { closesAt: v })}
                      disabled={!isOwner}
                      aria-label={`${days[weekday - 1]} ${t('adminLives.hoursEditor.to')}`}
                    />
                    {isOwner ? (
                      <button
                        type="button"
                        className={cx(styles.btnGhost, styles.btnSmall)}
                        aria-label={t('adminLives.hoursEditor.removePeriod', {
                          from: p.opensAt,
                          to: p.closesAt,
                        })}
                        onClick={() => setPeriods((list) => list!.filter((_, i) => i !== index))}
                      >
                        <Icon name="close" size={16} />
                      </button>
                    ) : null}
                  </span>
                ))}
                {isOwner ? (
                  <button
                    type="button"
                    className={cx(styles.btnGhost, styles.btnSmall)}
                    onClick={() =>
                      setPeriods((list) => [
                        ...list!,
                        { weekday, opensAt: '08:00', closesAt: '11:00' },
                      ])
                    }
                  >
                    <Icon name="plus" size={14} />
                    {t('adminLives.hoursEditor.addPeriod')}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {isOwner ? (
        <div>
          <button type="button" className={styles.btn} onClick={save} disabled={saving}>
            {t('adminLives.hoursEditor.save')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- sellers and passes

function SellersPanel() {
  const { t, locale } = useI18n();
  const sellers = useAsync(() => adminApi.sellers(), 'sellers');
  const prices = useAsync(() => adminApi.livePrices(), 'live-prices');
  const [granting, setGranting] = useState<AdminSellerDto | null>(null);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Africa/Lome',
    }).format(new Date(iso));

  if (sellers.error) return <LoadError error={sellers.error} onRetry={sellers.reload} />;
  if (!sellers.data) return <Loading />;
  return (
    <>
      <p className={styles.note}>{t('adminLives.sellersList.intro')}</p>
      {sellers.data.length === 0 ? (
        <Empty>{t('adminLives.sellersList.empty')}</Empty>
      ) : (
        <ul className={local.list}>
          {sellers.data.map((s) => (
            <li key={s.id} className={cx(styles.card, local.row)}>
              <div className={local.who}>
                <strong className={local.name}>{formatPhone(s.phone)}</strong>
                <span className={local.sub}>
                  {t('adminLives.sellersList.lives', { count: s.livesCount })}
                  {s.lastSignInAt
                    ? ` · ${t('adminLives.sellersList.lastSeen', { date: date(s.lastSignInAt) })}`
                    : ''}
                </span>
              </div>
              <div className={local.actions}>
                {s.blocked ? (
                  <Badge tone="danger">{t('adminLives.sellersList.blocked')}</Badge>
                ) : null}
                <Badge tone={s.pass ? 'success' : 'neutral'}>
                  {s.pass
                    ? t('adminLives.sellersList.passUntil', {
                        plan: t(`pay.planName.${s.pass.plan}` as TKey),
                        date: date(s.pass.endsAt),
                      })
                    : t('adminLives.sellersList.noPass')}
                </Badge>
                {!s.blocked ? (
                  <button
                    type="button"
                    className={cx(styles.btnSecondary, styles.btnSmall)}
                    onClick={() => setGranting(s)}
                  >
                    {t('adminLives.sellersList.grant')}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <GrantPassDialog
        seller={granting}
        prices={prices.data ?? null}
        onClose={() => setGranting(null)}
        onGranted={() => {
          setGranting(null);
          sellers.reload();
        }}
      />
    </>
  );
}

function GrantPassDialog({
  seller,
  prices,
  onClose,
  onGranted,
}: {
  seller: AdminSellerDto | null;
  prices: LivePrices | null;
  onClose: () => void;
  onGranted: () => void;
}) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [plan, setPlan] = useState<PassPlan>('MONTH');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setPlan('MONTH');
    setNote('');
    setError(null);
    onClose();
  };

  async function confirm() {
    if (!seller) return;
    setSaving(true);
    setError(null);
    try {
      await adminApi.grantPass(seller.id, plan, note.trim() || null);
      toast(t('adminLives.grantDialog.done', { phone: formatPhone(seller.phone) }));
      setNote('');
      onGranted();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={seller !== null}
      onClose={close}
      variant="modal"
      title={t('adminLives.grantDialog.title')}
      footer={
        <>
          <button type="button" className={styles.btnSecondary} onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className={styles.btn} onClick={confirm} disabled={saving}>
            {t('adminLives.grantDialog.confirm')}
          </button>
        </>
      }
    >
      {seller && (
        <div className={local.form}>
          <p className={styles.note}>
            <strong>{formatPhone(seller.phone)}</strong> — {t('adminLives.grantDialog.intro')}
          </p>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>{t('adminLives.grantDialog.plan')}</legend>
            <div role="group" className={styles.segmented}>
              {(['MONTH', 'YEAR'] as const).map((p) => (
                <button key={p} type="button" aria-pressed={plan === p} onClick={() => setPlan(p)}>
                  {t(
                    p === 'MONTH' ? 'adminLives.grantDialog.month' : 'adminLives.grantDialog.year',
                    {
                      amount: prices
                        ? formatXof(
                            p === 'MONTH' ? prices.passMonthXof : prices.passYearXof,
                            locale,
                          )
                        : '…',
                    },
                  )}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label={t('adminLives.grantDialog.note')}>
            {(props) => (
              <input
                {...props}
                className={styles.input}
                maxLength={255}
                placeholder={t('adminLives.grantDialog.notePlaceholder')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- prices

function PricesEditor() {
  const { t, locale } = useI18n();
  const { isOwner } = useAdmin();
  const toast = useToast();
  const prices = useAsync(() => adminApi.livePrices(), 'live-prices-editor');
  const [draft, setDraft] = useState<Record<keyof LivePrices, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (prices.data) {
      setDraft({
        passMonthXof: formatAmountInput(prices.data.passMonthXof, locale),
        passYearXof: formatAmountInput(prices.data.passYearXof, locale),
        liveXof: formatAmountInput(prices.data.liveXof, locale),
      });
    }
  }, [prices.data, locale]);

  if (prices.error) return <LoadError error={prices.error} onRetry={prices.reload} />;
  if (!draft) return <Loading />;

  const month = parseAmount(draft.passMonthXof);
  const fields: Array<{ key: keyof LivePrices; label: string; hint?: string }> = [
    { key: 'passMonthXof', label: t('adminLives.pricesEditor.month') },
    { key: 'passYearXof', label: t('adminLives.pricesEditor.year') },
    {
      key: 'liveXof',
      label: t('adminLives.pricesEditor.live'),
      hint: month
        ? t('adminLives.pricesEditor.liveHint', {
            min: formatXof(Math.floor(month / 30) + 1, locale),
          })
        : undefined,
    },
  ];

  async function save() {
    const values = {
      passMonthXof: parseAmount(draft!.passMonthXof),
      passYearXof: parseAmount(draft!.passYearXof),
      liveXof: parseAmount(draft!.liveXof),
    };
    if (Object.values(values).some((v) => v === null)) {
      setError(t('adminLives.pricesEditor.invalid'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminApi.setLivePrices(values as LivePrices);
      toast(t('adminLives.pricesEditor.saved'));
      prices.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cx(styles.card, local.hours)}>
      <p className={styles.note}>{t('adminLives.pricesEditor.intro')}</p>
      {!isOwner ? <p className={styles.note}>{t('adminLives.pricesEditor.ownerOnly')}</p> : null}
      <div className={local.priceFields}>
        {fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            {(props) => (
              <span className={local.amount}>
                <input
                  {...props}
                  className={styles.input}
                  inputMode="numeric"
                  disabled={!isOwner}
                  value={draft[f.key]}
                  onChange={(e) => setDraft((d) => ({ ...d!, [f.key]: e.target.value }))}
                />
                <span aria-hidden="true">FCFA</span>
              </span>
            )}
          </Field>
        ))}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {isOwner ? (
        <div>
          <button type="button" className={styles.btn} onClick={save} disabled={saving}>
            {t('adminLives.pricesEditor.save')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
