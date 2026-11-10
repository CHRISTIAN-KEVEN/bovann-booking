'use client';

import type { AdminRole, AdminUserDto, TemporaryPasswordResponse } from '@bovann/shared';
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
import { Link, useI18n } from '@/i18n/I18nProvider';
import { adminApi } from '@/lib/admin-api';
import { ADMIN_ROLE_LABELS, formatDateTime } from '@/lib/admin-format';

export default function AdminSettingsPage() {
  const { me, isOwner } = useAdmin();
  const { t, locale } = useI18n();
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <section className={cx(styles.card, styles.cardPad)}>
        <h2 className={styles.cardTitle}>{t('settings.account')}</h2>
        <dl className={styles.dl}>
          <dt>{t('settings.name')}</dt>
          <dd>{me.fullName}</dd>
          <dt>{t('settings.email')}</dt>
          <dd>{me.email}</dd>
          <dt>{t('settings.role')}</dt>
          <dd>{ADMIN_ROLE_LABELS[locale][me.role]}</dd>
        </dl>
        <div>
          <Link href="/admin/mot-de-passe" className={styles.btnSecondary}>
            {t('settings.changePassword')}
          </Link>
        </div>
      </section>
      {isOwner ? (
        <>
          <Users />
          <EmailSending />
          <Recipients />
        </>
      ) : (
        <p className={styles.note}>{t('settings.ownerOnly')}</p>
      )}
    </>
  );
}

