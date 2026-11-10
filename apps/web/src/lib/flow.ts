import type { BookingSelectionInput, SessionMode } from '@bovann/shared';

/**
 * What the customer has chosen so far, kept in sessionStorage so a page reload
 * or the back button never loses their progress (and nothing outlives the tab).
 */

export interface SelectionSummary {
  /** The package's name ("Pack 6h"), or null for single slots ("2 créneaux", built when shown). */
  packageName: string | null;
  /** "12:30 – 18:30", or "08:00 – 09:30, 20:00 – 21:30" for separate slots. */
  timesLabel: string;
  slotCount: number;
  listPriceXof: number;
  discountXof: number;
  totalXof: number;
}

export interface CustomerDetails {
  fullName: string;
  /** E.164 */
  phone: string;
  email: string;
  businessName: string;
  businessSector: string;
  liveDescription: string;
  acceptTerms: boolean;
}

export interface ActiveBooking {
  reference: string;
  accessToken: string;
}

export interface BookingFlow {
  mode?: SessionMode;
  date?: string;
  /** Month shown in the calendar ('YYYY-MM'). */
  month?: string;
  selection?: BookingSelectionInput;
  summary?: SelectionSummary;
  details?: CustomerDetails;
  booking?: ActiveBooking;
}

// v2: the summary keeps the package name instead of a French label.
const KEY = 'bovann.booking-flow.v2';

export function loadFlow(
  storage: Pick<Storage, 'getItem'> | undefined = safeSession(),
): BookingFlow {
  if (!storage) return {};
  try {
    const raw = storage.getItem(KEY);
    return raw ? (JSON.parse(raw) as BookingFlow) : {};
  } catch {
    return {};
  }
}

export function saveFlow(
  flow: BookingFlow,
  storage: Pick<Storage, 'setItem'> | undefined = safeSession(),
): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(flow));
  } catch {
    // Private mode or full storage: the flow still works for this page view.
  }
}

function safeSession(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * Keeps later choices only while they still make sense: changing the mode or
 * the date drops the slot selection; a new selection drops the active booking.
 */
export function updateFlow(flow: BookingFlow, patch: Partial<BookingFlow>): BookingFlow {
  const next: BookingFlow = { ...flow, ...patch };
  const changed = (k: keyof BookingFlow) =>
    k in patch && JSON.stringify(patch[k]) !== JSON.stringify(flow[k]);
  if (changed('mode') || changed('date')) {
    if (!('selection' in patch)) delete next.selection;
    if (!('summary' in patch)) delete next.summary;
  }
  if (changed('mode') || changed('date') || changed('selection')) {
    if (!('booking' in patch)) delete next.booking;
  }
  return next;
}

/**
 * Where the customer should be, given what they've chosen: used to send them
 * back to the right step if they open a later page directly.
 */
export function firstMissingStep(
  flow: BookingFlow,
): '/' | '/reserver/date' | '/reserver/creneaux' | '/reserver/informations' | null {
  if (!flow.mode) return '/';
  if (!flow.date) return '/reserver/date';
  if (!flow.selection || !flow.summary) return '/reserver/creneaux';
  if (!flow.details) return '/reserver/informations';
  return null;
}
