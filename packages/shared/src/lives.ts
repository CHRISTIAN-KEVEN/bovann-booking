/**
 * Live directory ("En direct"): vocabulary, contracts and the input rules shared by the API
 * (which enforces them) and the web app (which shows the same errors before sending).
 */

export const LIVE_PLATFORMS = ['TIKTOK', 'FACEBOOK'] as const;
export type LivePlatform = (typeof LIVE_PLATFORMS)[number];

export const LIVE_PLATFORM_LABELS: Record<LivePlatform, string> = {
  TIKTOK: 'TikTok',
  FACEBOOK: 'Facebook',
};

/**
 * PENDING → APPROVED | REJECTED by staff. An approved live is on the wall until `ends_at`,
 * or until the seller ends it (ENDED) or staff take it down (REMOVED).
 * Values mirror the CHECK constraint on t_lives.status.
 */
export const LIVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'ENDED', 'REMOVED'] as const;
export type LiveStatus = (typeof LIVE_STATUSES)[number];

/** Icons drawn by the web app for categories (t_categories.icon). */
export const CATEGORY_ICONS = [
  'mode',
  'beaute',
  'food',
  'elec',
  'maison',
  'sante',
  'services',
  'event',
  'autre',
] as const;
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

/**
 * Countries a live can be listed in (ISO 3166-1 alpha-2), Togo and its region first.
 * Same list as the phone country picker; add a country here and in the web's `countries.*` texts.
 */
export const LIVE_COUNTRIES = [
  'TG',
  'BJ',
  'GH',
  'CI',
  'BF',
  'NE',
  'SN',
  'ML',
  'NG',
  'CM',
  'GA',
  'CD',
  'CG',
  'GN',
  'FR',
  'US',
] as const;
export type LiveCountry = (typeof LIVE_COUNTRIES)[number];

export function isLiveCountry(value: unknown): value is LiveCountry {
  return typeof value === 'string' && (LIVE_COUNTRIES as readonly string[]).includes(value);
}

/** How long a listing stays on the wall (proposal: the seller picks 1 to 4 hours). */
export const LIVE_DURATIONS_MIN = [60, 120, 180, 240] as const;
export type LiveDurationMin = (typeof LIVE_DURATIONS_MIN)[number];

export const SELLER_NAME_MIN = 2;
export const SELLER_NAME_MAX = 60;
export const CATEGORY_OTHER_MAX = 40;
export const LIVE_URL_MAX = 500;

// ------------------------------------------------------------------ text cleaning

/**
 * Cleans a short text typed by a user (seller name, typed category): removes control and
 * invisible characters (zero-width, bidi overrides that can disguise text), turns any run of
 * spaces or line breaks into one space, and trims. Output is plain text; screens escape it.
 */
