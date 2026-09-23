/**
 * RHUFT-F per-scale measurement interface.  Phase 4 · Step 1 infrastructure.
 *
 * Each scale n ∈ [0..8] gets a `ScaleMeasurement` implementation that:
 *   1. Reads live amplitudes from ShadowStateTape (never mutates ψ).
 *   2. Compares against Phase-3 stability targets in
 *      `docs/v13_rebuild/scales/n<k>_stability.md`.
 *   3. Writes only to `m` (memory manifestation) and `gamma` (diagnostics)
 *      channels of the FieldStateN. `psi`, `psiHat`, `u`, `y` are read-only
 *      to this module.
 *
 * The registry lets the metric bank + panels iterate a stable enumeration.
 * Registration is opt-in per scale via `FLAG_RHUFTF_FRAMEWORK_<n>`; when
 * off, the scale simply doesn't appear in the registry.
 */

import type { FieldStateN } from '@metatron/field-kernel-core';

export interface ScaleMeasurementResult {
  readonly scale: number;
  /** Closure vector deviation ‖y − target‖². NaN when target not injected. */
  readonly closureResidual: number;
  /** Scalar closure score in [candidate 0..1] — spec-defined per scale. */
  readonly closureScore: number;
  /** Symmetry witness: 1 = candidate invariant holds, 0 = broken. */
  readonly invariantScore: number;
  /** Free-form per-scale diagnostics (written into γ). */
  readonly gamma: Float64Array;
}

export interface ScaleMeasurementContext {
  readonly tSeconds: number;
  readonly carrierHz: number;
  readonly tick: number;
}

export interface ScaleMeasurement {
  readonly scale: number;
  readonly name: string;
  readonly nodes: number;
  /**
   * Compute measurement result for the given state. MUST NOT mutate
   * `state.psi`, `state.psiHat`, `state.u`, or `state.y`. MAY write to
   * `state.m` and `state.gamma`. Returns the result for the metric bank.
   */
  measure(state: FieldStateN, ctx: ScaleMeasurementContext): ScaleMeasurementResult;
}

class ScaleMeasurementRegistry {
  private readonly byScale = new Map<number, ScaleMeasurement>();

  register(m: ScaleMeasurement): void {
    if (this.byScale.has(m.scale)) {
      throw new Error(`ScaleMeasurement already registered for scale ${m.scale}`);
    }
    this.byScale.set(m.scale, m);
  }

  get(scale: number): ScaleMeasurement | undefined {
    return this.byScale.get(scale);
  }

  list(): readonly ScaleMeasurement[] {
    return Array.from(this.byScale.values()).sort((a, b) => a.scale - b.scale);
  }

  clear(): void { this.byScale.clear(); }
}

export const scaleMeasurementRegistry = new ScaleMeasurementRegistry();
