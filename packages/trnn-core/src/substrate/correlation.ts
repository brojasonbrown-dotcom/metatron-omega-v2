/**
 * Ω-REAL · P2 — Level-2 correlation stack.
 *
 * Six dependence estimators over paired samples, spanning the whole ladder from
 * "linear only" to "any dependence at all":
 *
 *   pearson              linear, fastest, most fragile
 *   spearman             monotone, rank based, outlier robust
 *   kendallTauB          monotone by concordance, tie corrected
 *   distanceCorrelation  ANY dependence; 0 ⇔ independence (Székely)
 *   hsic                 kernel dependence, median-heuristic RBF
 *   gaussianMI           mutual information via the rank-normal copula
 *
 * THREE RULES, ENFORCED IN CODE — not in a comment on a dashboard:
 *
 * 1. THE ABSTENTION FLOOR. Below `STAT_FLOOR` = F9 = 34 paired samples every
 *    estimator returns `null` and `abstained: true`. It never returns 0.
 *    A correlation computed on 6 points is noise wearing a number's clothes,
 *    and the whole point of this programme is that a symbol only becomes a
 *    measurement when it has earned one.
 *
 * 2. O(n²) IS CAPPED. dCor, HSIC and Kendall are quadratic. They subsample
 *    deterministically (uniform stride, no RNG) down to `QUADRATIC_CAP` so a
 *    long window can never stall the caller. `n` in the result is the number
 *    of points actually used, so the reader is never misled about the evidence.
 *
 * 3. SIGNIFICANCE IS PERMUTED, NOT ASSUMED. `permutationTest` destroys the
 *    pairing with a seeded Fisher–Yates and reports the (B+1)-corrected
 *    one-sided p-value. No estimator here has a trustworthy analytic null on
 *    autocorrelated field data, so none of them claims one.
 */

import { SeedStream } from '../core/determinism';
import { dexp, dlog } from '../core/dmath';

/** F9 — the minimum paired-sample count for a Level-2 statistic to speak. */
export const STAT_FLOOR = 34;

/** Hard cap on n for the O(n²) estimators (deterministic uniform subsample). */
export const QUADRATIC_CAP = 512;

export interface StatResult {
  /** Estimate, or null when the estimator abstains. NEVER 0-as-abstention. */
  readonly value: number | null;
  /** Samples actually used (after any deterministic subsampling). */
  readonly n: number;
  readonly abstained: boolean;
  readonly reason?: string;
}

const abstain = (n: number, reason: string): StatResult => ({
  value: null,
  n,
  abstained: true,
  reason,
});

function pairLength(x: ArrayLike<number>, y: ArrayLike<number>): number {
  return Math.min(x.length, y.length);
}

/** Uniform-stride subsample — deterministic, phase-stable, no RNG. */
export function decimate(x: ArrayLike<number>, cap: number): Float64Array {
  const n = x.length;
  if (n <= cap) return Float64Array.from(x as ArrayLike<number>);
  const out = new Float64Array(cap);
  for (let i = 0; i < cap; i++) out[i] = x[Math.floor((i * n) / cap)];
  return out;
}

/* ── Pearson ──────────────────────────────────────────────────────────────── */

export function pearson(x: ArrayLike<number>, y: ArrayLike<number>): StatResult {
  const n = pairLength(x, y);
  if (n < STAT_FLOOR) return abstain(n, `n=${n} < F9 floor ${STAT_FLOOR}`);
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    sxy += a * b;
    sxx += a * a;
    syy += b * b;
  }
  if (sxx <= 0 || syy <= 0) return abstain(n, 'zero variance in one channel');
  const r = sxy / Math.sqrt(sxx * syy);
  return { value: Math.max(-1, Math.min(1, r)), n, abstained: false };
}

/* ── ranks (average ranks for ties) ───────────────────────────────────────── */

export function rank(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => x[a] - x[b]);
  const r = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && x[idx[j + 1]] === x[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}

export function spearman(x: ArrayLike<number>, y: ArrayLike<number>): StatResult {
  const n = pairLength(x, y);
  if (n < STAT_FLOOR) return abstain(n, `n=${n} < F9 floor ${STAT_FLOOR}`);
  return pearson(rank(Float64Array.from(x as ArrayLike<number>).slice(0, n)), rank(Float64Array.from(y as ArrayLike<number>).slice(0, n)));
}

/* ── Kendall τ-b ──────────────────────────────────────────────────────────── */

/**
 * τ-b = (C − D) / sqrt((n₀−n₁)(n₀−n₂)) — the tie-corrected form. τ-a is wrong
 * on quantised sensor data, where ties are the rule rather than the exception.
 */
