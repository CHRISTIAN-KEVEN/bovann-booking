/**
 * Booking access tokens, remembered in this browser so the customer can reopen
 * their confirmation page later. The token only lets this browser view the
 * booking and cancel it before payment; it is not a password to any account.
 */
const KEY = 'bovann.booking-tokens.v1';
const MAX_ENTRIES = 20;

type TokenMap = Record<string, string>;

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function read(store: Storage | undefined = storage()): TokenMap {
  try {
    return JSON.parse(store?.getItem(KEY) ?? '{}') as TokenMap;
  } catch {
    return {};
  }
}

export function rememberToken(
  reference: string,
  token: string,
  store: Storage | undefined = storage(),
): void {
  if (!store) return;
  const entries = Object.entries(read(store)).filter(([ref]) => ref !== reference);
  entries.push([reference, token]);
  try {
    store.setItem(KEY, JSON.stringify(Object.fromEntries(entries.slice(-MAX_ENTRIES))));
  } catch {
    // Storage full or disabled: the current tab still has the token in its flow.
  }
}

export function tokenFor(
  reference: string,
  store: Storage | undefined = storage(),
): string | undefined {
  return read(store)[reference];
}
