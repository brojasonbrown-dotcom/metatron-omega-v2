/**
 * Ω-SCALE P1 — split-conformal calibration.
 *
 * Every number the dashboard shows is a point estimate with no statement of
 * how far it can be wrong. That is exactly the defect class that produced a
 * "full coherence" reading on an unstable engine: the value was computable,
 * so it was published, and nothing recorded that it was not yet trustworthy.
 *
 * Split conformal prediction fixes that without any distributional assumption
 * and without touching the predictor. Given a calibration set of nonconformity
 * scores s_1..s_n (here |observed − predicted|), the interval
 *
 *   [ŷ − q, ŷ + q],   q = the ⌈(n+1)(1−α)⌉-th smallest score
 *
 * covers the next observation with probability ≥ 1 − α, provided the scores
 * are exchangeable. That proviso is the whole game for a live signal, so this
 * module does not merely emit the band — it *measures its own coverage* on the
 * frames that follow and reports the calibration as stale when the empirical
 * coverage drifts away from the nominal level. A band that is not covering is
 * worse than no band, so it is withdrawn rather than quietly widened.
 *
 * Rules enforced here:
 *  - NaN in, no interval out. An unmeasured channel never gets a fabricated
 *    band (same contract as `channelSampler`).
 *  - Below `minCalibration` samples the finite-sample guarantee is vacuous
 *    (q would be +∞), so the calibrator abstains instead of guessing.
 *  - Pure and allocation-light: a fixed ring per channel, no per-frame arrays.
 */

/** Nominal miscoverage. α = 0.1 → a 90% interval. */
export const DEFAULT_ALPHA = 0.1;

/**
 * Smallest calibration set with a non-vacuous guarantee at α: the conformal
 * quantile index ⌈(n+1)(1−α)⌉ must be ≤ n, i.e. n ≥ ⌈1/α⌉ − 1. We demand a
 * comfortable multiple of that so the band is not driven by one outlier.
 */
export function minCalibrationFor(alpha: number): number {
  return Math.max(8, Math.ceil(1 / alpha) * 2);
}

export interface CalibratedInterval {
  /** The point estimate the interval is centred on. */
  readonly value: number;
  /** Half-width. Always finite and ≥ 0 when present. */
  readonly halfWidth: number;
  readonly lower: number;
  readonly upper: number;
  /** Nominal coverage level, 1 − α. */
  readonly level: number;
  /** Calibration samples behind this band. */
  readonly samples: number;
  /**
   * Empirical coverage measured on the frames scored *after* calibration, or
   * NaN before enough of them exist. This is the number to distrust the band
   * by, not the nominal level.
   */
  readonly coverage: number;
  /** True when empirical coverage has drifted outside tolerance of nominal. */
  readonly stale: boolean;
}

export interface CalibratorOptions {
  /** Miscoverage rate; 0.1 → 90% intervals. */
  readonly alpha?: number;
  /** Calibration ring capacity. Older scores fall out first. */
  readonly capacity?: number;
  /**
   * Absolute tolerance on |empirical − nominal| coverage before the band is
   * declared stale. 0.1 means a 90% band may run between 80% and 100%.
   */
  readonly coverageTolerance?: number;
  /** Coverage observations required before staleness is judged. */
  readonly minCoverageSamples?: number;
}

/**
 * One channel's calibrator.
 *
 * Usage per frame, in this order:
 *   1. `interval(prediction)` — the band you publish, from scores seen so far.
 *   2. `observe(prediction, actual)` — feeds the score ring *and* scores the
 *      band that was just published against the truth, which is what makes the
 *      coverage figure honest rather than in-sample.
 */
export class ConformalCalibrator {
  readonly alpha: number;
  readonly capacity: number;
  readonly coverageTolerance: number;
  readonly minCoverageSamples: number;

  private readonly scores: Float64Array;
  private count = 0;
  private head = 0;
  /** Sorted scratch, reallocated only when the live count grows. */
  private sorted: Float64Array;

  private covered = 0;
  private coverageSeen = 0;
  /** Half-width published on the previous frame, NaN if none. */
  private lastHalfWidth = NaN;

  constructor(opts: CalibratorOptions = {}) {
    this.alpha = clampAlpha(opts.alpha ?? DEFAULT_ALPHA);
    this.capacity = Math.max(minCalibrationFor(this.alpha), Math.floor(opts.capacity ?? 233));
    this.coverageTolerance = Math.min(1, Math.max(0.01, opts.coverageTolerance ?? 0.1));
    this.minCoverageSamples = Math.max(8, Math.floor(opts.minCoverageSamples ?? 55));
    this.scores = new Float64Array(this.capacity);
    this.sorted = new Float64Array(this.capacity);
  }

