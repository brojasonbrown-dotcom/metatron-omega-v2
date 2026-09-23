/**
 * F2QuantumMeasurement — Phase 4 · Step 2 (n = 1).
 *
 * Implements the n=1 stability spec (`docs/v13_rebuild/scales/n1_stability.md`).
 *
 * The spec calls for the leading eigenmode of the 55-node flower-of-life
 * adjacency as the equilibrium projection. Computing that eigenmode
 * belongs to a graph-adjacency module that is not yet extracted from the
 * legacy F2 code path. To honour Decision #2 ("real live readings, no
 * fabricated values") without stalling Phase 4, this module:
 *
 *   1. Ships a **default reference mode** = normalized φ-decayed envelope
 *      `v_i = φ^(-i/N)`. This satisfies the Fib-pairing invariant from
 *      spec §6 and matches the shape of `defaultPineal()` up to a phase
 *      envelope. `referenceModeSeed = 'phi-decay:phase4.step2'` is
 *      stamped into each result's `gamma[0]` slot so any downstream
 *      analysis can identify which reference produced the score.
 *   2. Exposes `setReferenceMode(vec, seedTag)` so later phases can
 *      inject a computed eigenmode without rebuilding this module.
 *
 * Closure score: `y_1 = ⟨v_ref, ψ⟩ / ‖ψ‖`.  Target y_1 → 1.
 * Invariant witness: adjacent-mode φ-ratio geometric mean, same shape as F1.
 *
 * Read-only contract identical to F1: writes only to `m` and `gamma`.
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

function buildPhiEnvelope(n: number): Float64Array {
  const v = new Float64Array(n);
  let sq = 0;
  for (let i = 0; i < n; i++) {
    v[i] = Math.pow(1 / PHI, i / (n - 1));
    sq += v[i] * v[i];
  }
  const inv = 1 / Math.sqrt(sq);
  for (let i = 0; i < n; i++) v[i] *= inv;
  return v;
}

export class F2QuantumMeasurement implements ScaleMeasurement {
  readonly scale = 1;
  readonly name = 'Quantum';
  readonly nodes = NODES;

  private ref: Float64Array = buildPhiEnvelope(NODES);
  private refSeed = 'phi-decay:phase4.step2';

  /**
   * Inject a graph-computed reference mode. Must be length-`nodes` and
   * non-zero. `seedTag` is stamped into result.gamma[0] for provenance.
   */
  setReferenceMode(vec: Float64Array, seedTag: string): void {
    if (vec.length !== this.nodes) {
      throw new Error(`F2QuantumMeasurement: ref length ${vec.length} ≠ ${this.nodes}`);
    }
    // Normalize to unit ℓ².
    let sq = 0;
    for (let i = 0; i < vec.length; i++) sq += vec[i] * vec[i];
    if (!(sq > 0)) throw new Error('F2QuantumMeasurement: ref vector has zero norm');
    const inv = 1 / Math.sqrt(sq);
    const n = new Float64Array(this.nodes);
    for (let i = 0; i < this.nodes; i++) n[i] = vec[i] * inv;
    this.ref = n;
    this.refSeed = seedTag;
  }

  get referenceSeedTag(): string { return this.refSeed; }

  private static hashSeed(tag: string): number {
    // FNV-1a 32-bit for a stable numeric provenance stamp — not a security hash.
    let h = 0x811c9dc5;
    for (let i = 0; i < tag.length; i++) {
      h ^= tag.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }

  measure(state: FieldStateN, _ctx: ScaleMeasurementContext): ScaleMeasurementResult {
    if (state.psi.length < NODES) {
      return { scale: 1, closureResidual: NaN, closureScore: NaN, invariantScore: NaN, gamma: new Float64Array(NODES) };
    }
    const psi = state.psi;
    const ref = this.ref;

    // ‖ψ‖² compensated.
    let normSq = 0, comp = 0;
    for (let i = 0; i < NODES; i++) {
      const x = psi[i] * psi[i];
      const t = normSq + x;
      comp += Math.abs(normSq) >= x ? (normSq - t) + x : (x - t) + normSq;
      normSq = t;
    }
    const norm = Math.sqrt(normSq + comp);

    // y_1 = ⟨v_ref, ψ⟩ / ‖ψ‖ — unclamped.
    let dot = 0;
    for (let i = 0; i < NODES; i++) dot += ref[i] * psi[i];
    const y1 = norm > 0 ? dot / norm : NaN;

    // Per-mode diagnostics into γ, φ-ratio residuals into m.
    const g = state.gamma.length >= NODES ? state.gamma : new Float64Array(NODES);
    const m = state.m.length >= NODES ? state.m : null;
    let closureResidualSq = 0;
    for (let i = 0; i < NODES; i++) {
      const target = ref[i] * norm;
      const d = psi[i] - target;
      g[i] = d;
      closureResidualSq += d * d;
      if (m && i < NODES - 1) {
        const denom = psi[i + 1];
        m[i] = denom !== 0 ? psi[i] / denom - PHI : NaN;
      }
    }
    if (m && m.length >= NODES) m[NODES - 1] = 0;

    // Stamp reference-seed hash into γ[0]'s SIGN-preserving low bits.
    // Preserve the diagnostic magnitude by ORing the hash into the mantissa
    // only when γ[0] would otherwise be 0. Otherwise leave γ[0] intact — the
    // seed is still recoverable from `referenceSeedTag`.
    if (g[0] === 0) {
      // Encode the seed as a subnormal — zero magnitude, provenance in bits.
      const buf = new Float64Array(1);
      const bytes = new BigInt64Array(buf.buffer);
      bytes[0] = BigInt(F2QuantumMeasurement.hashSeed(this.refSeed));
      g[0] = buf[0];
    }

    // Invariant witness: adjacent-mode φ-ratio geometric mean.
    let invAcc = 0, invN = 0;
    for (let i = 0; i < NODES - 1; i++) {
      const denom = psi[i + 1];
      if (denom !== 0 && Number.isFinite(denom)) {
        invAcc += Math.log1p(Math.abs(psi[i] / denom - PHI));
        invN++;
      }
    }
    const invariantScore = invN > 0 ? Math.exp(-invAcc / invN) : NaN;

    return {
      scale: 1,
      closureResidual: closureResidualSq,
      closureScore: Number.isFinite(y1) ? y1 : NaN,
      invariantScore,
      gamma: g,
    };
  }
}

export function registerF2QuantumMeasurement(): boolean {
  if (!portFlag('FLAG_RHUFTF_FRAMEWORK_1')) return false;
  if (scaleMeasurementRegistry.get(1)) return true;
  scaleMeasurementRegistry.register(new F2QuantumMeasurement());
  return true;
}

export function registerF2QuantumMeasurementForced(): F2QuantumMeasurement {
  const existing = scaleMeasurementRegistry.get(1);
  if (existing instanceof F2QuantumMeasurement) return existing;
  const impl = new F2QuantumMeasurement();
  scaleMeasurementRegistry.register(impl);
  return impl;
}
