import { renderI18n } from '@/test/i18n';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignInPage from './page';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/connexion',
  useRouter: () => ({ replace, push: vi.fn() }),
}));

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('Admin sign-in', () => {
  beforeEach(() => {
    replace.mockClear();
    sessionStorage.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks for both fields before calling the server', async () => {
    const fetchMock = respond(200, {});
    vi.stubGlobal('fetch', fetchMock);
    renderI18n(<SignInPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(screen.getByRole('alert')).toHaveTextContent('adresse e-mail et votre mot de passe');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the server’s French message when the password is wrong', async () => {
    vi.stubGlobal(
      'fetch',
      respond(401, { code: 'INVALID_CREDENTIALS', message: 'E-mail ou mot de passe incorrect.' }),
    );
    renderI18n(<SignInPage />);
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'owner@bovann.tg');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'mauvais');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou mot de passe incorrect.');
    expect(replace).not.toHaveBeenCalled();
  });

  it('goes back to the page that asked for sign-in, or to the password change', async () => {
    sessionStorage.setItem('bovann.admin.next', '/admin/forfaits');
    vi.stubGlobal(
      'fetch',
      respond(200, {
        id: 1,
        email: 'o@b.tg',
        fullName: 'O',
        role: 'OWNER',
        mustChangePassword: false,
      }),
    );
    const { unmount } = renderI18n(<SignInPage />);
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'o@b.tg');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'un mot de passe');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/forfaits'));
    unmount();

    replace.mockClear();
    vi.stubGlobal(
      'fetch',
      respond(200, {
        id: 2,
        email: 'n@b.tg',
        fullName: 'N',
        role: 'STAFF',
        mustChangePassword: true,
      }),
    );
    renderI18n(<SignInPage />);
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'n@b.tg');
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'temporaire');
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/mot-de-passe'));
  });
});
