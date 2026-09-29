/**
 * causal.ts — Level-3 of the Ω-REAL measurement stack: directed dependence.
 *
 * WHAT THIS IS
 * ------------
 * Three estimators that answer *directed* questions, where Level-2
 * (correlation.ts) only answers symmetric ones:
 *
 *   1. Granger causality  — does the past of x reduce the prediction error of y
 *                           beyond y's own past?  Exact F test, p-value from a
 *                           from-scratch regularized incomplete beta.
 *   2. Transfer entropy   — the Gaussian-copula CMI  TE(x→y) = ½·ln(RSS_r/RSS_f),
 *                           which is exactly ½·the Granger statistic's log ratio
 *                           (Barnett–Barrett–Seth equivalence), reported in nats,
 *                           with a lag scan that returns `bestLag: null` when
 *                           every lag abstains — never lag 0 as a sentinel.
 *   3. DML (partially     — Chernozhukov double/debiased ML for the partially
 *      linear model)        linear model  y = θ·d + g(X) + ε,  d = m(X) + ν,
 *                           cross-fitted, Neyman-orthogonal score, θ / SE / CI.
 *                           The nuisance learner is a from-scratch deterministic
 *                           variance-reduction regression forest (no sklearn,
 *                           no Math.random).
 *
 * LAW COMPLIANCE
 * --------------
 * - Every transcendental goes through `dmath`; the only bare Math calls are the
 *   exactly-specified ones (sqrt/abs/floor/min/max).
 * - No `Math.random`: the forest's bootstrap and feature subsampling are driven
 *   by `SeedStream`, so a fit is reproducible bit-for-bit.
 * - Abstention is `null`, never 0, and always carries a reason. The paired-sample
 *   floor is the same F9 = `STAT_FLOOR` = 34 used at Level-2, applied to the
 *   *effective* sample count after lag embedding (n − lag), not the raw length.
 * - Nothing here runs on the tick path: these are batch estimators.
 */

import { dexp, dlog, dsin } from '../core/dmath';
import { SeedStream } from '../core/determinism';
import { STAT_FLOOR } from './correlation';

/* ── special functions ────────────────────────────────────────────────────── */

const LANCZOS_G = 7;
const LANCZOS_P = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** log Γ(x) for x > 0 — Lanczos, ~15 significant digits on the used domain. */
export function lgamma(x: number): number {
  if (x < 0.5) {
    // reflection: Γ(x)Γ(1−x) = π/sin(πx). Not needed by the F/beta paths, but
    // keeping the function total avoids silent NaN if a caller strays.
    return dlog(Math.PI / Math.abs(dsin(Math.PI * x))) - lgamma(1 - x);
  }
  const z = x - 1;
  let a = LANCZOS_P[0];
  for (let i = 1; i < LANCZOS_P.length; i++) a += LANCZOS_P[i] / (z + i);
  const t = z + LANCZOS_G + 0.5;
  return 0.5 * dlog(2 * Math.PI) + (z + 0.5) * dlog(t) - t + dlog(a);
}

