/**
 * useCognitive — read-only view of the cognitive driver's live witnesses.
 *
 * The driver is advanced by the omega runtime, not by React, so the hook only
 * polls its immutable snapshot. Nothing here can drive the engine.
 */
import { useEffect, useState } from "react";
import { getCognitiveDriver, type CognitiveSnapshot } from "./cognitiveDriver";

export function useCognitive(hz = 4): CognitiveSnapshot {
  const [snap, setSnap] = useState<CognitiveSnapshot>(() => getCognitiveDriver().getSnapshot());
  useEffect(() => {
    const driver = getCognitiveDriver();
    const period = Math.max(50, Math.round(1000 / Math.max(1, hz)));
    const id = setInterval(() => {
      const next = driver.getSnapshot();
      setSnap((prev) => (prev === next ? prev : next));
    }, period);
    return () => clearInterval(id);
  }, [hz]);
  return snap;
}
