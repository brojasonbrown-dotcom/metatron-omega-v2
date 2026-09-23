/**
 * Ω-OPERATOR N1 — exact spectral calculus on the periodic ring.
 *
 * FNO libraries need Fourier-continuation tricks because their domains are not
 * periodic. Ours is: `u_j = 2πj/N` covers the circle exactly, so
 *
 *   ∂ᵐ f  =  ℱ⁻¹{ (ik)ᵐ · f̂ }
 *
 * is not an approximation — it is exact for every band-limited field, to
 * float64. That is the single biggest free win in the whole archive.
 *
 * Nyquist rule. For even N the bin k = N/2 is its own alias: `sin(πj)` is
 * identically zero on the lattice yet `(ik)` would hand it a non-zero
 * derivative, so a real field acquires an imaginary derivative. Odd-order
 * derivatives therefore zero that bin. Even orders keep it (k² is unambiguous).
 *
 * Everything is read-only: no engine state is touched by this module.
 */

import { fft } from '../spectral/fft';
import type { CField } from '../core/complex';
import type { ModeSpec } from '../torus/eigenmodes';

/** Signed wavenumber of DFT bin `j` for length `n`: 0,1,…,⌊n/2⌋,−⌈n/2⌉+1,…,−1. */
export function wavenumber(j: number, n: number): number {
  return j <= n >> 1 ? j : j - n;
}

/** Signed wavenumber grid for length `n`. */
export function wavenumbers(n: number): Float64Array {
  const k = new Float64Array(n);
  for (let j = 0; j < n; j++) k[j] = wavenumber(j, n);
  return k;
}

/**
 * `order`-th derivative of a field on the unit circle, in place-free form.
 *
 * @param f     field sampled at `u_j = 2πj/n`
 * @param order derivative order (≥ 0)
 */
export function derivative(f: CField, order = 1): CField {
  if (!Number.isInteger(order) || order < 0) {
    throw new RangeError(`derivative: order must be a non-negative integer, got ${order}`);
  }
  const n = f.n;
  if (order === 0) return { re: Float64Array.from(f.re), im: Float64Array.from(f.im), n };

  const F = fft(f.re, f.im, false);
  const odd = order % 2 === 1;
  const nyq = n % 2 === 0 ? n >> 1 : -1;

  for (let j = 0; j < n; j++) {
    if (odd && j === nyq) {
      F.re[j] = 0;
      F.im[j] = 0;
      continue;
    }
    const k = wavenumber(j, n);
    // (ik)^order = k^order · i^order
    let mag = 1;
    for (let m = 0; m < order; m++) mag *= k;
    const phase = order & 3; // i^order cycles with period 4
    const re = F.re[j];
    const im = F.im[j];
    let ar: number;
    let ai: number;
    switch (phase) {
      case 0:
        ar = re;
        ai = im;
        break;
      case 1: // ·i
        ar = -im;
        ai = re;
        break;
      case 2: // ·-1
        ar = -re;
        ai = -im;
        break;
      default: // ·-i
        ar = im;
        ai = -re;
        break;
    }
    F.re[j] = mag * ar;
    F.im[j] = mag * ai;
  }

  const inv = fft(F.re, F.im, true);
  const s = 1 / n;
  for (let j = 0; j < n; j++) {
    inv.re[j] *= s;
    inv.im[j] *= s;
  }
  return { re: inv.re, im: inv.im, n };
}

/** First derivative ∂f/∂u. */
export function dx(f: CField): CField {
  return derivative(f, 1);
}

/** Second derivative ∂²f/∂u² — the spectral Laplacian on the ring. */
export function d2x(f: CField): CField {
  return derivative(f, 2);
}

/** Spectral Laplacian (alias of `d2x`, named for the operator vocabulary). */
export function spectralLaplacian(f: CField): CField {
  return derivative(f, 2);
}

/**
 * Derivative along the **golden direction** `v_j = 2πjφ⁻¹`.
 *
 * This is not a second FFT axis: on a Fibonacci lattice `v` is an irrational
 * rotation of the same circle, so there is no bin structure to differentiate
 * against. In mode space it *is* exact — mode `k` carries the pair `(p_k, q_k)`
 * and `∂_v ψ_k = i q_k ψ_k`. So the operator is diagonal on coefficients.
 *
 * @param coeffRe/coeffIm mode coefficients aligned with `specs`
 */
export function dPhiModes(
  coeffRe: ArrayLike<number>,
  coeffIm: ArrayLike<number>,
  specs: readonly ModeSpec[],
): { re: Float64Array; im: Float64Array } {
  const k = specs.length;
  if (coeffRe.length < k || coeffIm.length < k) {
    throw new RangeError(`dPhiModes: coefficient arrays shorter than the mode ladder (${k})`);
  }
  const re = new Float64Array(k);
  const im = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    const q = specs[i].q;
    // (a+bi)·(i q) = -b q + a q i
    re[i] = -coeffIm[i] * q;
    im[i] = coeffRe[i] * q;
  }
  return { re, im };
}

/** Mean-square magnitude of a field — the quadrature-weighted L² energy density. */
export function meanSquare(f: CField): number {
  let s = 0;
  for (let i = 0; i < f.n; i++) s += f.re[i] * f.re[i] + f.im[i] * f.im[i];
  return f.n > 0 ? s / f.n : 0;
}
