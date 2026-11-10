'use client';

import { useEffect } from 'react';
import { useFlow } from '@/components/FlowProvider';
import { useLocaleRouter } from '@/i18n/I18nProvider';
import { firstMissingStep } from './flow';

const ORDER = [
  '/',
  '/reserver/date',
  '/reserver/creneaux',
  '/reserver/informations',
  '/reserver/paiement',
] as const;

/**
 * Sends the customer back to the first step they skipped (e.g. opening the
 * payment page directly). Returns true once the page may render.
 */
export function useStepGuard(current: (typeof ORDER)[number]): boolean {
  const router = useLocaleRouter();
  const { flow, ready } = useFlow();
  const missing = ready ? firstMissingStep(flow) : null;
  const mustRedirect = ready && missing !== null && ORDER.indexOf(missing) < ORDER.indexOf(current);

  useEffect(() => {
    if (mustRedirect && missing) router.replace(missing);
  }, [mustRedirect, missing, router]);

  return ready && !mustRedirect;
}
