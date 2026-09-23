/**
 * OmegaEngineShim — the legacy `EngineCtx` projected off the LIVE Ω worker.
 *
 * Ω-WAKE S1. This file used to be inert: it reported `running=false, tick=0,
 * fieldState="fallback"` while the Ω worker was actually ticking, so the chat
 * snapshot and the module registry described two different machines. Now there
 * is exactly one truth — `omegaRuntime` — and this shim is a pure projection of
 * it (see `engineProjection.ts`).
 *
 * The projection is throttled to ~4 Hz: the worker bus runs at 8–64 Hz, but the
 * chat/tool tree must not re-render on the tick path.
 */
import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { EngineProvider, type EngineCtx } from "@/components/v11/EngineContext";
import { computeMetatronMemo } from "@/core/MetatronCore";
import { computeChapterResidualsMemo } from "@/core/residuals/ChapterResiduals";
import { getMemoryRuntime } from "./memoryRuntime";
import { useMemorySelector } from "./useMemoryRuntime";
import { getOmegaRuntime, type OmegaState } from "./omegaRuntime";
import { projectEngineState } from "./engineProjection";

/** UI-facing refresh period for the engine context (ms). */
const CTX_PERIOD_MS = 250;

function useThrottledOmega(): OmegaState {
  const rt = getOmegaRuntime();
  const subscribe = useCallback(
    (fn: () => void) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let last = 0;
      const off = rt.subscribe(() => {
        const now = Date.now();
        const wait = CTX_PERIOD_MS - (now - last);
        if (wait <= 0) {
          last = now;
          fn();
        } else if (timer === null) {
          timer = setTimeout(() => {
            timer = null;
            last = Date.now();
            fn();
          }, wait);
        }
      });
      return () => {
        if (timer !== null) clearTimeout(timer);
        off();
      };
    },
    [rt],
  );
  return useSyncExternalStore(subscribe, () => rt.get(), () => rt.get());
}

export function OmegaEngineShim({ children }: { children: ReactNode }) {
  const memory = getMemoryRuntime();
  const omega = useThrottledOmega();

  const engine = useMemo(
    () => projectEngineState(omega.snapshot, omega.running),
    [omega.snapshot, omega.running],
  );

  // Real constants evaluated at the engine's measured drive point.
  const output = useMemo(
    () =>
      computeMetatronMemo({
        coherence: engine.coherence,
        energy: engine.energy,
        time: engine.tick,
      }),
    [engine.coherence, engine.energy, engine.tick],
  );
  const residuals = useMemo(() => computeChapterResidualsMemo(output), [output]);

  const mem = useMemorySelector(
    (s) => ({ enabled: s.enabled, status: s.statusText, version: s.version }),
    (a, b) => a.enabled === b.enabled && a.status === b.status && a.version === b.version,
  );

  const ctx: EngineCtx = useMemo(
    () => ({
      out: output,
      residuals,
      running: engine.running,
      tick: engine.tick,
      fps: engine.fps,
      coherence: engine.coherence,
      energy: engine.energy,
      setCoherence: () => undefined,
      setEnergy: () => undefined,
      autoStabilize: true,
      setAutoStabilize: () => undefined,
      resolution: "auto",
      setResolution: () => undefined,
      fieldState: engine.fieldState,
      fieldCapabilities: engine.fieldCapabilities,
      fieldSnapshot: engine.fieldSnapshot,
      setFieldTargetM: () => undefined,
      setPhaseLocked: () => undefined,
      isPhaseLocked: false,
      benchmark: async () => null,
      forcedFallback: engine.forcedFallback,
      setForcedFallback: () => undefined,

      memoryEnabled: mem.enabled,
      setMemoryEnabled: (on: boolean) => memory.setEnabled(on),
      memoryStatus: mem.status,
      memoryStore: memory.store,
      memoryRefresh: mem.version,
      saveMem: () => { void memory.save(); },
      loadMem: () => { void memory.load(); },
      clearMem: () => { void memory.clear(); },

      pinealFeedbackEnabled: false,
      setPinealFeedbackEnabled: () => undefined,
      events: [],
      pushEvent: () => undefined,
    }),
    [output, residuals, engine, mem, memory],
  );

  return <EngineProvider value={ctx}>{children}</EngineProvider>;
}
