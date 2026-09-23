/**
 * React binding for the Ω engine runtime. `useSyncExternalStore` keeps the
 * component tree off the tick path — the worker owns the loop, React only
 * re-renders when a new immutable state object lands.
 */
import { useCallback, useSyncExternalStore } from "react";
import { getOmegaRuntime, type OmegaState } from "./omegaRuntime";

export function useOmegaState(): OmegaState {
  const rt = getOmegaRuntime();
  const subscribe = useCallback((fn: () => void) => rt.subscribe(fn), [rt]);
  return useSyncExternalStore(
    subscribe,
    () => rt.get(),
    () => rt.get(),
  );
}
