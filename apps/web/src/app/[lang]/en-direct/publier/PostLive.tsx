'use client';

import {
  CATEGORY_OTHER_MAX,
  checkLiveLink,
  cleanShortText,
  LIVE_COUNTRIES,
  LIVE_DURATIONS_MIN,
  LIVE_PLATFORM_LABELS,
  SELLER_NAME_MAX,
  SELLER_NAME_MIN,
  type LiveCategoryDto,
  type LiveDto,
  type ReviewStatus,
  type SellerLiveDto,
  type SellerMe,
} from '@bovann/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CategoryIcon } from '@/components/lives/CategoryIcon';
import { Flag } from '@/components/lives/Flag';
import { LiveCard } from '@/components/lives/LiveCard';
import { SellerShell } from '@/components/seller/SellerShell';
import { SiteHeader } from '@/components/SiteHeader';
import seller from '@/components/seller/seller.module.css';
import { ButtonSpinner, Skeleton } from '@/components/ui';
import { Link, useI18n, useLocaleRouter, type TKey } from '@/i18n/I18nProvider';
import { formatPhone } from '@/lib/admin-format';
import { ApiError } from '@/lib/api';
import { COUNTRY_CODES } from '@/lib/details';
import { lomeTime, nextOpening, OTHER_CATEGORY, waitLabel } from '@/lib/lives';
import { sellerApi } from '@/lib/seller-api';
import styles from './post.module.css';

type Step = 1 | 2 | 3 | 4;

interface Draft {
  url: string;
  countryCode: string | null;
  categoryCode: string | null;
  categoryOther: string;
  durationMin: number;
  sellerName: string;
}

type View =
  | { name: 'loading' }
  | { name: 'error'; message: string }
  | { name: 'closed' }
  | { name: 'form'; step: Step }
  | { name: 'tracking'; liveId: number };

/**
 * "Publier mon live", one question per screen: the link (platform and account are read from
 * it), the country, the category ("Autre" opens a field), then the duration and the name with
 * a preview of the card. The request then waits for staff review; this page follows it.
 * Closed outside review hours, with the next opening time.
 */
