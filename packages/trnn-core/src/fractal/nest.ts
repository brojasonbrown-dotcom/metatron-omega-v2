/**
 * Ω-DEPTH Section 2 — demand-driven fractal nesting.
 *
 * A *child* is a small certified lattice instantiated at one parent node's
 * site. It resolves the band the parent cannot express. Two maps connect them:
 *
 *   restrict :  parent patch  → child coefficients   (orthonormal analysis)
 *   prolong  :  child state   → parent patch, × μ    (adjoint, gain-scaled)
 *
 * Both maps are orthonormal projections, so the child's contribution obeys
 *   ‖prolong(child)‖ ≤ μ · ‖patch‖
 * — a *provable* ISS bound, and μ = 0 collapses the whole feature to the
 * current bit-exact behaviour.
 *
 * Pure module: no engine, no UI, no globals, zero per-tick allocation.
 */

import { createField, energy, type CField } from '../core/complex';
import { createLattice } from '../torus/lattice';
import { buildBasis, analyze, synthesize, type ModeBasis } from '../torus/superposition';
import { PHI_INV } from '../core/constants';

/** Node counts a child may take — Fibonacci, certified rungs. */
export const CHILD_SIZES = [89, 233] as const;
export type ChildSize = (typeof CHILD_SIZES)[number];

/**
 * Maximum nesting depth. Beyond 3 a child's resolved band no longer overlaps
 * its parent's, so a fourth level resolves nothing the ladder does not already
 * carry at another rung.
 */
export const MAX_DEPTH = 3;

export interface ChildField {
  /** Parent node index this child is anchored at. */
  site: number;
  /** 1 = child, 2 = grandchild, 3 = great-grandchild. */
  readonly depth: number;
  readonly size: ChildSize;
  readonly basis: ModeBasis;
  /** Child state in the spatial domain. */
  readonly state: CField;
  /** Scratch coefficient buffer (2·K, re/im interleaved). */
  readonly coeffs: Float64Array;
  /** Scratch spatial buffer for prolongation. */
  readonly work: CField;
  /** Energy this child explained on its last step. */
  explained: number;
  /** Monotone use counter for φ-scaled LRU. */
  lastUsed: number;
}

/** Step rate factor for a given depth: children run at φ⁻ᵈ of the parent. */
export function depthRate(depth: number): number {
  let r = 1;
  for (let d = 0; d < depth; d++) r *= PHI_INV;
  return r;
}

/**
 * Total tick cost multiplier at full occupancy across all allowed depths:
 * Σ_{d=0..MAX_DEPTH} φ⁻ᵈ — bounded below 2.62.
 */
export function costMultiplier(maxDepth = MAX_DEPTH): number {
  let s = 0;
  for (let d = 0; d <= maxDepth; d++) s += depthRate(d);
  return s;
}

export function createChildField(size: ChildSize, depth: number, site = -1): ChildField {
  if (depth < 1 || depth > MAX_DEPTH) {
    throw new RangeError(`createChildField: depth ${depth} outside 1..${MAX_DEPTH}`);
  }
  const lattice = createLattice(size, 'fibonacci');
  const basis = buildBasis(lattice);
  return {
    site,
    depth,
    size,
    basis,
    state: createField(size),
    coeffs: new Float64Array(2 * basis.vectors.length),
    work: createField(size),
    explained: 0,
    lastUsed: 0,
  };
}

/**
 * Energy in `psi` that the given basis cannot express:
 *   residual = ‖ψ‖² − ‖P ψ‖²   (≥ 0 up to rounding)
 * This is the honest "this site holds detail my resolution cannot carry"
 * signal that gates child allocation.
 */
export function residualEnergy(
  psi: CField,
  basis: ModeBasis,
  coeffs: Float64Array,
  work: CField,
): number {
  analyze(basis, psi, coeffs);
  synthesize(basis, coeffs, work);
  const r = energy(psi) - energy(work);
  return r > 0 ? r : 0;
}

/**
 * Restriction: write the parent patch into the child's state through the
 * child's orthonormal basis. Allocation-free.
 */
export function restrict(child: ChildField, patch: CField): void {
  const n = Math.min(child.state.n, patch.n);
  for (let i = 0; i < n; i++) {
    child.state.re[i] = patch.re[i];
    child.state.im[i] = patch.im[i];
  }
  for (let i = n; i < child.state.n; i++) {
    child.state.re[i] = 0;
    child.state.im[i] = 0;
  }
  analyze(child.basis, child.state, child.coeffs);
  synthesize(child.basis, child.coeffs, child.state);
}

/**
 * Prolongation: add μ · (child state) back into the parent patch.
 * Returns the ℓ² norm of the contribution actually added — the number the ISS
 * ledger records. μ = 0 leaves `patch` bit-identical.
 */
export function prolong(child: ChildField, patch: CField, mu: number): number {
  if (!(mu > 0)) return 0;
  const n = Math.min(child.state.n, patch.n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const dr = mu * child.state.re[i];
    const di = mu * child.state.im[i];
    patch.re[i] += dr;
    patch.im[i] += di;
    s += dr * dr + di * di;
  }
  return Math.sqrt(s);
}

/**
 * Selection rule: a site qualifies for a child when its residual exceeds the
 * rung median by φ² and has done so for a sustained Fibonacci window.
 * `sustained` counts consecutive qualifying ticks, maintained by the caller.
 */
export const RESIDUAL_FACTOR = 1 / (PHI_INV * PHI_INV); // φ²
export const SUSTAIN_TICKS = 89;

export function medianOf(values: Float64Array | number[]): number {
  const xs = Array.from(values).sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

export function qualifies(residual: number, median: number, sustained: number): boolean {
  return residual > median * RESIDUAL_FACTOR && sustained >= SUSTAIN_TICKS;
}
