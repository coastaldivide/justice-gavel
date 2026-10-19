/**
 * useInFlight — one submission at a time.
 *
 *   const [run, pending] = useInFlight();
 *   <Button disabled={pending} onPress={() => run(save)} />
 *
 * The guard is a ref, set synchronously on the first tap, so a second tap that
 * arrives before React re-renders (and before `disabled` takes effect) is
 * ignored too. `pending` drives the disabled / spinner state. Pair with the
 * server's Idempotency-Key handling (services/api.ts) for retried requests.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function useInFlight(): [<T>(fn: () => Promise<T>) => Promise<T | undefined>, boolean] {
  const busy = useRef(false);
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  useEffect(() => () => { mounted.current = false; }, []);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    try {
      return await fn();
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }, []);
  return [run, pending];
}
