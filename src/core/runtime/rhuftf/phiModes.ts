/**
 * φ-mode residual projection — principle ⑤ "when stuck, project, don't push".
 *
 * If a residual refuses to shrink, decompose it onto the φ-mode basis, find
 * the leaking harmonic k (residual ≈ φ⁻ᵏ), and damp exactly that mode. This
 * is what the F8 κ-closure does; here we make the target selection explicit
 * and data-driven instead of a broad constant damping.
 *
 * Basis: φ-scaled cosine modes over the rung's node count,
 *
 *     b_k[i] = φ^(−k/2) · cos( π·k·(i + ½) / N )
 *
 * The φ^(−k/2) envelope makes coefficient magnitude directly comparable to
 * the φ⁻ᵏ decay ladder, so `k* = argmax |c_k|` names the leaking harmonic.
 *
 * Pure. Basis vectors are generated on the fly (no table allocation) so the
 * function is safe to call from a worker global-free context.
 */

import { PHI } from '@metatron/field-kernel-core';

const LN_PHI = Math.log(PHI);

interface NAcc { s: number; c: number; }
function nAcc(): NAcc { return { s: 0, c: 0 }; }
function nAdd(a: NAcc, x: number): void {
  if (!Number.isFinite(x)) return;
  const s = a.s;
  const t = s + x;
  a.c += Math.abs(s) >= Math.abs(x) ? (s - t) + x : (x - t) + s;
  a.s = t;
}
function nVal(a: NAcc): number { return a.s + a.c; }

export interface PhiModeProjection {
  /** Coefficients c_0..c_{K−1}. */
  readonly coeff: Float64Array;
  /** Leaking harmonic index = argmax |c_k| over k ≥ 1. −1 when undefined. */
  readonly k: number;
  /** |c_k*| */
  readonly leakMagnitude: number;
  /** φ^(−k*) — the decay the leak implies. */
  readonly impliedDecay: number;
  /** Σ c_k² / ‖r‖² — how much of the residual the basis explains. */
  readonly explained: number;
}

/** Project a residual vector onto K φ-modes. */
export function projectResidual(residual: Float64Array, modes = 13): PhiModeProjection {
  const N = residual.length;
  const K = Math.max(1, Math.min(modes, N));
  const coeff = new Float64Array(K);

  const energy = nAcc();
  for (let i = 0; i < N; i++) nAdd(energy, residual[i] * residual[i]);
  const total = nVal(energy);

  for (let k = 0; k < K; k++) {
    const env = Math.exp(-0.5 * k * LN_PHI);
    const acc = nAcc();
    const nrm = nAcc();
    for (let i = 0; i < N; i++) {
      const b = env * Math.cos((Math.PI * k * (i + 0.5)) / N);
      nAdd(acc, residual[i] * b);
      nAdd(nrm, b * b);
    }
    const d = nVal(nrm);
    coeff[k] = d > 0 ? nVal(acc) / Math.sqrt(d) : 0;
  }

  let k = -1; let mag = 0;
  for (let i = 1; i < K; i++) {
    const a = Math.abs(coeff[i]);
    if (a > mag) { mag = a; k = i; }
  }

  const explainedAcc = nAcc();
  for (let i = 0; i < K; i++) nAdd(explainedAcc, coeff[i] * coeff[i]);

  return {
    coeff,
    k,
    leakMagnitude: mag,
    impliedDecay: k >= 0 ? Math.exp(-k * LN_PHI) : NaN,
    explained: total > 0 ? Math.min(1, nVal(explainedAcc) / total) : NaN,
  };
}

/**
 * Targeted κ-closure damping: remove a fraction of the leaking mode from the
 * signal, with strength derived from the coefficient rather than a constant.
 * Returns the damping strength actually applied. Never touches other modes.
 */
export function dampMode(
  signal: Float64Array,
  k: number,
  coefficient: number,
  kappa: number,
): number {
  const N = signal.length;
  if (k < 0 || N === 0 || !Number.isFinite(coefficient)) return 0;
  const strength = Math.min(1, Math.max(0, kappa * Math.abs(coefficient)));
  if (strength === 0) return 0;
  const env = Math.exp(-0.5 * k * LN_PHI);
  const nrm = nAcc();
  for (let i = 0; i < N; i++) {
    const b = env * Math.cos((Math.PI * k * (i + 0.5)) / N);
    nAdd(nrm, b * b);
  }
  const d = Math.sqrt(nVal(nrm));
  if (!(d > 0)) return 0;
  for (let i = 0; i < N; i++) {
    const b = (env * Math.cos((Math.PI * k * (i + 0.5)) / N)) / d;
    signal[i] -= strength * coefficient * b;
  }
  return strength;
}

/** Rolling stall detector for a residual series. */
export class StallDetector {
  private readonly buf: Float64Array;
  private len = 0;
  private head = 0;

  constructor(private readonly window = 21, private readonly tolerance = 1e-4) {
    this.buf = new Float64Array(window);
  }

  push(x: number): void {
    if (!Number.isFinite(x)) return;
    this.buf[this.head] = x;
    this.head = (this.head + 1) % this.buf.length;
    if (this.len < this.buf.length) this.len++;
  }

  /** True when the residual has not shrunk meaningfully across the window. */
  get stalled(): boolean {
    if (this.len < this.buf.length) return false;
    let min = Infinity, max = -Infinity, first = 0, last = 0;
    for (let i = 0; i < this.len; i++) {
      const idx = (this.head + i) % this.buf.length;
      const v = this.buf[idx];
      if (i === 0) first = v;
      if (i === this.len - 1) last = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!(max > 0)) return false;
    return (first - last) / max < this.tolerance;
  }

  get samples(): number { return this.len; }
}
