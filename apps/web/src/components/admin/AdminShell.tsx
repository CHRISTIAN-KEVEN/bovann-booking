'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AdminMe, AdminSpaceDto } from '@bovann/shared';
import { splitLocale } from '@/i18n/config';
import { Link, useI18n, useLocaleRouter, type TKey } from '@/i18n/I18nProvider';
import { adminApi, setUnauthorizedHandler } from '@/lib/admin-api';
import { ADMIN_ROLE_LABELS } from '@/lib/admin-format';
import { LanguageSwitch } from '../LanguageSwitch';
import { Icon, type IconName } from '../icons';
import { cx, Loading, ToastProvider } from './ui';
import styles from './admin.module.css';

interface AdminContextValue {
  me: AdminMe;
  isOwner: boolean;
  spaces: AdminSpaceDto[];
  space: AdminSpaceDto;
  setSpaceId: (id: number) => void;
  reloadSpaces: () => Promise<void>;
  /** Refunds still to handle, shown as a badge in the menu. */
  refundsDue: number;
  refreshCounters: () => void;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error('useAdmin must be used inside AdminShell');
  return value;
}

const SPACE_KEY = 'bovann.admin.space';
export const NEXT_KEY = 'bovann.admin.next';

const NAV: Array<{ href: string; label: TKey; icon: IconName; badge?: 'refunds' }> = [
  { href: '/admin', label: 'adminShell.nav.bookings', icon: 'bookings' },
  { href: '/admin/calendrier', label: 'adminShell.nav.calendar', icon: 'calendar' },
  { href: '/admin/forfaits', label: 'adminShell.nav.packages', icon: 'tag' },
  { href: '/admin/espaces', label: 'adminShell.nav.spaces', icon: 'video' },
  { href: '/admin/clients', label: 'adminShell.nav.clients', icon: 'users' },
  { href: '/admin/paiements', label: 'adminShell.nav.payments', icon: 'card', badge: 'refunds' },
  { href: '/admin/parametres', label: 'adminShell.nav.settings', icon: 'sliders' },
];

