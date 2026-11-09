'use client';

import type { AdminRole, AdminUserDto, TemporaryPasswordResponse } from '@bovann/shared';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useAdmin } from '@/components/admin/AdminShell';
import {
  adminStyles as styles,
  Badge,
  cx,
  Dialog,
  errorMessage,
  Field,
  LoadError,
  Loading,
  PageHeader,
  useAsync,
  useToast,
} from '@/components/admin/ui';
import { Icon } from '@/components/icons';
import { adminApi } from '@/lib/admin-api';
import { ADMIN_ROLE_LABELS_FR, formatDateTime } from '@/lib/admin-format';

const ROLE_HELP: Record<AdminRole, string> = {
  OWNER: 'Tout\u00a0: réservations, annulations et remboursements, prix, horaires, comptes.',
  STAFF:
    'Réservations, clients et paiements\u00a0; ajoute des réservations, enregistre les paiements, bloque des créneaux.',
};

export default function AdminSettingsPage() {
  const { me, isOwner } = useAdmin();
  return (
    <>
      <PageHeader title="Paramètres" />
      <section className={cx(styles.card, styles.cardPad)}>
        <h2 className={styles.cardTitle}>Mon compte</h2>
        <dl className={styles.dl}>
          <dt>Nom</dt>
          <dd>{me.fullName}</dd>
          <dt>E-mail</dt>
          <dd>{me.email}</dd>
          <dt>Rôle</dt>
          <dd>{ADMIN_ROLE_LABELS_FR[me.role]}</dd>
        </dl>
        <div>
          <Link href="/admin/mot-de-passe" className={styles.btnSecondary}>
            Changer mon mot de passe
          </Link>
        </div>
      </section>
      {isOwner ? (
        <>
          <Users />
          <Recipients />
        </>
      ) : (
        <p className={styles.note}>
          La gestion des comptes et des e-mails de notification est réservée aux administrateurs.
        </p>
      )}
    </>
  );
}

function Users() {
  const { me } = useAdmin();
  const toast = useToast();
  const users = useAsync(() => adminApi.users(), 'users');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AdminUserDto | null>(null);
  const [issued, setIssued] = useState<TemporaryPasswordResponse | null>(null);

  return (
    <section className={styles.card}>
      <div className={styles.toolbar}>
        <h2 className={styles.cardTitle}>Utilisateurs</h2>
        <button type="button" className={styles.btn} onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} /> Ajouter un utilisateur
        </button>
      </div>
      {users.error ? (
        <LoadError error={users.error} onRetry={users.reload} />
      ) : !users.data ? (
        <Loading />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table} style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Rôle</th>
                <th>État</th>
                <th>Dernière connexion</th>
                <th>
                  <span className={styles.srOnly}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <tr key={u.id} style={u.isActive ? undefined : { opacity: 0.6 }}>
                  <td>
                    <div className={styles.cellStack}>
                      <span style={{ fontWeight: 600 }}>
                        {u.fullName}
                        {u.id === me.id ? ' (vous)' : ''}
                      </span>
                      <span className={styles.cellSub}>{u.email}</span>
                    </div>
                  </td>
                  <td>{ADMIN_ROLE_LABELS_FR[u.role]}</td>
                  <td>
                    {!u.isActive ? (
                      <Badge tone="neutral">Désactivé</Badge>
                    ) : u.mustChangePassword ? (
                      <Badge tone="warning">Mot de passe temporaire</Badge>
                    ) : (
                      <Badge tone="success">Actif</Badge>
                    )}
                  </td>
                  <td>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Jamais'}</td>
                  <td className={styles.right}>
                    {u.id === me.id ? null : (
                      <button
                        type="button"
                        className={cx(styles.btnSecondary, styles.btnSmall)}
                        onClick={() => setEditing(u)}
                      >
                        Gérer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <NewUserDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(result) => {
          setAdding(false);
          setIssued(result);
          users.reload();
        }}
      />
      <EditUserDialog
        user={editing}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null);
          users.reload();
          toast(message);
        }}
        onReset={(result) => {
          setEditing(null);
          setIssued(result);
          users.reload();
        }}
      />
      <Dialog
        open={issued !== null}
        onClose={() => setIssued(null)}
        variant="modal"
        title="Mot de passe temporaire"
        footer={
          <button type="button" className={styles.btn} onClick={() => setIssued(null)}>
            C’est noté
          </button>
        }
      >
        {issued ? (
          <>
            <p>
              Transmettez ce mot de passe à <strong>{issued.user.fullName}</strong> (
              {issued.user.email}). Il devra le remplacer à sa première connexion.
            </p>
            <div className={styles.tempPassword} aria-label="Mot de passe temporaire">
              {issued.temporaryPassword}
            </div>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => {
                void navigator.clipboard?.writeText(issued.temporaryPassword).then(
                  () => toast('Mot de passe copié.'),
                  () => toast('Copie impossible\u00a0: notez-le à la main.', true),
                );
              }}
            >
              <Icon name="copy" size={16} /> Copier
            </button>
            <p className={styles.note}>
              Il ne sera plus affiché ensuite. En cas de perte, réinitialisez-le depuis
              «&nbsp;Gérer&nbsp;».
            </p>
          </>
        ) : null}
      </Dialog>
    </section>
  );
}

function NewUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: TemporaryPasswordResponse) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AdminRole>('STAFF');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName('');
    setEmail('');
    setRole('STAFF');
    setError(null);
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Indiquez un nom et une adresse e-mail valide.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await adminApi.createUser({ fullName: fullName.trim(), email: email.trim(), role }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="modal"
      title="Ajouter un utilisateur"
      footer={
        <>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="user-form" className={styles.btn} disabled={busy}>
            {busy ? 'Création…' : 'Créer le compte'}
          </button>
        </>
      }
    >
      <form id="user-form" className={styles.section} onSubmit={submit} noValidate>
        <Field label="Nom complet">
          {(p) => (
            <input
              {...p}
              className={styles.input}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Adresse e-mail" hint="Elle sert d’identifiant de connexion.">
          {(p) => (
            <input
              {...p}
              type="email"
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <RolePicker value={role} onChange={setRole} />
        {error ? (
          <div className={styles.banner} role="alert">
            {error}
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}

function RolePicker({
  value,
  onChange,
}: {
  value: AdminRole;
  onChange: (role: AdminRole) => void;
}) {
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Rôle</legend>
      {(['STAFF', 'OWNER'] as const).map((r) => (
        <label key={r} className={styles.checkCard} style={{ alignItems: 'flex-start' }}>
          <input type="radio" name="role" checked={value === r} onChange={() => onChange(r)} />
          <span className={styles.cellStack}>
            <span>{ADMIN_ROLE_LABELS_FR[r]}</span>
            <span className={styles.cellSub} style={{ fontWeight: 400 }}>
              {ROLE_HELP[r]}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function EditUserDialog({
  user,
  onClose,
  onSaved,
  onReset,
}: {
  user: AdminUserDto | null;
  onClose: () => void;
  onSaved: (message: string) => void;
  onReset: (result: TemporaryPasswordResponse) => void;
}) {
  const [role, setRole] = useState<AdminRole>('STAFF');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    setRole(user.role);
    setError(null);
  }, [user]);

  async function act(action: () => Promise<unknown>, then: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      then();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!user)
    return (
      <Dialog open={false} onClose={onClose} title="" variant="modal">
        <span />
      </Dialog>
    );

  return (
    <Dialog open onClose={onClose} variant="modal" title={user.fullName}>
      <p className={styles.muted}>{user.email}</p>
      <RolePicker value={role} onChange={setRole} />
      {role !== user.role ? (
        <button
          type="button"
          className={styles.btn}
          disabled={busy}
          onClick={() =>
            act(
              () => adminApi.updateUser(user.id, { role }),
              () =>
                onSaved(
                  `${user.fullName} est maintenant ${ADMIN_ROLE_LABELS_FR[role].toLowerCase()}.`,
                ),
            )
          }
        >
          Enregistrer le rôle
        </button>
      ) : null}
      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: 0 }} />
      <div className={styles.formActions}>
        <button
          type="button"
          className={styles.btnSecondary}
          disabled={busy || !user.isActive}
          onClick={() =>
            act(
              () => adminApi.resetPassword(user.id).then(onReset),
              () => {},
            )
          }
        >
          Réinitialiser le mot de passe
        </button>
        {user.isActive ? (
          <button
            type="button"
            className={styles.btnDanger}
            disabled={busy}
            onClick={() =>
              act(
                () => adminApi.updateUser(user.id, { isActive: false }),
                () => onSaved(`Le compte de ${user.fullName} est désactivé.`),
              )
            }
          >
            Désactiver le compte
          </button>
        ) : (
          <button
            type="button"
            className={styles.btn}
            disabled={busy}
            onClick={() =>
              act(
                () => adminApi.updateUser(user.id, { isActive: true }),
                () => onSaved(`Le compte de ${user.fullName} est réactivé.`),
              )
            }
          >
            Réactiver le compte
          </button>
        )}
      </div>
      <p className={styles.note}>
        Désactiver ou réinitialiser déconnecte immédiatement la personne sur tous ses appareils.
      </p>
      {error ? (
        <div className={styles.banner} role="alert">
          {error}
        </div>
      ) : null}
    </Dialog>
  );
}

function Recipients() {
  const { space } = useAdmin();
  const toast = useToast();
  const list = useAsync(() => adminApi.recipients(space.id), `rec-${space.id}`);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Adresse e-mail invalide.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      list.setData(await adminApi.addRecipient(space.id, email.trim(), name.trim() || null));
      setEmail('');
      setName('');
      toast('Adresse ajoutée.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<Awaited<ReturnType<typeof adminApi.recipients>>>) {
    try {
      list.setData(await action());
    } catch (err) {
      toast(errorMessage(err), true);
    }
  }

  return (
    <section className={cx(styles.card, styles.cardPad)}>
      <h2 className={styles.cardTitle}>E-mails de notification · {space.name}</h2>
      <p className={styles.note}>
        Ces adresses reçoivent un e-mail à chaque réservation confirmée, avec les coordonnées
        professionnelles du client. (L’envoi des e-mails sera activé à la phase 6.)
      </p>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <div className={styles.banner}>
          Aucune adresse&nbsp;: personne ne sera prévenu des réservations.
        </div>
      ) : (
        list.data.map((r) => (
          <div
            key={r.id}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 14px',
              borderRadius: 10,
              background: 'var(--color-ground)',
            }}
          >
            <span className={styles.cellStack}>
              <span style={{ fontWeight: 600 }}>{r.email}</span>
              {r.name ? <span className={styles.cellSub}>{r.name}</span> : null}
            </span>
            <span className={styles.actions} style={{ alignItems: 'center' }}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={r.isActive}
                  onChange={() => run(() => adminApi.updateRecipient(r.id, !r.isActive))}
                />
                Reçoit les e-mails
              </label>
              <button
                type="button"
                className={styles.iconBtn}
                aria-label={`Retirer ${r.email}`}
                onClick={() => run(() => adminApi.deleteRecipient(r.id))}
              >
                <Icon name="trash" size={16} />
              </button>
            </span>
          </div>
        ))
      )}
      <form onSubmit={add} className={styles.grid2} style={{ alignItems: 'end' }} noValidate>
        <Field label="Adresse e-mail">
          {(p) => (
            <input
              {...p}
              type="email"
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Nom (facultatif)">
          {(p) => (
            <input
              {...p}
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <div>
          <button type="submit" className={styles.btnSecondary} disabled={busy}>
            <Icon name="plus" size={16} /> Ajouter
          </button>
        </div>
      </form>
      {error ? (
        <div className={styles.banner} role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
