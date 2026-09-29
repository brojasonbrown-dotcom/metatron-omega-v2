/**
 * F5ColorMusicMeasurement — Phase 4 · Step 5 (n = 4).
 *
 * Implements docs/v13_rebuild/scales/n4_stability.md.
 *
 * Equilibrium projection: ψ*_i = √(f_i / f_0) with f_i ∈ SOLFEGGIO_HZ,
 *                        normalized so ‖ψ*‖ = 1. Nine nodes.
 * Closure target:        y_4 = ⟨v_solfeggio, ψ⟩ / ‖ψ‖. Target → 1.
 * Invariant witness:     octave-cycle preservation — adjacent-ratio
 *                        residual against equilibrium ratios,
 *                        exp(-mean|Δratio|).
 *
 * Read-only. Writes γ (per-step deviation from equilibrium) and m
 * (per-step adjacent-ratio residual). Preserves per-step values —
 * averaging happens at the display layer, not here.
 */

import type { FieldStateN } from '@metatron/field-kernel-core';
import { portFlag } from '@metatron/field-kernel-core';
import type {
  ScaleMeasurement,
  ScaleMeasurementContext,
  ScaleMeasurementResult,
} from './ScaleMeasurement';
import { scaleMeasurementRegistry } from './ScaleMeasurement';

const SOLFEGGIO_HZ = [174, 285, 396, 417, 528, 639, 741, 852, 963];
const NODES = SOLFEGGIO_HZ.length;

function buildEquilibrium(): { ref: Float64Array; ratios: Float64Array } {
  const ref = new Float64Array(NODES);
  let sq = 0;
  for (let i = 0; i < NODES; i++) {
    ref[i] = Math.sqrt(SOLFEGGIO_HZ[i] / SOLFEGGIO_HZ[0]);
    sq += ref[i] * ref[i];
  }
  const inv = 1 / Math.sqrt(sq);
  for (let i = 0; i < NODES; i++) ref[i] *= inv;

  const ratios = new Float64Array(NODES - 1);
  for (let i = 0; i < NODES - 1; i++) ratios[i] = ref[i + 1] / ref[i];
  return { ref, ratios };
}

export class F5ColorMusicMeasurement implements ScaleMeasurement {
  readonly scale = 4;
  readonly name = 'Color/Music';
  readonly nodes = NODES;

  private eq = buildEquilibrium();

  measure(state: FieldStateN, _ctx: ScaleMeasurementContext): ScaleMeasurementResult {
    if (state.psi.length < NODES) {
      return {
        scale: 4,
        closureResidual: NaN,
        closureScore: NaN,
        invariantScore: NaN,
        gamma: new Float64Array(NODES),
      };
    }
    const psi = state.psi;
    const { ref, ratios } = this.eq;

    // Compensated ‖ψ‖².
    let normSq = 0,
      comp = 0;
    for (let i = 0; i < NODES; i++) {
      const x = psi[i] * psi[i];
      const t = normSq + x;
      comp += Math.abs(normSq) >= x ? normSq - t + x : x - t + normSq;
      normSq = t;
    }
    const norm = Math.sqrt(normSq + comp);

    // y_4 = ⟨v_ref, ψ⟩ / ‖ψ‖.
    let dot = 0;
    for (let i = 0; i < NODES; i++) dot += ref[i] * psi[i];
    const y4 = norm > 0 ? dot / norm : NaN;

    // γ: per-step deviation.
    const g = state.gamma.length >= NODES ? state.gamma : new Float64Array(NODES);
    let closureResidualSq = 0;
    for (let i = 0; i < NODES; i++) {
      const target = ref[i] * norm;
      const d = psi[i] - target;
      g[i] = d;
      closureResidualSq += d * d;
    }

    // m: adjacent-ratio residual.
    const m = state.m.length >= NODES ? state.m : null;
    if (m) {
      for (let i = 0; i < NODES - 1; i++) {
        const denom = psi[i];
        m[i] = denom !== 0 && Number.isFinite(denom) ? psi[i + 1] / denom - ratios[i] : NaN;
      }
      m[NODES - 1] = 0;
    }

    // Invariant witness: octave-cycle preservation.
    let invAcc = 0,
      invN = 0;
    for (let i = 0; i < NODES - 1; i++) {
      const denom = psi[i];
      if (denom !== 0 && Number.isFinite(denom)) {
        invAcc += Math.log1p(Math.abs(psi[i + 1] / denom - ratios[i]));
        invN++;
      }
    }
    const invariantScore = invN > 0 ? Math.exp(-invAcc / invN) : NaN;

    return {
      scale: 4,
      closureResidual: closureResidualSq,
      closureScore: y4,
      invariantScore,
      gamma: g,
    };
  }
}

export function registerF5ColorMusicMeasurement(): boolean {
  if (!portFlag('FLAG_RHUFTF_FRAMEWORK_4')) return false;
  if (scaleMeasurementRegistry.get(4)) return true;
  scaleMeasurementRegistry.register(new F5ColorMusicMeasurement());
  return true;
}

export function registerF5ColorMusicMeasurementForced(): F5ColorMusicMeasurement {
  const existing = scaleMeasurementRegistry.get(4);
  if (existing instanceof F5ColorMusicMeasurement) return existing;
  const impl = new F5ColorMusicMeasurement();
  scaleMeasurementRegistry.register(impl);
  return impl;
}
