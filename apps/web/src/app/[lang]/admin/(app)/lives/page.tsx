'use client';

import {
  checkLiveLink,
  cleanShortText,
  LIVE_COUNTRIES,
  LIVE_DURATIONS_MIN,
  LIVE_PLATFORM_LABELS,
  SELLER_NAME_MIN,
  type AdminLiveDto,
  type AdminLiveTab,
  type LiveCategoryDto,
} from '@bovann/shared';
import { useMemo, useState } from 'react';
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
  useAsync,
  useToast,
} from '@/components/admin/ui';
import { CategoryIcon } from '@/components/lives/CategoryIcon';
import { Flag } from '@/components/lives/Flag';
import { Icon } from '@/components/icons';
import { Link, useI18n, type TKey } from '@/i18n/I18nProvider';
import { adminApi } from '@/lib/admin-api';
import { CATEGORY_HUES, initialsOf, OTHER_CATEGORY } from '@/lib/lives';
import local from './lives.module.css';

/** "Lives": what is on the "En direct" page now, and listing a live for a seller. */
export default function AdminLivesPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<AdminLiveTab>('online');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AdminLiveDto | null>(null);
  const list = useAsync(() => adminApi.lives(tab), tab);
  const categories = useAsync(() => adminApi.liveCategories(), 'categories');

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

      <Tabs
        label={t('adminLives.tabs')}
        value={tab}
        onChange={setTab}
        options={[
          {
            value: 'online',
            label: t('adminLives.online'),
            count: tab === 'online' ? list.data?.lives.length : undefined,
          },
          { value: 'past', label: t('adminLives.past') },
        ]}
      />

      {list.error ? (
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
          {tab === 'online' ? t('adminLives.empty') : t('adminLives.emptyPast')}
        </Empty>
      ) : (
        <ul className={local.list}>
          {list.data.lives.map((live) => (
            <LiveRow
              key={live.id}
              live={live}
              online={tab === 'online'}
              onRemove={() => setRemoving(live)}
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
  online,
  onRemove,
}: {
  live: AdminLiveDto;
  online: boolean;
  onRemove: () => void;
}) {
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
          {online
            ? `${t('adminLives.startedAt', { time: fmt.time(live.startedAt) })} · ${t('adminLives.until', { time: fmt.time(live.endsAt) })}`
            : fmt.day(live.startedAt)}
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
        {!online && live.status !== 'APPROVED' && live.endedBy ? (
          <span className={local.sub}>
            {t('adminLives.removedBy', { name: live.endedBy })}
            {live.endReason ? ` · ${live.endReason}` : ''}
          </span>
        ) : null}
      </div>
      <div className={local.actions}>
        {!online && (
          <Badge tone={live.status === 'REMOVED' ? 'danger' : 'neutral'}>
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
