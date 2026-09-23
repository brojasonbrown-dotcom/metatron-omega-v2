/**
 * O-P2 — radial spectral plane: spherical Bessel functions j_l on the golden
 * radial ladder.
 *
 * Basis functions:  R_{l,i}(r) = j_l(pi * phi^i * r),  r in [0,1], i = 0..I-1.
 * The ladder of radial wavenumbers is geometric in phi, matching the scale
 * ladder rather than an arbitrary linear grid.
 *
 * j_l is evaluated by:
 *   - the small-argument power series when x < l/2 + 1 (upward recurrence is
 *     catastrophically cancelling there),
 *   - upward recurrence from j_0 = sin x / x, j_1 = sin x / x^2 - cos x / x
 *     otherwise, which is stable for x >~ l.
 *
 * Radial quadrature is the midpoint rule with weight r^2 dr (the spherical
 * Jacobian). As on the shell, the sampled basis is CGS2-orthonormalized under
 * that quadrature so analysis is the exact adjoint of synthesis, and the raw
 * Gram defect is reported rather than swallowed.
 */

import { PHI } from '../core/constants';
import { dcos, dpow, dsin } from '../core/dmath';

export interface RadialGrid {
  readonly n: number;
  /** Node radii in (0,1). */
  readonly r: Float64Array;
  /** Quadrature weights r^2 dr. */
  readonly w: Float64Array;
}

export interface RadialBasis {
  readonly grid: RadialGrid;
  readonly l: number;
  /** phi-ladder index per basis function. */
  readonly rungs: readonly number[];
  readonly vectors: readonly Float64Array[];
  readonly gramDefect: number;
}

/** Midpoint grid on (0,1) with the spherical volume weight. */
export function radialGrid(n: number): RadialGrid {
  if (n <= 0 || !Number.isInteger(n)) throw new RangeError(`radialGrid: n must be a positive integer, got ${n}`);
  const r = new Float64Array(n);
  const w = new Float64Array(n);
  const dr = 1 / n;
  for (let i = 0; i < n; i++) {
    const ri = (i + 0.5) * dr;
    r[i] = ri;
    w[i] = ri * ri * dr;
  }
  return { n, r, w };
}

/** Spherical Bessel function of the first kind, j_l(x), l >= 0. */
export function sphericalBesselJ(l: number, x: number): number {
  if (l < 0 || !Number.isInteger(l)) throw new RangeError(`sphericalBesselJ: l must be a non-negative integer, got ${l}`);
  if (x === 0) return l === 0 ? 1 : 0;
  const ax = Math.abs(x);
  if (ax < l / 2 + 1) return besselSeries(l, x);
  let jm1 = dcos(x) / x; // j_{-1}
  let j0 = dsin(x) / x;
  if (l === 0) return j0;
  for (let k = 0; k < l; k++) {
    const next = ((2 * k + 1) / x) * j0 - jm1;
    jm1 = j0;
    j0 = next;
  }
  return j0;
}

/** j_l(x) = x^l / (2l+1)!! * sum_k (-x^2/2)^k / (k! * (2l+3)(2l+5)...(2l+2k+1)) */
function besselSeries(l: number, x: number): number {
  let dfact = 1; // (2l+1)!!
  for (let k = 3; k <= 2 * l + 1; k += 2) dfact *= k;
  const pref = dpow(x, l) / dfact;
  const h = (-x * x) / 2;
  let term = 1;
  let sum = 1;
  for (let k = 1; k < 60; k++) {
    term *= h / (k * (2 * l + 2 * k + 1));
    sum += term;
    if (Math.abs(term) < 1e-18 * Math.abs(sum)) break;
  }
  return pref * sum;
}

function quadInner(w: Float64Array, a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += w[i] * a[i] * b[i];
  return s;
}

