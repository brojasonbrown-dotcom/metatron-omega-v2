/**
 * Ω-SHFN Section C · Path A — the learnable dispersion filter α(λ_k).
 *
 * In an orthonormal eigenbasis the propagator of a linear field equation is
 * *diagonal*: each mode simply gets multiplied by a complex number that depends
 * only on its eigenvalue. So the honest learnable object here is not a K×K
 * matrix (O(K²) parameters, and it would break equivariance) but a length-K
 * complex filter:
 *
 *   c'_k = α_k · c_k,    α_k = ρ_k · e^{i ψ_k}
 *
 * with ρ_k ∈ [0, ρ_max] and ψ_k ∈ (−π, π), both produced by *surjective* maps
 * from the whole real line (the algebraic sigmoid used everywhere else in
 * `learn/params.ts`). There is no parameter value — not one the optimiser can
 * ever reach — for which |α_k| exceeds ρ_max.
 *
 * Certificate. The basis is orthonormal, so the operator's induced ℓ² gain is
 * exactly max_k |α_k| ≤ ρ_max. Admitting the filter into the certified cell as
 * an additive drive with gate g therefore costs at most g·ρ_max in the Jury
 * ledger, and the default gate is 0 — a default build is bit-identical to the
 * oracle.
 *
 * Learning. `fitMagnitudes` is deterministic gradient descent on the squared
 * error between |α_k| and a measured target (e.g. the observed per-mode decay
 * of the field). Exact analytic gradient through the sigmoid — no finite
 * differences, no RNG, no momentum state that could drift between runs.
 */

import { algSigmoid, algSigmoidPrime, type Certificate, type Parametrization } from './params';
import { PHI_INV } from '../core/constants';
import { dcos, dexp, dsin } from '../core/dmath';

/** Default magnitude ceiling: φ⁻¹ < 1, so the filter alone is a contraction. */
export const FILTER_RHO_MAX = PHI_INV;

export class SpectralFilter implements Parametrization {
  readonly kind = 'SpectralFilter';
  readonly size: number;
  /** raw layout: [mag_0..mag_{K-1}, phase_0..phase_{K-1}] */
  readonly raw: Float64Array;
  readonly rhoMax: number;
  private readonly out: Float64Array;

  constructor(modes: number, rhoMax = FILTER_RHO_MAX) {
    if (!Number.isInteger(modes) || modes <= 0) throw new RangeError(`SpectralFilter: modes must be a positive integer, got ${modes}`);
    if (!(rhoMax > 0) || !(rhoMax < 1)) throw new RangeError(`SpectralFilter: rhoMax must lie in (0,1), got ${rhoMax}`);
    this.size = modes;
    this.rhoMax = rhoMax;
    this.raw = new Float64Array(2 * modes);
    this.out = new Float64Array(2 * modes);
  }

  /** ρ_k ∈ [0, ρ_max]. |s(x)| is used so the map covers the closed lower end. */
  magnitude(k: number): number {
    return this.rhoMax * Math.abs(algSigmoid(this.raw[k]));
  }

  /** ψ_k ∈ (−π, π). */
  phase(k: number): number {
    return Math.PI * algSigmoid(this.raw[this.size + k]);
  }

  /** Interleaved [Re α_0, Im α_0, …]. Owned buffer; no allocation. */
  values(): Float64Array {
    for (let k = 0; k < this.size; k++) {
      const r = this.magnitude(k);
      const p = this.phase(k);
      this.out[2 * k] = r * dcos(p);
      this.out[2 * k + 1] = r * dsin(p);
    }
    return this.out;
  }

  /** c ← α ⊙ c, in place on an interleaved coefficient buffer. */
  apply(coeffs: Float64Array): Float64Array {
    if (coeffs.length < 2 * this.size) {
      throw new RangeError(`SpectralFilter.apply: buffer holds ${coeffs.length / 2} modes, filter needs ${this.size}`);
    }
    const a = this.values();
    for (let k = 0; k < this.size; k++) {
      const cr = coeffs[2 * k];
      const ci = coeffs[2 * k + 1];
      const ar = a[2 * k];
      const ai = a[2 * k + 1];
      coeffs[2 * k] = ar * cr - ai * ci;
      coeffs[2 * k + 1] = ar * ci + ai * cr;
    }
    return coeffs;
  }

  /** The induced ℓ² gain of the filter: max_k |α_k|. */
  gain(): number {
    let m = 0;
    for (let k = 0; k < this.size; k++) m = Math.max(m, this.magnitude(k));
    return m;
  }

  certificate(): Certificate {
    const g = this.gain();
    return {
      kind: this.kind,
      statement: `‖diag(α)‖₂ = max_k|α_k| ≤ ρ_max = ${this.rhoMax} < 1 for every raw ∈ R^${2 * this.size}`,
      bound: this.rhoMax,
      measured: g,
      holds: g <= this.rhoMax * (1 + 8 * Number.EPSILON),
    };
  }

  /**
   * One deterministic gradient step on E = ½ Σ_k (ρ_k − target_k)².
   *
   *   dE/draw_k = (ρ_k − t_k) · ρ_max · sign(s) · s'(raw_k)
   *
   * Targets above ρ_max are honestly unreachable; the step drives ρ_k to the
   * ceiling and the residual it returns says so rather than pretending to fit.
   */
  stepMagnitudes(target: ArrayLike<number>, rate: number): number {
    if (target.length < this.size) throw new RangeError(`stepMagnitudes: need ${this.size} targets, got ${target.length}`);
    let sse = 0;
    for (let k = 0; k < this.size; k++) {
      const x = this.raw[k];
      const s = algSigmoid(x);
      const rho = this.rhoMax * Math.abs(s);
      const err = rho - target[k];
      sse += err * err;
      const sgn = s >= 0 ? 1 : -1;
      this.raw[k] = x - rate * err * this.rhoMax * sgn * algSigmoidPrime(x);
    }
    return Math.sqrt(sse / this.size);
  }

  /** Run `iters` deterministic steps; returns the final RMS magnitude error. */
  fitMagnitudes(target: ArrayLike<number>, rate = 1, iters = 512): number {
    let rms = Infinity;
    for (let i = 0; i < iters; i++) rms = this.stepMagnitudes(target, rate);
    return rms;
  }
}

/**
 * The Green's-function target for a diffusive field on a measured spectrum:
 * a mode with eigenvalue λ decays as e^{−λ Δt} over one tick. This is what
 * Path A should learn when the driving field really is diffusive, and Gate C
 * checks that it does.
 */
export function diffusionTarget(lambda: ArrayLike<number>, dt: number, out?: Float64Array): Float64Array {
  const o = out ?? new Float64Array(lambda.length);
  for (let k = 0; k < lambda.length; k++) o[k] = dexp(-lambda[k] * dt);
  return o;
}
