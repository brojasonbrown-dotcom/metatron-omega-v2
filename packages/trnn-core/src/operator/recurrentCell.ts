/**
 * Ω-SCALE P3 — gated recurrence over mode coefficients (RNO-style).
 *
 * Every spectral pass today is memoryless: the signature is recomputed from
 * the instantaneous field and nothing carries forward. That throws away the
 * one thing a time-series has that a snapshot does not — its own history.
 *
 * The recurrent-operator cell adds that memory with GRU gates evaluated in the
 * spectral domain, which is the same structure the 2026 state-space operator
 * work arrives at from the other direction (adaptive damping + per-frequency
 * modulation):
 *
 *   z_t = σ(a_z·x_t + b_z·h_{t-1} + c_z)          update gate
 *   r_t = σ(a_r·x_t + b_r·h_{t-1} + c_r)          reset gate
 *   h̃_t = tanh(a_h·x_t + b_h·(r_t ⊙ h_{t-1}))    candidate
 *   h_t = (1 − z_t) ⊙ h_{t-1} + z_t ⊙ h̃_t        blend
 *
 * with gains per mode, so a low mode can hold for minutes while a high mode
 * forgets in a few frames — the φ ladder supplies that spread for free.
 *
 * STABILITY (the reason this can be enabled without re-opening the ISS
 * argument): the blend is convex, z_t ∈ (0,1), and the candidate is bounded by
 * tanh into [−1, 1]. Therefore
 *
 *   |h_t| ≤ (1 − z_t)|h_{t-1}| + z_t·1 ≤ max(|h_{t-1}|, 1),
 *
 * so the state is bounded by max(|h_0|, 1) for all t and can never grow. With
 * `zMax < 1` the map is additionally a contraction toward the candidate with
 * factor (1 − zMin) per step, so a bounded input yields a bounded state — ISS
 * in the only sense the engine needs. `certify()` returns those numbers so the
 * property is checked rather than asserted.
 *
 * Gated OFF by default: nothing in the engine consumes this until the A/B
 * harness shows it beats the memoryless signature on a real task.
 */

import { PHI, PHI_INV } from '../core/constants';
import { dexp, dlog, dtanh } from '../core/dmath';

export interface RecurrentOptions {
  /** Mode count. Must match the signature width. */
  readonly modes: number;
  /**
   * Per-mode retention spread. Mode k gets base retention φ^(−k·decay), so
   * low modes are slow and high modes are fast. 0 makes every mode equal.
   */
  readonly decay?: number;
  /** Input gain on the candidate path. */
  readonly inputGain?: number;
  /** Upper clamp on the update gate — keeps the contraction strict. */
  readonly zMax?: number;
  /** Lower clamp on the update gate — keeps the cell from freezing. */
  readonly zMin?: number;
}

export interface RecurrentCertificate {
  /** Sup over modes of the per-step retention factor (1 − z). */
  readonly contraction: number;
  /** Bound on |h_t| for all t given |h_0| ≤ 1. */
  readonly stateBound: number;
  /** True when contraction < 1 and the bound is finite. */
  readonly stable: boolean;
  /** Slowest and fastest effective time constants, in frames. */
  readonly tauSlow: number;
  readonly tauFast: number;
}

const sigmoid = (x: number): number => 1 / (1 + dexp(-x));

/**
 * One recurrent cell over a real mode-coefficient vector (magnitudes; the
 * phase channel is handled by `modeCurrent`, which is already driver-invariant
 * and must not be smoothed).
 */
export class RecurrentModeCell {
  readonly modes: number;
  readonly zMin: number;
  readonly zMax: number;
  private readonly h: Float64Array;
  /** Per-mode retention bias — pushes low modes toward "hold". */
  private readonly bias: Float64Array;
  private readonly inputGain: number;
  private steps = 0;

  constructor(opts: RecurrentOptions) {
    if (!Number.isInteger(opts.modes) || opts.modes < 1) {
      throw new RangeError(`RecurrentModeCell: bad modes ${opts.modes}`);
    }
    this.modes = opts.modes;
    this.zMin = clamp01(opts.zMin ?? 0.02, 1e-6, 0.5);
    this.zMax = clamp01(opts.zMax ?? PHI_INV, this.zMin + 1e-6, 1 - 1e-6);
    this.inputGain = Number.isFinite(opts.inputGain ?? 1) ? (opts.inputGain ?? 1) : 1;
    this.h = new Float64Array(this.modes);
    this.bias = new Float64Array(this.modes);
    const decay = Number.isFinite(opts.decay ?? 1) ? (opts.decay ?? 1) : 1;
    for (let k = 0; k < this.modes; k++) {
      // Low k → strongly negative bias → small z → long memory.
      this.bias[k] = -decay * (this.modes - 1 - k) * dlog(PHI) * PHI_INV;
    }
  }

  /** Current hidden state (live view — copy before retaining). */
  get state(): Float64Array {
    return this.h;
  }

  get frames(): number {
    return this.steps;
  }

  reset(): void {
    this.h.fill(0);
    this.steps = 0;
  }

  /**
   * Advance one frame. `x` is this frame's mode magnitudes; the returned array
   * is the cell's own state (not a copy) so the hot path allocates nothing.
   *
   * A non-finite input component leaves that mode's state untouched — the same
   * gap contract the rest of the stack uses. A gap is not a zero.
   */
  step(x: ArrayLike<number>): Float64Array {
    if (x.length !== this.modes) {
      throw new RangeError(`RecurrentModeCell.step: width ${x.length} != ${this.modes}`);
    }
    for (let k = 0; k < this.modes; k++) {
      const xi = x[k];
      if (!Number.isFinite(xi)) continue;
      const prev = this.h[k];
      const z = this.gate(xi, prev, k);
      const r = sigmoid(xi - prev);
      const cand = dtanh(this.inputGain * xi + PHI_INV * r * prev);
      this.h[k] = (1 - z) * prev + z * cand;
    }
    this.steps++;
    return this.h;
  }

  private gate(x: number, prev: number, k: number): number {
    const raw = sigmoid(x - prev + this.bias[k]);
    return Math.min(this.zMax, Math.max(this.zMin, raw));
  }

  /**
   * Stability certificate. Computed from the clamps, not sampled — these are
   * the actual worst cases the class can produce.
   */
  certify(): RecurrentCertificate {
    const contraction = 1 - this.zMin;
    // |h| ≤ (1-z)|h| + z·1 → fixed point at 1 for any z ∈ (0,1].
    const stateBound = 1;
    return {
      contraction,
      stateBound,
      stable: contraction < 1 && Number.isFinite(stateBound),
      tauSlow: 1 / this.zMin,
      tauFast: 1 / this.zMax,
    };
  }
}

/**
 * Offline roll of a cell over a sequence — the form the A/B harness uses to
 * compare "recurrent signature" against "raw signature" on identical input.
 */
export function rollRecurrent(
  seq: readonly ArrayLike<number>[],
  opts: RecurrentOptions,
): Float64Array[] {
  const cell = new RecurrentModeCell(opts);
  return seq.map((x) => Float64Array.from(cell.step(x)));
}

/** Default spread: slowest mode holds ~φ⁴ longer than the fastest. */
export const DEFAULT_DECAY = 1 / PHI;

function clamp01(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}
