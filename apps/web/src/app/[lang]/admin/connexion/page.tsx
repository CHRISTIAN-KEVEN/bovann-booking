'use client';

import { useState, type FormEvent } from 'react';
import { NEXT_KEY } from '@/components/admin/AdminShell';
import { adminStyles as styles, errorMessage, Field } from '@/components/admin/ui';
import { useI18n, useLocaleRouter } from '@/i18n/I18nProvider';
import { adminApi } from '@/lib/admin-api';
import { LanguageSwitch } from '@/components/LanguageSwitch';

export default function AdminSignInPage() {
  const router = useLocaleRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError(t('adminAuth.missing'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const me = await adminApi.login(email.trim(), password);
      let next = '/admin';
      try {
        const stored = sessionStorage.getItem(NEXT_KEY);
        sessionStorage.removeItem(NEXT_KEY);
        if (stored?.startsWith('/admin') && !stored.startsWith('/admin/connexion')) next = stored;
      } catch {
        /* default destination */
      }
      router.replace(me.mustChangePassword ? '/admin/mot-de-passe' : next);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className={styles.authPage}>
      <form className={styles.authCard} onSubmit={submit} noValidate>
        <span className={styles.authBrand}>
          <span className={styles.liveDot} aria-hidden="true" />
          Bovann OCD Live
        </span>
        <h1 className={styles.authTitle}>{t('adminAuth.title')}</h1>
        {error ? (
          <div className={styles.banner} role="alert">
            {error}
          </div>
        ) : null}
        <Field label={t('adminAuth.email')}>
          {(p) => (
            <input
              {...p}
              className={styles.input}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('adminAuth.password')}>
          {(p) => (
            <input
              {...p}
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <button type="submit" className={styles.btn} disabled={busy}>
          {busy ? t('adminAuth.signingIn') : t('adminAuth.signIn')}
        </button>
        <p className={styles.hint}>{t('adminAuth.forgot')}</p>
        <LanguageSwitch tone="light" />
      </form>
    </div>
  );
}
