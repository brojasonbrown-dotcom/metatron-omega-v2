/**
 * EngineContext — single source of engine state for all panels.
 * Owned by Workstation; panels consume via useEngine().
 *
 * Two access modes:
 *   • useEngine()    — live subscription; re-renders the consumer on every
 *                      context update (~UI tick rate). For panels that DISPLAY
 *                      live values.
 *   • useEngineRef() — point-in-time accessor; NEVER re-renders the consumer.
 *                      For components that only read engine state inside event
 *                      handlers (chat send, tool launch). Reading .current
 *                      always yields the freshest ctx.
 */
import { createContext, useContext, useRef, type ReactNode } from 'react';
import type { MetatronOutput } from '@/core/MetatronCore';
import type { computeChapterResiduals } from '@/core/residuals/ChapterResiduals';
import type { MemoryStore } from '@/core/memory/MemoryStore';
import type { ConnectionState } from '@/core/bus/EngineBus';
import type { EngineCapabilities, FieldSnapshot } from '@/core/bus/protocol';

export type Residuals = ReturnType<typeof computeChapterResiduals>;

export interface EngineCtx {
  out: MetatronOutput;
  residuals: Residuals;
  running: boolean;
  tick: number;
  fps: number;
  coherence: number;
  energy: number;
  /** Manual override of coherence input. No-op when autoStabilize is true. */
  setCoherence: (v: number) => void;
  /** Manual override of energy input. No-op when autoStabilize is true. */
  setEnergy: (v: number) => void;
  /**
   * Auto-Stabilize — locks the coherence/energy inputs to the Wolfram-verified
   * golden split (1/φ, 1/φ²) so the engine sits on the crystalline-stability
   * vector with no manual tuning. Default ON. Manual sliders only appear when
   * the user explicitly turns this off.
   */
  autoStabilize: boolean;
  setAutoStabilize: (b: boolean) => void;
  /** φ-mode target. "auto" follows the governor's honest ceiling; any positive integer is accepted. */
  resolution: 'auto' | number;
  setResolution: (n: 'auto' | number) => void;
  fieldState: ConnectionState | 'fallback';
  fieldCapabilities: EngineCapabilities | null;
  fieldSnapshot: FieldSnapshot | null;
  setFieldTargetM: (m: number) => void;
  /** Phase-lock toggle: holds M, suppresses auto-promote/demote, snaps probe to crystalline vector. */
  setPhaseLocked: (locked: boolean) => void;
  isPhaseLocked: boolean;
  /** Real frequency probe — drives live workers and reports honest Hz. */
  benchmark: (
    ticks?: number,
  ) => Promise<import('@/core/runtime/computeBench').ComputeBenchResult | null>;
  /** True when the user has explicitly forced the in-browser worker-pool engine (daemon probe skipped). */
  forcedFallback: boolean;
  /** Persist preference + reload the engine. true → skip daemon probe and go straight to fallback. */
  setForcedFallback: (force: boolean) => void;

  // memory
  memoryEnabled: boolean;
  setMemoryEnabled: (b: boolean) => void;
  memoryStatus: string;
  memoryStore: MemoryStore;
  memoryRefresh: number;
  saveMem: () => void;
  loadMem: () => void;
  clearMem: () => void;
  /** Optional pineal MemoryFeedback ring (Ψ_memory = λ·Ψ_{t−τ}). Default OFF. Bounded ±1/φ³. */
  pinealFeedbackEnabled: boolean;
  setPinealFeedbackEnabled: (b: boolean) => void;
  // events
  events: { t: number; kind: string; msg: string }[];
  pushEvent: (kind: string, msg: string) => void;
}

const Ctx = createContext<EngineCtx | null>(null);
const RefCtx = createContext<{ readonly current: EngineCtx } | null>(null);

export function EngineProvider({ value, children }: { value: EngineCtx; children: ReactNode }) {
  // Stable ref identity for the lifetime of the provider; .current is
  // refreshed on every render so useEngineRef() readers always see the
  // latest ctx without subscribing to updates.
  const ref = useRef<EngineCtx>(value);
  ref.current = value;
  return (
    <Ctx.Provider value={value}>
      <RefCtx.Provider value={ref}>{children}</RefCtx.Provider>
    </Ctx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is co-located with its provider by design
export function useEngine(): EngineCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEngine must be used inside <EngineProvider>');
  return v;
}

/**
 * Zero-re-render accessor. The returned object is referentially stable;
 * read `.current` inside event handlers for the freshest engine state.
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook is co-located with its provider by design
export function useEngineRef(): { readonly current: EngineCtx } {
  const v = useContext(RefCtx);
  if (!v) throw new Error('useEngineRef must be used inside <EngineProvider>');
  return v;
}
