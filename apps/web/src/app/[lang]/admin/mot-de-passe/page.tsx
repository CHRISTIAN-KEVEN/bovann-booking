'use client';

import { ADMIN_PASSWORD_MIN_LENGTH, type AdminMe } from '@bovann/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { adminStyles as styles, errorMessage, Field, Loading } from '@/components/admin/ui';
import { adminApi } from '@/lib/admin-api';

/** Choose a new password; required after a temporary one, optional otherwise. */
export default function AdminPasswordPage() {
  const router = useRouter();
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
      setError(
        `Le nouveau mot de passe doit contenir au moins ${ADMIN_PASSWORD_MIN_LENGTH} caractères.`,
      );
      return;
    }
    if (next !== confirm) {
      setError('Les deux mots de passe ne sont pas identiques.');
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
          {me.mustChangePassword ? 'Choisissez votre mot de passe' : 'Changer mon mot de passe'}
        </h1>
        {me.mustChangePassword ? (
          <p className={styles.hint}>
            Bienvenue {me.fullName}. Remplacez le mot de passe temporaire qui vous a été remis par
            un mot de passe personnel.
          </p>
        ) : null}
        {error ? (
          <div className={styles.banner} role="alert">
            {error}
          </div>
        ) : null}
        <Field label={me.mustChangePassword ? 'Mot de passe temporaire' : 'Mot de passe actuel'}>
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
          label="Nouveau mot de passe"
          hint={`Au moins ${ADMIN_PASSWORD_MIN_LENGTH} caractères. Une phrase facile à retenir fonctionne bien.`}
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
        <Field label="Confirmer le nouveau mot de passe">
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
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {me.mustChangePassword ? null : (
          <Link href="/admin/parametres" className={styles.hint}>
            Annuler
          </Link>
        )}
      </form>
    </div>
  );
}
