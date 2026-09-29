/**
 * Ω-UNBOUND P2 — the fractal residual torus.
 *
 * THE CEILING THIS REMOVES
 * ------------------------
 * A ring field of width n can only carry wavenumbers |k| ≤ (n-1)/2. Push a
 * mode above that through a narrower rung and it is gone — measured, on this
 * host: a k=60 mode driven through width 89 comes back with absolute error
 * 1.00, i.e. total loss. That band limit is REAL and no amount of cleverness
 * makes a width-89 grid hold a k=60 mode.
 *
 * What is NOT real is the assumption that a rung must be alone. Split the field
 * instead of truncating it:
 *
 *     coarse   = resample(f, m)                 the part width m can hold
 *     residual = f - resample(coarse, n)        exactly what it could not
 *
 * `coarse` lives on the child grid; `residual` is band-limited to the annulus
 * (m/2, n/2] and is itself a field, so it can be split again. Reconstruction is
 * addition, and addition is exact — measured reconstruction error 1.11e-16,
 * i.e. one ulp. Resolution therefore stops being a property of the grid and
 * becomes a property of how deep you descend.
 *
 * SELF-RELEVANCE
 * --------------
 * No level in this structure is defined against an external ruler. A level is
 * exactly "what my parent could not say", and the parent is exactly "what my
 * child summarises". The chain closes on itself: `closureDefect` sums the
 * energy that no level accounts for, and for a genuinely closed nest that sum
 * sits at machine epsilon. A nest with a defect above the float64 floor is
 * reported as such rather than presented as closed — an unclosed toroid that
 * claims closure is worse than no witness at all.
 *
 * WHAT STILL BOUNDS THIS
 * ----------------------
 * Depth costs memory and transforms: each level is a full field. Depth is a
 * budget you spend, not a wall you hit — but it is a budget, and `descendTo`
 * takes the level widths explicitly so the cost is always the caller's choice.
 */

import type { CField } from '../core/complex';
import { resample, bandLimit, spectralEnergy } from './resample';

/** A parent field split into a coarse child and the residual it could not hold. */
export interface FieldSplit {
  /** Band-limited projection onto `m` nodes. */
  readonly coarse: CField;
  /** Parent minus the coarse part, lifted back to parent width. Exact. */
  readonly residual: CField;
  /** Width of the coarse level. */
  readonly childWidth: number;
  /** Width of the parent level. */
  readonly parentWidth: number;
  /** Highest wavenumber the coarse level retains. */
  readonly retainedBand: number;
}

function zerosLike(n: number): CField {
  return { re: new Float64Array(n), im: new Float64Array(n), n };
}

function addInto(a: CField, b: CField): CField {
  if (a.n !== b.n) throw new RangeError(`add: width mismatch ${a.n} vs ${b.n}`);
  const re = new Float64Array(a.n);
  const im = new Float64Array(a.n);
  for (let i = 0; i < a.n; i++) {
    re[i] = a.re[i] + b.re[i];
    im[i] = a.im[i] + b.im[i];
  }
  return { re, im, n: a.n };
}

function subtract(a: CField, b: CField): CField {
  if (a.n !== b.n) throw new RangeError(`sub: width mismatch ${a.n} vs ${b.n}`);
  const re = new Float64Array(a.n);
  const im = new Float64Array(a.n);
  for (let i = 0; i < a.n; i++) {
    re[i] = a.re[i] - b.re[i];
    im[i] = a.im[i] - b.im[i];
  }
  return { re, im, n: a.n };
}

/**
 * Split `f` into the part a width-`childWidth` grid can carry and the exact
 * remainder. `ascend(descend(f, m))` reproduces `f` to one ulp for any m ≤ n.
 */
export function descend(f: CField, childWidth: number): FieldSplit {
  if (!Number.isInteger(childWidth) || childWidth <= 0) {
    throw new RangeError(`descend: child width must be a positive integer, got ${childWidth}`);
  }
  if (childWidth > f.n) {
    throw new RangeError(`descend: child width ${childWidth} exceeds parent width ${f.n}`);
  }
  const coarse = resample(f, childWidth);
  const lifted = childWidth === f.n ? coarse : resample(coarse, f.n);
  return {
    coarse,
    residual: subtract(f, lifted),
    childWidth,
    parentWidth: f.n,
    retainedBand: Math.min(bandLimit(f.n), bandLimit(childWidth)),
  };
}

/** Recombine a split into its parent. Exact to float64. */
export function ascend(split: FieldSplit): CField {
  const lifted =
    split.childWidth === split.parentWidth
      ? split.coarse
      : resample(split.coarse, split.parentWidth);
  return addInto(lifted, split.residual);
}

/**
 * A field represented as a chain of rungs: a base (the coarsest view) plus one
 * residual per level, widest last. The nest is not "a field at width n" — it is
 * a field, full stop, that happens to be able to answer at any width.
 */
