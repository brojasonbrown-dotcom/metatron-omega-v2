/**
 * Ω-REAL P8 — Adaptive Conformal Inference (ACI).
 *
 * The machine is allowed to be wrong; it is not allowed to be wrong *and*
 * confident. ACI (Gibbs & Candès, 2021) is the only calibration scheme here
 * that keeps its coverage promise when the data distribution shifts under it,
 * which is exactly what happens when a sensor drifts or a rung warms up.
 *
 * Mechanism
 * ---------
 *   qₜ   = empirical (1 − αₜ) quantile of the last `window` nonconformity
 *          scores, with the finite-sample split-conformal correction
 *          ⌈(n+1)(1−αₜ)⌉ / n  — the correction is what makes coverage a
 *          guarantee at finite n rather than an asymptotic hope.
 *   errₜ = 1 when the truth fell outside [ŷ ± qₜ], else 0.
 *   αₜ₊₁ = αₜ + γ(α − errₜ)   — miss ⇒ α shrinks ⇒ the interval widens.
 *
 * The α recursion is the whole point: a fixed quantile silently loses coverage
 * after a shift and never notices. αₜ is clamped to (0, 1) exclusive, because
 * αₜ ≤ 0 means "infinite interval" and αₜ ≥ 1 means "empty interval", and both
 * are states a dashboard would render as a number.
 *
 * Abstention: below `STAT_FLOOR` calibration scores there is no quantile worth
 * quoting, so the interval is `null` — not a wide guess. A null interval is
 * counted as neither covered nor missed; it is excluded from the coverage
 * denominator, so warm-up can never inflate or deflate the reported coverage.
 */

import { STAT_FLOOR } from '../substrate/correlation';
import { PHI_INV } from '../core/constants';

/**
 * Default miscoverage: 10% ⇒ nominal coverage 0.90.
 *
 * The certification gate is 0.85. Running the predictor at α = 0.15 would aim
 * *exactly* at the gate, so half of all honest runs would fail it on sampling
 * noise alone — and the temptation would then be to lower the gate. The
 * predictor aims above the gate instead, and the margin is measured.
 */
export const ACI_ALPHA = 0.10;

/**
 * Default learning rate for the α recursion. φ⁻¹/16 ≈ 0.0386: fast enough to
 * recover coverage inside the 100-event budget, slow enough that a single
 * unlucky miss does not throw the interval open.
 */
export const ACI_GAMMA = PHI_INV / 16;

/** Default calibration window (Fibonacci; ≥ STAT_FLOOR). */
export const ACI_WINDOW = 233;

/** Coverage a certified run must reach and hold. */
export const COVERAGE_TARGET = 0.85;

/** Events allowed after a distribution shift before coverage must be back. */
export const RECOVERY_BUDGET = 100;

export interface AciOptions {
  /** Target miscoverage ∈ (0,1). */
  readonly alpha?: number;
  /** α-recursion step size > 0. */
  readonly gamma?: number;
  /** Calibration window length. */
  readonly window?: number;
  /** Minimum scores before an interval is quoted. */
  readonly floor?: number;
}

export interface AciObservation {
  /** Point prediction that was scored. */
  readonly prediction: number;
  readonly truth: number;
  /** Nonconformity score |truth − prediction|; NaN when either is non-finite. */
  readonly score: number;
  /** Half-width used, or null when the estimator abstained. */
  readonly halfWidth: number | null;
  readonly lo: number | null;
  readonly hi: number | null;
  /** null when abstained — an abstention is not a miss and not a hit. */
  readonly covered: boolean | null;
  /** αₜ in force when the interval was quoted. */
  readonly alphaT: number;
  /** Calibration scores available at quote time. */
  readonly nCalib: number;
}

export interface CoverageReport {
  /** Scored (non-abstained) events. */
  readonly scored: number;
  readonly covered: number;
  readonly abstained: number;
  /** covered / scored, or null when nothing was scored. */
  readonly coverage: number | null;
  /** Mean half-width over scored events, or null. */
  readonly meanWidth: number | null;
  readonly alphaFinal: number;
}

function quantileSorted(sorted: readonly number[], level: number): number {
  const n = sorted.length;
  // Split-conformal finite-sample index: ⌈(n+1)·level⌉, 1-based, capped at n.
  const k = Math.ceil((n + 1) * level);
  if (k <= 0) return sorted[0];
  if (k >= n) return sorted[n - 1];
  return sorted[k - 1];
}

/**
 * Online adaptive conformal predictor over a scalar residual.
 *
 * Deterministic: no RNG, no clock. Two runs over the same event sequence
 * produce identical observations, so a coverage regression is reproducible.
 */
export class AdaptiveConformal {
  readonly alpha: number;
  readonly gamma: number;
  readonly window: number;
  readonly floor: number;

  private alphaT: number;
  private readonly scores: number[] = [];
  private readonly log: AciObservation[] = [];

  constructor(opts: AciOptions = {}) {
    const alpha = opts.alpha ?? ACI_ALPHA;
    if (!(alpha > 0 && alpha < 1)) throw new RangeError('AdaptiveConformal: alpha must be in (0,1)');
    const gamma = opts.gamma ?? ACI_GAMMA;
    if (!(gamma > 0)) throw new RangeError('AdaptiveConformal: gamma must be > 0');
    this.alpha = alpha;
    this.gamma = gamma;
    this.window = Math.max(1, Math.floor(opts.window ?? ACI_WINDOW));
    this.floor = Math.max(1, Math.floor(opts.floor ?? STAT_FLOOR));
    this.alphaT = alpha;
  }

