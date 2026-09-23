/**
 * StableSum — numerically robust accumulation primitives
 * =======================================================
 *
 * Pure, dependency-free helpers used wherever the engine sums long sequences
 * of φ-ladder terms, residual squares, or worker shard contributions. These
 * exist so closures remain stable at 68k+ nodes without changing any
 * mathematical result — only the trailing bits that naive `+=` loses.
 *
 *  • Neumaier compensated summation  (Kahan–Babuška–Neumaier variant)
 *  • Welford online mean / variance  (single-pass, catastrophic-cancellation-free)
 *  • Safe φ-power evaluation         (log-space, overflow/underflow guarded)
 *  • Finite clamp                    (NaN / ±∞ sentinel)
 *  • Contraction assertion           (Banach invariant guard)
 *
 * None of these change the *value* of a convergent sum — they preserve it
 * across scales where IEEE-754 would otherwise drift.
 */

import { PHI } from '@/core/frameworks/constants';

export const LN_PHI = Math.log(PHI);
// IEEE-754 double safe exponent band for exp(x): roughly (−744, 709).
const EXP_MAX = 700;
const EXP_MIN = -700;

// ─────────────────────────────────────────────────────────────────────────
// Neumaier compensated sum
// ─────────────────────────────────────────────────────────────────────────

export class NeumaierSum {
  private s = 0;
  private c = 0; // running compensation
  add(x: number): void {
    if (!Number.isFinite(x)) return; // hard sentinel: never poison the sum
    const t = this.s + x;
    if (Math.abs(this.s) >= Math.abs(x)) {
      this.c += (this.s - t) + x;
    } else {
      this.c += (x - t) + this.s;
    }
    this.s = t;
  }
  value(): number { return this.s + this.c; }
  reset(): void { this.s = 0; this.c = 0; }
}

/** One-shot Neumaier sum of an array. */
export function neumaierSum(xs: ArrayLike<number>): number {
  const acc = new NeumaierSum();
  for (let i = 0; i < xs.length; i++) acc.add(xs[i]);
  return acc.value();
}

/**
 * One-shot Neumaier sum of a Float64Array. Loop body is inlined (no class
 * dispatch per element) and the per-element `Number.isFinite` check is elided
 * — typed-array hot paths in this codebase guarantee finite inputs. Bit-
 * identical to neumaierSum() on any finite Float64Array, and faster on
 * JIT runtimes because the compensation state stays in registers.
 */
export function neumaierSumF64(xs: Float64Array, n: number = xs.length): number {
  let s = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const t = s + x;
    if (Math.abs(s) >= Math.abs(x)) c += (s - t) + x;
    else c += (x - t) + s;
    s = t;
  }
  return s + c;
}

// ─────────────────────────────────────────────────────────────────────────
// Welford online mean / variance
// ─────────────────────────────────────────────────────────────────────────

export class Welford {
  private n = 0;
  private m = 0;       // running mean
  private m2 = 0;      // running Σ(x − mean)²
  add(x: number): void {
    if (!Number.isFinite(x)) return;
    this.n += 1;
    const d = x - this.m;
    this.m += d / this.n;
    this.m2 += d * (x - this.m);
  }
  get count(): number { return this.n; }
  get mean(): number { return this.n > 0 ? this.m : 0; }
  /** Population variance. Use sampleVariance() for unbiased (n−1). */
  get variance(): number { return this.n > 0 ? this.m2 / this.n : 0; }
  get sampleVariance(): number { return this.n > 1 ? this.m2 / (this.n - 1) : 0; }
  /** RMS = √(Σx²/n). Computed stably from mean and variance. */
  get rms(): number {
    if (this.n === 0) return 0;
    return Math.sqrt(this.variance + this.m * this.m);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Safe φ-power (log-space, guarded)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Returns φ^k computed via exp(k·ln φ), clamped to the IEEE-754 safe band.
 * `Math.pow(PHI, k)` overflows near k≈1475 and underflows near k≈−1475;
 * this guard returns the saturating extreme instead of Infinity / 0 so
 * downstream divisions and accumulators stay finite.
 */
export function phiPow(k: number): number {
  const x = k * LN_PHI;
  if (x >= EXP_MAX) return Number.MAX_VALUE;
  if (x <= EXP_MIN) return Number.MIN_VALUE;
  return Math.exp(x);
}

/** ln(φ^k) = k·ln φ — use when consumers can stay in log-space. */
export function logPhiPow(k: number): number {
  return k * LN_PHI;
}

// ─────────────────────────────────────────────────────────────────────────
// Sentinels
// ─────────────────────────────────────────────────────────────────────────

/** Returns x if finite, else `fallback` (default 0). Single-line poison guard. */
export function finiteOr(x: number, fallback = 0): number {
  return Number.isFinite(x) ? x : fallback;
}

// ─────────────────────────────────────────────────────────────────────────
// Banach contraction invariant
// ─────────────────────────────────────────────────────────────────────────

/**
 * Asserts |λ| < 1, the contraction-mapping prerequisite for convergence of
 * any recursion of the form xₙ₊₁ = λ·xₙ + d. Throws (dev-time) if violated,
 * so a future edit cannot silently break Banach.
 */
export function assertContraction(lambda: number, label = 'lambda'): void {
  if (!(Math.abs(lambda) < 1)) {
    throw new Error(
      `assertContraction: ${label}=${lambda} violates Banach contraction (|λ|<1).`,
    );
  }
}
