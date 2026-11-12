import type { ReviewStatus, SellerLiveDto, SellerLivesResponse } from '@bovann/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type * as SellerApiModule from '@/lib/seller-api';
import { renderI18n } from '@/test/i18n';
import { PostLive } from './PostLive';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/en-direct/publier',
  useRouter: () => ({ push: vi.fn(), replace }),
}));

const api = vi.hoisted(() => ({
  me: vi.fn(),
  lives: vi.fn(),
  submit: vi.fn(),
  end: vi.fn(),
  pay: vi.fn(),
  payment: vi.fn(),
  simulatePayment: vi.fn(),
}));
vi.mock('@/lib/seller-api', async (importOriginal) => ({
  ...(await importOriginal<typeof SellerApiModule>()),
  sellerApi: api,
}));

const NOW = Date.now();
const OPEN: ReviewStatus = {
  open: true,
  closesAt: new Date(NOW + 2 * 3_600_000).toISOString(),
  nextOpensAt: null,
  today: [{ opensAt: '08:00', closesAt: '18:00' }],
  timezone: 'Africa/Lome',
};

const response = (over: Partial<SellerLivesResponse> = {}): SellerLivesResponse => ({
  now: new Date(NOW).toISOString(),
  lives: [],
  review: OPEN,
  categories: [
    { code: 'MODE', name: 'Mode', icon: 'mode' },
    { code: 'BEAUTE', name: 'Beauté', icon: 'beaute' },
  ],
  pass: {
    plan: 'MONTH',
    startsAt: new Date(NOW).toISOString(),
    endsAt: '2026-12-09T12:00:00.000Z',
  },
  prices: { passMonthXof: 10_000, passYearXof: 100_000 },
  ...over,
});

const sellerLive = (over: Partial<SellerLiveDto> = {}): SellerLiveDto => ({
  id: 7,
  sellerName: 'afimode',
  platform: 'TIKTOK',
  url: 'https://www.tiktok.com/@afimode/live',
  countryCode: 'TG',
  categoryCode: null,
  categoryLabel: 'Pagnes et tissus',
  categoryIcon: 'autre',
  startedAt: '',
  endsAt: '',
  status: 'PENDING',
  durationMin: 120,
  createdAt: new Date(NOW).toISOString(),
  rejectReason: null,
  reviewedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.me.mockResolvedValue({ id: 1, phone: '+22890123456' });
  api.lives.mockResolvedValue(response());
});

