import { useCallback, useRef, useSyncExternalStore } from 'react';
import { getMemoryRuntime, type MemoryRuntimeStats } from './memoryRuntime';

/**
 * Subscribe to a narrow slice of the memory runtime. Mirrors the snapshot
 * selector pattern: the component re-renders only when its slice changes.
 */
export function useMemorySelector<T>(
  selector: (s: MemoryRuntimeStats) => T,
  eq: (a: T, b: T) => boolean = Object.is,
): T {
  const rt = getMemoryRuntime();
  const lastRef = useRef<{ v: T; init: boolean }>({ v: undefined as unknown as T, init: false });

  const read = useCallback((): T => {
    const next = selector(rt.getStats());
    if (!lastRef.current.init || !eq(lastRef.current.v, next)) {
      lastRef.current = { v: next, init: true };
    }
    return lastRef.current.v;
  }, [rt, selector, eq]);

  return useSyncExternalStore(rt.subscribe, read, read);
}

/** Version counter — cheapest possible "memory changed" subscription. */
export function useMemoryVersion(): number {
  const rt = getMemoryRuntime();
  return useSyncExternalStore(rt.subscribe, rt.getVersion, () => 0);
}

export function shallowEq<T extends Record<string, unknown>>(a: T, b: T): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}