/** Continued fraction for the incomplete beta (Lentz, NR §6.4). */
function betacf(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a,b) ∈ [0,1]. */
export function regIncBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = dexp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * dlog(x) + b * dlog(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? (front * betacf(a, b, x)) / a
    : 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** Upper tail P(F_{d1,d2} > f) — the Granger p-value. */
export function fSurvival(f: number, d1: number, d2: number): number {
  if (!(f > 0)) return 1;
  const x = d2 / (d2 + d1 * f);
  return regIncBeta(d2 / 2, d1 / 2, x);
}

const TWO_OVER_SQRT_PI = 1.1283791670955126;

/**
 * erfc(x) to ~1e-16 relative: Maclaurin series below |x|=1 (where it converges
 * in ~25 terms), Lentz continued fraction above. The Numerical-Recipes rational
 * `erfccheb` only reaches ~1.2e-7 — that is fine for a plot and not fine for a
 * p-value, so it is deliberately not used here.
 */
export function erfc(x: number): number {
  const a = Math.abs(x);
  let e: number;
  if (a < 1) {
    let term = a;
    let sum = a;
    for (let n = 1; n < 60; n++) {
      term *= (-a * a) / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-18 * Math.abs(sum)) break;
    }
    e = 1 - TWO_OVER_SQRT_PI * sum;
  } else {
    // erfc(a) = exp(−a²)/√π · 1/(a + ½/(a + 1/(a + 3/2/(a + …))))
    const TINY = 1e-300;
    // Lentz on f = a1/(b1 + a2/(b2 + …)) with b_j = a, a_1 = 1, a_j = (j−1)/2.
    let f = TINY;
    let C = f;
    let D = 0;
    for (let j = 1; j < 400; j++) {
      const aj = j === 1 ? 1 : (j - 1) / 2;
      D = a + aj * D;
      if (Math.abs(D) < TINY) D = TINY;
      C = a + aj / C;
      if (Math.abs(C) < TINY) C = TINY;
      D = 1 / D;
      const delta = C * D;
      f *= delta;
      if (Math.abs(delta - 1) < 1e-17) break;
    }
    e = (dexp(-a * a) / Math.sqrt(Math.PI)) * f;
  }
  return x >= 0 ? e : 2 - e;
}

/** Φ(z) — standard normal CDF, accurate to ~1e-15 across the used domain. */
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/* ── linear algebra: ridge-stabilised OLS via Cholesky ────────────────────── */

export interface OlsFit {
  readonly beta: Float64Array;
  /** Residual sum of squares. */
  readonly rss: number;
  readonly n: number;
  readonly k: number;
  readonly singular: boolean;
}

/**
 * Least squares for the design matrix `X` (row-major, n×k) against `y`.
 * A ridge of `ridge`·trace/k is added only if the plain Cholesky fails, so an
 * identifiable problem is solved exactly and a collinear one degrades instead
 * of returning NaN. `singular` is reported so callers can abstain.
 */
export function olsFit(
  X: Float64Array,
  y: ArrayLike<number>,
  n: number,
  k: number,
  ridge = 1e-10,
): OlsFit {
  const A = new Float64Array(k * k);
  const b = new Float64Array(k);
  for (let i = 0; i < n; i++) {
    const row = i * k;
    for (let p = 0; p < k; p++) {
      const xp = X[row + p];
      b[p] += xp * y[i];
      for (let q = p; q < k; q++) A[p * k + q] += xp * X[row + q];
    }
  }
  for (let p = 0; p < k; p++) for (let q = 0; q < p; q++) A[p * k + q] = A[q * k + p];

  let trace = 0;
  for (let p = 0; p < k; p++) trace += A[p * k + p];
  const lam = ridge * (trace / Math.max(1, k) + 1e-300);

  let singular = false;
  let L = cholesky(A, k);
  if (!L) {
    singular = true;
    const R = Float64Array.from(A);
    for (let p = 0; p < k; p++) R[p * k + p] += lam;
    L = cholesky(R, k);
    if (!L) {
      return { beta: new Float64Array(k), rss: Number.NaN, n, k, singular: true };
    }
  }
  const beta = choleskySolve(L, b, k);

  let rss = 0;
  for (let i = 0; i < n; i++) {
    let f = 0;
    const row = i * k;
    for (let p = 0; p < k; p++) f += X[row + p] * beta[p];
    const r = y[i] - f;
    rss += r * r;
  }
  return { beta, rss, n, k, singular };
}

function cholesky(A: Float64Array, k: number): Float64Array | null {
  const L = new Float64Array(k * k);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * k + j];
      for (let m = 0; m < j; m++) s -= L[i * k + m] * L[j * k + m];
      if (i === j) {
        if (!(s > 1e-300)) return null;
        L[i * k + j] = Math.sqrt(s);
      } else {
        L[i * k + j] = s / L[j * k + j];
      }
    }
  }
  return L;
}

