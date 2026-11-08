'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { loadFlow, saveFlow, updateFlow, type BookingFlow } from '@/lib/flow';

interface FlowContextValue {
  flow: BookingFlow;
  /** False until the saved progress has been read (avoid redirects before that). */
  ready: boolean;
  update: (patch: Partial<BookingFlow>) => void;
  reset: () => void;
}

const FlowContext = createContext<FlowContextValue | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const [flow, setFlow] = useState<BookingFlow>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setFlow(loadFlow());
    setReady(true);
  }, []);

  const update = useCallback((patch: Partial<BookingFlow>) => {
    setFlow((current) => {
      const next = updateFlow(current, patch);
      saveFlow(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    saveFlow({});
    setFlow({});
  }, []);

  const value = useMemo(() => ({ flow, ready, update, reset }), [flow, ready, update, reset]);
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowContextValue {
  const ctx = useContext(FlowContext);
  if (!ctx) throw new Error('useFlow must be used inside <FlowProvider>');
  return ctx;
}