function readStoredSpace(): number | null {
  try {
    const v = Number(localStorage.getItem(SPACE_KEY));
    return Number.isSafeInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Signed-in frame of every admin page: checks the session, sends the admin to
 * sign-in (or to the password change) when needed, loads the spaces, and
 * renders the sidebar from the approved design.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const router = useLocaleRouter();
  const { t, locale } = useI18n();
  // The page's path without its language prefix ("/en/admin/clients" → "/admin/clients").
  const pathname = splitLocale(usePathname() ?? '/').path;
  const [me, setMe] = useState<AdminMe | null>(null);
  const [spaces, setSpaces] = useState<AdminSpaceDto[] | null>(null);
  const [spaceId, setSpaceIdState] = useState<number | null>(null);
  const [refundsDue, setRefundsDue] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const toSignIn = useCallback(() => {
    try {
      // Stored without the language: the sign-in page adds the current one back.
      sessionStorage.setItem(NEXT_KEY, splitLocale(window.location.pathname).path);
    } catch {
      /* private mode: just go to sign-in */
    }
    router.replace('/admin/connexion');
  }, [router]);

  useEffect(() => {
    setUnauthorizedHandler(toSignIn);
    return () => setUnauthorizedHandler(null);
  }, [toSignIn]);

  const reloadSpaces = useCallback(async () => {
    const list = await adminApi.spaces();
    setSpaces(list);
    setSpaceIdState((current) => {
      const wanted = current ?? readStoredSpace();
      return list.find((s) => s.id === wanted)?.id ?? list[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .me()
      .then(async (user) => {
        if (cancelled) return;
        if (user.mustChangePassword) {
          router.replace('/admin/mot-de-passe');
          return;
        }
        setMe(user);
        await reloadSpaces();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if ((error as { status?: number }).status !== 401) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router, reloadSpaces]);

  const refreshCounters = useCallback(() => {
    if (!spaceId) return;
    adminApi
      .stats(spaceId)
      .then((s) => setRefundsDue(s.refundsDueCount))
      .catch(() => {});
  }, [spaceId]);

  useEffect(() => {
    refreshCounters();
  }, [refreshCounters, pathname]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const setSpaceId = useCallback((id: number) => {
    setSpaceIdState(id);
    try {
      localStorage.setItem(SPACE_KEY, String(id));
    } catch {
      /* not essential */
    }
  }, []);

  const space = spaces?.find((s) => s.id === spaceId) ?? null;
  const value = useMemo<AdminContextValue | null>(
    () =>
      me && spaces && space
        ? {
            me,
            isOwner: me.role === 'OWNER',
            spaces,
            space,
            setSpaceId,
            reloadSpaces,
            refundsDue,
            refreshCounters,
          }
        : null,
    [me, spaces, space, setSpaceId, reloadSpaces, refundsDue, refreshCounters],
  );

  async function logout() {
    try {
      await adminApi.logout();
    } finally {
      router.replace('/admin/connexion');
    }
  }

  if (failed) {
    return (
      <div className={styles.authPage}>
        <div className={styles.authCard} role="alert">
          <h1 className={styles.authTitle}>{t('adminShell.downTitle')}</h1>
          <p>{t('adminShell.downText')}</p>
          <button type="button" className={styles.btn} onClick={() => window.location.reload()}>
            {t('adminShell.retry')}
          </button>
        </div>
      </div>
    );
  }
  if (!value) {
    return (
      <div className={styles.shell}>
        <main className={styles.main}>
          <Loading />
        </main>
      </div>
    );
  }

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  return (
    <AdminContext.Provider value={value}>
      <ToastProvider>
        <div className={styles.shell}>
          <header className={styles.topbar}>
            <span className={styles.brand}>
              <span className={styles.liveDot} aria-hidden="true" />
              Bovann OCD Live
            </span>
            <button
              type="button"
              className={styles.iconBtn}
              aria-expanded={menuOpen}
              aria-controls="admin-menu"
              aria-label={menuOpen ? t('adminShell.closeMenu') : t('adminShell.openMenu')}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <Icon name={menuOpen ? 'close' : 'menu'} size={18} />
            </button>
          </header>
          <nav
            id="admin-menu"
            aria-label={t('adminShell.admin')}
            className={cx(styles.sidebar, menuOpen && styles.sidebarOpen)}
          >
            <span className={styles.brand}>
              <span className={styles.liveDot} aria-hidden="true" />
              Bovann OCD Live
            </span>
            {value.spaces.length > 1 ? (
              <label className={styles.spacePicker}>
                {t('adminShell.space')}
                <select value={value.space.id} onChange={(e) => setSpaceId(Number(e.target.value))}>
                  {value.spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.isActive ? '' : t('adminShell.inactive')}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className={styles.spacePicker}>
                {t('adminShell.space')}
                <span style={{ color: '#fff', fontSize: 14, fontWeight: 500, letterSpacing: 0 }}>
                  {value.space.name}
                </span>
              </div>
            )}
            <div className={styles.nav}>
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cx(styles.navLink, isActive(item.href) && styles.navLinkActive)}
                >
                  <Icon name={item.icon} size={17} />
                  {t(item.label)}
                  {item.badge === 'refunds' && refundsDue > 0 ? (
                    <span
                      className={styles.navBadge}
                      aria-label={t('adminShell.refundsDue', { count: refundsDue })}
                    >
                      {refundsDue}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
            <div className={styles.account}>
              <span className={styles.accountName}>{value.me.fullName}</span>
              <span className={styles.accountRole}>
                {ADMIN_ROLE_LABELS[locale][value.me.role]} · {value.me.email}
              </span>
              <span className={styles.accountActions}>
                <button type="button" className={styles.linkButton} onClick={logout}>
                  {t('adminShell.logout')}
                </button>
                <LanguageSwitch />
              </span>
            </div>
          </nav>
          <main className={styles.main}>{children}</main>
        </div>
      </ToastProvider>
    </AdminContext.Provider>
  );
}