function choleskySolve(L: Float64Array, b: Float64Array, k: number): Float64Array {
  const z = new Float64Array(k);
  for (let i = 0; i < k; i++) {
    let s = b[i];
    for (let m = 0; m < i; m++) s -= L[i * k + m] * z[m];
    z[i] = s / L[i * k + i];
  }
  const x = new Float64Array(k);
  for (let i = k - 1; i >= 0; i--) {
    let s = z[i];
    for (let m = i + 1; m < k; m++) s -= L[m * k + i] * x[m];
    x[i] = s / L[i * k + i];
  }
  return x;
}

/* ── Granger causality ────────────────────────────────────────────────────── */

export interface CausalResult {
  /** Statistic value, or null when the estimator abstains. */
  readonly value: number | null;
  /** Two-model p-value where defined. */
  readonly p: number | null;
  /** Effective paired samples used (n − lag). */
  readonly n: number;
  readonly lag: number;
  readonly abstained: boolean;
  readonly reason?: string;
}

const causalAbstain = (n: number, lag: number, reason: string): CausalResult => ({
  value: null,
  p: null,
  n,
  lag,
  abstained: true,
  reason,
});

interface Embedding {
  readonly X: Float64Array;
  readonly y: Float64Array;
  readonly n: number;
  readonly k: number;
}

/**
 * Builds the restricted / full designs for lag L:
 *   restricted  y_t ~ 1 + y_{t−1..t−L}
 *   full        y_t ~ 1 + y_{t−1..t−L} + x_{t−1..t−L}
 */
function embed(y: ArrayLike<number>, x: ArrayLike<number> | null, lag: number): Embedding {
  const N = x ? Math.min(y.length, x.length) : y.length;
  const n = N - lag;
  const k = 1 + lag + (x ? lag : 0);
  const X = new Float64Array(n * k);
  const t = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = i * k;
    const now = i + lag;
    X[row] = 1;
    for (let l = 1; l <= lag; l++) X[row + l] = y[now - l];
    if (x) for (let l = 1; l <= lag; l++) X[row + lag + l] = x[now - l];
    t[i] = y[now];
  }
  return { X, y: t, n, k };
}

/**
 * Granger F test for "x causes y" at the given lag.
 * `value` is the F statistic; `p` is the exact upper-tail probability.
 */
export function grangerCausality(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  lag = 1,
): CausalResult {
  const L = Math.max(1, Math.floor(lag));
  const N = Math.min(x.length, y.length);
  const n = N - L;
  if (n < STAT_FLOOR) return causalAbstain(Math.max(0, n), L, `n=${n} < F9 floor ${STAT_FLOOR}`);
  const full = embed(y, x, L);
  if (full.n - full.k < 1) return causalAbstain(n, L, 'no residual degrees of freedom');
  const restricted = embed(y, null, L);

  const fr = olsFit(restricted.X, restricted.y, restricted.n, restricted.k);
  const ff = olsFit(full.X, full.y, full.n, full.k);
  if (!Number.isFinite(fr.rss) || !Number.isFinite(ff.rss)) {
    return causalAbstain(n, L, 'design matrix not solvable');
  }
  if (!(ff.rss > 0) || !(fr.rss > 0)) {
    return causalAbstain(n, L, 'degenerate (zero-residual) fit');
  }
  const df1 = L;
  const df2 = full.n - full.k;
  const F = (fr.rss - ff.rss) / df1 / (ff.rss / df2);
  const Fc = F > 0 ? F : 0;
  return { value: Fc, p: fSurvival(Fc, df1, df2), n, lag: L, abstained: false };
}

/* ── transfer entropy (Gaussian copula / linear CMI) ──────────────────────── */

/**
 * TE(x→y) in nats at a fixed lag: ½·ln(RSS_restricted / RSS_full).
 * For jointly Gaussian variables this equals the conditional mutual information
 * I(y_t ; x_past | y_past), which is the Barnett–Barrett–Seth identity linking
 * it to Granger causality (G = 2·TE).
 */
