/**
 * φ-conjugate dual pass — principle ③ "pair every forward pass with its
 * φ-conjugate".
 *
 * The inward spiral is not decoration: running the same operator on the
 * mirrored, φ⁻¹-weighted sample gives a free bias / cancellation check.
 *
 *   forward   x[i]
 *   conjugate x̃[i] = φ⁻¹ · x[N−1−i]
 *
 * Mirrored variances give the bias witness; the forward+conjugate mean
 * annihilates odd harmonic content, and what survives is the conjugate
 * residual.
 *
 * Pure, in-place into caller-owned buffers, no allocation on the hot path.
 */

import { PHI_INV } from '@metatron/field-kernel-core';

interface NAcc {
  s: number;
  c: number;
}
function nAcc(): NAcc {
  return { s: 0, c: 0 };
}
function nAdd(a: NAcc, x: number): void {
  if (!Number.isFinite(x)) return;
  const s = a.s;
  const t = s + x;
  a.c += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s;
  a.s = t;
}
function nVal(a: NAcc): number {
  return a.s + a.c;
}

/** Write the φ-conjugate (inward spiral) of `src` into `dst`. */
export function conjugateInto(src: Float64Array, dst: Float64Array): void {
  const n = Math.min(src.length, dst.length);
  for (let i = 0; i < n; i++) dst[i] = PHI_INV * src[n - 1 - i];
  for (let i = n; i < dst.length; i++) dst[i] = 0;
}

export function variance(x: Float64Array): number {
  const n = x.length;
  if (n === 0) return NaN;
  const m = nAcc();
  for (let i = 0; i < n; i++) nAdd(m, x[i]);
  const mean = nVal(m) / n;
  const v = nAcc();
  for (let i = 0; i < n; i++) {
    const d = x[i] - mean;
    nAdd(v, d * d);
  }
  return nVal(v) / n;
}

export interface ConjugateWitness {
  readonly varForward: number;
  readonly varConjugate: number;
  /** (varF − varC) / (varF + varC) ∈ [−1,1]. 0 = unbiased. */
  readonly biasWitness: number;
  /** ‖(x + x̃)/2‖ / ‖x‖ — surviving even content after cancellation. */
  readonly conjugateResidual: number;
  /** Fraction of energy annihilated by the mirror = 1 − residual. */
  readonly cancellation: number;
}

export function conjugateWitness(forward: Float64Array, conj: Float64Array): ConjugateWitness {
  const vf = variance(forward);
  const vc = variance(conj);
  const sum = vf + vc;

  const n = Math.min(forward.length, conj.length);
  const acc = nAcc();
  const base = nAcc();
  for (let i = 0; i < n; i++) {
    const mid = 0.5 * (forward[i] + conj[i]);
    nAdd(acc, mid * mid);
    nAdd(base, forward[i] * forward[i]);
  }
  const b = nVal(base);
  const residual = b > 0 ? Math.sqrt(nVal(acc) / b) : NaN;

  return {
    varForward: vf,
    varConjugate: vc,
    biasWitness: Number.isFinite(sum) && sum > 0 ? (vf - vc) / sum : NaN,
    conjugateResidual: residual,
    cancellation: Number.isFinite(residual) ? 1 - Math.min(1, residual) : NaN,
  };
}
