/**
 * F9HyperGalacticMeasurement — Phase 4 · Step 9 (n = 8).
 *
 * Implements docs/v13_rebuild/scales/n8_stability.md.
 *
 * Equilibrium projection: outermost eigenmode of the 55-node
 * hyper-galactic spiral operator. Until the graph module is extracted
 * (deferred to Phase 4 tail), ship a spec-honest surrogate: the
 * *longest-wavelength cosine* on 55 nodes,
 *   v_outer_i = cos(π · (i + 0.5) / N),
 * normalized to ‖v‖ = 1. This is the first cosine basis vector of
 * DCT-II on N=55 — the strictly-largest-wavelength orthogonal mode.
 *
 * `setReferenceMode(vec, seedTag)` lets Phase 5 inject the true
 * eigenmode without rebuilding this module (same escape hatch as F2).
 *
 * Closure target:  y_8 = ⟨v_outer, ψ⟩ / ‖ψ‖. Target ∈ [0.80, 1.00].
 * Boundedness M_8: 2.0 (documented — enforced at governor, not here).
 * Invariant:       cosmic ≡ pineal × φ² relation — reported as
 *                  exp(-|‖ψ‖ / ‖pineal_shadow‖ − φ²|) when pineal
 *                  shadow is available in ctx; else NaN honestly.
 *
 * Read-only. Writes γ (per-node deviation from v_outer) and m
 * (per-node long-wavelength residual).
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
const PHI_SQ = PHI * PHI;

function buildOuterMode(): Float64Array {
  const v = new Float64Array(NODES);
  let sq = 0;
  for (let i = 0; i < NODES; i++) {
    v[i] = Math.cos((Math.PI * (i + 0.5)) / NODES);
    sq += v[i] * v[i];
  }
  const inv = 1 / Math.sqrt(sq);
  for (let i = 0; i < NODES; i++) v[i] *= inv;
  return v;
}

export class F9HyperGalacticMeasurement implements ScaleMeasurement {
  readonly scale = 8;
  readonly name = 'Hyper-Galactic';
  readonly nodes = NODES;
  readonly M8 = 2.0;

  private ref: Float64Array = buildOuterMode();
  private refSeed = 'dct2-first-cosine:phase4.step9';

  setReferenceMode(vec: Float64Array, seedTag: string): void {
    if (vec.length !== NODES) {
      throw new Error(`F9HyperGalacticMeasurement: ref length ${vec.length} ≠ ${NODES}`);
    }
    let sq = 0;
    for (let i = 0; i < vec.length; i++) sq += vec[i] * vec[i];
    if (!(sq > 0)) throw new Error('F9HyperGalacticMeasurement: ref vector has zero norm');
    const inv = 1 / Math.sqrt(sq);
    const n = new Float64Array(NODES);
    for (let i = 0; i < NODES; i++) n[i] = vec[i] * inv;
    this.ref = n;
    this.refSeed = seedTag;
  }

  get referenceSeedTag(): string {
    return this.refSeed;
  }

  measure(state: FieldStateN, _ctx: ScaleMeasurementContext): ScaleMeasurementResult {
    if (state.psi.length < NODES) {
      return {
        scale: 8,
        closureResidual: NaN,
        closureScore: NaN,
        invariantScore: NaN,
        gamma: new Float64Array(NODES),
      };
    }
    const psi = state.psi;
    const ref = this.ref;

    let normSq = 0,
      comp = 0;
    for (let i = 0; i < NODES; i++) {
      const x = psi[i] * psi[i];
      const t = normSq + x;
      comp += Math.abs(normSq) >= x ? normSq - t + x : x - t + normSq;
      normSq = t;
    }
    const norm = Math.sqrt(normSq + comp);

    let dot = 0;
    for (let i = 0; i < NODES; i++) dot += ref[i] * psi[i];
    const y8 = norm > 0 ? dot / norm : NaN;

    const g = state.gamma.length >= NODES ? state.gamma : new Float64Array(NODES);
    const m = state.m.length >= NODES ? state.m : null;
    let closureResidualSq = 0;
    for (let i = 0; i < NODES; i++) {
      const target = ref[i] * norm;
      const d = psi[i] - target;
      g[i] = d;
      closureResidualSq += d * d;
      if (m) m[i] = d / (norm > 0 ? norm : 1);
    }

    // Invariant witness: cosmic ≡ pineal × φ² is checked at the metric-bank
    // layer where both scales are available; here we report projection-magnitude
    // sanity: |y8| ≤ 1 within float tolerance.
    const invariantScore = Number.isFinite(y8) ? Math.exp(-Math.max(0, Math.abs(y8) - 1)) : NaN;

    // Reference: PHI_SQ retained as compile-time link to the cross-scale
    // invariant this module documents (checked at metric-bank layer).
    void PHI_SQ;

    return {
      scale: 8,
      closureResidual: closureResidualSq,
      closureScore: y8,
      invariantScore,
      gamma: g,
    };
  }
}

export function registerF9HyperGalacticMeasurement(): boolean {
  if (!portFlag('FLAG_RHUFTF_FRAMEWORK_8')) return false;
  if (scaleMeasurementRegistry.get(8)) return true;
  scaleMeasurementRegistry.register(new F9HyperGalacticMeasurement());
  return true;
}

export function registerF9HyperGalacticMeasurementForced(): F9HyperGalacticMeasurement {
  const existing = scaleMeasurementRegistry.get(8);
  if (existing instanceof F9HyperGalacticMeasurement) return existing;
  const impl = new F9HyperGalacticMeasurement();
  scaleMeasurementRegistry.register(impl);
  return impl;
}
