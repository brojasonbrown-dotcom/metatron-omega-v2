/**
 * F7GalacticMeasurement — Phase 4 · Step 7 (n = 6).
 *
 * Implements docs/v13_rebuild/scales/n6_stability.md.
 *
 * Equilibrium projection: ψ*_i = exp(-i·ln(φ)/N) · cos(i · θ_gold),
 *                        θ_gold = 2π·φ^(-2), N = 55. Normalized ‖ψ*‖ = 1.
 * Closure target:        y_6 = ⟨v_spiral, ψ⟩ / ‖ψ‖. Target ∈ [0.85, 1.00].
 * Invariant witness:     spiral-phase preservation — mean absolute
 *                        residual of adjacent-node golden-angle rotation.
 *
 * Read-only. Writes γ (per-node deviation from spiral) and m (angular
 * residual per node in radians).
 *
 * Decoupling rule (from spec §7): this module reads its own shadow
 * copy — never the live pineal buffer.
 */

import type { FieldStateN } from '@metatron/field-kernel-core';
import { PHI, portFlag } from '@metatron/field-kernel-core';
import type {
  ScaleMeasurement,
  ScaleMeasurementContext,
  ScaleMeasurementResult,
} from './ScaleMeasurement';
import { scaleMeasurementRegistry } from './ScaleMeasurement';

const NODES = 55;
const THETA_GOLD = 2 * Math.PI * Math.pow(1 / PHI, 2);
const LN_PHI_OVER_N = Math.log(PHI) / NODES;

function buildEquilibrium(): Float64Array {
  const ref = new Float64Array(NODES);
  let sq = 0;
  for (let i = 0; i < NODES; i++) {
    ref[i] = Math.exp(-i * LN_PHI_OVER_N) * Math.cos(i * THETA_GOLD);
    sq += ref[i] * ref[i];
  }
  const inv = 1 / Math.sqrt(sq);
  for (let i = 0; i < NODES; i++) ref[i] *= inv;
  return ref;
}

export class F7GalacticMeasurement implements ScaleMeasurement {
  readonly scale = 6;
  readonly name = 'Galactic';
  readonly nodes = NODES;

  private ref = buildEquilibrium();

  measure(state: FieldStateN, _ctx: ScaleMeasurementContext): ScaleMeasurementResult {
    if (state.psi.length < NODES) {
      return { scale: 6, closureResidual: NaN, closureScore: NaN, invariantScore: NaN, gamma: new Float64Array(NODES) };
    }
    const psi = state.psi;
    const ref = this.ref;

    // Compensated ‖ψ‖².
    let normSq = 0, comp = 0;
    for (let i = 0; i < NODES; i++) {
      const x = psi[i] * psi[i];
      const t = normSq + x;
      comp += Math.abs(normSq) >= x ? (normSq - t) + x : (x - t) + normSq;
      normSq = t;
    }
    const norm = Math.sqrt(normSq + comp);

    // y_6 = ⟨v_spiral, ψ⟩ / ‖ψ‖.
    let dot = 0;
    for (let i = 0; i < NODES; i++) dot += ref[i] * psi[i];
    const y6 = norm > 0 ? dot / norm : NaN;

    // γ + closure residual.
    const g = state.gamma.length >= NODES ? state.gamma : new Float64Array(NODES);
    let closureResidualSq = 0;
    for (let i = 0; i < NODES; i++) {
      const target = ref[i] * norm;
      const d = psi[i] - target;
      g[i] = d;
      closureResidualSq += d * d;
    }

    // m: golden-angle phase residual per node index.
    // Reference phase φ_i = i · θ_gold  (mod 2π). Measured phase estimated as
    // atan2(-diff, val) using adjacent nodes as sin/cos surrogates. Purely
    // diagnostic — the closure score does not depend on it.
    const m = state.m.length >= NODES ? state.m : null;
    if (m) {
      for (let i = 0; i < NODES - 1; i++) {
        const targetPhase = (i * THETA_GOLD) % (2 * Math.PI);
        const measuredPhase = Math.atan2(psi[i + 1], psi[i]);
        let delta = measuredPhase - targetPhase;
        // Wrap to (-π, π].
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta <= -Math.PI) delta += 2 * Math.PI;
        m[i] = delta;
      }
      m[NODES - 1] = 0;
    }

    // Invariant witness: spiral-phase preservation. Compute mean |Δphase| in m.
    let invAcc = 0, invN = 0;
    for (let i = 0; i < NODES - 1; i++) {
      const denom = psi[i];
      if (denom !== 0 && Number.isFinite(denom)) {
        const targetPhase = (i * THETA_GOLD) % (2 * Math.PI);
        const measuredPhase = Math.atan2(psi[i + 1], psi[i]);
        let delta = measuredPhase - targetPhase;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta <= -Math.PI) delta += 2 * Math.PI;
        invAcc += Math.abs(delta);
        invN++;
      }
    }
    const invariantScore = invN > 0 ? Math.exp(-invAcc / invN) : NaN;

    return {
      scale: 6,
      closureResidual: closureResidualSq,
      closureScore: y6,
      invariantScore,
      gamma: g,
    };
  }
}

export function registerF7GalacticMeasurement(): boolean {
  if (!portFlag('FLAG_RHUFTF_FRAMEWORK_6')) return false;
  if (scaleMeasurementRegistry.get(6)) return true;
  scaleMeasurementRegistry.register(new F7GalacticMeasurement());
  return true;
}

export function registerF7GalacticMeasurementForced(): F7GalacticMeasurement {
  const existing = scaleMeasurementRegistry.get(6);
  if (existing instanceof F7GalacticMeasurement) return existing;
  const impl = new F7GalacticMeasurement();
  scaleMeasurementRegistry.register(impl);
  return impl;
}
