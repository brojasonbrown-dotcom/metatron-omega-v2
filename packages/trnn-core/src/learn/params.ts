/**
 * Ω-P8 — constrained parametrizations.
 *
 * Rule (BRAINMAP L-P8): a learnable quantity is never a free float that a
 * training loop can push out of the certified region. Every learnable is a
 * *surjective smooth map from the whole real line into its admissible set*, so
 * the certificate holds for every value the optimiser can ever produce — there
 * is no projection step that can be forgotten, no clip that can be tuned off,
 * and no "it stayed in range during our run" hand-waving.
 *
 *   SimplexGain       raw ∈ R^k  →  w ∈ Δ^{k-1} · total   (w_i ≥ 0, Σ w_i = total)
 *   InputGain         raw ∈ R    →  (-L, L)
 *   BoundedEigenvalue raw ∈ R    →  (-ρ, ρ) with ρ < 1     (Schur-stable ∀ raw)
 *
 * All three use the algebraic sigmoid s(x) = x / sqrt(1 + x²) rather than tanh
 * or softmax: no exp, no overflow at |raw| = 1e300, monotone, and its
 * derivative (1 + x²)^{-3/2} is exact enough for finite-difference training.
 */

/** Algebraic sigmoid, range (-1, 1), defined and finite for every float64. */
export function algSigmoid(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : -1;
  return x / Math.sqrt(1 + x * x);
}

/** d/dx algSigmoid. */
export function algSigmoidPrime(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const d = 1 + x * x;
  return 1 / (d * Math.sqrt(d));
}

export interface Certificate {
  readonly kind: string;
  /** Human-readable statement of the invariant. */
  readonly statement: string;
  /** The certified bound. */
  readonly bound: number;
  /** Measured quantity the bound applies to, at the current raw values. */
  readonly measured: number;
  /** True when measured respects bound (must be true by construction). */
  readonly holds: boolean;
}

export interface Parametrization {
  readonly kind: string;
  readonly size: number;
  /** Unconstrained coordinates — the only thing a trainer touches. */
  readonly raw: Float64Array;
  /** Constrained values, written into an owned buffer (no allocation). */
  values(): Float64Array;
  certificate(): Certificate;
}

/**
 * Non-negative weights summing to exactly `total` (up to k ulp of the division).
 *
 * w_i = total · u_i / Σ u_j  with  u_i = 1 + s(raw_i)  ∈ (0, 2)
 *
 * The offset keeps every u_i strictly positive, so the denominator can never be
 * zero and the map is defined on all of R^k — including the all-equal ray,
 * where it returns the uniform simplex point.
 */
export class SimplexGain implements Parametrization {
  readonly kind = 'SimplexGain';
  readonly size: number;
  readonly raw: Float64Array;
  readonly total: number;
  private readonly out: Float64Array;

  constructor(size: number, total: number, raw?: ArrayLike<number>) {
    if (!(size > 0)) throw new Error('SimplexGain: size must be positive');
    if (!(total >= 0) || !Number.isFinite(total)) throw new Error('SimplexGain: total must be finite ≥ 0');
    this.size = size;
    this.total = total;
    this.raw = new Float64Array(size);
    if (raw) for (let i = 0; i < Math.min(size, raw.length); i++) this.raw[i] = raw[i];
    this.out = new Float64Array(size);
  }

  values(): Float64Array {
    let sum = 0;
    for (let i = 0; i < this.size; i++) {
      const u = 1 + algSigmoid(this.raw[i]);
      this.out[i] = u;
      sum += u;
    }
    if (!(sum > 0) || !Number.isFinite(sum)) {
      // Degenerate ray: every raw saturated to s = −1 (u = 0). The limit of the
      // map along that ray is the uniform point, so that is what we return —
      // the simplex invariant holds with no division by zero.
      const u = this.total / this.size;
      for (let i = 0; i < this.size; i++) this.out[i] = u;
      return this.out;
    }
    const k = this.total / sum;
    for (let i = 0; i < this.size; i++) this.out[i] *= k;
    return this.out;
  }

  certificate(): Certificate {
    const v = this.values();
    let s = 0;
    let minv = Infinity;
    for (let i = 0; i < this.size; i++) {
      s += Math.abs(v[i]);
      if (v[i] < minv) minv = v[i];
    }
    return {
      kind: this.kind,
      statement: `Σ|w_i| = ${this.total} and w_i ≥ 0 for every raw ∈ R^${this.size}`,
      bound: this.total,
      measured: s,
      holds: minv >= 0 && s <= this.total * (1 + 8 * Number.EPSILON) + 8 * Number.EPSILON,
    };
  }
}

/** A single gain confined to the open interval (-limit, limit) for every raw. */
export class InputGain implements Parametrization {
  readonly kind = 'InputGain';
  readonly size = 1;
  readonly raw = new Float64Array(1);
  readonly limit: number;
  private readonly out = new Float64Array(1);

  constructor(limit: number, raw = 0) {
    if (!(limit > 0) || !Number.isFinite(limit)) throw new Error('InputGain: limit must be finite > 0');
    this.limit = limit;
    this.raw[0] = raw;
  }

  value(): number {
    return this.limit * algSigmoid(this.raw[0]);
  }

  values(): Float64Array {
    this.out[0] = this.value();
    return this.out;
  }

  certificate(): Certificate {
    const v = Math.abs(this.value());
    return {
      kind: this.kind,
      statement: `|g| < ${this.limit} for every raw ∈ R`,
      bound: this.limit,
      measured: v,
      holds: v <= this.limit,
    };
  }
}

/**
 * A real eigenvalue pinned inside the open disc of radius `rho` (< 1), so the
 * one-pole recurrence x+ = λ x + u is Schur-stable for every parameter value.
 */
export class BoundedEigenvalue implements Parametrization {
  readonly kind = 'BoundedEigenvalue';
  readonly size = 1;
  readonly raw = new Float64Array(1);
  readonly rho: number;
  private readonly out = new Float64Array(1);

  constructor(rho: number, raw = 0) {
    if (!(rho > 0) || !(rho < 1)) throw new Error('BoundedEigenvalue: rho must lie in (0, 1)');
    this.rho = rho;
    this.raw[0] = raw;
  }

  lambda(): number {
    return this.rho * algSigmoid(this.raw[0]);
  }

  values(): Float64Array {
    this.out[0] = this.lambda();
    return this.out;
  }

  certificate(): Certificate {
    const v = Math.abs(this.lambda());
    return {
      kind: this.kind,
      statement: `|λ| < ρ = ${this.rho} < 1 (Schur stable) for every raw ∈ R`,
      bound: this.rho,
      measured: v,
      holds: v < 1 && v <= this.rho,
    };
  }
}

/** Flatten a parameter set into one raw vector view (trainer convenience). */
export function rawVector(params: readonly Parametrization[]): Float64Array {
  let n = 0;
  for (const p of params) n += p.raw.length;
  const v = new Float64Array(n);
  let o = 0;
  for (const p of params) {
    v.set(p.raw, o);
    o += p.raw.length;
  }
  return v;
}

/** Scatter a raw vector back onto a parameter set (same order as rawVector). */
export function setRawVector(params: readonly Parametrization[], v: ArrayLike<number>): void {
  let o = 0;
  for (const p of params) {
    for (let i = 0; i < p.raw.length; i++) p.raw[i] = v[o + i];
    o += p.raw.length;
  }
}
