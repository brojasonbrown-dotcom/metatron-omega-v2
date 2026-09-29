/**
 * O-P2 — spherical shell: Fibonacci (golden-spiral) sampling + a real
 * spherical-harmonic transform (SHT).
 *
 * Sampling (BRAINMAP 2.3): N points placed by the golden spiral,
 *   z_j = 1 - (2j+1)/N,  phi_j = 2*pi*j*phi^-1,
 * which is the lowest-discrepancy deterministic shell available without a
 * quadrature table. Every point carries the same solid-angle weight 4*pi/N.
 *
 * The sampled harmonics Y_l^m are NOT exactly orthonormal on a finite shell —
 * the quadrature has a residual. Rather than pretend otherwise, the basis is
 * CGS2-orthonormalized under the quadrature inner product, so analysis is the
 * exact adjoint of synthesis and the roundtrip closes to machine precision
 * (Gate G2: < 1e-12). The pre-orthonormalization Gram defect is reported by
 * `gramDefect` so the approximation is measured, never hidden.
 */

import { PHI_INV } from '../core/constants';
import { dacos, dcos, dsin } from '../core/dmath';

export interface Shell {
  readonly n: number;
  /** Polar angle per point, radians (0..pi). */
  readonly theta: Float64Array;
  /** Azimuth per point, radians. */
  readonly phi: Float64Array;
  /** Cartesian coordinates on the unit sphere. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  /** Quadrature weight per point (uniform: 4*pi/N). */
  readonly w: Float64Array;
}

export interface HarmonicSpec {
  readonly l: number;
  readonly m: number;
}

export interface SphericalBasis {
  readonly shell: Shell;
  readonly specs: readonly HarmonicSpec[];
  /** Orthonormal (under the shell quadrature) real basis vectors. */
  readonly vectors: readonly Float64Array[];
  /** max_{a!=b} |<a|b>| of the RAW sampled harmonics — the honest quadrature defect. */
  readonly gramDefect: number;
}

const TWO_PI = 2 * Math.PI;

/** Golden-spiral shell of `n` points with uniform solid-angle weights. */
export function fibonacciShell(n: number): Shell {
  if (n <= 0 || !Number.isInteger(n))
    throw new RangeError(`fibonacciShell: n must be a positive integer, got ${n}`);
  const theta = new Float64Array(n);
  const phi = new Float64Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const w = new Float64Array(n);
  const wj = (4 * Math.PI) / n;
  for (let j = 0; j < n; j++) {
    const zc = 1 - (2 * j + 1) / n;
    const r = Math.sqrt(Math.max(0, 1 - zc * zc));
    const az = (TWO_PI * j * PHI_INV) % TWO_PI;
    theta[j] = dacos(Math.min(1, Math.max(-1, zc)));
    phi[j] = az;
    x[j] = r * dcos(az);
    y[j] = r * dsin(az);
    z[j] = zc;
    w[j] = wj;
  }
  return { n, theta, phi, x, y, z, w };
}

/**
 * Associated Legendre P_l^m(x) with the Condon-Shortley phase, via the stable
 * three-term recurrence seeded at P_m^m. m >= 0.
 */
export function legendreP(l: number, m: number, xv: number): number {
  if (m < 0 || m > l) throw new RangeError(`legendreP: require 0 <= m <= l, got l=${l} m=${m}`);
  let pmm = 1;
  if (m > 0) {
    const somx2 = Math.sqrt(Math.max(0, (1 - xv) * (1 + xv)));
    let fact = 1;
    for (let i = 1; i <= m; i++) {
      pmm *= -fact * somx2;
      fact += 2;
    }
  }
  if (l === m) return pmm;
  let pmmp1 = xv * (2 * m + 1) * pmm;
  if (l === m + 1) return pmmp1;
  let pll = 0;
  for (let ll = m + 2; ll <= l; ll++) {
    pll = (xv * (2 * ll - 1) * pmmp1 - (ll + m - 1) * pmm) / (ll - m);
    pmm = pmmp1;
    pmmp1 = pll;
  }
  return pll;
}

