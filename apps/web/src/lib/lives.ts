import type { CategoryIcon, LiveDto, LivePlatform } from '@bovann/shared';
import type { T } from '@/i18n/I18nProvider';

/**
 * Live wall: filters (kept in the address, so a filtered wall can be shared), counts for the
 * country chips, and the small texts on each card.
 */

/** Pseudo-category for lives whose seller typed their own category ("Autre"). */
export const OTHER_CATEGORY = 'AUTRE';

export interface LiveFilters {
  country: string | null;
  platform: LivePlatform | null;
  category: string | null;
}

export const NO_FILTERS: LiveFilters = { country: null, platform: null, category: null };

const PARAMS = { country: 'pays', platform: 'plateforme', category: 'categorie' } as const;

export function filtersFromSearch(params: URLSearchParams): LiveFilters {
  const country = params.get(PARAMS.country)?.toUpperCase() ?? null;
  const platform = params.get(PARAMS.platform)?.toUpperCase() ?? null;
  const category = params.get(PARAMS.category)?.toUpperCase() ?? null;
  return {
    country: country && /^[A-Z]{2}$/.test(country) ? country : null,
    platform: platform === 'TIKTOK' || platform === 'FACEBOOK' ? platform : null,
    category: category && /^[A-Z0-9_]{2,40}$/.test(category) ? category : null,
  };
}

export function searchFromFilters(filters: LiveFilters): string {
  const params = new URLSearchParams();
  if (filters.country) params.set(PARAMS.country, filters.country);
  if (filters.platform) params.set(PARAMS.platform, filters.platform.toLowerCase());
  if (filters.category) params.set(PARAMS.category, filters.category.toLowerCase());
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function hasFilters(filters: LiveFilters): boolean {
  return Boolean(filters.country || filters.platform || filters.category);
}

function matches(live: LiveDto, f: LiveFilters, skip?: keyof LiveFilters): boolean {
  if (skip !== 'country' && f.country && live.countryCode !== f.country) return false;
  if (skip !== 'platform' && f.platform && live.platform !== f.platform) return false;
  if (skip !== 'category' && f.category) {
    const code = live.categoryCode ?? OTHER_CATEGORY;
    if (code !== f.category) return false;
  }
  return true;
}

/** Lives still on the wall at `now` (the list is refreshed every minute; this hides ended ones in between). */
export function liveNow(lives: LiveDto[], now: number): LiveDto[] {
  return lives.filter((l) => Date.parse(l.endsAt) > now);
}

export function applyFilters(lives: LiveDto[], filters: LiveFilters): LiveDto[] {
  return lives.filter((l) => matches(l, filters));
}

/**
 * Country chips: how many lives each country has with the other filters applied, so a chip's
 * number is what tapping it shows. Countries with none are left out (unless selected).
 */
export function countryCounts(
  lives: LiveDto[],
  filters: LiveFilters,
): { total: number; countries: Array<{ code: string; count: number }> } {
  const counts = new Map<string, number>();
  let total = 0;
  for (const live of lives) {
    if (!matches(live, filters, 'country')) continue;
    total += 1;
    counts.set(live.countryCode, (counts.get(live.countryCode) ?? 0) + 1);
  }
  if (filters.country && !counts.has(filters.country)) counts.set(filters.country, 0);
  const countries = [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  return { total, countries };
}

/** "25 min", "1 h 05". */
export function sinceLabel(startedAt: string, now: number, t: T): string {
  const minutes = Math.max(1, Math.floor((now - Date.parse(startedAt)) / 60_000));
  if (minutes < 60) return t('lives.minutes', { m: minutes });
  const h = Math.floor(minutes / 60);
  return t('lives.hours', { h, mm: String(minutes % 60).padStart(2, '0') });
}

/** Up to two letters for the card's badge: "Afi Mode" → "AM", "@kofi" → "KO". */
export function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '•';
  const letters =
    words.length === 1 ? [...words[0]!].slice(0, 2) : [[...words[0]!][0], [...words[1]!][0]];
  return letters.join('').toUpperCase();
}

/** Card colour per category: deep tones, all with white text above WCAG AA. */
export const CATEGORY_HUES: Record<CategoryIcon, string> = {
  mode: '#7a2a52',
  beaute: '#8a2f3c',
  food: '#8f4a0c',
  elec: '#1f4a75',
  maison: '#245a4c',
  sante: '#2d5f37',
  services: '#4a3d8c',
  event: '#6b2f7a',
  autre: '#4d443c',
};