function Users() {
  const { me } = useAdmin();
  const { t, locale } = useI18n();
  const toast = useToast();
  const users = useAsync(() => adminApi.users(), 'users');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AdminUserDto | null>(null);
  const [issued, setIssued] = useState<TemporaryPasswordResponse | null>(null);

  return (
    <section className={styles.card}>
      <div className={styles.toolbar}>
        <h2 className={styles.cardTitle}>{t('settings.users')}</h2>
        <button type="button" className={styles.btn} onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} /> {t('settings.addUser')}
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
                <th>{t('settings.colName')}</th>
                <th>{t('settings.colRole')}</th>
                <th>{t('settings.colState')}</th>
                <th>{t('settings.colLast')}</th>
                <th>
                  <span className={styles.srOnly}>{t('settings.colActions')}</span>
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
                        {u.id === me.id ? t('settings.you') : ''}
                      </span>
                      <span className={styles.cellSub}>{u.email}</span>
                    </div>
                  </td>
                  <td>{ADMIN_ROLE_LABELS[locale][u.role]}</td>
                  <td>
                    {!u.isActive ? (
                      <Badge tone="neutral">{t('settings.deactivated')}</Badge>
                    ) : u.mustChangePassword ? (
                      <Badge tone="warning">{t('settings.tempPassword')}</Badge>
                    ) : (
                      <Badge tone="success">{t('settings.active')}</Badge>
                    )}
                  </td>
                  <td>
                    {u.lastLoginAt
                      ? formatDateTime(u.lastLoginAt, undefined, locale)
                      : t('settings.never')}
                  </td>
                  <td className={styles.right}>
                    {u.id === me.id ? null : (
                      <button
                        type="button"
                        className={cx(styles.btnSecondary, styles.btnSmall)}
                        onClick={() => setEditing(u)}
                      >
                        {t('settings.manage')}
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
        title={t('settings.tempPassword')}
        footer={
          <button type="button" className={styles.btn} onClick={() => setIssued(null)}>
            {t('settings.noted')}
          </button>
        }
      >
        {issued ? (
          <>
            <p>{t('settings.giveTo', { name: issued.user.fullName, email: issued.user.email })}</p>
            <div className={styles.tempPassword} aria-label={t('settings.tempPassword')}>
              {issued.temporaryPassword}
            </div>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => {
                void navigator.clipboard?.writeText(issued.temporaryPassword).then(
                  () => toast(t('settings.copied')),
                  () => toast(t('settings.copyFailed'), true),
                );
              }}
            >
              <Icon name="copy" size={16} /> {t('settings.copy')}
            </button>
            <p className={styles.note}>{t('settings.shownOnce')}</p>
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
  const { t } = useI18n();
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
      setError(t('settings.invalidUser'));
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
      title={t('settings.addUser')}
      footer={
        <>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            {t('settings.cancel')}
          </button>
          <button type="submit" form="user-form" className={styles.btn} disabled={busy}>
            {busy ? t('settings.creating') : t('settings.create')}
          </button>
        </>
      }
    >
      <form id="user-form" className={styles.section} onSubmit={submit} noValidate>
        <Field label={t('settings.fullName')}>
          {(p) => (
            <input
              {...p}
              className={styles.input}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('settings.emailAddress')} hint={t('settings.emailHint')}>
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
  const { t, locale } = useI18n();
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>{t('settings.role')}</legend>
      {(['STAFF', 'OWNER'] as const).map((r) => (
        <label key={r} className={styles.checkCard} style={{ alignItems: 'flex-start' }}>
          <input type="radio" name="role" checked={value === r} onChange={() => onChange(r)} />
          <span className={styles.cellStack}>
            <span>{ADMIN_ROLE_LABELS[locale][r]}</span>
            <span className={styles.cellSub} style={{ fontWeight: 400 }}>
              {t(`settings.roleHelp.${r}`)}
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
  const { t, locale } = useI18n();
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
                  t('settings.nowRole', {
                    name: user.fullName,
                    role: ADMIN_ROLE_LABELS[locale][role].toLowerCase(),
                  }),
                ),
            )
          }
        >
          {t('settings.saveRole')}
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
          {t('settings.reset')}
        </button>
        {user.isActive ? (
          <button
            type="button"
            className={styles.btnDanger}
            disabled={busy}
            onClick={() =>
              act(
                () => adminApi.updateUser(user.id, { isActive: false }),
                () => onSaved(t('settings.deactivatedToast', { name: user.fullName })),
              )
            }
          >
            {t('settings.deactivate')}
          </button>
        ) : (
          <button
            type="button"
            className={styles.btn}
            disabled={busy}
            onClick={() =>
              act(
                () => adminApi.updateUser(user.id, { isActive: true }),
                () => onSaved(t('settings.reactivatedToast', { name: user.fullName })),
              )
            }
          >
            {t('settings.reactivate')}
          </button>
        )}
      </div>
      <p className={styles.note}>{t('settings.signsOut')}</p>
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
  const { t } = useI18n();
  const toast = useToast();
  const list = useAsync(() => adminApi.recipients(space.id), `rec-${space.id}`);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t('settings.badEmail'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      list.setData(await adminApi.addRecipient(space.id, email.trim(), name.trim() || null));
      setEmail('');
      setName('');
      toast(t('settings.added'));
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
      <h2 className={styles.cardTitle}>{t('settings.recipients', { space: space.name })}</h2>
      <p className={styles.note}>{t('settings.recipientsNote')}</p>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.length === 0 ? (
        <div className={styles.banner}>{t('settings.noRecipients')}</div>
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
                {t('settings.receives')}
              </label>
              <button
                type="button"
                className={styles.iconBtn}
                aria-label={t('settings.remove', { email: r.email })}
                onClick={() => run(() => adminApi.deleteRecipient(r.id))}
              >
                <Icon name="trash" size={16} />
              </button>
            </span>
          </div>
        ))
      )}
      <form onSubmit={add} className={styles.grid2} style={{ alignItems: 'end' }} noValidate>
        <Field label={t('settings.emailAddress')}>
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
        <Field label={t('settings.nameOptional')}>
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
            <Icon name="plus" size={16} /> {t('settings.add')}
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

function EmailSending() {
  const { me } = useAdmin();
  const { t } = useI18n();
  const toast = useToast();
  const settings = useAsync(() => adminApi.notificationSettings(), 'email-settings');
  const [to, setTo] = useState(me.email);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function test(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.sendTestEmail(to.trim() || undefined);
      toast(t('settings.testSent', { to: res.to }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cx(styles.card, styles.cardPad)}>
      <h2 className={styles.cardTitle}>{t('settings.sending')}</h2>
      {settings.error ? (
        <LoadError error={settings.error} onRetry={settings.reload} />
      ) : !settings.data ? (
        <Loading />
      ) : !settings.data.enabled ? (
        <div className={styles.banner}>{t('settings.notConfigured')}</div>
      ) : (
        <>
          <dl className={styles.dl}>
            <dt>{t('settings.from')}</dt>
            <dd>{settings.data.from}</dd>
            <dt>{t('settings.pending')}</dt>
            <dd>{settings.data.pending}</dd>
            <dt>{t('settings.failed')}</dt>
            <dd>
              {settings.data.failed > 0 ? <Badge tone="danger">{settings.data.failed}</Badge> : 0}
              {settings.data.failed > 0 ? (
                <span className={styles.cellSub}>{t('settings.failedHint')}</span>
              ) : null}
            </dd>
          </dl>
          <form onSubmit={test} className={styles.grid2} style={{ alignItems: 'end' }} noValidate>
            <Field label={t('settings.testTo')}>
              {(p) => (
                <input
                  {...p}
                  type="email"
                  className={styles.input}
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              )}
            </Field>
            <div>
              <button type="submit" className={styles.btnSecondary} disabled={busy}>
                {busy ? t('settings.testing') : t('settings.test')}
              </button>
            </div>
          </form>
          {error ? (
            <div className={styles.banner} role="alert">
              {error}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