/** log(n!) by exact product for the small l used here (no lgamma drift). */
function factorialRatio(lminus: number, lplus: number): number {
  // (l-|m|)! / (l+|m|)! computed as a product of reciprocals — exact for small l.
  let r = 1;
  for (let k = lminus + 1; k <= lplus; k++) r /= k;
  return r;
}

/** Real orthonormal spherical harmonic Y_l^m(theta, phi). */
export function realSH(l: number, m: number, theta: number, phi: number): number {
  const am = Math.abs(m);
  const norm = Math.sqrt(((2 * l + 1) / (4 * Math.PI)) * factorialRatio(l - am, l + am));
  const p = legendreP(l, am, dcos(theta));
  if (m === 0) return norm * p;
  const s = Math.SQRT2 * norm * p;
  return m > 0 ? s * dcos(am * phi) : s * dsin(am * phi);
}

/** All (l,m) with l <= lmax, in the canonical order l ascending, m = -l..l. */
export function harmonicLadder(lmax: number): HarmonicSpec[] {
  const out: HarmonicSpec[] = [];
  for (let l = 0; l <= lmax; l++) for (let m = -l; m <= l; m++) out.push({ l, m });
  return out;
}

function quadInner(w: Float64Array, a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += w[i] * a[i] * b[i];
  return s;
}

/**
 * Build the CGS2-orthonormal real SH basis on a shell.
 * `lmax` defaults to 3 (16 harmonics), the width the transcription plane reads.
 */
export function buildSphericalBasis(shell: Shell, lmax = 3): SphericalBasis {
  const specs = harmonicLadder(lmax);
  const raw = specs.map((s) => {
    const v = new Float64Array(shell.n);
    for (let j = 0; j < shell.n; j++) v[j] = realSH(s.l, s.m, shell.theta[j], shell.phi[j]);
    return v;
  });

  // Honest measurement of the sampling defect BEFORE any repair.
  let defect = 0;
  for (let a = 0; a < raw.length; a++) {
    for (let b = 0; b < raw.length; b++) {
      const g = quadInner(shell.w, raw[a], raw[b]);
      const target = a === b ? 1 : 0;
      defect = Math.max(defect, Math.abs(g - target));
    }
  }

  const basis: Float64Array[] = [];
  const kept: HarmonicSpec[] = [];
  for (let k = 0; k < raw.length; k++) {
    const v = Float64Array.from(raw[k]);
    for (let pass = 0; pass < 2; pass++) {
      for (const b of basis) {
        const c = quadInner(shell.w, b, v);
        for (let i = 0; i < v.length; i++) v[i] -= c * b[i];
      }
    }
    const nrm = Math.sqrt(quadInner(shell.w, v, v));
    if (!(nrm > 1e-10)) continue; // degenerate on this shell — dropped, never faked
    for (let i = 0; i < v.length; i++) v[i] /= nrm;
    basis.push(v);
    kept.push(specs[k]);
  }
  return { shell, specs: kept, vectors: basis, gramDefect: defect };
}

/** c_k = <b_k | f> under the shell quadrature. */
export function shtAnalyze(
  basis: SphericalBasis,
  f: Float64Array,
  out: Float64Array,
): Float64Array {
  for (let k = 0; k < basis.vectors.length; k++)
    out[k] = quadInner(basis.shell.w, basis.vectors[k], f);
  return out;
}

/** f = sum_k c_k b_k. */
export function shtSynthesize(
  basis: SphericalBasis,
  coeffs: Float64Array,
  out: Float64Array,
): Float64Array {
  out.fill(0);
  for (let k = 0; k < basis.vectors.length; k++) {
    const c = coeffs[k];
    if (c === 0) continue;
    const b = basis.vectors[k];
    for (let i = 0; i < out.length; i++) out[i] += c * b[i];
  }
  return out;
}

/** Per-degree angular power sum_m c_{lm}^2 (rotation-invariant). */
export function angularPower(
  basis: SphericalBasis,
  coeffs: Float64Array,
  lmax: number,
): Float64Array {
  const out = new Float64Array(lmax + 1);
  for (let k = 0; k < basis.specs.length; k++) {
    const l = basis.specs[k].l;
    if (l <= lmax) out[l] += coeffs[k] * coeffs[k];
  }
  return out;
}
