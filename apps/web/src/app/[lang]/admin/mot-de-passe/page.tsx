'use client';

import { ADMIN_PASSWORD_MIN_LENGTH, type AdminMe } from '@bovann/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { adminStyles as styles, errorMessage, Field, Loading } from '@/components/admin/ui';
import { Link, useI18n, useLocaleRouter } from '@/i18n/I18nProvider';
import { adminApi } from '@/lib/admin-api';

/** Choose a new password; required after a temporary one, optional otherwise. */
export default function AdminPasswordPage() {
  const router = useLocaleRouter();
  const { t } = useI18n();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    adminApi
      .me()
      .then(setMe)
      .catch(() => router.replace('/admin/connexion'));
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < ADMIN_PASSWORD_MIN_LENGTH) {
      setError(t('adminAuth.tooShort', { min: ADMIN_PASSWORD_MIN_LENGTH }));
      return;
    }
    if (next !== confirm) {
      setError(t('adminAuth.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await adminApi.changePassword(current, next);
      router.replace('/admin');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!me) {
    return (
      <div className={styles.authPage}>
        <div className={styles.authCard}>
          <Loading />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.authPage}>
      <form className={styles.authCard} onSubmit={submit} noValidate>
        <span className={styles.authBrand}>
          <span className={styles.liveDot} aria-hidden="true" />
          Bovann OCD Live
        </span>
        <h1 className={styles.authTitle}>
          {me.mustChangePassword ? t('adminAuth.chooseTitle') : t('adminAuth.changeTitle')}
        </h1>
        {me.mustChangePassword ? (
          <p className={styles.hint}>{t('adminAuth.welcome', { name: me.fullName })}</p>
        ) : null}
        {error ? (
          <div className={styles.banner} role="alert">
            {error}
          </div>
        ) : null}
        <Field label={me.mustChangePassword ? t('adminAuth.temporary') : t('adminAuth.current')}>
          {(p) => (
            <input
              {...p}
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('adminAuth.new')}
          hint={t('adminAuth.newHint', { min: ADMIN_PASSWORD_MIN_LENGTH })}
        >
          {(p) => (
            <input
              {...p}
              className={styles.input}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('adminAuth.confirm')}>
          {(p) => (
            <input
              {...p}
              className={styles.input}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>
        <button type="submit" className={styles.btn} disabled={busy}>
          {busy ? t('adminAuth.saving') : t('adminAuth.save')}
        </button>
        {me.mustChangePassword ? null : (
          <Link href="/admin/parametres" className={styles.hint}>
            {t('adminAuth.cancel')}
          </Link>
        )}
      </form>
    </div>
  );
}
