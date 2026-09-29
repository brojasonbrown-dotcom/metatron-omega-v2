/**
 * Toroidal lattices (BRAINMAP 2.2).
 *
 * Two lattices exist and both are kept:
 *  - GoldenRing  — the oracle/parity path: u_j = 2*pi*j/N with the golden angle
 *                  advancing v.
 *  - Fibonacci   — the corrected lattice (amendment A-04): u_j = 2*pi*j/N,
 *                  v_j = 2*pi*j*phi^-1. The printed phyllotactic law is
 *                  degenerate (v collapses onto u for Fibonacci N) and is NOT
 *                  implemented. [CORRECTED]
 *
 * N must be Fibonacci so the golden advance is equidistributed with the
 * best-possible (Hurwitz) discrepancy.
 */

import { PHI_INV } from '../core/constants';
import { isFibonacci } from '../core/fibonacci';

export type LatticeKind = 'golden-ring' | 'fibonacci';

export interface Lattice {
  readonly kind: LatticeKind;
  readonly n: number;
  /** Major angle per node, radians. */
  readonly u: Float64Array;
  /** Minor angle per node, radians. */
  readonly v: Float64Array;
}

const TWO_PI = 2 * Math.PI;

export function createLattice(n: number, kind: LatticeKind = 'fibonacci'): Lattice {
  if (n <= 0) throw new RangeError(`createLattice: n must be positive, got ${n}`);
  if (!isFibonacci(n))
    throw new RangeError(`createLattice: node count ${n} is not Fibonacci (Law 2.2)`);
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    u[j] = (TWO_PI * j) / n;
    // Both lattices advance v by the golden angle; the ring wraps modulo 2*pi
    // on an integer turn count, the fibonacci form keeps the raw phase so the
    // (p,q) mode ladder sees the full irrational rotation.
    const raw = TWO_PI * j * PHI_INV;
    v[j] = kind === 'golden-ring' ? raw % TWO_PI : raw;
  }
  return { kind, n, u, v };
}

/** Minimum angular separation — a discrepancy proxy used by the gate battery. */
export function minSeparation(l: Lattice): number {
  const xs = Array.from(l.v, (x) => ((x % TWO_PI) + TWO_PI) % TWO_PI).sort((a, b) => a - b);
  let m = TWO_PI;
  for (let i = 1; i < xs.length; i++) m = Math.min(m, xs[i] - xs[i - 1]);
  if (xs.length > 1) m = Math.min(m, TWO_PI - xs[xs.length - 1] + xs[0]);
  return m;
}
