/**
 * Ω-SHFN Section B — the O(K log K) transform path.
 *
 * The certified analysis path is a dense projection: one `inner()` per mode,
 * O(N·K). That is the asymptotic wall the blueprint calls out.
 *
 * The plan asked for a mixed-radix (2/3/5) Stockham FFT with a dense fallback.
 * That would have helped almost nowhere here: this machine's rung sizes are
 * *Fibonacci*, and Fibonacci numbers are mostly prime or near-prime
 * (233 prime, 1597 prime, 610 = 2·5·61, 4181 = 37·113). A radix-2/3/5 kernel
 * would fall back to the dense path on the rungs that matter most.
 *
 * So this implements the strictly stronger thing: a radix-2 Stockham core plus
 * **Bluestein's chirp-z** wrapper, which gives O(N log N) for *every* N,
 * primes included. No rung falls back.
 *
 * Determinism.
 *  - Every twiddle comes from `dcos`/`dsin` (the deterministic bank), never
 *    `Math.cos`, and is evaluated at an angle reduced by exact integer
 *    arithmetic before any float division — so the same index gives the same
 *    bits on every engine.
 *  - Butterfly order is fixed and single-threaded; there is no reduction whose
 *    order could vary.
 *  - `dft()` is kept as the dense reference and the parity test compares the
 *    two at 1e-13 relative on every rung size.
 */

import { dcos, dsin } from '../core/dmath';

/** Split-complex buffer pair; both arrays have the same length. */
export interface Split {
  readonly re: Float64Array;
  readonly im: Float64Array;
}

const TWO_PI = 2 * Math.PI;

/** Dense DFT — O(N²). The reference the fast path must reproduce. */
export function dft(re: Float64Array, im: Float64Array, inverse = false): Split {
  const n = re.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  const sign = inverse ? 1 : -1;
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let j = 0; j < n; j++) {
      // (k*j) mod n keeps the angle in [0, 2π) with exact integer reduction.
      const idx = (k * j) % n;
      const ang = (sign * TWO_PI * idx) / n;
      const c = dcos(ang);
      const s = dsin(ang);
      sr += re[j] * c - im[j] * s;
      si += re[j] * s + im[j] * c;
    }
    outRe[k] = sr;
    outIm[k] = si;
  }
  return { re: outRe, im: outIm };
}

function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** In-place iterative radix-2 FFT (Cooley–Tukey, decimation in time). */
function fftPow2(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  if (n <= 1) return;
  // bit reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const ang = (sign * TWO_PI * k) / len;
        const wr = dcos(ang);
        const wi = dsin(ang);
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + half] * wr - im[i + k + half] * wi;
        const vi = re[i + k + half] * wi + im[i + k + half] * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + half] = ur - vr;
        im[i + k + half] = ui - vi;
      }
    }
  }
}

/**
 * Bluestein chirp for length n: angle_j = ±π j² / n, with j² reduced modulo 2n
 * in integers first so the float argument never grows and the value is exact
 * to the same bits on every engine.
 */
function chirp(n: number, j: number, sign: number): { c: number; s: number } {
  const m = (j * j) % (2 * n);
  const ang = (sign * Math.PI * m) / n;
  return { c: dcos(ang), s: dsin(ang) };
}

/**
 * Forward (or inverse) DFT of arbitrary length in O(n log n).
 * Unnormalised, matching `dft()` exactly: the inverse carries no 1/n.
 */
export function fft(reIn: Float64Array, imIn: Float64Array, inverse = false): Split {
  const n = reIn.length;
  if (imIn.length !== n) throw new RangeError(`fft: re/im length mismatch ${n} vs ${imIn.length}`);
  if (n <= 1) return { re: Float64Array.from(reIn), im: Float64Array.from(imIn) };

  if (isPow2(n)) {
    const re = Float64Array.from(reIn);
    const im = Float64Array.from(imIn);
    fftPow2(re, im, inverse);
    return { re, im };
  }

  const sign = inverse ? 1 : -1;
  let m = 1;
  while (m < 2 * n - 1) m <<= 1;

  const ar = new Float64Array(m);
  const ai = new Float64Array(m);
  const br = new Float64Array(m);
  const bi = new Float64Array(m);

  for (let j = 0; j < n; j++) {
    const w = chirp(n, j, sign); // e^{sign·iπj²/n}
    ar[j] = reIn[j] * w.c - imIn[j] * w.s;
    ai[j] = reIn[j] * w.s + imIn[j] * w.c;
    // b is the conjugate chirp, symmetric about 0 and wrapped into m.
    br[j] = w.c;
    bi[j] = -w.s;
    if (j > 0) {
      br[m - j] = w.c;
      bi[m - j] = -w.s;
    }
  }

  fftPow2(ar, ai, false);
  fftPow2(br, bi, false);
  for (let i = 0; i < m; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    const s = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
    ai[i] = s;
  }
  fftPow2(ar, ai, true);

  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const w = chirp(n, k, sign);
    // undo the m-point inverse scaling (fftPow2 inverse is unnormalised)
    const cr = ar[k] / m;
    const ci = ai[k] / m;
    outRe[k] = cr * w.c - ci * w.s;
    outIm[k] = cr * w.s + ci * w.c;
  }
  return { re: outRe, im: outIm };
}

/** Unitary forward transform: 1/√n on both directions, so it is its own adjoint. */
export function fftUnitary(re: Float64Array, im: Float64Array, inverse = false): Split {
  const out = fft(re, im, inverse);
  const k = 1 / Math.sqrt(re.length || 1);
  for (let i = 0; i < out.re.length; i++) {
    out.re[i] *= k;
    out.im[i] *= k;
  }
  return out;
}

/** Circular cross-correlation ℱ⁻¹{ℱ(a)·conj(ℱ(b))} — the Section E primitive. */
export function crossCorrelate(a: Split, b: Split): Split {
  const n = a.re.length;
  if (b.re.length !== n)
    throw new RangeError(`crossCorrelate: length mismatch ${n} vs ${b.re.length}`);
  const fa = fft(a.re, a.im, false);
  const fb = fft(b.re, b.im, false);
  const pr = new Float64Array(n);
  const pi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // fa · conj(fb)
    pr[i] = fa.re[i] * fb.re[i] + fa.im[i] * fb.im[i];
    pi[i] = fa.im[i] * fb.re[i] - fa.re[i] * fb.im[i];
  }
  const out = fft(pr, pi, true);
  for (let i = 0; i < n; i++) {
    out.re[i] /= n;
    out.im[i] /= n;
  }
  return out;
}