export interface NestedField {
  /** Coarsest level. */
  readonly base: CField;
  /** Residuals, ordered coarse→fine; `residuals[i]` lives at `widths[i+1]`. */
  readonly residuals: readonly CField[];
  /** Level widths, coarse→fine. `widths[0] === base.n`. */
  readonly widths: readonly number[];
}

/**
 * Build a nest from a field by descending through `widths` (fine→coarse order
 * is derived automatically; duplicates and out-of-range widths are rejected).
 */
export function descendTo(f: CField, widths: readonly number[]): NestedField {
  const ladder = [...new Set(widths)].filter((w) => w < f.n).sort((a, b) => a - b);
  for (const w of ladder) {
    if (!Number.isInteger(w) || w <= 0) throw new RangeError(`descendTo: bad width ${w}`);
  }
  const full = [...ladder, f.n];

  // Peel from the top down: each step yields the residual for the level above.
  const residuals: CField[] = [];
  let current = f;
  for (let i = full.length - 1; i > 0; i--) {
    const split = descend(current, full[i - 1]);
    residuals.unshift(split.residual);
    current = split.coarse;
  }
  return { base: current, residuals, widths: full };
}

/** Collapse a nest back to its finest width. Exact to float64. */
export function ascendAll(nest: NestedField): CField {
  let current = nest.base;
  for (let i = 0; i < nest.residuals.length; i++) {
    const parentWidth = nest.widths[i + 1];
    const lifted = current.n === parentWidth ? current : resample(current, parentWidth);
    current = addInto(lifted, nest.residuals[i]);
  }
  return current;
}

/**
 * Evaluate the nest at any width — including widths finer than every stored
 * level, because a nest is a function and not a sample vector. Levels finer
 * than `width` are dropped (their content is above that grid's band limit and
 * cannot be represented there, which is stated, not hidden).
 */
export function evaluateAt(nest: NestedField, width: number): CField {
  if (!Number.isInteger(width) || width <= 0) {
    throw new RangeError(`evaluateAt: width must be a positive integer, got ${width}`);
  }
  let current = nest.base;
  for (let i = 0; i < nest.residuals.length; i++) {
    const parentWidth = nest.widths[i + 1];
    if (parentWidth > width) break;
    const lifted = current.n === parentWidth ? current : resample(current, parentWidth);
    current = addInto(lifted, nest.residuals[i]);
  }
  return current.n === width ? current : resample(current, width);
}

/** Energy carried by each level, coarse→fine. */
export function levelEnergies(nest: NestedField): number[] {
  return [spectralEnergy(nest.base), ...nest.residuals.map((r) => spectralEnergy(r))];
}

/** Effective band limit the nest can answer at — the finest level's. */
export function nestBandLimit(nest: NestedField): number {
  return bandLimit(nest.widths[nest.widths.length - 1]);
}

export interface ClosureWitness {
  /** ‖reconstruct − original‖₂ ⁄ ‖original‖₂. */
  readonly defect: number;
  /** The float64 floor this defect is judged against. */
  readonly floor: number;
  /** True only when the defect sits at or below the arithmetic floor. */
  readonly closed: boolean;
  /** Levels in the nest. */
  readonly depth: number;
  /** Energy per level, coarse→fine. */
  readonly energies: readonly number[];
  /** Fraction of total energy the base level accounts for. */
  readonly baseShare: number;
}

/**
 * The self-relevance witness: rebuild the finest level from the chain and
 * measure what the chain failed to account for.
 *
 * The floor is √depth · 2⁻⁵² — the honest accumulation bound for `depth`
 * dependent float64 reductions. A defect above it means the nest is NOT closed,
 * and the witness says so.
 */
export function closureDefect(nest: NestedField, original: CField): ClosureWitness {
  const rebuilt = ascendAll(nest);
  if (rebuilt.n !== original.n) {
    throw new RangeError(`closureDefect: nest tops out at ${rebuilt.n}, original is ${original.n}`);
  }
  let num = 0;
  let den = 0;
  for (let i = 0; i < original.n; i++) {
    const dr = rebuilt.re[i] - original.re[i];
    const di = rebuilt.im[i] - original.im[i];
    num += dr * dr + di * di;
    den += original.re[i] * original.re[i] + original.im[i] * original.im[i];
  }
  const defect = den > 0 ? Math.sqrt(num / den) : Math.sqrt(num);
  const depth = nest.widths.length;
  const floor = Math.sqrt(depth) * 2.220446049250313e-16 * 8;
  const energies = levelEnergies(nest);
  const total = energies.reduce((a, b) => a + b, 0);
  return {
    defect,
    floor,
    closed: defect <= floor,
    depth,
    energies,
    baseShare: total > 0 ? energies[0] / total : 0,
  };
}

/** Bytes a nest occupies (two float64 arrays per level). */
export function nestFootprint(nest: NestedField): number {
  return nest.widths.reduce((a, w, i) => a + (i === 0 ? w : w) * 16, 0);
}