export function PostLive() {
  const { t, locale } = useI18n();
  const router = useLocaleRouter();
  const [view, setView] = useState<View>({ name: 'loading' });
  const [me, setMe] = useState<SellerMe | null>(null);
  const [review, setReview] = useState<ReviewStatus | null>(null);
  const [categories, setCategories] = useState<LiveCategoryDto[]>([]);
  const [lives, setLives] = useState<SellerLiveDto[]>([]);
  const [draft, setDraft] = useState<Draft>({
    url: '',
    countryCode: null,
    categoryCode: null,
    categoryOther: '',
    durationMin: 120,
    sellerName: '',
  });
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const linkInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [account, mine] = await Promise.all([sellerApi.me(), sellerApi.lives()]);
      setMe(account);
      setReview(mine.review);
      setCategories(mine.categories);
      setLives(mine.lives);
      setNow(Date.now());
      return { account, mine };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/vendeur/connexion?suite=/en-direct/publier');
        return null;
      }
      setView({ name: 'error', message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }, [router]);

  // On arrival (once): a request already waiting is followed; otherwise the form, if open.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load().then((result) => {
      if (!result) return;
      const pending = result.mine.lives.find((l) => l.status === 'PENDING');
      if (pending) setView({ name: 'tracking', liveId: pending.id });
      else if (!result.mine.review.open) setView({ name: 'closed' });
      else {
        const iso = COUNTRY_CODES.find((c) => result.account.phone.startsWith(c.code))?.iso;
        setDraft((d) => ({ ...d, countryCode: d.countryCode ?? iso ?? null }));
        setView({ name: 'form', step: 1 });
      }
    });
  }, [load]);

  // While tracking, ask every 10 s (staff answer within minutes).
  useEffect(() => {
    if (view.name !== 'tracking' && view.name !== 'closed') return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [view.name, load]);

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };
  const go = (step: Step) => {
    setError(null);
    setView({ name: 'form', step });
    window.scrollTo({ top: 0 });
  };

  const link = draft.url.trim() ? checkLiveLink(draft.url) : null;

  function onLink(url: string) {
    const result = url.trim() ? checkLiveLink(url) : null;
    const account = result?.ok ? result.account?.replace(/^@/, '') : null;
    set(nameTouched || !account ? { url } : { url, sellerName: account });
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      onLink(text.trim());
    } catch {
      setError(t('post.pasteDenied'));
      linkInput.current?.focus();
    }
  }

  function linkNext() {
    const checked = checkLiveLink(draft.url);
    if (!checked.ok) {
      setError(t(`adminLives.linkErrors.${checked.error}` as TKey));
      linkInput.current?.focus();
      return;
    }
    go(2);
  }

  async function send() {
    const name = cleanShortText(draft.sellerName);
    if (name.length < SELLER_NAME_MIN) {
      setError(t('post.errors.name'));
      return;
    }
    const other = draft.categoryCode === OTHER_CATEGORY;
    setBusy(true);
    setError(null);
    try {
      const sent = await sellerApi.submit({
        url: draft.url,
        sellerName: name,
        countryCode: draft.countryCode ?? '',
        categoryCode: other ? null : draft.categoryCode,
        categoryOther: other ? draft.categoryOther : null,
        durationMin: draft.durationMin,
      });
      setLives((l) => [sent, ...l]);
      setView({ name: 'tracking', liveId: sent.id });
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REVIEW_CLOSED') {
        await load();
        setView({ name: 'closed' });
      } else if (err instanceof ApiError && err.code === 'LIVE_PENDING_EXISTS') {
        const liveId = (err.details as { liveId?: number } | undefined)?.liveId;
        await load();
        if (liveId) setView({ name: 'tracking', liveId });
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(id: number) {
    setBusy(true);
    try {
      await sellerApi.end(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function startAgain() {
    setDraft((d) => ({ ...d, url: '', categoryCode: null, categoryOther: '' }));
    if (review?.open) go(1);
    else setView({ name: 'closed' });
  }

  // ---------------------------------------------------------------- screens

  if (view.name === 'loading') {
    return (
      <SellerShell back="/en-direct">
        <Skeleton height={60} count={4} />
      </SellerShell>
    );
  }

  if (view.name === 'error') {
    return (
      <SellerShell back="/en-direct">
        <p className={seller.error} role="alert">
          {view.message}
        </p>
        <button type="button" className={seller.primary} onClick={() => window.location.reload()}>
          {t('common.retry')}
        </button>
      </SellerShell>
    );
  }

  if (view.name === 'closed' && review) {
    return <ClosedScreen review={review} now={now} />;
  }

  if (view.name === 'tracking') {
    const live = lives.find((l) => l.id === view.liveId);
    if (!live) {
      return (
        <SellerShell back="/en-direct">
          <Skeleton height={60} count={3} />
        </SellerShell>
      );
    }
    return trackingScreen(live);
  }

  if (view.name !== 'form') return null;
  const step = view.step;
  const back = step === 1 ? undefined : () => go((step - 1) as Step);
  const header = progress(step);

  if (step === 1) {
    return (
      <SellerShell back="/en-direct" top={header}>
        <form
          className={seller.form}
          onSubmit={(e) => {
            e.preventDefault();
            linkNext();
          }}
          noValidate
        >
          <h1 className={seller.title}>{t('post.linkTitle')}</h1>
          <button type="button" className={styles.paste} onClick={() => void paste()}>
            <ClipboardIcon />
            {t('post.paste')}
          </button>
          <div className={seller.field}>
            <label htmlFor="live-link" className={seller.label}>
              {t('post.linkLabel')}
            </label>
            <input
              ref={linkInput}
              id="live-link"
              className={`${styles.input} ${link?.ok ? styles.inputOk : ''} ${error ? styles.inputError : ''}`}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('post.linkPlaceholder')}
              value={draft.url}
              onChange={(e) => onLink(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={link?.ok ? 'link-ok' : error ? 'post-error' : undefined}
            />
            {link?.ok ? (
              <p id="link-ok" className={styles.detected}>
                <span className={styles.tick} aria-hidden="true">
                  <CheckIcon />
                </span>
                <span>
                  {link.account
                    ? t('post.detectedAccount', {
                        platform: LIVE_PLATFORM_LABELS[link.platform],
                        account: link.account,
                      })
                    : t('post.detected', { platform: LIVE_PLATFORM_LABELS[link.platform] })}
                </span>
              </p>
            ) : null}
          </div>
          {error ? (
            <p id="post-error" className={seller.error} role="alert">
              {error}
            </p>
          ) : null}
          <details className={styles.how} open={!draft.url}>
            <summary>{t('post.howTitle')}</summary>
            <ol className={styles.howSteps}>
              {(['post.how1', 'post.how2', 'post.how3'] as const).map((key, i) => (
                <li key={key}>
                  <span className={styles.howIcon} aria-hidden="true">
                    {i === 0 ? <ShareIcon /> : i === 1 ? <LinkIcon /> : <ClipboardIcon />}
                    <span className={styles.howNumber}>{i + 1}</span>
                  </span>
                  {t(key)}
                </li>
              ))}
            </ol>
          </details>
          <div className={seller.actions}>
            <button type="submit" className={seller.primary}>
              {t('post.continue')}
              <ArrowIcon />
            </button>
          </div>
        </form>
      </SellerShell>
    );
  }

  if (step === 2) {
    return (
      <SellerShell onBack={back} top={header}>
        <fieldset className={seller.fieldset}>
          <legend className={`${seller.title} ${styles.legend}`}>{t('post.countryTitle')}</legend>
          <div className={styles.countries}>
            {LIVE_COUNTRIES.map((code) => (
              <button
                key={code}
                type="button"
                aria-pressed={draft.countryCode === code}
                className={styles.country}
                onClick={() => {
                  set({ countryCode: code });
                  go(3);
                }}
              >
                <Flag code={code} width={32} />
                <span>{t(`countries.${code}` as TKey)}</span>
              </button>
            ))}
          </div>
        </fieldset>
      </SellerShell>
    );
  }

  if (step === 3) {
    const choices = [
      ...categories,
      { code: OTHER_CATEGORY, name: t('post.other'), icon: 'autre' as const },
    ];
    const isOther = draft.categoryCode === OTHER_CATEGORY;
    return (
      <SellerShell onBack={back} top={header}>
        <form
          className={seller.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (cleanShortText(draft.categoryOther).length < 2) {
              setError(t('post.errors.other'));
              return;
            }
            go(4);
          }}
          noValidate
        >
          <fieldset className={seller.fieldset}>
            <legend className={`${seller.title} ${styles.legend}`}>
              {t('post.categoryTitle')}
            </legend>
            <div className={styles.tiles}>
              {choices.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  aria-pressed={draft.categoryCode === c.code}
                  className={styles.tile}
                  onClick={() => {
                    set({ categoryCode: c.code });
                    if (c.code !== OTHER_CATEGORY) go(4);
                  }}
                >
                  <CategoryIcon icon={c.icon} size={32} />
                  {c.name}
                </button>
              ))}
            </div>
          </fieldset>
          {isOther ? (
            <>
              <div className={styles.otherBox}>
                <label htmlFor="other" className={styles.otherLabel}>
                  {t('post.otherLabel')}
                </label>
                <input
                  id="other"
                  className={styles.input}
                  maxLength={CATEGORY_OTHER_MAX}
                  autoFocus
                  value={draft.categoryOther}
                  onChange={(e) => set({ categoryOther: e.target.value })}
                  aria-describedby="other-help"
                  aria-invalid={Boolean(error)}
                />
                <span id="other-help" className={seller.hint}>
                  {t('post.otherHelp', { count: draft.categoryOther.length })}
                </span>
              </div>
              {error ? (
                <p className={seller.error} role="alert">
                  {error}
                </p>
              ) : null}
              <div className={seller.actions}>
                <button type="submit" className={seller.primary}>
                  {t('post.continue')}
                  <ArrowIcon />
                </button>
              </div>
            </>
          ) : null}
        </form>
      </SellerShell>
    );
  }

  // Step 4: duration, name, preview, send.
  const category =
    draft.categoryCode === OTHER_CATEGORY
      ? { label: cleanShortText(draft.categoryOther), icon: 'autre' as const }
      : (() => {
          const c = categories.find((x) => x.code === draft.categoryCode);
          return { label: c?.name ?? '', icon: c?.icon ?? ('autre' as const) };
        })();
  const preview: LiveDto | null = link?.ok
    ? {
        id: 0,
        sellerName: cleanShortText(draft.sellerName) || '…',
        platform: link.platform,
        url: link.url,
        countryCode: (draft.countryCode ?? 'TG') as LiveDto['countryCode'],
        categoryCode: draft.categoryCode,
        categoryLabel: category.label,
        categoryIcon: category.icon,
        startedAt: new Date(now).toISOString(),
        endsAt: new Date(now + draft.durationMin * 60_000).toISOString(),
      }
    : null;

  return (
    <SellerShell onBack={back} top={header}>
      <form
        className={seller.form}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        noValidate
      >
        <fieldset className={seller.fieldset}>
          <legend className={`${seller.title} ${styles.legend}`}>{t('post.durationTitle')}</legend>
          <div className={styles.durations}>
            {LIVE_DURATIONS_MIN.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={draft.durationMin === m}
                className={styles.duration}
                onClick={() => set({ durationMin: m })}
              >
                {t('post.hours', { count: m / 60 })}
              </button>
            ))}
          </div>
          <span className={seller.hint}>{t('post.durationHelp')}</span>
        </fieldset>

        <section className={styles.previewBlock} aria-labelledby="preview-title">
          <h2 id="preview-title" className={styles.previewTitle}>
            {t('post.preview')}
          </h2>
          <div className={styles.previewRow}>
            <div className={styles.previewCard} aria-hidden="true" inert>
              {preview ? <LiveCard live={preview} now={now} /> : null}
            </div>
            <div className={styles.previewSide}>
              <label htmlFor="seller-name" className={seller.label}>
                {t('post.name')}
              </label>
              <input
                id="seller-name"
                className={styles.input}
                maxLength={SELLER_NAME_MAX}
                value={draft.sellerName}
                onChange={(e) => {
                  setNameTouched(true);
                  set({ sellerName: e.target.value });
                }}
                aria-invalid={Boolean(error)}
              />
              <button type="button" className={seller.link} onClick={() => go(1)}>
                {t('post.changeLink')}
              </button>
              {me ? <span className={seller.hint}>{formatPhone(me.phone)}</span> : null}
            </div>
          </div>
        </section>

        {error ? (
          <p className={seller.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={seller.actions}>
          <button type="submit" className={seller.primary} disabled={busy}>
            {busy ? <ButtonSpinner /> : <SendIcon />}
            {t('post.send')}
          </button>
          <span className={styles.center}>{t('post.sendHelp')}</span>
        </div>
      </form>
    </SellerShell>
  );

  // ---------------------------------------------------------------- pieces

  function progress(current: Step) {
    return (
      <div className={styles.progressRow}>
        <div
          className={styles.progress}
          role="progressbar"
          aria-label={t('post.step', { step: current })}
          aria-valuemin={1}
          aria-valuemax={4}
          aria-valuenow={current}
        >
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={i <= current ? styles.barOn : styles.bar} />
          ))}
        </div>
        <span className={styles.stepCount} aria-hidden="true">
          {current}/4
        </span>
      </div>
    );
  }

  function trackingScreen(live: SellerLiveDto) {
    const working = busy;
    const problem = error;
    const onWithdraw = () => void withdraw(live.id);
    const onAgain = startAgain;
    const online = live.status === 'APPROVED' && Date.parse(live.endsAt) > now;
    const title =
      live.status === 'PENDING'
        ? t('post.sentTitle')
        : online
          ? t('post.approvedTitle')
          : live.status === 'REJECTED'
            ? t('post.rejectedTitle')
            : live.status === 'CANCELLED'
              ? t('post.cancelledTitle')
              : t(
                  `seller.status.${live.status === 'APPROVED' ? 'APPROVED_DONE' : live.status}` as TKey,
                );
    return (
      <div className={seller.page}>
        <SiteHeader />
        <section className={`${styles.hero} ${live.status === 'REJECTED' ? styles.heroMuted : ''}`}>
          <div className={styles.rings} aria-hidden="true">
            {live.status === 'PENDING' ? (
              <>
                <span className={styles.ring} />
                <span className={`${styles.ring} ${styles.ring2}`} />
              </>
            ) : null}
            <span className={styles.heroIcon}>
              {live.status === 'REJECTED' || live.status === 'CANCELLED' ? (
                <CrossIcon />
              ) : online ? (
                <CheckIcon size={44} />
              ) : (
                <SendIcon size={44} />
              )}
            </span>
          </div>
          <h1 className={styles.heroTitle} aria-live="polite">
            {title}
          </h1>
          {live.status === 'PENDING' ? (
            <p className={styles.heroText}>{t('post.sentText')}</p>
          ) : online ? (
            <p className={styles.heroText}>
              {t('post.approvedText', { time: lomeTime(live.endsAt, locale) })}
            </p>
          ) : null}
        </section>

        <main className={seller.main}>
          <div className={seller.column}>
            {live.status === 'REJECTED' && live.rejectReason ? (
              <div className={seller.card}>
                <span className={seller.label}>{t('post.rejectedReason')}</span>
                <p className={seller.cardText}>{live.rejectReason}</p>
              </div>
            ) : null}

            {live.status === 'PENDING' || online ? (
              <ol className={styles.timeline} aria-label={t('post.trackLabel')}>
                <li className={styles.done}>
                  <span className={styles.dot}>
                    <CheckIcon size={16} />
                  </span>
                  <div>
                    <strong>{t('post.stepSent')}</strong>
                    <span>{t('post.sentAt', { time: lomeTime(live.createdAt, locale) })}</span>
                  </div>
                </li>
                <li
                  className={online ? styles.done : styles.current}
                  aria-current={online ? undefined : 'step'}
                >
                  <span className={styles.dot}>{online ? <CheckIcon size={16} /> : null}</span>
                  <div>
                    <strong>{t('post.stepReview')}</strong>
                    {online ? null : <span>{t('post.autoUpdate')}</span>}
                  </div>
                </li>
                <li
                  className={online ? styles.done : styles.todo}
                  aria-current={online ? 'step' : undefined}
                >
                  <span className={styles.dot}>{online ? <CheckIcon size={16} /> : null}</span>
                  <div>
                    <strong>{t('post.stepOnline')}</strong>
                  </div>
                </li>
              </ol>
            ) : null}

            {problem ? (
              <p className={seller.error} role="alert">
                {problem}
              </p>
            ) : null}

            <div className={seller.actions}>
              {online ? (
                <Link href="/en-direct" className={seller.primary}>
                  {t('post.seeWall')}
                </Link>
              ) : live.status !== 'PENDING' ? (
                <button type="button" className={seller.primary} onClick={onAgain}>
                  {t('post.sendAgain')}
                </button>
              ) : null}
              <Link href="/vendeur" className={seller.secondary}>
                {t('post.mySpace')}
              </Link>
              {live.status === 'PENDING' ? (
                <button
                  type="button"
                  className={seller.link}
                  onClick={onWithdraw}
                  disabled={working}
                >
                  {t('post.withdraw')}
                </button>
              ) : null}
            </div>
          </div>
        </main>
      </div>
    );
  }
}

