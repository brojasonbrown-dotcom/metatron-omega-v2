/**
 * Deck-paced pull loop. Wide views (field frames, ledger tails, spectral
 * reports) are requested by the deck that displays them, at the rate that deck
 * can actually draw — never pushed at tick rate.
 */
import { useEffect } from "react";
import { getOmegaRuntime } from "./omegaRuntime";

export function useOmegaPull(request: () => void, hz: number, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    request();
    const id = setInterval(request, Math.max(50, 1000 / Math.max(0.5, hz)));
    return () => clearInterval(id);
    // request is recreated per render by callers using useCallback with deps
  }, [request, hz, enabled]);
}

export function useOmegaDescribe(enabled: boolean): void {
  const rt = getOmegaRuntime();
  useEffect(() => {
    if (enabled) rt.describe();
  }, [rt, enabled]);
}