/**
 * Midpoint count a grid needs to resolve the top wavenumber of a φ ladder that
 * starts at `offset` and runs `count` orders.
 *
 * The top basis function is j_l(pi * phi^(offset+count-1) * r), whose shortest
 * half-period is 1 / phi^(offset+count-1). Two midpoints per half-period is the
 * Nyquist floor, so the grid needs at least 2 * phi^(offset+count-1) points.
 * Below that the sampled ladder aliases: CGS2 drops the aliased duplicates and
 * the basis silently empties out.
 */
export function radialGridSize(count: number, offset = 0): number {
  if (count <= 0 || !Number.isInteger(count)) throw new RangeError(`radialGridSize: count must be a positive integer, got ${count}`);
  if (offset < 0 || !Number.isInteger(offset)) throw new RangeError(`radialGridSize: offset must be a non-negative integer, got ${offset}`);
  return Math.max(count, Math.ceil(2 * dpow(PHI, offset + count - 1)));
}

/**
 * Number of distinct φ-ladder offsets that stay resolvable under `gridCap`
 * midpoints. Rung ladder indices are folded into [0, window) so every rung gets
 * a real, fully-ranked basis instead of an aliased or empty one.
 */
export function radialLadderWindow(count: number, gridCap = 233): number {
  let w = 0;
  while (radialGridSize(count, w) <= gridCap) w++;
  return Math.max(1, w);
}

/** Build the orthonormal radial basis for degree `l` over `count` phi rungs. */
export function buildRadialBasis(grid: RadialGrid, l = 0, count = 8, rung0 = 0): RadialBasis {
  const rungs: number[] = [];
  const raw: Float64Array[] = [];
  for (let i = 0; i < count; i++) {
    const rung = rung0 + i;
    const kappa = Math.PI * dpow(PHI, rung);
    const v = new Float64Array(grid.n);
    for (let j = 0; j < grid.n; j++) v[j] = sphericalBesselJ(l, kappa * grid.r[j]);
    rungs.push(rung);
    raw.push(v);
  }

  let defect = 0;
  for (let a = 0; a < raw.length; a++) {
    const na = Math.sqrt(quadInner(grid.w, raw[a], raw[a]));
    for (let b = 0; b < raw.length; b++) {
      const nb = Math.sqrt(quadInner(grid.w, raw[b], raw[b]));
      if (na === 0 || nb === 0) continue;
      const g = quadInner(grid.w, raw[a], raw[b]) / (na * nb);
      defect = Math.max(defect, Math.abs(g - (a === b ? 1 : 0)));
    }
  }

  const basis: Float64Array[] = [];
  const kept: number[] = [];
  for (let k = 0; k < raw.length; k++) {
    const v = Float64Array.from(raw[k]);
    for (let pass = 0; pass < 2; pass++) {
      for (const b of basis) {
        const c = quadInner(grid.w, b, v);
        for (let i = 0; i < v.length; i++) v[i] -= c * b[i];
      }
    }
    const nrm = Math.sqrt(quadInner(grid.w, v, v));
    if (!(nrm > 1e-10)) continue;
    for (let i = 0; i < v.length; i++) v[i] /= nrm;
    basis.push(v);
    kept.push(rungs[k]);
  }
  return { grid, l, rungs: kept, vectors: basis, gramDefect: defect };
}

export function radialAnalyze(basis: RadialBasis, f: Float64Array, out: Float64Array): Float64Array {
  for (let k = 0; k < basis.vectors.length; k++) out[k] = quadInner(basis.grid.w, basis.vectors[k], f);
  return out;
}

export function radialSynthesize(basis: RadialBasis, coeffs: Float64Array, out: Float64Array): Float64Array {
  out.fill(0);
  for (let k = 0; k < basis.vectors.length; k++) {
    const c = coeffs[k];
    if (c === 0) continue;
    const b = basis.vectors[k];
    for (let i = 0; i < out.length; i++) out[i] += c * b[i];
  }
  return out;
}