describe('posting a live', () => {
  it('takes the link, country, category ("Autre"), duration and name, then sends', async () => {
    api.submit.mockResolvedValue(sellerLive());
    const user = userEvent.setup();
    renderI18n(<PostLive />);

    await user.type(await screen.findByLabelText('Lien du live'), 'tiktok.com/@afimode/live');
    expect(screen.getByText('Live TikTok de @afimode')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Continuer/ }));

    // Country: the phone's country is pre-selected; one tap moves on.
    expect(screen.getByRole('button', { name: 'Togo' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Togo' }));

    await user.click(await screen.findByRole('button', { name: 'Autre' }));
    await user.click(screen.getByRole('button', { name: /Continuer/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Écrivez votre activité');
    await user.type(screen.getByLabelText('Écrivez votre activité'), 'Pagnes et tissus');
    await user.click(screen.getByRole('button', { name: /Continuer/ }));

    await user.click(await screen.findByRole('button', { name: '3 h' }));
    expect(screen.getByLabelText('Votre nom')).toHaveValue('afimode');
    expect(screen.getByText('Pass mensuel · jusqu’au 9 décembre 2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Envoyer' }));

    expect(api.submit).toHaveBeenCalledWith({
      url: 'tiktok.com/@afimode/live',
      sellerName: 'afimode',
      countryCode: 'TG',
      categoryCode: null,
      categoryOther: 'Pagnes et tissus',
      durationMin: 180,
    });
    expect(await screen.findByRole('heading', { name: 'C’est envoyé !' })).toBeInTheDocument();
    expect(screen.getByText('Vérification en cours')).toBeInTheDocument();
  });

  it('refuses another site’s link before going on', async () => {
    const user = userEvent.setup();
    renderI18n(<PostLive />);
    await user.type(await screen.findByLabelText('Lien du live'), 'https://youtube.com/live/x');
    await user.click(screen.getByRole('button', { name: /Continuer/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Seuls les liens TikTok et Facebook sont acceptés.',
    );
  });

  it('is closed outside review hours and says when the team is back', async () => {
    api.lives.mockResolvedValue(
      response({
        review: {
          ...OPEN,
          open: false,
          closesAt: null,
          nextOpensAt: new Date(NOW + 2 * 3_600_000 + 20 * 60_000).toISOString(),
        },
      }),
    );
    renderI18n(<PostLive />);
    expect(await screen.findByRole('heading', { name: /L’équipe revient/ })).toBeInTheDocument();
    expect(screen.getByText(/Revenez dans 2 h 20/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Lien du live')).not.toBeInTheDocument();
  });

  it('follows a request already waiting, and shows staff’s answer', async () => {
    api.lives.mockResolvedValue(response({ lives: [sellerLive()] }));
    const { unmount } = renderI18n(<PostLive />);
    expect(await screen.findByRole('heading', { name: 'C’est envoyé !' })).toBeInTheDocument();
    unmount();

    api.lives.mockResolvedValue(
      response({
        lives: [sellerLive({ status: 'REJECTED', rejectReason: 'Le lien ne marche pas.' })],
      }),
    );
    renderI18n(<PostLive />);
    // A refused request isn't "waiting": the form opens; the answer shows in the seller space.
    expect(await screen.findByLabelText('Lien du live')).toBeInTheDocument();
  });

  it('sends a signed-out seller to sign-in, then back here', async () => {
    api.me.mockRejectedValue(new ApiError(401, 'NOT_AUTHENTICATED', 'Connectez-vous'));
    renderI18n(<PostLive />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/vendeur/connexion?suite=/en-direct/publier'),
    );
  });

  it('shows the pass on the last step when the seller has one', async () => {
    api.lives.mockResolvedValue(
      response({
        pass: { plan: 'MONTH', startsAt: '2026-11-11T09:00:00Z', endsAt: '2026-12-09T09:00:00Z' },
      }),
    );
    const user = userEvent.setup();
    renderI18n(<PostLive />);
    await user.type(await screen.findByLabelText('Lien du live'), 'tiktok.com/@afimode/live');
    await user.click(screen.getByRole('button', { name: /Continuer/ }));
    await user.click(screen.getByRole('button', { name: 'Togo' }));
    await user.click(await screen.findByRole('button', { name: 'Mode' }));
    expect(await screen.findByText('Pass mensuel · jusqu’au 9 décembre 2026')).toBeInTheDocument();
  });

  it('asks for a pass first when the seller has none, then opens the form once paid', async () => {
    api.lives.mockResolvedValue(response({ pass: null }));
    api.pay.mockResolvedValue({
      id: 3,
      purpose: 'PASS_MONTH',
      amountXof: 10_000,
      method: 'MOBILE_MONEY',
      channel: 'FLOOZ',
      status: 'PENDING',
      instructions: 'Paiement simulé',
      failureReason: null,
      createdAt: new Date(NOW).toISOString(),
    });
    api.payment.mockResolvedValue({
      id: 3,
      purpose: 'PASS_MONTH',
      amountXof: 10_000,
      method: 'MOBILE_MONEY',
      channel: 'FLOOZ',
      status: 'SUCCEEDED',
      instructions: null,
      failureReason: null,
      createdAt: new Date(NOW).toISOString(),
    });
    const user = userEvent.setup();
    renderI18n(<PostLive />);
    expect(
      await screen.findByRole('heading', { name: 'Prenez un pass pour publier' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Lien du live')).not.toBeInTheDocument();
    // No single-live option.
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([
      expect.stringContaining('Pass annuel'),
      expect.stringContaining('Pass mensuel'),
    ]);

    await user.click(screen.getByRole('radio', { name: /Pass mensuel/ }));
    await user.click(screen.getByRole('button', { name: 'Flooz' }));
    // Once paid, the next load has the pass.
    api.lives.mockResolvedValue(response());
    await user.click(screen.getByRole('button', { name: /Payer 10\s?000 FCFA/ }));
    expect(api.pay).toHaveBeenCalledWith({
      purpose: 'PASS_MONTH',
      method: 'MOBILE_MONEY',
      channel: 'FLOOZ',
      payerPhone: '+22890123456',
    });
    expect(await screen.findByText('Validez le paiement sur votre téléphone')).toBeInTheDocument();
    expect(
      await screen.findByLabelText('Lien du live', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('goes back to the pass if it ran out while filling in the form', async () => {
    api.submit.mockRejectedValue(
      new ApiError(402, 'PASS_REQUIRED', 'Prenez un pass pour publier vos lives.'),
    );
    const user = userEvent.setup();
    renderI18n(<PostLive />);
    await user.type(await screen.findByLabelText('Lien du live'), 'tiktok.com/@afimode/live');
    await user.click(screen.getByRole('button', { name: /Continuer/ }));
    await user.click(screen.getByRole('button', { name: 'Togo' }));
    await user.click(await screen.findByRole('button', { name: 'Mode' }));
    api.lives.mockResolvedValue(response({ pass: null }));
    await user.click(await screen.findByRole('button', { name: 'Envoyer' }));
    expect(
      await screen.findByRole('heading', { name: 'Prenez un pass pour publier' }),
    ).toBeInTheDocument();
  });
});
