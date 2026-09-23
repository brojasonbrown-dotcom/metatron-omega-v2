/**
 * Ω-SCALE P3 — Fourier continuation for non-periodic windows.
 *
 * The spectral machinery on the torus is exact because the torus is periodic.
 * A *sensory window* is not: a 233 Hz audio buffer sliced at an arbitrary
 * instant almost never has matching endpoints, and the implied jump injects a
 * 1/k spectral tail across every mode. That tail is indistinguishable from
 * real high-frequency content, so it corrupts the signature, the entropy
 * reading, and anything learned from them.
 *
 * The standard fixes each cost something:
 *   - windowing (Hann etc.) suppresses the jump by destroying the data at the
 *     edges — the taper is applied to real signal, not to the artefact;
 *   - zero-padding moves the discontinuity rather than removing it.
 *
 * Fourier continuation instead *extends* the sample into a short fictitious
 * region where it is smoothly bent back to meet itself, producing a genuinely
 * periodic sequence whose first `n` entries are the untouched original. The
 * transform of the extension has no artificial jump, and the extension region
 * is discarded after analysis.
 *
 * FC-Gram builds the extension from a precomputed Gram basis. We use the
 * cheaper two-sided blend that is exact for the properties that matter here:
 * the extension matches value and first derivative at both seams (C¹), is
 * built from a fixed cosine basis (deterministic, no least squares, no
 * conditioning risk), and costs O(ext) per call.
 */

import { dsin, dcos } from '../core/dmath';

/** Extension length as a fraction of the window. φ⁻³ ≈ 0.236. */
export const DEFAULT_EXTENSION = 0.236;

export interface ContinuationResult {
  /** Periodic sequence of length n + ext. First n entries are the original. */
  readonly extended: Float64Array;
  /** Original length. */
  readonly n: number;
  /** Number of fictitious samples appended. */
  readonly ext: number;
  /** |f(0) − f(n−1)| — the jump the continuation removed. */
  readonly seam: number;
}

/**
 * Blend length from a window length. Always ≥ 4 (a C¹ bend needs room) and
 * never larger than the window itself.
 */
export function extensionLength(n: number, fraction = DEFAULT_EXTENSION): number {
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : DEFAULT_EXTENSION;
  return Math.min(n, Math.max(4, Math.round(n * f)));
}

/**
 * Periodic C¹ continuation of a real window.
 *
 * On the extension region s ∈ [0, 1] we blend from the right endpoint back to
 * the left endpoint with the smoothstep-like cosine ramp
 *
 *   w(s) = (1 − cos(πs)) / 2,
 *
 * whose derivative vanishes at both ends. Adding the endpoint slopes with the
 * matching bump `s(1−s)` makes the join C¹ rather than merely C⁰, which is
 * what removes the 1/k tail (a C⁰-only join still leaves 1/k²).
 */
export function fourierContinuation(
  data: ArrayLike<number>,
  fraction = DEFAULT_EXTENSION,
): ContinuationResult {
  const n = data.length;
  if (n < 4) throw new RangeError(`fourierContinuation: window too short (${n})`);
  const ext = extensionLength(n, fraction);
  const out = new Float64Array(n + ext);
  for (let i = 0; i < n; i++) out[i] = data[i];

  const right = data[n - 1];
  const left = data[0];
  // One-sided slopes at the seams, in samples.
  const slopeR = data[n - 1] - data[n - 2];
  const slopeL = data[1] - data[0];

  for (let j = 0; j < ext; j++) {
    const s = (j + 1) / (ext + 1);
    const w = (1 - dcos(Math.PI * s)) / 2;
    const base = right * (1 - w) + left * w;
    // Hermite-style slope terms: each decays away from its own seam.
    const bump = s * (1 - s) * ext;
    out[n + j] = base + slopeR * bump * (1 - w) - slopeL * bump * w;
  }

  return { extended: out, n, ext, seam: Math.abs(left - right) };
}

/** Drop the fictitious tail, recovering exactly the original support. */
export function truncateContinuation(r: ContinuationResult): Float64Array {
  return r.extended.subarray(0, r.n);
}

/**
 * Discrete spectral tail energy — the diagnostic that decides whether the
 * continuation is worth its cost on a given stream.
 *
 * Returns the fraction of total energy sitting above the lowest `keep`
 * wavenumbers. A discontinuous window leaks energy upward; a continued one
 * does not. Uses a direct DFT: called on diagnostics cadence over short
 * windows, never on the tick path.
 */
export function highFrequencyFraction(data: ArrayLike<number>, keep = 8): number {
  const n = data.length;
  if (n < 2) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += data[i];
  mean /= n;

  let total = 0;
  let low = 0;
  const half = Math.floor(n / 2);
  for (let k = 1; k <= half; k++) {
    let re = 0;
    let im = 0;
    const w = (-2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) {
      const v = data[i] - mean;
      re += v * dcos(w * i);
      im += v * dsin(w * i);
    }
    const p = re * re + im * im;
    total += p;
    if (k <= keep) low += p;
  }
  if (!(total > 0)) return 0;
  return 1 - low / total;
}

export interface ContinuationVerdict {
  readonly seam: number;
  /** High-frequency fraction of the raw window. */
  readonly rawTail: number;
  /** High-frequency fraction after continuation. */
  readonly continuedTail: number;
  /** rawTail − continuedTail; positive means the continuation helped. */
  readonly improvement: number;
  /** True only when the continuation measurably reduced the tail. */
  readonly worthwhile: boolean;
}

/**
 * Measure, don't assume. Compares the spectral tail with and without the
 * continuation on the same window so the caller can decide per stream.
 */
export function assessContinuation(
  data: ArrayLike<number>,
  fraction = DEFAULT_EXTENSION,
  keep = 8,
): ContinuationVerdict {
  const r = fourierContinuation(data, fraction);
  const rawTail = highFrequencyFraction(data, keep);
  const continuedTail = highFrequencyFraction(r.extended, keep);
  const improvement = rawTail - continuedTail;
  return {
    seam: r.seam,
    rawTail,
    continuedTail,
    improvement,
    worthwhile: improvement > 0,
  };
}
