/**
 * Persistent FIELD view preferences (presentation only).
 *
 * The rung selection and pull rate used to live inside FieldDeckPanel, so
 * switching tabs unmounted the panel and reset them. They now live here:
 * a tiny external store, guarded localStorage persistence, clamped on load.
 */
import { useCallback, useSyncExternalStore } from "react";

export type FieldView = {
  rank: number;
  hz: number;
  /** Max nodes sampled per frame (draw resolution, Fibonacci steps). */
  samples: number;
  stageOpen: boolean;
  showStrip: boolean;
  /** Decorative additive halo/bloom. Off = strict data-only rendering. */
  glow: boolean;
};

const KEY = "omega.field.view";

/**
 * Fibonacci resolution steps offered in the stage RES selector. The ladder is
 * Fibonacci by law, so every step here is an exact rung node count somewhere on
 * the ladder — the stage only ever offers steps that the selected rung can
 * actually supply, plus that rung's own full count.
 */
export const SAMPLE_STEPS = [
  89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946, 17711, 28657, 46368,
] as const;

/** Hard bounds for the persisted RES value (the ladder tops out at F(24)). */
export const SAMPLES_MIN = 8;
export const SAMPLES_MAX = 46368;

export const HZ_MAX = 60;

const DEFAULTS: FieldView = {
  rank: 0,
  hz: 30,
  samples: 610,
  stageOpen: true,
  showStrip: true,
  glow: false,
};

const clampInt = (x: unknown, lo: number, hi: number, fb: number): number => {
  const n = typeof x === "number" ? Math.round(x) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb;
};

function read(): FieldView {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<FieldView>;
    return {
      rank: clampInt(p.rank, 0, 63, DEFAULTS.rank),
      hz: clampInt(p.hz, 1, HZ_MAX, DEFAULTS.hz),
      samples: clampInt(p.samples, SAMPLES_MIN, SAMPLES_MAX, DEFAULTS.samples),
      stageOpen: typeof p.stageOpen === "boolean" ? p.stageOpen : DEFAULTS.stageOpen,
      showStrip: typeof p.showStrip === "boolean" ? p.showStrip : DEFAULTS.showStrip,
      glow: typeof p.glow === "boolean" ? p.glow : DEFAULTS.glow,
    };
  } catch {
    return DEFAULTS;
  }
}

let state: FieldView = DEFAULTS;
let hydrated = false;
const listeners = new Set<() => void>();

function ensureHydrated(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  state = read();
}

function emit(): void {
  for (const fn of listeners) fn();
}

export function getFieldView(): FieldView {
  ensureHydrated();
  return state;
}

export function setFieldView(patch: Partial<FieldView>): void {
  ensureHydrated();
  const next: FieldView = {
    rank: clampInt(patch.rank ?? state.rank, 0, 63, state.rank),
    hz: clampInt(patch.hz ?? state.hz, 1, HZ_MAX, state.hz),
    samples: clampInt(patch.samples ?? state.samples, SAMPLES_MIN, SAMPLES_MAX, state.samples),
    stageOpen: patch.stageOpen ?? state.stageOpen,
    showStrip: patch.showStrip ?? state.showStrip,
    glow: patch.glow ?? state.glow,
  };
  if (
    next.rank === state.rank &&
    next.hz === state.hz &&
    next.samples === state.samples &&
    next.stageOpen === state.stageOpen &&
    next.showStrip === state.showStrip &&
    next.glow === state.glow
  ) {
    return;
  }
  state = next;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* storage unavailable — in-memory state still works */
    }
  }
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useFieldView(): FieldView {
  const sub = useCallback((fn: () => void) => subscribe(fn), []);
  return useSyncExternalStore(
    sub,
    () => getFieldView(),
    () => DEFAULTS,
  );
}
