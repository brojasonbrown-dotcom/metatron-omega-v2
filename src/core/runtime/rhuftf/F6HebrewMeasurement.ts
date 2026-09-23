/**
 * F6HebrewMeasurement — Phase 4 · Step 6 (n = 5).
 *
 * Implements docs/v13_rebuild/scales/n5_stability.md.
 *
 * Equilibrium projection: ψ*_i = 1/√22 (flat symbol prior).
 * Closure target:        y_5 = H(ψ² / Σψ²) / log₂(22). Uniform → 1.
 * Invariant witness:     3-7-12 partition preservation — mass ratio
 *                        against equilibrium (3/22 mothers,
 *                        7/22 doubles, 12/22 simples).
 *
 * Read-only. Writes γ (per-letter probability mass) and m (per-letter
 * deviation from 1/22 prior in probability units).
 *
 * NaN honesty: if the total probability mass is 0, returns NaN closure
 * rather than substituting 0.
 */

import type { FieldStateN } from '@metatron/field-kernel-core';
import { portFlag } from '@metatron/field-kernel-core';
import type {
  ScaleMeasurement,
  ScaleMeasurementContext,
  ScaleMeasurementResult,
} from './ScaleMeasurement';
import { scaleMeasurementRegistry } from './ScaleMeasurement';

const NODES = 22;
const UNIFORM = 1 / NODES;
const LOG2_N = Math.log2(NODES);

// Aleph-bet partition (0..21):
// Mothers (א מ ש) = indices {0, 12, 20}
// Doubles (בגדכפרת)   = indices {1, 2, 3, 10, 16, 19, 21}
// Simples (rest) = remaining 12 letters.
const MOTHERS = new Set([0, 12, 20]);
const DOUBLES = new Set([1, 2, 3, 10, 16, 19, 21]);

export class F6HebrewMeasurement implements ScaleMeasurement {
  readonly scale = 5;
  readonly name = 'Hebrew';
  readonly nodes = NODES;

  measure(state: FieldStateN, _ctx: ScaleMeasurementContext): ScaleMeasurementResult {
    if (state.psi.length < NODES) {
      return { scale: 5, closureResidual: NaN, closureScore: NaN, invariantScore: NaN, gamma: new Float64Array(NODES) };
    }
    const psi = state.psi;

    // Compensated Σψ² for probability normalization.
    let sumSq = 0, comp = 0;
    for (let i = 0; i < NODES; i++) {
      const x = psi[i] * psi[i];
      const t = sumSq + x;
      comp += Math.abs(sumSq) >= x ? (sumSq - t) + x : (x - t) + sumSq;
      sumSq = t;
    }
    const total = sumSq + comp;

    if (!(total > 0)) {
      const g = state.gamma.length >= NODES ? state.gamma : new Float64Array(NODES);
      for (let i = 0; i < NODES; i++) g[i] = NaN;
      return { scale: 5, closureResidual: NaN, closureScore: NaN, invariantScore: NaN, gamma: g };
    }

    // Entropy H = -Σ p log₂ p ; γ = per-letter probability.
    const g = state.gamma.length >= NODES ? state.gamma : new Float64Array(NODES);
    let H = 0;
    let mMass = 0, dMass = 0, sMass = 0;
    for (let i = 0; i < NODES; i++) {
      const p = (psi[i] * psi[i]) / total;
      g[i] = p;
      if (p > 0) H -= p * Math.log2(p);
      if (MOTHERS.has(i)) mMass += p;
      else if (DOUBLES.has(i)) dMass += p;
      else sMass += p;
    }
    const y5 = H / LOG2_N;

    // m: probability deviation from uniform 1/22.
    const m = state.m.length >= NODES ? state.m : null;
    let closureResidualSq = 0;
    for (let i = 0; i < NODES; i++) {
      const d = g[i] - UNIFORM;
      closureResidualSq += d * d;
      if (m) m[i] = d;
    }

    // Invariant witness: partition-mass preservation.
    // Equilibrium: mothers 3/22, doubles 7/22, simples 12/22.
    const target = [3 / NODES, 7 / NODES, 12 / NODES];
    const measured = [mMass, dMass, sMass];
    let invAcc = 0;
    for (let k = 0; k < 3; k++) invAcc += Math.log1p(Math.abs(measured[k] - target[k]));
    const invariantScore = Math.exp(-invAcc / 3);

    return {
      scale: 5,
      closureResidual: closureResidualSq,
      closureScore: y5,
      invariantScore,
      gamma: g,
    };
  }
}

export function registerF6HebrewMeasurement(): boolean {
  if (!portFlag('FLAG_RHUFTF_FRAMEWORK_5')) return false;
  if (scaleMeasurementRegistry.get(5)) return true;
  scaleMeasurementRegistry.register(new F6HebrewMeasurement());
  return true;
}

export function registerF6HebrewMeasurementForced(): F6HebrewMeasurement {
  const existing = scaleMeasurementRegistry.get(5);
  if (existing instanceof F6HebrewMeasurement) return existing;
  const impl = new F6HebrewMeasurement();
  scaleMeasurementRegistry.register(impl);
  return impl;
}
