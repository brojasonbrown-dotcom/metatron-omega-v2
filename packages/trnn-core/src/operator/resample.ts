/**
 * Ω-OPERATOR N3 — discretisation invariance.
 *
 * A field is a function, not a sample vector. Spectral zero-pad / truncate maps
 * between rung widths with **no interpolation error** for band-limited content:
 * the coefficients are literally the same numbers, just carried on a longer or
 * shorter grid.
 *
 * The transform used is the unitary one, so Parseval holds in both directions
 * and up→down is an exact identity whenever nothing was truncated. Because
 * `spectral/fft.ts` runs Bluestein for arbitrary length, 13 ↔ 233 ↔ 1597 are all
 * first-class — no Fibonacci rung falls back to a dense path.
 *
 * This is the missing primitive for genuine fractal nesting: a field learned at
 * rung 4 can be evaluated at rung 14 without resampling loss, and rungs become
 * views of one spectral object rather than independent arrays.
 */

import { fftUnitary } from '../spectral/fft';
import type { CField } from '../core/complex';
import { wavenumber } from './fourierDiff';

/** Highest signed wavenumber safely representable at length `n` (Nyquist excluded). */
export function bandLimit(n: number): number {
  return Math.max(0, (n - 1) >> 1);
}

/**
 * Resample a ring field from its own width to `m` nodes.
 *
 * Modes with |k| above the smaller grid's band limit are dropped (down) or left
 * zero (up). Amplitudes are rescaled by √(m/n) so that the *field values* — not
 * merely the coefficients — are preserved: a constant stays the same constant,
 * and a pure mode keeps its amplitude.
 */
export function resample(f: CField, m: number): CField {
  if (!Number.isInteger(m) || m <= 0) throw new RangeError(`resample: target width must be a positive integer, got ${m}`);
  const n = f.n;
  if (m === n) return { re: Float64Array.from(f.re), im: Float64Array.from(f.im), n };

  const F = fftUnitary(f.re, f.im, false);
  const kmax = Math.min(bandLimit(n), bandLimit(m));
  const gre = new Float64Array(m);
  const gim = new Float64Array(m);
  const s = Math.sqrt(m / n);

  for (let j = 0; j < n; j++) {
    const k = wavenumber(j, n);
    if (Math.abs(k) > kmax) continue;
    const t = k >= 0 ? k : m + k;
    gre[t] = F.re[j] * s;
    gim[t] = F.im[j] * s;
  }

  const out = fftUnitary(gre, gim, true);
  return { re: out.re, im: out.im, n: m };
}

/** Spectral energy Σ|f̂_k|² of a field (unitary convention). */
export function spectralEnergy(f: CField): number {
  const F = fftUnitary(f.re, f.im, false);
  let s = 0;
  for (let i = 0; i < F.re.length; i++) s += F.re[i] * F.re[i] + F.im[i] * F.im[i];
  return s;
}

/**
 * Project a field onto the band representable at width `m`, without changing
 * its own width. Used to make an A/B comparison fair when the two paths carry
 * different resolutions.
 */
export function bandProject(f: CField, m: number): CField {
  return resample(resample(f, m), f.n);
}