  /** Current adaptive miscoverage level. */
  currentAlpha(): number {
    return this.alphaT;
  }

  /** Calibration scores currently in the window. */
  calibrationSize(): number {
    return this.scores.length;
  }

  /**
   * Half-width for the next quote, or null when the window is under floor.
   * Pure — calling it does not advance the recursion.
   */
  halfWidth(): number | null {
    if (this.scores.length < this.floor) return null;
    const sorted = [...this.scores].sort((a, b) => a - b);
    const q = quantileSorted(sorted, 1 - this.alphaT);
    return Number.isFinite(q) ? q : null;
  }

  /**
   * Score one event: quote an interval around `prediction`, compare to
   * `truth`, then advance αₜ and the calibration window.
   */
  observe(prediction: number, truth: number): AciObservation {
    const nCalib = this.scores.length;
    const alphaT = this.alphaT;
    const hw = this.halfWidth();
    const score = Number.isFinite(prediction) && Number.isFinite(truth)
      ? Math.abs(truth - prediction)
      : NaN;

    let covered: boolean | null = null;
    let lo: number | null = null;
    let hi: number | null = null;
    if (hw !== null && Number.isFinite(score)) {
      lo = prediction - hw;
      hi = prediction + hw;
      covered = score <= hw;
      // α recursion runs only on scored events: an abstention carries no
      // information about coverage and must not move the level.
      const err = covered ? 0 : 1;
      const next = alphaT + this.gamma * (this.alpha - err);
      this.alphaT = Math.min(1 - 1e-9, Math.max(1e-9, next));
    }

    if (Number.isFinite(score)) {
      this.scores.push(score);
      if (this.scores.length > this.window) this.scores.shift();
    }

    const obs: AciObservation = {
      prediction, truth, score, halfWidth: hw, lo, hi, covered, alphaT, nCalib,
    };
    this.log.push(obs);
    return obs;
  }

  observations(): readonly AciObservation[] {
    return this.log;
  }

  /** Coverage over a suffix of the log (`from` inclusive, default all). */
  report(from = 0): CoverageReport {
    let scored = 0, covered = 0, abstained = 0, widthSum = 0;
    for (let i = Math.max(0, from); i < this.log.length; i++) {
      const o = this.log[i];
      if (o.covered === null) { abstained++; continue; }
      scored++;
      if (o.covered) covered++;
      if (o.halfWidth !== null) widthSum += o.halfWidth;
    }
    return {
      scored,
      covered,
      abstained,
      coverage: scored > 0 ? covered / scored : null,
      meanWidth: scored > 0 ? widthSum / scored : null,
      alphaFinal: this.alphaT,
    };
  }
}

export interface RecoveryReport {
  /** Event index where the shift was injected. */
  readonly shiftAt: number;
  /** Scored events after the shift. */
  readonly scored: number;
  /**
   * Events after the shift before trailing coverage returned to target, or
   * null when it never did within the log.
   */
  readonly recoveredAfter: number | null;
  /** recoveredAfter ≤ budget (and non-null). */
  readonly withinBudget: boolean;
  /** Coverage over the whole post-shift tail. */
  readonly tailCoverage: number | null;
  /** Coverage over the tail once recovered, or null when never recovered. */
  readonly settledCoverage: number | null;
}

/**
 * How long coverage took to come back after a shift.
 *
 * Recovery is declared when the trailing coverage over the last `probe` scored
 * events reaches `target` — a trailing window, not a cumulative average, so a
 * long pre-shift run of hits cannot mask a still-broken tail.
 */
export function recoveryAfterShift(
  observations: readonly AciObservation[],
  shiftAt: number,
  target = COVERAGE_TARGET,
  budget = RECOVERY_BUDGET,
  probe = 55,
): RecoveryReport {
  const tail: boolean[] = [];
  let recoveredAfter: number | null = null;
  let settledFrom = -1;

  for (let i = Math.max(0, shiftAt); i < observations.length; i++) {
    const o = observations[i];
    if (o.covered === null) continue;
    tail.push(o.covered);
    if (recoveredAfter === null && tail.length >= probe) {
      const w = tail.slice(tail.length - probe);
      const cov = w.reduce((a, b) => a + (b ? 1 : 0), 0) / probe;
      if (cov >= target) {
        recoveredAfter = tail.length;
        settledFrom = tail.length;
      }
    }
  }

  const tailCoverage = tail.length > 0
    ? tail.reduce((a, b) => a + (b ? 1 : 0), 0) / tail.length
    : null;
  let settledCoverage: number | null = null;
  if (settledFrom >= 0 && settledFrom < tail.length) {
    const rest = tail.slice(settledFrom);
    settledCoverage = rest.reduce((a, b) => a + (b ? 1 : 0), 0) / rest.length;
  }

  return {
    shiftAt,
    scored: tail.length,
    recoveredAfter,
    withinBudget: recoveredAfter !== null && recoveredAfter <= budget,
    tailCoverage,
    settledCoverage,
  };
}