export function kendallTauB(x: ArrayLike<number>, y: ArrayLike<number>): StatResult {
  const nRaw = pairLength(x, y);
  if (nRaw < STAT_FLOOR) return abstain(nRaw, `n=${nRaw} < F9 floor ${STAT_FLOOR}`);
  const a = decimate(Float64Array.from(x as ArrayLike<number>).slice(0, nRaw), QUADRATIC_CAP);
  const b = decimate(Float64Array.from(y as ArrayLike<number>).slice(0, nRaw), QUADRATIC_CAP);
  const n = a.length;
  let conc = 0;
  let disc = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = a[i] - a[j];
      const dy = b[i] - b[j];
      const s = Math.sign(dx) * Math.sign(dy);
      if (s > 0) conc++;
      else if (s < 0) disc++;
      else {
        if (dx === 0 && dy !== 0) tx++;
        else if (dy === 0 && dx !== 0) ty++;
        else {
          tx++;
          ty++;
        }
      }
    }
  }
  const n0 = (n * (n - 1)) / 2;
  const den = Math.sqrt((n0 - tx) * (n0 - ty));
  if (!(den > 0)) return abstain(n, 'all pairs tied');
  return { value: Math.max(-1, Math.min(1, (conc - disc) / den)), n, abstained: false };
}

/* ── distance correlation ─────────────────────────────────────────────────── */

function doubleCenter(v: Float64Array, n: number): Float64Array {
  const rowMean = new Float64Array(n);
  let grand = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += v[i * n + j];
    rowMean[i] = s / n;
    grand += s;
  }
  grand /= n * n;
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) out[i * n + j] = v[i * n + j] - rowMean[i] - rowMean[j] + grand;
  }
  return out;
}

function distMatrix(x: Float64Array): Float64Array {
  const n = x.length;
  const d = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = Math.abs(x[i] - x[j]);
      d[i * n + j] = v;
      d[j * n + i] = v;
    }
  }
  return d;
}

/**
 * Székely–Rizzo distance correlation. dCor = 0 ⇔ independence, which no
 * moment-based statistic can claim; that is why it is worth the O(n²).
 */
export function distanceCorrelation(x: ArrayLike<number>, y: ArrayLike<number>): StatResult {
  const nRaw = pairLength(x, y);
  if (nRaw < STAT_FLOOR) return abstain(nRaw, `n=${nRaw} < F9 floor ${STAT_FLOOR}`);
  const a = decimate(Float64Array.from(x as ArrayLike<number>).slice(0, nRaw), QUADRATIC_CAP);
  const b = decimate(Float64Array.from(y as ArrayLike<number>).slice(0, nRaw), QUADRATIC_CAP);
  const n = a.length;
  const A = doubleCenter(distMatrix(a), n);
  const B = doubleCenter(distMatrix(b), n);
  let dcov = 0;
  let dvx = 0;
  let dvy = 0;
  for (let i = 0; i < n * n; i++) {
    dcov += A[i] * B[i];
    dvx += A[i] * A[i];
    dvy += B[i] * B[i];
  }
  const m = n * n;
  dcov /= m;
  dvx /= m;
  dvy /= m;
  const den = Math.sqrt(Math.max(0, dvx) * Math.max(0, dvy));
  if (!(den > 0)) return abstain(n, 'degenerate distance variance');
  return { value: Math.min(1, Math.sqrt(Math.max(0, dcov) / den)), n, abstained: false };
}

/* ── HSIC ─────────────────────────────────────────────────────────────────── */

/** Median of pairwise |xi−xj| — the standard RBF bandwidth heuristic. */
export function medianPairwise(x: Float64Array): number {
  const n = x.length;
  const d: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) d.push(Math.abs(x[i] - x[j]));
  if (d.length === 0) return 1;
  d.sort((p, q) => p - q);
  const mid = d.length >> 1;
  const med = d.length % 2 ? d[mid] : 0.5 * (d[mid - 1] + d[mid]);
  return med > 0 ? med : 1;
}

function rbfGram(x: Float64Array, sigma: number): Float64Array {
  const n = x.length;
  const k = new Float64Array(n * n);
  const inv = 1 / (2 * sigma * sigma);
  for (let i = 0; i < n; i++) {
    k[i * n + i] = 1;
    for (let j = i + 1; j < n; j++) {
      const dd = x[i] - x[j];
      const v = dexp(-dd * dd * inv);
      k[i * n + j] = v;
      k[j * n + i] = v;
    }
  }
  return k;
}

/**
 * Biased HSIC V-statistic with median-heuristic RBF kernels, normalised to
 * [0,1] as HSIC/sqrt(HSIC_xx·HSIC_yy) so readings are comparable across
 * channels with different scales.
 */
