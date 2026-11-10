import type { LiveDto, LiveWallResponse } from '@bovann/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyFilters,
  countryCounts,
  filtersFromSearch,
  initialsOf,
  searchFromFilters,
  sinceLabel,
} from '@/lib/lives';
import { renderI18n, tFor } from '@/test/i18n';
import { LiveWall } from './LiveWall';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en-direct',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const lives = vi.fn<() => Promise<LiveWallResponse>>();
vi.mock('@/lib/api', () => ({
  api: { lives: () => lives() },
  ApiError: class extends Error {},
}));

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const later = (min: number) => new Date(NOW + min * 60_000).toISOString();

const live = (over: Partial<LiveDto>): LiveDto => ({
  id: 1,
  sellerName: 'Afi Mode',
  platform: 'TIKTOK',
  url: 'https://www.tiktok.com/@afimode/live',
  countryCode: 'TG',
  categoryCode: 'MODE',
  categoryLabel: 'Mode',
  categoryIcon: 'mode',
  startedAt: ago(25),
  endsAt: later(60),
  ...over,
});

const WALL: LiveWallResponse = {
  now: new Date(NOW).toISOString(),
  categories: [
    { code: 'MODE', name: 'Mode', icon: 'mode' },
    { code: 'ELECTRONIQUE', name: 'Téléphones & électronique', icon: 'elec' },
  ],
  lives: [
    live({ id: 1 }),
    live({
      id: 2,
      sellerName: 'Kofi Électro',
      platform: 'FACEBOOK',
      url: 'https://www.facebook.com/kofi/videos/1',
      countryCode: 'GH',
      categoryCode: 'ELECTRONIQUE',
      categoryLabel: 'Téléphones & électronique',
      categoryIcon: 'elec',
      startedAt: ago(8),
    }),
    live({
      id: 3,
      sellerName: 'Pagnes Dédé',
      categoryCode: null,
      categoryLabel: 'Pagnes et tissus',
      categoryIcon: 'autre',
      startedAt: ago(65),
    }),
  ],
};

beforeEach(() => {
  lives.mockReset();
  window.history.replaceState(null, '', '/en-direct');
});

describe('live wall helpers', () => {
  it('reads and writes the filters in the address', () => {
    const f = filtersFromSearch(new URLSearchParams('pays=tg&plateforme=tiktok&categorie=mode'));
    expect(f).toEqual({ country: 'TG', platform: 'TIKTOK', category: 'MODE' });
    expect(searchFromFilters(f)).toBe('?pays=TG&plateforme=tiktok&categorie=mode');
    expect(filtersFromSearch(new URLSearchParams('pays=<b>&plateforme=youtube'))).toEqual({
      country: null,
      platform: null,
      category: null,
    });
  });

  it('counts countries with the other filters applied', () => {
    const tiktok = { country: null, platform: 'TIKTOK' as const, category: null };
    expect(countryCounts(WALL.lives, tiktok)).toEqual({
      total: 2,
      countries: [{ code: 'TG', count: 2 }],
    });
    expect(applyFilters(WALL.lives, { ...tiktok, category: 'AUTRE' }).map((l) => l.id)).toEqual([
      3,
    ]);
  });

  it('writes the time live and the initials', () => {
    const t = tFor('fr');
    expect(sinceLabel(ago(25), NOW, t)).toBe('25 min');
    expect(sinceLabel(ago(65), NOW, t)).toBe('1 h 05');
    expect(initialsOf('Afi Mode')).toBe('AM');
    expect(initialsOf('@kofi.electro')).toBe('KE');
    expect(initialsOf('Élodie')).toBe('ÉL');
  });
});

describe('live wall', () => {
  it('lists the lives, newest first, each opening on its platform in a new tab', async () => {
    lives.mockResolvedValue(WALL);
    renderI18n(<LiveWall />);
    expect(await screen.findByText('3 vendeurs en direct')).toBeInTheDocument();
    const cards = screen.getAllByRole('link', { name: /Regarder le live de/ });
    expect(cards.map((c) => c.getAttribute('href'))).toEqual([
      'https://www.tiktok.com/@afimode/live',
      'https://www.facebook.com/kofi/videos/1',
      'https://www.tiktok.com/@afimode/live',
    ]);
    for (const card of cards) {
      expect(card).toHaveAttribute('target', '_blank');
      expect(card.getAttribute('rel')).toContain('noopener');
    }
    expect(cards[1]).toHaveAccessibleName(
      'Regarder le live de Kofi Électro sur Facebook, Ghana, Téléphones & électronique. En direct depuis 8 min.',
    );
  });

  it('filters by country and platform, and keeps the choice in the address', async () => {
    lives.mockResolvedValue(WALL);
    const user = userEvent.setup();
    renderI18n(<LiveWall />);
    const countries = await screen.findByRole('group', { name: 'Pays' });
    await user.click(within(countries).getByRole('button', { name: /Ghana/ }));
    expect(screen.getAllByRole('link', { name: /Regarder le live de/ })).toHaveLength(1);
    expect(window.location.search).toBe('?pays=GH');
    expect(screen.getByRole('heading', { name: 'Ghana · 1 live' })).toBeInTheDocument();

    await user.click(within(countries).getByRole('button', { name: /Tous/ }));
    const platforms = screen.getByRole('group', { name: 'Plateforme' });
    await user.click(within(platforms).getByRole('button', { name: 'TikTok' }));
    expect(screen.getAllByRole('link', { name: /Regarder le live de/ })).toHaveLength(2);
    expect(window.location.search).toBe('?plateforme=tiktok');
  });

  it('offers "Autres" for categories sellers typed, and says when nothing matches', async () => {
    lives.mockResolvedValue({ ...WALL, lives: [WALL.lives[2]!] });
    window.history.replaceState(null, '', '/en-direct?categorie=mode');
    const user = userEvent.setup();
    renderI18n(<LiveWall />);
    expect(await screen.findByText('Aucun live pour ce choix')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voir tous les lives' }));
    expect(screen.getAllByRole('link', { name: /Regarder le live de/ })).toHaveLength(1);
    const categories = screen.getByRole('group', { name: 'Catégorie' });
    expect(within(categories).getByRole('button', { name: 'Autres' })).toBeInTheDocument();
  });

  it('says when nobody is live, and hides lives whose time is up', async () => {
    lives.mockResolvedValue({ ...WALL, lives: [live({ endsAt: ago(1) })] });
    renderI18n(<LiveWall />);
    expect(await screen.findByText('Pas de live en ce moment')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Regarder le live de/ })).not.toBeInTheDocument();
  });

  it('shows an error with a way to try again', async () => {
    lives.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(WALL);
    const user = userEvent.setup();
    renderI18n(<LiveWall />);
    expect(await screen.findByText('Impossible d’afficher les lives.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('3 vendeurs en direct')).toBeInTheDocument();
  });

  it('speaks English on the English site', async () => {
    lives.mockResolvedValue(WALL);
    renderI18n(<LiveWall />, { locale: 'en' });
    expect(await screen.findByText('3 sellers live now')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Everywhere · 3 lives' })).toBeInTheDocument();
  });
});
