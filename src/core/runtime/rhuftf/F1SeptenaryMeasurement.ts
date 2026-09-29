/**
 * F1SeptenaryMeasurement — Phase 4 · Step 1 (n = 0).
 *
 * Read-only shadow measurement module implementing the n = 0 stability
 * spec from `docs/v13_rebuild/scales/n0_stability.md`:
 *
 *   - Equilibrium ψ*_i = A · φ^(-i), i ∈ {0..6}, ‖ψ*‖ = 1.
 *   - Closure vector v_φ_i = φ^(-i) / ‖φ^(-i)‖.
 *   - y_0 = ⟨v_φ, ψ⟩ / ‖ψ‖. Target y_0 → 1.
 *   - Chain graph 0—1—2—3—4—5—6 with uniform weight.
 *   - Invariant: ψ_i / ψ_{i+1} → φ.
 *
 * Discipline:
 *   - Never writes to psi/psiHat/u/y.
 *   - Writes only to m (manifestation: latest φ-ratio residuals) and
 *     gamma (diagnostics: per-mode closure contribution).
 *   - No clamping, no offset, no fabricated floor.
 */

import type { FieldStateN } from '@metatron/field-kernel-core';
import { PHI, portFlag } from '@metatron/field-kernel-core';
import type {
  ScaleMeasurement,
  ScaleMeasurementContext,
  ScaleMeasurementResult,
} from './ScaleMeasurement';
import { scaleMeasurementRegistry } from './ScaleMeasurement';

const NODES = 7;

/** v_φ normalized to unit ℓ² norm (module-scope precompute). */
const V_PHI: Float64Array = (() => {
  const v = new Float64Array(NODES);
  let sq = 0;
  for (let i = 0; i < NODES; i++) {
    v[i] = Math.pow(1 / PHI, i);
    sq += v[i] * v[i];
  }
  const inv = 1 / Math.sqrt(sq);
  for (let i = 0; i < NODES; i++) v[i] *= inv;
  return v;
})();

export class F1SeptenaryMeasurement implements ScaleMeasurement {
  readonly scale = 0;
  readonly name = 'Septenary';
  readonly nodes = NODES;

  measure(state: FieldStateN, _ctx: ScaleMeasurementContext): ScaleMeasurementResult {
    if (state.psi.length < NODES) {
      const g = new Float64Array(NODES);
      return {
        scale: 0,
        closureResidual: NaN,
        closureScore: NaN,
        invariantScore: NaN,
        gamma: g,
      };
    }
    const psi = state.psi;

    // ‖ψ‖ (compensated).
    let normSq = 0,
      comp = 0;
    for (let i = 0; i < NODES; i++) {
      const x = psi[i] * psi[i];
      const t = normSq + x;
      comp += Math.abs(normSq) >= x ? normSq - t + x : x - t + normSq;
      normSq = t;
    }
    const norm = Math.sqrt(normSq + comp);

    // y_0 = ⟨v_φ, ψ⟩ / ‖ψ‖.
    let dot = 0;
    for (let i = 0; i < NODES; i++) dot += V_PHI[i] * psi[i];
    const y0 = norm > 0 ? dot / norm : NaN;

    // Per-mode closure contribution (γ) and manifestation (m).
    const g = state.gamma.length >= NODES ? state.gamma : new Float64Array(NODES);
    const m = state.m.length >= NODES ? state.m : null;
    let closureResidualSq = 0;
    for (let i = 0; i < NODES; i++) {
      const target = V_PHI[i] * norm; // reconstructed equilibrium at current amplitude
      const d = psi[i] - target;
      g[i] = d;
      closureResidualSq += d * d;
      if (m && i < NODES - 1) {
        // φ-ratio residual per adjacent pair (i, i+1). Zero at equilibrium.
        const denom = psi[i + 1];
        m[i] = denom !== 0 ? psi[i] / denom - PHI : NaN;
      }
    }
    if (m && NODES - 1 < m.length) m[NODES - 1] = 0;

    // Invariant witness: geometric mean of |ratio − φ| across adjacent pairs.
    let invAcc = 0,
      invN = 0;
    for (let i = 0; i < NODES - 1; i++) {
      const denom = psi[i + 1];
      if (denom !== 0 && Number.isFinite(denom)) {
        invAcc += Math.log1p(Math.abs(psi[i] / denom - PHI));
        invN++;
      }
    }
    const invariantScore = invN > 0 ? Math.exp(-invAcc / invN) : NaN;

    return {
      scale: 0,
      closureResidual: closureResidualSq,
      closureScore: Number.isFinite(y0) ? y0 : NaN,
      invariantScore,
      gamma: g,
    };
  }
}

/**
 * Registration is opt-in per Phase 4 discipline. Idempotent — safe to call
 * multiple times from HMR / test harnesses.
 */
export function registerF1SeptenaryMeasurement(): boolean {
  if (!portFlag('FLAG_RHUFTF_FRAMEWORK_0')) return false;
  if (scaleMeasurementRegistry.get(0)) return true;
  scaleMeasurementRegistry.register(new F1SeptenaryMeasurement());
  return true;
}

/** Force-registered variant for offline scripts (bypasses the flag). */
export function registerF1SeptenaryMeasurementForced(): void {
  if (scaleMeasurementRegistry.get(0)) return;
  scaleMeasurementRegistry.register(new F1SeptenaryMeasurement());
}