/** Outside review hours: when the team is back, and today's periods on a day bar. */
function ClosedScreen({ review, now }: { review: ReviewStatus; now: number }) {
  const { t, locale } = useI18n();
  const next = review.nextOpensAt ? nextOpening(review.nextOpensAt, now, locale, t) : null;
  const nowMin = (() => {
    const [h, m] = lomeTime(new Date(now).toISOString(), 'fr').split(':').map(Number);
    return h! * 60 + m!;
  })();
  // Bar from 06:00 to 22:00.
  const pos = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return Math.min(100, Math.max(0, ((h! * 60 + m! - 360) / 960) * 100));
  };
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h! * 60 + m!;
  };
  const nowLabel = lomeTime(new Date(now).toISOString(), locale);
  const periodsLabel = review.today.map((p) => `${p.opensAt}–${p.closesAt}`).join(', ');
  let nextMarked = false;

  return (
    <SellerShell back="/en-direct">
      <div className={seller.icon} aria-hidden="true">
        <TimerIcon />
      </div>
      <div className={seller.titleBlock}>
        <h1 className={seller.title}>
          {next ? (
            <>
              {next.day ? t('post.closedTitleDay', { day: next.day }) : t('post.closedTitle')}{' '}
              <span className={styles.accent}>{next.time}</span>
            </>
          ) : (
            t('post.closedNever')
          )}
        </h1>
        {review.nextOpensAt ? (
          <p className={seller.lead}>
            {t('post.closedText', { wait: waitLabel(review.nextOpensAt, now, t) })}
          </p>
        ) : null}
      </div>

      <figure className={styles.dayCard}>
        <figcaption className={styles.dayTitle}>{t('post.today')}</figcaption>
        {review.today.length === 0 ? (
          <p className={seller.hint}>{t('post.todayNone')}</p>
        ) : (
          <>
            <div
              className={styles.dayBar}
              role="img"
              aria-label={t('post.dayBar', { periods: periodsLabel, now: nowLabel })}
            >
              <span className={styles.dayTrack} />
              {review.today.map((p) => (
                <span
                  key={p.opensAt}
                  className={toMin(p.closesAt) <= nowMin ? styles.dayPast : styles.dayNext}
                  style={{
                    left: `${pos(p.opensAt)}%`,
                    width: `${pos(p.closesAt) - pos(p.opensAt)}%`,
                  }}
                />
              ))}
              <span className={styles.nowLine} style={{ left: `${pos(nowLabel)}%` }} />
              <span className={styles.nowTag} style={{ left: `${pos(nowLabel)}%` }}>
                {nowLabel}
              </span>
            </div>
            <div className={styles.dayScale} aria-hidden="true">
              <span>6h</span>
              <span>10h</span>
              <span>14h</span>
              <span>18h</span>
              <span>22h</span>
            </div>
            <ul className={styles.periods}>
              {review.today.map((p) => {
                const done = toMin(p.closesAt) <= nowMin;
                const isNext = !done && !nextMarked;
                if (isNext) nextMarked = true;
                return (
                  <li key={p.opensAt} className={isNext ? styles.periodNext : undefined}>
                    <span>
                      <span
                        className={styles.periodDot}
                        style={{ background: done ? '#c9bcae' : '#2f7a4a' }}
                      />
                      {p.opensAt} – {p.closesAt}
                    </span>
                    <span>{done ? t('post.periodDone') : isNext ? t('post.periodNext') : ''}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </figure>

      <div className={seller.actions}>
        <Link href="/en-direct" className={seller.secondary}>
          {t('post.seeWall')}
        </Link>
      </div>
    </SellerShell>
  );
}

// ---------------------------------------------------------------- icons

function svg(children: React.ReactNode, size = 24, strokeWidth = 1.9) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
const ClipboardIcon = () =>
  svg(
    <>
      <rect x="7" y="4" width="10" height="4" rx="1.5" />
      <path d="M7 6H5.5A1.5 1.5 0 0 0 4 7.5v12A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 18.5 6H17" />
      <path d="M9 14h6M9 17h4" />
    </>,
    26,
  );
const ShareIcon = () => svg(<path d="M14 4l7 7-7 7v-4c-5 0-8 1.5-10 5 0-6 3-10 10-11V4Z" />, 26);
const LinkIcon = () =>
  svg(
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>,
    26,
  );
const ArrowIcon = () => svg(<path d="M5 12h14M13 6l6 6-6 6" />, 22, 2.2);
const CheckIcon = ({ size = 16 }: { size?: number }) =>
  svg(<path d="M5 12.5l4.5 4.5L19 7.5" />, size, 3);
const CrossIcon = () => svg(<path d="M6 6l12 12M18 6 6 18" />, 44, 2.4);
const SendIcon = ({ size = 22 }: { size?: number }) =>
  svg(<path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" />, size, 2.2);
const TimerIcon = () =>
  svg(
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2" />
      <path d="M9 2h6" />
    </>,
    40,
    1.8,
  );
