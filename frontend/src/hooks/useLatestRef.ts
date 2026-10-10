/**
 * useLatestRef — a stable ref that always holds the latest value.
 *
 * For effects that must run on a specific trigger (mount, a filter change)
 * but call a callback whose identity changes more often than that trigger.
 * Listing the callback itself as a dependency would re-run the effect (and
 * refetch) every time the callback is re-created; reading it through this ref
 * keeps the trigger exact while never calling a stale closure.
 *
 * The ref is updated in a layout effect, which runs before any useEffect of
 * the same commit, so effects always see the value from the current render.
 */
import { useLayoutEffect, useRef, type MutableRefObject } from 'react';

export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

export default useLatestRef;
