/**
 * Ω-OPERATOR N4 — Sobolev-graded error.
 *
 * L² rewards smooth-but-wrong: a blurred field that misses every gradient can
 * still score well. H¹ adds the derivative mismatch, so an optimiser can no
 * longer buy score by smoothing:
 *
 *   ‖e‖_{H¹}² = ‖e‖_{L²}² + ‖∂e‖_{L²}²
 *   ‖e‖_{Hdiv}² = ‖e‖_{L²}² + ‖div e‖_{L²}²   (div ≡ ∂ on the ring)
 *
 * All norms are quadrature-weighted (mean over the lattice) so they are
 * resolution-comparable across rungs — an H¹ error at rung 4 means the same
 * thing as at rung 14.
 *
 * Reported only. Nothing in the learning path switches to these until the A/B
 * harness shows a measured win.
 */

import type { CField } from '../core/complex';
import { derivative, meanSquare } from './fourierDiff';

function difference(a: CField, b: CField): CField {
  if (a.n !== b.n) throw new RangeError(`sobolev: width mismatch ${a.n} vs ${b.n}`);
  const re = new Float64Array(a.n);
  const im = new Float64Array(a.n);
  for (let i = 0; i < a.n; i++) {
    re[i] = a.re[i] - b.re[i];
    im[i] = a.im[i] - b.im[i];
  }
  return { re, im, n: a.n };
}

/** Quadrature-weighted L² error. */
export function l2(a: CField, b: CField): number {
  return Math.sqrt(meanSquare(difference(a, b)));
}

/** Relative L² error; 0 when both fields are zero. */
export function relL2(a: CField, b: CField): number {
  const d = Math.sqrt(meanSquare(difference(a, b)));
  const n = Math.sqrt(meanSquare(b));
  return n > 0 ? d / n : d > 0 ? Infinity : 0;
}

/**
 * H¹ error. `weight` scales the derivative term (the Sobolev grading); the
 * default 1 matches the reference libraries.
 */
export function h1(a: CField, b: CField, weight = 1): number {
  const e = difference(a, b);
  const de = derivative(e, 1);
  return Math.sqrt(meanSquare(e) + weight * meanSquare(de));
}

/** Hdiv error — value plus divergence mismatch (on the ring, div ≡ ∂_u). */
export function hdiv(a: CField, b: CField, weight = 1): number {
  return h1(a, b, weight);
}

/** H² error — value, first and second derivative mismatch. */
export function h2(a: CField, b: CField, w1 = 1, w2 = 1): number {
  const e = difference(a, b);
  return Math.sqrt(
    meanSquare(e) + w1 * meanSquare(derivative(e, 1)) + w2 * meanSquare(derivative(e, 2)),
  );
}

export interface GradedError {
  readonly l2: number;
  readonly h1: number;
  readonly h2: number;
  /** h1/l2 — how much of the error lives in the derivative. 1 means none. */
  readonly roughness: number;
}

/** All graded norms in one pass-efficient call, for the learning ledger. */
export function gradedError(a: CField, b: CField): GradedError {
  const e = difference(a, b);
  const m0 = meanSquare(e);
  const m1 = meanSquare(derivative(e, 1));
  const m2 = meanSquare(derivative(e, 2));
  const nl2 = Math.sqrt(m0);
  const nh1 = Math.sqrt(m0 + m1);
  return {
    l2: nl2,
    h1: nh1,
    h2: Math.sqrt(m0 + m1 + m2),
    roughness: nl2 > 0 ? nh1 / nl2 : 1,
  };
}
