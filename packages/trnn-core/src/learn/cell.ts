/**
 * Ω-P8 — the learnable cell term.
 *
 * The certified nine-term cell is untouched. Learning is a *bounded additive
 * correction* applied after it:
 *
 *   z+ = clamp_phi4[ cell(z, terms) + gate · ( Σ_i w_i D_i + λ z ) ]
 *
 * with D = [G, P, R, Π, ẑ] (fixed order), w from a SimplexGain of total
 * LEARN_BUDGET, and λ from a BoundedEigenvalue of radius LEARN_BUDGET.
 *
 * Certificate. Each drive D_i is Lipschitz-1 in z in the max norm (G and P are
 * orthogonal-modal images of z, R and ẑ are memory reads bounded by the memory
 * kernel, Π is the closure target). Worst case the correction adds
 *
 *   gate · ( 2·LEARN_BUDGET + ρ )
 *
 * to the homogeneous Jury gain (the factor 2 charges the two pull terms twice,
 * the pessimal reading). LEARN_BUDGET = (1 − JURY_GAIN)·φ⁻¹/2 is chosen so that
 * even at gate = 1 with any raw parameters the total stays strictly below 1:
 *
 *   0.7507764… + 3·0.0770… = 0.9818… < 1
 *
 * so the contraction survives *every* point of parameter space, not just the
 * trained one. `gate = 0` is the shipped default and is bit-exact identity:
 * adding 0·x to a float changes nothing, and the φ⁴ clamp is idempotent.
 */

import { CLAMP_MAX, JURY_GAIN, PHI_INV } from '../core/constants';
import { clampField, type CField } from '../core/complex';
import { cellStep, ISS_SLACK, type CellStepReport, type CellTerms } from '../cell/update';
import { BoundedEigenvalue, SimplexGain, type Certificate, type Parametrization } from './params';

/** Total ℓ¹ budget handed to the learnable drive mix (and to |λ|). */
export const LEARN_BUDGET = ((1 - JURY_GAIN) * PHI_INV) / 2;

/** Drive slots the mix may use, in fixed order. */
export const DRIVE_SLOTS = ['G', 'P', 'R', 'Pi', 'zhat'] as const;
export type DriveSlot = (typeof DRIVE_SLOTS)[number];

export interface LearnableCellOptions {
  /** 0 → shipped-disabled identity. Clamped to [0, 1]. */
  readonly gate?: number;
  readonly mixRaw?: ArrayLike<number>;
  readonly lambdaRaw?: number;
}

export class LearnableCell {
  readonly mix: SimplexGain;
  readonly lambda: BoundedEigenvalue;
  private gateValue: number;

  constructor(opts: LearnableCellOptions = {}) {
    this.mix = new SimplexGain(DRIVE_SLOTS.length, LEARN_BUDGET, opts.mixRaw);
    this.lambda = new BoundedEigenvalue(LEARN_BUDGET, opts.lambdaRaw ?? 0);
    this.gateValue = clamp01(opts.gate ?? 0);
  }

  get gate(): number {
    return this.gateValue;
  }

  setGate(g: number): void {
    this.gateValue = clamp01(g);
  }

  get enabled(): boolean {
    return this.gateValue > 0;
  }

  params(): readonly Parametrization[] {
    return [this.mix, this.lambda];
  }

  /** Worst-case homogeneous gain over *all* parameter values at this gate. */
  certifiedGain(): number {
    return JURY_GAIN + this.gateValue * (2 * LEARN_BUDGET + this.lambda.rho);
  }

  certificates(): readonly Certificate[] {
    return [
      this.mix.certificate(),
      this.lambda.certificate(),
      {
        kind: 'JuryGain',
        statement: 'homogeneous max-norm gain < 1 for every parameter value at this gate',
        bound: 1,
        measured: this.certifiedGain(),
        holds: this.certifiedGain() < 1,
      },
    ];
  }

  /**
   * Certified cell step. `out` must differ from `z` (Jacobi staging).
   * With gate = 0 the result is bit-identical to `cellStep(z, out, terms)`.
   */
  step(z: CField, out: CField, terms: CellTerms): CellStepReport {
    const base = cellStep(z, out, terms);
    if (this.gateValue === 0) return base;

    const w = this.mix.values();
    const lam = this.lambda.lambda() * this.gateValue;
    const n = z.n;
    const slots: (CField | null | undefined)[] = [terms.G, terms.P, terms.R, terms.Pi, terms.zhat];

    // S4/S5 — the learned drive carries its own ISS contribution:
    // ‖Δ‖∞ ≤ Σ_s |k_s|·‖d_s‖∞ + |λ|·‖z‖∞, accumulated in the same pass so the
    // bound reported below is a real measurement, not an assumption.
    let learnedDrive = 0;
    for (let s = 0; s < slots.length; s++) {
      const d = slots[s];
      if (!d) continue;
      const k = this.gateValue * w[s];
      if (k === 0) continue;
      const m = Math.min(n, d.n);
      let dMax = 0;
      for (let i = 0; i < m; i++) {
        out.re[i] += k * d.re[i];
        out.im[i] += k * d.im[i];
        const a = Math.sqrt(d.re[i] * d.re[i] + d.im[i] * d.im[i]);
        if (a > dMax) dMax = a;
      }
      learnedDrive += Math.abs(k) * dMax;
    }
    if (lam !== 0) {
      let zMax = 0;
      for (let i = 0; i < n; i++) {
        out.re[i] += lam * z.re[i];
        out.im[i] += lam * z.im[i];
        const a = Math.sqrt(z.re[i] * z.re[i] + z.im[i] * z.im[i]);
        if (a > zMax) zMax = a;
      }
      learnedDrive += Math.abs(lam) * zMax;
    }

    const clamped = clampField(out, CLAMP_MAX);

    let inMax = 0;
    let peak = 0;
    let d2 = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.sqrt(z.re[i] * z.re[i] + z.im[i] * z.im[i]);
      if (a > inMax) inMax = a;
      const b = Math.sqrt(out.re[i] * out.re[i] + out.im[i] * out.im[i]);
      if (b > peak) peak = b;
      const dr = out.re[i] - z.re[i];
      const di = out.im[i] - z.im[i];
      d2 += dr * dr + di * di;
    }

    const driveNorm = base.driveNorm + learnedDrive;
    const issBound = JURY_GAIN * inMax + driveNorm;
    return {
      clamped: base.clamped + clamped,
      delta: Math.sqrt(d2),
      peak,
      realizedGain: inMax > 0 ? peak / inMax : 0,
      issBound,
      driveNorm,
      issSatisfied: peak <= issBound * (1 + ISS_SLACK) + ISS_SLACK,
    };
  }
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