  get samples(): number {
    return this.count;
  }

  get level(): number {
    return 1 - this.alpha;
  }

  /** Empirical coverage of published bands, NaN until enough observations. */
  get coverage(): number {
    return this.coverageSeen >= this.minCoverageSamples ? this.covered / this.coverageSeen : NaN;
  }

  get stale(): boolean {
    const c = this.coverage;
    return Number.isFinite(c) && Math.abs(c - this.level) > this.coverageTolerance;
  }

  /** Drop all calibration and coverage history. */
  reset(): void {
    this.count = 0;
    this.head = 0;
    this.covered = 0;
    this.coverageSeen = 0;
    this.lastHalfWidth = NaN;
  }

  /**
   * Conformal half-width, or NaN while the guarantee would be vacuous.
   *
   * q is the ⌈(n+1)(1−α)⌉-th smallest score. When that index exceeds n the
   * true quantile is +∞ — the honest answer is "no band", not a wide one.
   */
  quantile(): number {
    const n = this.count;
    if (n < minCalibrationFor(this.alpha)) return NaN;
    const idx = Math.ceil((n + 1) * (1 - this.alpha));
    if (idx > n) return NaN;
    if (this.sorted.length < n) this.sorted = new Float64Array(n);
    for (let i = 0; i < n; i++) this.sorted[i] = this.scores[i];
    const view = this.sorted.subarray(0, n);
    view.sort();
    return view[idx - 1];
  }

  /**
   * Band around `value`. Returns null when the value is unmeasured (NaN) or
   * the calibration set cannot yet support a guarantee.
   */
  interval(value: number): CalibratedInterval | null {
    if (!Number.isFinite(value)) {
      this.lastHalfWidth = NaN;
      return null;
    }
    const q = this.quantile();
    this.lastHalfWidth = q;
    if (!Number.isFinite(q)) return null;
    return {
      value,
      halfWidth: q,
      lower: value - q,
      upper: value + q,
      level: this.level,
      samples: this.count,
      coverage: this.coverage,
      stale: this.stale,
    };
  }

  /**
   * Record a (prediction, truth) pair.
   *
   * Scores the band published by the immediately preceding `interval()` call
   * before absorbing the new residual, so coverage is always out-of-sample.
   */
  observe(prediction: number, actual: number): void {
    if (!Number.isFinite(prediction) || !Number.isFinite(actual)) {
      this.lastHalfWidth = NaN;
      return;
    }
    const score = Math.abs(actual - prediction);
    if (Number.isFinite(this.lastHalfWidth)) {
      this.coverageSeen++;
      if (score <= this.lastHalfWidth) this.covered++;
      this.lastHalfWidth = NaN;
    }
    this.scores[this.head] = score;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
}

/**
 * Persistence-free calibration over an explicit score array — the offline form
 * used by tests and by tape replay, where there is no streaming order to keep.
 */
export function conformalQuantile(scores: readonly number[], alpha = DEFAULT_ALPHA): number {
  const a = clampAlpha(alpha);
  const finite = scores.filter((s) => Number.isFinite(s)).map(Math.abs);
  const n = finite.length;
  if (n < minCalibrationFor(a)) return NaN;
  const idx = Math.ceil((n + 1) * (1 - a));
  if (idx > n) return NaN;
  finite.sort((x, y) => x - y);
  return finite[idx - 1];
}

/**
 * A named bank of calibrators — one per analysis channel. Channels are created
 * lazily so a source that never reports never allocates.
 */
export class CalibrationBank<K extends string = string> {
  private readonly bank = new Map<K, ConformalCalibrator>();

  constructor(private readonly opts: CalibratorOptions = {}) {}

  get(id: K): ConformalCalibrator {
    let c = this.bank.get(id);
    if (!c) {
      c = new ConformalCalibrator(this.opts);
      this.bank.set(id, c);
    }
    return c;
  }

  /** Ids that currently hold calibration state. */
  ids(): K[] {
    return [...this.bank.keys()];
  }

  reset(): void {
    for (const c of this.bank.values()) c.reset();
  }
}

function clampAlpha(a: number): number {
  if (!Number.isFinite(a)) return DEFAULT_ALPHA;
  return Math.min(0.5, Math.max(0.001, a));
}
