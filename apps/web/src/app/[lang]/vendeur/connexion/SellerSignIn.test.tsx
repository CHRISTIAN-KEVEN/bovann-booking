import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type * as SellerApiModule from '@/lib/seller-api';
import { safeNext } from '@/lib/seller-api';
import { renderI18n } from '@/test/i18n';
import { SellerSignIn } from './SellerSignIn';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/vendeur/connexion',
  useRouter: () => ({ push: vi.fn(), replace }),
}));

const api = vi.hoisted(() => ({
  status: vi.fn(),
  me: vi.fn(),
  requestCode: vi.fn(),
  verify: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('@/lib/seller-api', async (importOriginal) => ({
  ...(await importOriginal<typeof SellerApiModule>()),
  sellerApi: api,
}));

const sent = (over = {}) => ({
  phone: '+22890123456',
  channel: 'WHATSAPP',
  expiresInSec: 600,
  resendInSec: 60,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.status.mockResolvedValue({ available: true });
  api.me.mockRejectedValue(new ApiError(401, 'NOT_AUTHENTICATED', 'Connectez-vous'));
  window.history.replaceState(null, '', '/vendeur/connexion');
});

describe('seller sign-in', () => {
  it('asks for the number, sends the code by WhatsApp, then signs in with the 6 digits', async () => {
    api.requestCode.mockResolvedValue(sent());
    api.verify.mockResolvedValue({ id: 1, phone: '+22890123456' });
    window.history.replaceState(null, '', '/vendeur/connexion?suite=/en-direct');
    const user = userEvent.setup();
    renderI18n(<SellerSignIn />);

    await user.type(screen.getByLabelText('Numéro de téléphone'), '90 12 34 56');
    expect(screen.getByRole('button', { name: 'WhatsApp' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Recevoir le code' }));
    expect(api.requestCode).toHaveBeenCalledWith('+22890123456', 'WHATSAPP');

    expect(await screen.findByRole('heading', { name: 'Entrez le code reçu' })).toBeInTheDocument();
    expect(screen.getByText('+228 90 12 34 56')).toBeInTheDocument();
    expect(screen.getByText(/Renvoyer dans 1:00/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Code à 6 chiffres'), '482731');
    expect(api.verify).toHaveBeenCalledWith('+22890123456', '482731');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/en-direct'));
  });

  it('checks the number before sending, and can use SMS', async () => {
    api.requestCode.mockResolvedValue(sent({ channel: 'SMS' }));
    const user = userEvent.setup();
    renderI18n(<SellerSignIn />);
    await user.click(screen.getByRole('button', { name: 'Recevoir le code' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Numéro invalide');
    expect(api.requestCode).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Numéro de téléphone'), '90123456');
    await user.click(screen.getByRole('button', { name: 'SMS' }));
    await user.click(screen.getByRole('button', { name: 'Recevoir le code' }));
    expect(api.requestCode).toHaveBeenCalledWith('+22890123456', 'SMS');
    expect(await screen.findByText('Nous l’avons envoyé par SMS au')).toBeInTheDocument();
  });

  it('shows the server’s message for a wrong code and empties the boxes', async () => {
    api.requestCode.mockResolvedValue(sent());
    api.verify.mockRejectedValue(
      new ApiError(400, 'OTP_INVALID', 'Code incorrect. Encore 4 essais.'),
    );
    const user = userEvent.setup();
    renderI18n(<SellerSignIn />);
    await user.type(screen.getByLabelText('Numéro de téléphone'), '90123456');
    await user.click(screen.getByRole('button', { name: 'Recevoir le code' }));
    const input = await screen.findByLabelText('Code à 6 chiffres');
    await user.type(input, '111111');
    expect(await screen.findByRole('alert')).toHaveTextContent('Code incorrect. Encore 4 essais.');
    expect(input).toHaveValue('');
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows the code in test mode, with a button to fill it in', async () => {
    api.requestCode.mockResolvedValue(sent({ devCode: '135790' }));
    api.verify.mockResolvedValue({ id: 1, phone: '+22890123456' });
    const user = userEvent.setup();
    renderI18n(<SellerSignIn />);
    await user.type(screen.getByLabelText('Numéro de téléphone'), '90123456');
    await user.click(screen.getByRole('button', { name: 'Recevoir le code' }));
    expect(await screen.findByText(/Votre code est 135790/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remplir' }));
    expect(api.verify).toHaveBeenCalledWith('+22890123456', '135790');
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/vendeur'));
  });

  it('says when sign-in isn’t open yet', async () => {
    api.status.mockResolvedValue({ available: false });
    renderI18n(<SellerSignIn />);
    expect(
      await screen.findByRole('heading', { name: 'La publication de lives ouvre bientôt' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir les lives' })).toHaveAttribute(
      'href',
      '/en-direct',
    );
  });

  it('goes on at once when the seller is already signed in', async () => {
    api.me.mockResolvedValue({ id: 1, phone: '+22890123456' });
    renderI18n(<SellerSignIn />, { locale: 'en' });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/en/vendeur'));
  });

  it('only returns to pages of our own site', () => {
    expect(safeNext('/en-direct/publier')).toBe('/en-direct/publier');
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});
