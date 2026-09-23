/**
 * @metatron/field-kernel-core/localUpdate
 *
 * Phase 5 · Step 1 — RHUFT-F canonical local update interface.
 *
 * Blueprint §10 (master equation) is split, per scale n, into a family of
 * canonical local updates `U_n : FieldStateN → FieldStateN`. Each `U_n`:
 *
 *   • reads   state.psi, state.psiHat, state.m, state.u, state.y, state.gamma
 *   • writes  ONLY out.psi, out.m, out.gamma
 *   • never mutates state.psiHat, state.u, state.y     (measurement-owned)
 *   • never mutates the input `state` in place         (pure w.r.t. input)
 *
 * `psiHat`, `u`, `y` remain owned by the Phase-4 measurement pipeline and
 * upstream sensory/control bridges; `U_n` is a physics writer, not a
 * measurement or bridge.
 *
 * This file is a landing surface only. No consumer is wired in this step —
 * the ban on live-buffer writes for `U_n` is enforced structurally by the
 * empty `localUpdateRegistry`. Reference `U_n` modules ship in Step 2 and
 * register themselves through Step 3's bootstrap, gated by per-scale
 * `FLAG_RHUFTF_LOCAL_UPDATE_<n>` flags (added in Step 2 as well).
 *
 * Determinism: `U_n.step(state, ctx, out)` MUST be a pure function of
 * `state`, `ctx`, and `out`'s scale/nodes — no time-of-day reads, no PRNGs
 * outside a seeded scratch, no allocations on the hot path.
 */

import type { FieldStateN } from './state';

/* ─────────────────────────────  Context  ─────────────────────────────── */

/**
 * Ambient step context. Populated by `CanonicalUpdateBank` (Phase 5 · Step 4)
 * from the shard scheduler; equivalent scaffolding lives in
 * `RhuftMetricBank` for the measurement side.
 *
 * `dt` is expressed in shard ticks (dimensionless), NOT seconds — the
 * carrier frequency and wall-clock time are surfaced separately so `U_n`
 * kernels can decide how (or whether) to convert.
 */
export interface LocalUpdateContext {
  /** Wall-clock seconds since engine boot. Monotone across ticks. */
  readonly tSeconds: number;
  /** Active carrier frequency (Hz). 0 = untethered / offline harness. */
  readonly carrierHz: number;
  /** Shard-tick delta since previous invocation (dimensionless, ≥ 0). */
  readonly dt: number;
  /** Monotone tick counter published by the shard scheduler. */
  readonly tick: number;
  /** Optional per-scale weight override — reserved for Phase 6. */
  readonly weights?: Readonly<Record<string, number>>;
}

/* ──────────────────────────────  Report  ─────────────────────────────── */

/**
 * Diagnostic snapshot emitted by every `U_n.step()`. Recorded verbatim into
 * `CanonicalUpdateBank` ring rows; never fed back into the physics.
 */
export interface LocalUpdateReport {
  /** ‖out.psi − state.psi‖₂ (Neumaier-compensated). Non-negative, finite. */
  readonly psiDelta: number;
  /**
   * Contribution to the scale-local Lyapunov energy budget in this step.
   * Convention: positive = energy injected, negative = energy dissipated.
   * The bank sums these to produce `totalEnergyContribution`.
   */
  readonly energyContribution: number;
  /**
   * Admission verdict. `false` means the update was computed but rejected
   * (e.g. NaN in state, closure gate). Bank treats non-admitted rows as
   * `out.psi := state.psi`.
   */
  readonly admitted: boolean;
  /** Suggested next gauge value (γ) — advisory, bank copies as-is. */
  readonly gamma: number;
}

/* ────────────────────────────  Interface  ────────────────────────────── */

export interface LocalUpdate {
  /** RHUFT-F scale index; matches the owning scale-measurement module. */
  readonly scale: number;
  /** Stable identifier, e.g. `'F1_Septenary'`. Used in registry logs. */
  readonly name: string;
  /**
   * Compute `out ← U_n(state, ctx)`. MUST write `out.psi`, `out.m`,
   * `out.gamma` and leave `out.psiHat`, `out.u`, `out.y` untouched.
   * Returns a `LocalUpdateReport` describing what was written.
   */
  step(state: FieldStateN, ctx: LocalUpdateContext, out: FieldStateN): LocalUpdateReport;
}

/* ────────────────────────────  Registry  ────────────────────────────── */

const registry = new Map<number, LocalUpdate>();

/** Idempotent register. Later registrations for the same scale win. */
export function registerLocalUpdate(update: LocalUpdate): void {
  if (!Number.isInteger(update.scale)) {
    throw new Error(`registerLocalUpdate: scale must be an integer, got ${update.scale}`);
  }
  registry.set(update.scale, update);
}

/** Remove a scale's update. Returns true when a registration was removed. */
export function unregisterLocalUpdate(scale: number): boolean {
  return registry.delete(scale);
}

/** Look up the update for a given scale, or `undefined` if none registered. */
export function getLocalUpdate(scale: number): LocalUpdate | undefined {
  return registry.get(scale);
}

/**
 * Snapshot of currently-registered updates, sorted by scale ascending.
 * The bank calls this once per snapshot cycle — never on the hot path.
 */
export function listLocalUpdates(): readonly LocalUpdate[] {
  return [...registry.values()].sort((a, b) => a.scale - b.scale);
}

/** Test-only reset. Not exported from the package index. */
export function _resetLocalUpdateRegistryForTests(): void {
  registry.clear();
}