export function transferEntropyGaussian(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  lag = 1,
): CausalResult {
  const g = grangerCausality(x, y, lag);
  if (g.value === null) return g;
  const L = g.lag;
  const full = embed(y, x, L);
  const restricted = embed(y, null, L);
  const fr = olsFit(restricted.X, restricted.y, restricted.n, restricted.k);
  const ff = olsFit(full.X, full.y, full.n, full.k);
  const ratio = fr.rss / ff.rss;
  const te = ratio > 1 ? 0.5 * dlog(ratio) : 0;
  return { value: te, p: g.p, n: g.n, lag: L, abstained: false };
}

export interface LagScanResult {
  /**
   * The lag with the strongest evidence, or **null** when every candidate lag
   * abstained. It is never 0-as-sentinel: 0 is not a candidate lag at all.
   */
  readonly bestLag: number | null;
  readonly best: CausalResult | null;
  readonly perLag: readonly CausalResult[];
  readonly abstained: boolean;
  readonly reason?: string;
}

/**
 * Scans lags 1..maxLag and returns the strongest *significant* directed link.
 * Selection is by smallest p-value, ties broken by the larger TE then the
 * smaller lag, so the result is deterministic. A Bonferroni threshold over the
 * scanned lags is applied: without it, scanning L lags inflates the false
 * positive rate by roughly L.
 */
export function transferEntropyScan(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: { maxLag?: number; alpha?: number } = {},
): LagScanResult {
  const maxLag = Math.max(1, Math.floor(opts.maxLag ?? 8));
  const alpha = opts.alpha ?? 0.05;
  const perLag: CausalResult[] = [];
  for (let L = 1; L <= maxLag; L++) perLag.push(transferEntropyGaussian(x, y, L));

  const threshold = alpha / maxLag;
  let best: CausalResult | null = null;
  for (const r of perLag) {
    if (r.value === null || r.p === null || r.p > threshold) continue;
    if (
      best === null ||
      r.p < (best.p as number) ||
      (r.p === best.p && (r.value > (best.value as number) || r.lag < best.lag))
    ) {
      best = r;
    }
  }
  if (!best) {
    const anyMeasured = perLag.some((r) => r.value !== null);
    return {
      bestLag: null,
      best: null,
      perLag,
      abstained: true,
      reason: anyMeasured
        ? `no lag significant at Bonferroni α/${maxLag}=${threshold}`
        : (perLag[0]?.reason ?? 'all lags abstained'),
    };
  }
  return { bestLag: best.lag, best, perLag, abstained: false };
}

/* ── deterministic variance-reduction regression forest ───────────────────── */

interface TreeNode {
  feature: number;
  threshold: number;
  left: number;
  right: number;
  value: number;
}

export interface ForestOptions {
  trees?: number;
  minLeaf?: number;
  maxDepth?: number;
  /** Features sampled per split; default ⌈√p⌉ (⌈p/3⌉ is the regression default
   *  but √p is more stable at the small p we use). */
  featuresPerSplit?: number;
  seed?: string;
}

/**
 * CART with variance-reduction splits, bagged. Deterministic: bootstrap indices
 * and feature subsets come from `SeedStream`, so refitting the same data with
 * the same seed gives bit-identical predictions.
 */
export class RegressionForest {
  private readonly trees: TreeNode[][] = [];
  private readonly p: number;

  constructor(
    X: Float64Array,
    y: ArrayLike<number>,
    n: number,
    p: number,
    opts: ForestOptions = {},
  ) {
    this.p = p;
    const nTrees = Math.max(1, Math.floor(opts.trees ?? 24));
    const minLeaf = Math.max(1, Math.floor(opts.minLeaf ?? 5));
    const maxDepth = Math.max(1, Math.floor(opts.maxDepth ?? 8));
    const mtry = Math.max(1, Math.floor(opts.featuresPerSplit ?? Math.ceil(Math.sqrt(p))));
    const rng = new SeedStream(opts.seed ?? 'omega-real/p3/forest');
    for (let t = 0; t < nTrees; t++) {
      const idx = new Int32Array(n);
      for (let i = 0; i < n; i++) idx[i] = Math.floor(rng.next() * n) % n;
      const nodes: TreeNode[] = [];
      this.grow(X, y, p, idx, 0, n, nodes, 0, maxDepth, minLeaf, mtry, rng);
      this.trees.push(nodes);
    }
  }

