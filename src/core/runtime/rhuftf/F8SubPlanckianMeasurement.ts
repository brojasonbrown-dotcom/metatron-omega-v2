/**
 * F8SubPlanckianMeasurement — Phase 4 · Step 8 (n = 7).
 *
 * Implements docs/v13_rebuild/scales/n7_stability.md.
 *
 * Equilibrium projection: ψ*_i = 0 (zero field).
 * Closure target:        y_7 = ‖ψ‖. Target → 0.
 *                        Reported closureScore = exp(-‖ψ‖/M_7) so that
 *                        zero residual → 1 and residual == M_7 → e⁻¹.
 * Boundedness:           M_7 = 1e-6 (from spec §2). Amplitudes larger
 *                        than this indicate precision degradation.
 * Invariant witness:     Planck-ceiling clearance — 1 when max|ψ| ≤ M_7,
 *                        decays as exp(-(max/M_7 − 1)) beyond.
 *
 * Read-only. Writes γ (per-node ceiling excess) and m (per-node abs
 * amplitude for downstream governor down-shifts).
 *
 * Node count: takes the entire ψ buffer (spec: recursive-octave residual
 * field, size determined at runtime by the shard kernel).
 */

import type { FieldStateN } from '@metatron/field-kernel-core';
import { portFlag } from '@metatron/field-kernel-core';
import type {
  ScaleMeasurement,
  ScaleMeasurementContext,
  ScaleMeasurementResult,
} from './ScaleMeasurement';
import { scaleMeasurementRegistry } from './ScaleMeasurement';

const M_7 = 1e-6;

export class F8SubPlanckianMeasurement implements ScaleMeasurement {
  readonly scale = 7;
  readonly name = 'Sub-Planckian';
  readonly nodes = 0; // Determined at measure() time.
  readonly M7 = M_7;

  measure(state: FieldStateN, _ctx: ScaleMeasurementContext): ScaleMeasurementResult {
    const psi = state.psi;
    const N = psi.length;
    if (N === 0) {
      return { scale: 7, closureResidual: 0, closureScore: 1, invariantScore: 1, gamma: new Float64Array(0) };
    }

    // Compensated ‖ψ‖² and max|ψ|.
    let normSq = 0, comp = 0, maxAbs = 0;
    for (let i = 0; i < N; i++) {
      const x = psi[i] * psi[i];
      const t = normSq + x;
      comp += Math.abs(normSq) >= x ? (normSq - t) + x : (x - t) + normSq;
      normSq = t;
      const a = Math.abs(psi[i]);
      if (a > maxAbs) maxAbs = a;
    }
    const norm = Math.sqrt(normSq + comp);

    // Closure: exp(-norm/M_7). Zero → 1; norm == M_7 → e⁻¹.
    const y7 = Math.exp(-norm / M_7);

    // γ: per-node ceiling excess (in units of M_7).
    const g = state.gamma.length >= N ? state.gamma : new Float64Array(N);
    for (let i = 0; i < N; i++) g[i] = Math.abs(psi[i]) / M_7 - 1;

    // m: per-node absolute amplitude for governor consumption.
    const m = state.m.length >= N ? state.m : null;
    if (m) for (let i = 0; i < N; i++) m[i] = Math.abs(psi[i]);

    // Invariant witness: ceiling clearance.
    const invariantScore = maxAbs <= M_7 ? 1 : Math.exp(-(maxAbs / M_7 - 1));

    return {
      scale: 7,
      closureResidual: normSq + comp, // ‖ψ‖² — direct residual.
      closureScore: y7,
      invariantScore,
      gamma: g,
    };
  }
}

export function registerF8SubPlanckianMeasurement(): boolean {
  if (!portFlag('FLAG_RHUFTF_FRAMEWORK_7')) return false;
  if (scaleMeasurementRegistry.get(7)) return true;
  scaleMeasurementRegistry.register(new F8SubPlanckianMeasurement());
  return true;
}

export function registerF8SubPlanckianMeasurementForced(): F8SubPlanckianMeasurement {
  const existing = scaleMeasurementRegistry.get(7);
  if (existing instanceof F8SubPlanckianMeasurement) return existing;
  const impl = new F8SubPlanckianMeasurement();
  scaleMeasurementRegistry.register(impl);
  return impl;
}
