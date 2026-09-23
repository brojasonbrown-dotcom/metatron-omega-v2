/**
 * F4GeometricMeasurement — Phase 4 · Step 4 (n = 3).
 *
 * Implements docs/v13_rebuild/scales/n3_stability.md.
 *
 * Equilibrium projection: ψ*_i = 1/√13 (isotropic).
 * Closure target:        y_3 = 1 − stddev(ψ_i/‖ψ‖) · √N (scaled so
 *                        equilibrium → 1). Deviation = anisotropy.
 * Invariant witness:     mean-preservation — |mean(ψ)/‖ψ‖ − 1/√N|
 *                        mapped through exp(-·).
 *
 * Read-only. Writes only γ (per-node anisotropy) and m (per-node
 * deviation from 1/√N in normalized units).
 */

import type { FieldStateN } from '@metatron/field-kernel-core';
import { portFlag } from '@metatron/field-kernel-core';
import type {
  ScaleMeasurement,
  ScaleMeasurementContext,
  ScaleMeasurementResult,
} from './ScaleMeasurement';
import { scaleMeasurementRegistry } from './ScaleMeasurement';

const NODES = 13;
const REF_VAL = 1 / Math.sqrt(NODES);

export class F4GeometricMeasurement implements ScaleMeasurement {
  readonly scale = 3;
  readonly name = 'Geometric';
  readonly nodes = NODES;

  measure(state: FieldStateN, _ctx: ScaleMeasurementContext): ScaleMeasurementResult {
    if (state.psi.length < NODES) {
      return { scale: 3, closureResidual: NaN, closureScore: NaN, invariantScore: NaN, gamma: new Float64Array(NODES) };
    }
    const psi = state.psi;

    // Compensated ‖ψ‖².
    let normSq = 0, comp = 0;
    for (let i = 0; i < NODES; i++) {
      const x = psi[i] * psi[i];
      const t = normSq + x;
      comp += Math.abs(normSq) >= x ? (normSq - t) + x : (x - t) + normSq;
      normSq = t;
    }
    const nSq = normSq + comp;
    const norm = Math.sqrt(nSq);

    // Normalized amplitudes, mean, stddev.
    let mean = 0;
    if (norm > 0) {
      for (let i = 0; i < NODES; i++) mean += psi[i] / norm;
      mean /= NODES;
    }
    let varAcc = 0;
    if (norm > 0) {
      for (let i = 0; i < NODES; i++) {
        const d = psi[i] / norm - mean;
        varAcc += d * d;
      }
    }
    const std = Math.sqrt(varAcc / NODES);

    // Equilibrium stddev is 0. Closure score = 1 − std · √N, so worst case
    // (single node holds all amplitude) → 0.
    const y3 = 1 - std * Math.sqrt(NODES);

    // γ: per-node anisotropy against 1/√N (after ‖ψ‖ normalization).
    const g = state.gamma.length >= NODES ? state.gamma : new Float64Array(NODES);
    let closureResidualSq = 0;
    for (let i = 0; i < NODES; i++) {
      const d = norm > 0 ? psi[i] / norm - REF_VAL : NaN;
      g[i] = d;
      if (Number.isFinite(d)) closureResidualSq += d * d;
    }

    // m: unnormalized deviation (in raw units).
    const m = state.m.length >= NODES ? state.m : null;
    if (m) {
      for (let i = 0; i < NODES; i++) m[i] = psi[i] - REF_VAL * norm;
    }

    // Invariant: mean should equal 1/√N under isotropy.
    const invariantScore = Number.isFinite(mean)
      ? Math.exp(-Math.abs(mean - REF_VAL))
      : NaN;

    return {
      scale: 3,
      closureResidual: closureResidualSq,
      closureScore: y3,
      invariantScore,
      gamma: g,
    };
  }
}

export function registerF4GeometricMeasurement(): boolean {
  if (!portFlag('FLAG_RHUFTF_FRAMEWORK_3')) return false;
  if (scaleMeasurementRegistry.get(3)) return true;
  scaleMeasurementRegistry.register(new F4GeometricMeasurement());
  return true;
}

export function registerF4GeometricMeasurementForced(): F4GeometricMeasurement {
  const existing = scaleMeasurementRegistry.get(3);
  if (existing instanceof F4GeometricMeasurement) return existing;
  const impl = new F4GeometricMeasurement();
  scaleMeasurementRegistry.register(impl);
  return impl;
}