  private grow(
    X: Float64Array,
    y: ArrayLike<number>,
    p: number,
    idx: Int32Array,
    lo: number,
    hi: number,
    nodes: TreeNode[],
    depth: number,
    maxDepth: number,
    minLeaf: number,
    mtry: number,
    rng: SeedStream,
  ): number {
    const self = nodes.length;
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += y[idx[i]];
    const count = hi - lo;
    const mean = sum / count;
    nodes.push({ feature: -1, threshold: 0, left: -1, right: -1, value: mean });
    if (depth >= maxDepth || count < 2 * minLeaf) return self;

    let bestGain = 0;
    let bestFeat = -1;
    let bestThr = 0;
    // deterministic feature subsample without replacement (partial Fisher–Yates)
    const feats = new Int32Array(p);
    for (let i = 0; i < p; i++) feats[i] = i;
    for (let i = 0; i < Math.min(mtry, p); i++) {
      const j = i + Math.floor(rng.next() * (p - i));
      const t = feats[i];
      feats[i] = feats[j];
      feats[j] = t;
    }
    const order = Array.from({ length: count }, (_, i) => idx[lo + i]);
    for (let f = 0; f < Math.min(mtry, p); f++) {
      const feat = feats[f];
      order.sort((a, b) => X[a * p + feat] - X[b * p + feat] || a - b);
      let sl = 0;
      let sr = sum;
      for (let i = 0; i < count - 1; i++) {
        const v = y[order[i]];
        sl += v;
        sr -= v;
        const nl = i + 1;
        const nr = count - nl;
        if (nl < minLeaf || nr < minLeaf) continue;
        const a = X[order[i] * p + feat];
        const b = X[order[i + 1] * p + feat];
        if (!(b > a)) continue;
        // variance reduction ∝ nl·mean_l² + nr·mean_r² − n·mean²
        const gain = (sl * sl) / nl + (sr * sr) / nr - (sum * sum) / count;
        if (gain > bestGain) {
          bestGain = gain;
          bestFeat = feat;
          bestThr = 0.5 * (a + b);
        }
      }
    }
    if (bestFeat < 0) return self;

    // partition idx[lo..hi) in place by the chosen split
    let w = lo;
    const buf: number[] = [];
    for (let i = lo; i < hi; i++) {
      const id = idx[i];
      if (X[id * p + bestFeat] <= bestThr) idx[w++] = id;
      else buf.push(id);
    }
    const mid = w;
    for (const id of buf) idx[w++] = id;
    if (mid === lo || mid === hi) return self;

    nodes[self].feature = bestFeat;
    nodes[self].threshold = bestThr;
    nodes[self].left = this.grow(
      X,
      y,
      p,
      idx,
      lo,
      mid,
      nodes,
      depth + 1,
      maxDepth,
      minLeaf,
      mtry,
      rng,
    );
    nodes[self].right = this.grow(
      X,
      y,
      p,
      idx,
      mid,
      hi,
      nodes,
      depth + 1,
      maxDepth,
      minLeaf,
      mtry,
      rng,
    );
    return self;
  }

  predictRow(row: ArrayLike<number>, offset = 0): number {
    let acc = 0;
    for (const nodes of this.trees) {
      let i = 0;
      while (nodes[i].feature >= 0) {
        i = row[offset + nodes[i].feature] <= nodes[i].threshold ? nodes[i].left : nodes[i].right;
      }
      acc += nodes[i].value;
    }
    return acc / this.trees.length;
  }

  predict(X: Float64Array, n: number): Float64Array {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = this.predictRow(X, i * this.p);
    return out;
  }
}