export function hsic(x: ArrayLike<number>, y: ArrayLike<number>): StatResult {
  const nRaw = pairLength(x, y);
  if (nRaw < STAT_FLOOR) return abstain(nRaw, `n=${nRaw} < F9 floor ${STAT_FLOOR}`);
  const a = decimate(Float64Array.from(x as ArrayLike<number>).slice(0, nRaw), QUADRATIC_CAP);
  const b = decimate(Float64Array.from(y as ArrayLike<number>).slice(0, nRaw), QUADRATIC_CAP);
  const n = a.length;
  const K = doubleCenter(rbfGram(a, medianPairwise(a)), n);
  const L = doubleCenter(rbfGram(b, medianPairwise(b)), n);
  let kl = 0;
  let kk = 0;
  let ll = 0;
  for (let i = 0; i < n * n; i++) {
    kl += K[i] * L[i];
    kk += K[i] * K[i];
    ll += L[i] * L[i];
  }
  const den = Math.sqrt(Math.max(0, kk) * Math.max(0, ll));
  if (!(den > 0)) return abstain(n, 'degenerate kernel matrices');
  return { value: Math.max(0, Math.min(1, kl / den)), n, abstained: false };
}

/* ── Gaussian (copula) mutual information ─────────────────────────────────── */

/** Acklam inverse normal CDF, ~1.15e-9 relative accuracy. */
export function invNormalCdf(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  const q = p;
  if (q <= 0) return -Infinity;
  if (q >= 1) return Infinity;
  if (q < pl) {
    const t = Math.sqrt(-2 * dlog(q));
    return (((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
  }
  if (q > 1 - pl) {
    const t = Math.sqrt(-2 * dlog(1 - q));
    return -(((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) / ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
  }
  const t = q - 0.5;
  const r = t * t;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Rank → normal scores (the empirical Gaussian copula transform). */
export function normalScores(x: ArrayLike<number>): Float64Array {
  const r = rank(x);
  const n = r.length;
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = invNormalCdf(r[i] / (n + 1));
  return z;
}

/**
 * MI in nats under the Gaussian-copula model: I = −½ln(1−ρ²) on normal scores.
 * This is a LOWER BOUND on true MI (it sees only copula-linear dependence) and
 * is reported as such — it will not detect a pure U-shape.
 */
export function gaussianMI(x: ArrayLike<number>, y: ArrayLike<number>): StatResult {
  const n = pairLength(x, y);
  if (n < STAT_FLOOR) return abstain(n, `n=${n} < F9 floor ${STAT_FLOOR}`);
  const r = pearson(normalScores(Float64Array.from(x as ArrayLike<number>).slice(0, n)), normalScores(Float64Array.from(y as ArrayLike<number>).slice(0, n)));
  if (r.value === null) return abstain(n, r.reason ?? 'copula transform degenerate');
  const rho = Math.max(-0.999999999, Math.min(0.999999999, r.value));
  return { value: Math.max(0, -0.5 * dlog(1 - rho * rho)), n, abstained: false };
}

/* ── permutation calibration ──────────────────────────────────────────────── */

export interface PermutationResult extends StatResult {
  /** One-sided p-value with the (B+1) correction, or null when abstaining. */
  readonly p: number | null;
  readonly permutations: number;
}

/**
 * Seeded permutation null. p = (1 + #{|stat*| ≥ |stat|}) / (B + 1) — the +1
 * keeps p strictly positive, which is required for any downstream multiple
 * testing correction to be valid.
 */
export function permutationTest(
  stat: (a: ArrayLike<number>, b: ArrayLike<number>) => StatResult,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: { permutations?: number; seed?: string } = {},
): PermutationResult {
  const B = opts.permutations ?? 199;
  const base = stat(x, y);
  if (base.value === null) return { ...base, p: null, permutations: 0 };
  const n = pairLength(x, y);
  const ys = Float64Array.from(y as ArrayLike<number>).slice(0, n);
  const rng = new SeedStream(opts.seed ?? 'omega-real/p2/permutation');
  const buf = new Float64Array(n);
  let ge = 0;
  for (let b = 0; b < B; b++) {
    buf.set(ys);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = buf[i];
      buf[i] = buf[j];
      buf[j] = t;
    }
    const s = stat(x, buf);
    if (s.value !== null && Math.abs(s.value) >= Math.abs(base.value) - 1e-15) ge++;
  }
  return { ...base, p: (1 + ge) / (B + 1), permutations: B };
}

/* ── the whole family at once ─────────────────────────────────────────────── */

export interface CorrelationReport {
  readonly n: number;
  readonly abstained: boolean;
  readonly pearson: StatResult;
  readonly spearman: StatResult;
  readonly kendall: StatResult;
  readonly dcor: StatResult;
  readonly hsic: StatResult;
  readonly mi: StatResult;
}

/** Runs the full Level-2 family. Off the tick path — quadratic members inside. */
export function correlationReport(x: ArrayLike<number>, y: ArrayLike<number>): CorrelationReport {
  const n = pairLength(x, y);
  const r = {
    n,
    pearson: pearson(x, y),
    spearman: spearman(x, y),
    kendall: kendallTauB(x, y),
    dcor: distanceCorrelation(x, y),
    hsic: hsic(x, y),
    mi: gaussianMI(x, y),
  };
  return { ...r, abstained: r.pearson.abstained };
}
