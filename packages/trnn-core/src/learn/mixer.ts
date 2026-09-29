/**
 * Ω-SHFN Section D · Path B — the superposition mixer.
 *
 * A diagonal spectral filter can never make two modes talk to each other; it
 * only rescales each one. Non-linear field dynamics (three-wave mixing, shock
 * formation, anything turbulent) *is* inter-mode coupling. The cheapest exact
 * way to get it is to leave the spectral domain, apply a pointwise
 * non-linearity in the spatial domain, and come back:
 *
 *   c  →  synth  →  σ(ψ(r)) + β(r)  →  analyze  →  c'
 *
 * A single pointwise operation in r couples *every* eigenmode at once, which
 * is exactly the Kolmogorov–Arnold construction the blueprint invokes.
 *
 * The non-linearity is phase-preserving and radial:
 *
 *   σ(z) = z · s(|z|),   s(x) = x / √(1 + x²)   (the algebraic sigmoid)
 *
 * chosen over a complex GELU/sigmoid for three reasons: it needs no `exp` (so
 * it stays inside the deterministic math bank), it never rotates phase (so the
 * mixer cannot silently inject a phase drift the closure law would then chase),
 * and its gain is provably bounded.
 *
 * Certificate. |σ(z)| = |z|·s(|z|) ≤ |z| because s ≤ 1, so the pointwise map is
 * non-expansive in the max norm. Analysis and synthesis are isometries onto the
 * spanned subspace (CGS2-orthonormal basis, `torus/superposition.ts`), so the
 * whole mixer has ℓ² gain ≤ 1 — it enters the ISS ledger with a *proved* bound
 * of 1 rather than an unknown. The bias field adds its own ℓ² norm, which is
 * bounded by the SimplexGain total, so the full term is bounded by
 * ‖c‖ + biasTotal and nothing here can be tuned out of that.
 */

import { createField, type CField } from '../core/complex';
import { analyze, synthesize, type ModeBasis } from '../torus/superposition';
import { SimplexGain, algSigmoid } from './params';
import { PHI_INV } from '../core/constants';
import { dmag } from '../core/dmath';

/** Default ℓ¹ budget of the learnable bias field, in coefficient units. */
export const BIAS_TOTAL = PHI_INV;

export interface MixerReport {
  /** ‖c'‖ / ‖c‖ — must be ≤ 1 + biasTotal/‖c‖ by the certificate. */
  readonly gain: number;
  /** Fraction of output energy that landed in modes the input did not occupy. */
  readonly transfer: number;
  /** Max |ψ(r)| seen in the spatial domain (the non-linearity's operating point). */
  readonly peak: number;
}

export class SuperpositionMixer {
  readonly basis: ModeBasis;
  readonly modes: number;
  /** Learnable bias *field*, held as its own eigencoefficients β_k. */
  readonly bias: SimplexGain;
  private readonly spatial: CField;
  private readonly scratch: Float64Array;

  constructor(basis: ModeBasis, biasTotal = BIAS_TOTAL) {
    this.basis = basis;
    this.modes = basis.vectors.length;
    this.spatial = createField(basis.n);
    this.scratch = new Float64Array(2 * this.modes);
    this.bias = new SimplexGain(this.modes, biasTotal);
  }

  /**
   * c ← analyze( σ( synth(c) ) ) + β. In place on an interleaved buffer.
   * Zero allocation after construction.
   */
  apply(coeffs: Float64Array): MixerReport {
    if (coeffs.length < 2 * this.modes) {
      throw new RangeError(
        `SuperpositionMixer.apply: buffer holds ${coeffs.length / 2} modes, basis has ${this.modes}`,
      );
    }
    let inE = 0;
    const occupied = new Uint8Array(this.modes);
    for (let k = 0; k < this.modes; k++) {
      const e = coeffs[2 * k] ** 2 + coeffs[2 * k + 1] ** 2;
      inE += e;
      if (e > 0) occupied[k] = 1;
    }

    synthesize(this.basis, coeffs, this.spatial);

    let peak = 0;
    for (let i = 0; i < this.spatial.n; i++) {
      const re = this.spatial.re[i];
      const im = this.spatial.im[i];
      const a = dmag(re, im);
      if (a > peak) peak = a;
      const g = algSigmoid(a); // ∈ [0, 1), radial, phase-preserving
      this.spatial.re[i] = re * g;
      this.spatial.im[i] = im * g;
    }

    analyze(this.basis, this.spatial, this.scratch);

    const beta = this.bias.values();
    let outE = 0;
    let newE = 0;
    for (let k = 0; k < this.modes; k++) {
      // The bias is a real per-mode offset; its phase is carried by the basis
      // vector itself, so a real β_k biases a spatial region, not a phase.
      const r = this.scratch[2 * k] + beta[k];
      const i = this.scratch[2 * k + 1];
      coeffs[2 * k] = r;
      coeffs[2 * k + 1] = i;
      const e = r * r + i * i;
      outE += e;
      if (!occupied[k]) newE += e;
    }

    return {
      gain: inE > 0 ? Math.sqrt(outE / inE) : 0,
      transfer: outE > 0 ? newE / outE : 0,
      peak,
    };
  }

  /** The certified ℓ² bound of this mixer at its current parameters. */
  bound(inputNorm: number): number {
    return inputNorm + this.bias.total;
  }
}
