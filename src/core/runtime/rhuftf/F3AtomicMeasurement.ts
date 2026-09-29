/**
 * F3AtomicMeasurement — Phase 4 · Step 3 (n = 2).
 *
 * Implements docs/v13_rebuild/scales/n2_stability.md.
 *
 * Equilibrium projection: ψ*_i = φ^(-i/2), i ∈ [0..6], normalized to ‖ψ*‖ = 1.
 * Closure target:        y_2 = Σ_i (ψ_i/‖ψ‖)² · w_i / Σ w_i, w_i = 2i+1.
 *                        At equilibrium the normalized weighted-shell sum = 1.
 * Invariant witness:     shell-doubling residual — geometric mean of
 *                        |(ψ_i/ψ_{i+1})² − φ|, mapped through exp(-·).
 *
 * Read-only contract: writes only to `m` (φ^(-1/2) ratio residuals) and
 * `gamma` (per-shell deviation from equilibrium). ψ/ψ̂/u/y untouched.
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
const SQRT_PHI = Math.sqrt(PHI);
const INV_SQRT_PHI = 1 / SQRT_PHI;

function buildEquilibrium(): { ref: Float64Array; wSum: number; w: Float64Array } {
  const ref = new Float64Array(NODES);
  const w = new Float64Array(NODES);
  let sq = 0,
    wSum = 0;
  for (let i = 0; i < NODES; i++) {
    ref[i] = Math.pow(INV_SQRT_PHI, i);
    sq += ref[i] * ref[i];
    w[i] = 2 * i + 1;
    wSum += w[i];
  }
  const inv = 1 / Math.sqrt(sq);
  for (let i = 0; i < NODES; i++) ref[i] *= inv;
  return { ref, wSum, w };
}

export class F3AtomicMeasurement implements ScaleMeasurement {
  readonly scale = 2;
  readonly name = 'Atomic';
  readonly nodes = NODES;

  private eq = buildEquilibrium();
  /** Normalization constant for y_2 so that y_2(ψ*) = 1 exactly. */
  private y2NormAtEq: number;

  constructor() {
    // Compute weighted shell sum at equilibrium, so y_2 is scale-invariant to 1.
    let acc = 0;
    for (let i = 0; i < NODES; i++) {
      acc += this.eq.ref[i] * this.eq.ref[i] * this.eq.w[i];
    }
    // acc / wSum is the equilibrium value; normalize by it.
    this.y2NormAtEq = acc / this.eq.wSum;
  }

  measure(state: FieldStateN, _ctx: ScaleMeasurementContext): ScaleMeasurementResult {
    if (state.psi.length < NODES) {
      return {
        scale: 2,
        closureResidual: NaN,
        closureScore: NaN,
        invariantScore: NaN,
        gamma: new Float64Array(NODES),
      };
    }
    const psi = state.psi;
    const { ref, w, wSum } = this.eq;

    // Compensated ‖ψ‖².
    let normSq = 0,
      comp = 0;
    for (let i = 0; i < NODES; i++) {
      const x = psi[i] * psi[i];
      const t = normSq + x;
      comp += Math.abs(normSq) >= x ? normSq - t + x : x - t + normSq;
      normSq = t;
    }
    const nSq = normSq + comp;
    const norm = Math.sqrt(nSq);

    // y_2 = Σ (ψ_i/‖ψ‖)² · w_i / Σ w_i, normalized so equilibrium = 1.
    let weighted = 0;
    if (nSq > 0) {
      for (let i = 0; i < NODES; i++) {
        weighted += ((psi[i] * psi[i]) / nSq) * w[i];
      }
    }
    const y2Raw = weighted / wSum;
    const y2 = this.y2NormAtEq > 0 ? y2Raw / this.y2NormAtEq : NaN;

    // Per-shell γ: deviation from equilibrium (scaled to ‖ψ‖).
    const g = state.gamma.length >= NODES ? state.gamma : new Float64Array(NODES);
    let closureResidualSq = 0;
    for (let i = 0; i < NODES; i++) {
      const target = ref[i] * norm;
      const d = psi[i] - target;
      g[i] = d;
      closureResidualSq += d * d;
    }

    // m[i] = shell-ratio residual against φ^(-1/2).
    const m = state.m.length >= NODES ? state.m : null;
    if (m) {
      for (let i = 0; i < NODES - 1; i++) {
        const denom = psi[i + 1];
        m[i] = denom !== 0 && Number.isFinite(denom) ? psi[i] / denom - SQRT_PHI : NaN;
      }
      m[NODES - 1] = 0;
    }

    // Invariant witness: shell-doubling — (ψ_i/ψ_{i+1})² should ≈ φ.
    let invAcc = 0,
      invN = 0;
    for (let i = 0; i < NODES - 1; i++) {
      const denom = psi[i + 1];
      if (denom !== 0 && Number.isFinite(denom)) {
        const r = psi[i] / denom;
        invAcc += Math.log1p(Math.abs(r * r - PHI));
        invN++;
      }
    }
    const invariantScore = invN > 0 ? Math.exp(-invAcc / invN) : NaN;

    return {
      scale: 2,
      closureResidual: closureResidualSq,
      closureScore: y2,
      invariantScore,
      gamma: g,
    };
  }
}

export function registerF3AtomicMeasurement(): boolean {
  if (!portFlag('FLAG_RHUFTF_FRAMEWORK_2')) return false;
  if (scaleMeasurementRegistry.get(2)) return true;
  scaleMeasurementRegistry.register(new F3AtomicMeasurement());
  return true;
}

export function registerF3AtomicMeasurementForced(): F3AtomicMeasurement {
  const existing = scaleMeasurementRegistry.get(2);
  if (existing instanceof F3AtomicMeasurement) return existing;
  const impl = new F3AtomicMeasurement();
  scaleMeasurementRegistry.register(impl);
  return impl;
}