export function cleanShortText(value: string): string {
  return (
    value
      .normalize('NFC')
      // Zero-width and bidirectional formatting characters, BOM: removed.
      .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
      // Control characters (line breaks, tabs, bell…): become spaces.
      // eslint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// ------------------------------------------------------------------ live links

/** WHATWG URL, available in Node and browsers (declared here: this package has no DOM types). */
declare const URL: new (input: string) => {
  hostname: string;
  pathname: string;
  search: string;
  port: string;
  username: string;
  password: string;
};

const PLATFORM_HOSTS: Record<string, LivePlatform> = {
  'tiktok.com': 'TIKTOK',
  'www.tiktok.com': 'TIKTOK',
  'm.tiktok.com': 'TIKTOK',
  'vm.tiktok.com': 'TIKTOK',
  'vt.tiktok.com': 'TIKTOK',
  'facebook.com': 'FACEBOOK',
  'www.facebook.com': 'FACEBOOK',
  'm.facebook.com': 'FACEBOOK',
  'web.facebook.com': 'FACEBOOK',
  'fb.com': 'FACEBOOK',
  'www.fb.com': 'FACEBOOK',
  'fb.watch': 'FACEBOOK',
};

/** Facebook path segments that are not an account name. */
const FACEBOOK_NON_ACCOUNTS = new Set([
  'watch',
  'share',
  'live',
  'videos',
  'video',
  'groups',
  'events',
  'reel',
  'reels',
  'story.php',
  'profile.php',
  'permalink.php',
  'gaming',
  'marketplace',
]);

export type LiveLinkError = 'EMPTY' | 'TOO_LONG' | 'INVALID' | 'NOT_ALLOWED';

export type LiveLinkResult =
  | {
      ok: true;
      /** The link to store and open: https, known host, no fragment. */
      url: string;
      platform: LivePlatform;
      /** Account name read from the link ("@afimode", "kofielectro"), when it has one. */
      account: string | null;
    }
  | { ok: false; error: LiveLinkError };

/**
 * Checks a link pasted by a seller. Only TikTok and Facebook addresses are accepted, always
 * opened in https: a listing can never send visitors to another site, and the stored link can't
 * carry a script (`javascript:`), credentials or an unusual port. "tiktok.com/@x/live" without
 * "https://" is accepted (people often copy it that way) and http is upgraded to https.
 */
export function checkLiveLink(input: string): LiveLinkResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'EMPTY' };
  if (raw.length > LIVE_URL_MAX) return { ok: false, error: 'TOO_LONG' };
  if (/\s/.test(raw)) return { ok: false, error: 'INVALID' };

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  if (hasScheme && !/^https?:\/\//i.test(raw)) return { ok: false, error: 'NOT_ALLOWED' };

  let parsed: InstanceType<typeof URL>;
  try {
    parsed = new URL(hasScheme ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: 'INVALID' };
  }
  if (parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
    return { ok: false, error: 'NOT_ALLOWED' };
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const platform = PLATFORM_HOSTS[host];
  if (!platform) return { ok: false, error: 'NOT_ALLOWED' };

  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  const url = `https://${host}${path}${parsed.search}`;
  if (url.length > LIVE_URL_MAX) return { ok: false, error: 'TOO_LONG' };
  return { ok: true, url, platform, account: accountFromPath(platform, host, parsed.pathname) };
}

function accountFromPath(platform: LivePlatform, host: string, pathname: string): string | null {
  const first = pathname.split('/').filter(Boolean)[0];
  if (!first) return null;
  let segment: string;
  try {
    segment = decodeURIComponent(first);
  } catch {
    return null;
  }
  if (platform === 'TIKTOK') {
    return /^@[\w.]{2,40}$/.test(segment) ? segment : null;
  }
  if (host === 'fb.watch' || FACEBOOK_NON_ACCOUNTS.has(segment.toLowerCase())) return null;
  return /^[\w.-]{2,60}$/.test(segment) ? segment : null;
}

// ------------------------------------------------------------------ contracts

export interface LiveCategoryDto {
  code: string;
  /** In the language of the request. */
  name: string;
  icon: CategoryIcon;
}

export interface LiveDto {
  id: number;
  sellerName: string;
  platform: LivePlatform;
  url: string;
  countryCode: LiveCountry;
  /** Null when the seller typed their own category ("Autre"). */
  categoryCode: string | null;
  /** Category name in the request's language, or the text the seller typed. */
  categoryLabel: string;
  categoryIcon: CategoryIcon;
  startedAt: string;
  endsAt: string;
}

/** GET /lives: everything on the wall right now, most recent first, plus the filter options. */
export interface LiveWallResponse {
  now: string;
  lives: LiveDto[];
  categories: LiveCategoryDto[];
}

// Admin

export const ADMIN_LIVE_TABS = ['online', 'past'] as const;
export type AdminLiveTab = (typeof ADMIN_LIVE_TABS)[number];

export interface AdminLiveDto extends LiveDto {
  status: LiveStatus;
  durationMin: number;
  createdAt: string;
  /** Who listed it: a staff member's name, or null when the seller posted it. */
  addedBy: string | null;
  endedAt: string | null;
  endedBy: string | null;
  endReason: string | null;
}

export interface AdminLiveListResponse {
  now: string;
  lives: AdminLiveDto[];
}

/** Staff list a live for a seller (phone call, walk-in): it goes on the wall at once. */
export interface AdminLiveCreate {
  sellerName: string;
  url: string;
  countryCode: string;
  /** A category code, or null with `categoryOther` filled in. */
  categoryCode: string | null;
  categoryOther: string | null;
  durationMin: number;
}

export interface AdminLiveRemove {
  reason: string | null;
}