/**
 * Nuisance learner used by DML: a ridge-stabilised linear fit on [1, X, X²]
 * plus a regression forest on what the linear part leaves behind.
 *
 * WHY THE HYBRID. A pure forest is a piecewise-constant approximator; on a
 * smooth confounder it underfits at the leaves, and whatever of g(X) survives
 * in the outcome residual is *correlated with the same survivor* in the
 * treatment residual. That correlation lands directly on θ̂ (measured +0.12 on
 * the R3.6 fixture — 9% bias) even though the Neyman score is orthogonal: the
 * score protects against nuisance *noise*, not against nuisance *bias*. Adding
 * the smooth part analytically removes the shared leftover; the forest then
 * only has to model the genuinely non-smooth remainder.
 */
export class NuisanceLearner {
  private readonly beta: Float64Array;
  private readonly forest: RegressionForest;
  private readonly p: number;
  private readonly k: number;

  constructor(
    X: Float64Array,
    y: ArrayLike<number>,
    n: number,
    p: number,
    opts: ForestOptions = {},
  ) {
    this.p = p;
    this.k = 1 + 2 * p;
    const Z = new Float64Array(n * this.k);
    for (let i = 0; i < n; i++) this.expand(X, i * p, Z, i * this.k);
    const fit = olsFit(Z, y, n, this.k, 1e-8);
    this.beta = fit.beta;
    const resid = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let f = 0;
      for (let j = 0; j < this.k; j++) f += Z[i * this.k + j] * this.beta[j];
      resid[i] = y[i] - f;
    }
    this.forest = new RegressionForest(X, resid, n, p, {
      trees: opts.trees ?? 48,
      minLeaf: opts.minLeaf ?? 3,
      maxDepth: opts.maxDepth ?? 12,
      featuresPerSplit: opts.featuresPerSplit ?? p,
      seed: opts.seed ?? 'omega-real/p3/nuisance',
    });
  }

  private expand(X: Float64Array, src: number, out: Float64Array, dst: number): void {
    out[dst] = 1;
    for (let j = 0; j < this.p; j++) {
      const v = X[src + j];
      out[dst + 1 + j] = v;
      out[dst + 1 + this.p + j] = v * v;
    }
  }

  predictRow(X: Float64Array, offset: number): number {
    const z = new Float64Array(this.k);
    this.expand(X, offset, z, 0);
    let f = 0;
    for (let j = 0; j < this.k; j++) f += z[j] * this.beta[j];
    return f + this.forest.predictRow(X, offset);
  }
}

/* ── DML: partially linear model with cross-fitting ───────────────────────── */

export interface DmlResult {
  /** θ̂ — the causal effect of d on y holding X, or null when abstaining. */
  readonly theta: number | null;
  readonly se: number | null;
  readonly ci: readonly [number, number] | null;
  readonly p: number | null;
  readonly n: number;
  readonly folds: number;
  readonly abstained: boolean;
  readonly reason?: string;
}

export interface DmlOptions extends ForestOptions {
  folds?: number;
}

const dmlAbstain = (n: number, folds: number, reason: string): DmlResult => ({
  theta: null,
  se: null,
  ci: null,
  p: null,
  n,
  folds,
  abstained: true,
  reason,
});

/**
 * Double/debiased ML for  y = θ·d + g(X) + ε,  d = m(X) + ν.
 *
 * Cross-fitting (K folds, deterministic contiguous-stride assignment) removes
 * the own-observation bias of the nuisance fits; the score
 * ψ = (y − ĝ)·(d − m̂) − θ·(d − m̂)² is Neyman-orthogonal, so
 *   θ̂ = Σ ν̂·ỹ / Σ ν̂²   and   SE² = (1/n)·E[ψ²]/E[ν̂²]²   (influence function).
 */
export function dmlPartialLinear(
  y: ArrayLike<number>,
  d: ArrayLike<number>,
  X: Float64Array,
  p: number,
  opts: DmlOptions = {},
): DmlResult {
  const n = Math.min(
    y.length,
    d.length,
    p > 0 ? Math.floor(X.length / p) : Number.MAX_SAFE_INTEGER,
  );
  const K = Math.max(2, Math.floor(opts.folds ?? 5));
  if (n < STAT_FLOOR) return dmlAbstain(Math.max(0, n), K, `n=${n} < F9 floor ${STAT_FLOOR}`);
  if (n < 2 * K) return dmlAbstain(n, K, `n=${n} too small for ${K} folds`);

  const resY = new Float64Array(n);
  const resD = new Float64Array(n);
  const seed = opts.seed ?? 'omega-real/p3/dml';

  for (let k = 0; k < K; k++) {
    const testIdx: number[] = [];
    const trainIdx: number[] = [];
    for (let i = 0; i < n; i++) (i % K === k ? testIdx : trainIdx).push(i);
    const nt = trainIdx.length;
    const Xtr = new Float64Array(nt * p);
    const ytr = new Float64Array(nt);
    const dtr = new Float64Array(nt);
    for (let i = 0; i < nt; i++) {
      const src = trainIdx[i] * p;
      for (let j = 0; j < p; j++) Xtr[i * p + j] = X[src + j];
      ytr[i] = y[trainIdx[i]];
      dtr[i] = d[trainIdx[i]];
    }
    const gHat = new NuisanceLearner(Xtr, ytr, nt, p, { ...opts, seed: `${seed}/g/${k}` });
    const mHat = new NuisanceLearner(Xtr, dtr, nt, p, { ...opts, seed: `${seed}/m/${k}` });
    for (const i of testIdx) {
      resY[i] = y[i] - gHat.predictRow(X, i * p);
      resD[i] = d[i] - mHat.predictRow(X, i * p);
    }
  }

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += resD[i] * resY[i];
    den += resD[i] * resD[i];
  }
  if (!(den > 0))
    return dmlAbstain(n, K, 'treatment fully explained by controls (no residual variation)');
  const theta = num / den;

  let psi2 = 0;
  for (let i = 0; i < n; i++) {
    const psi = resD[i] * (resY[i] - theta * resD[i]);
    psi2 += psi * psi;
  }
  const j0 = den / n;
  const se = Math.sqrt(psi2 / n) / (j0 * Math.sqrt(n));
  if (!(se > 0) || !Number.isFinite(se)) return dmlAbstain(n, K, 'degenerate variance estimate');
  const z = theta / se;
  const pv = 2 * (1 - normalCdf(Math.abs(z)));
  return {
    theta,
    se,
    ci: [theta - 1.959963984540054 * se, theta + 1.959963984540054 * se],
    p: Math.max(0, Math.min(1, pv)),
    n,
    folds: K,
    abstained: false,
  };
}

/* ── directed report ──────────────────────────────────────────────────────── */

export interface DirectedReport {
  readonly forward: LagScanResult;
  readonly reverse: LagScanResult;
  /**
   * Net directionality in [−1,1]: (TE_fwd − TE_rev)/(TE_fwd + TE_rev), or null
   * when either direction abstains. Positive means x drives y.
   */
  readonly netDirection: number | null;
  readonly verdict: 'x→y' | 'y→x' | 'bidirectional' | 'none';
}

/** Runs the scan in both directions and reports a signed directionality index. */
export function directedReport(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: { maxLag?: number; alpha?: number } = {},
): DirectedReport {
  const forward = transferEntropyScan(x, y, opts);
  const reverse = transferEntropyScan(y, x, opts);
  const f = forward.best?.value ?? null;
  const r = reverse.best?.value ?? null;
  let netDirection: number | null = null;
  if (f !== null && r !== null && f + r > 0) netDirection = (f - r) / (f + r);
  const verdict: DirectedReport['verdict'] =
    f !== null && r !== null ? 'bidirectional' : f !== null ? 'x→y' : r !== null ? 'y→x' : 'none';
  if (netDirection === null && f !== null && r === null) netDirection = 1;
  if (netDirection === null && r !== null && f === null) netDirection = -1;
  return { forward, reverse, netDirection, verdict };
}
