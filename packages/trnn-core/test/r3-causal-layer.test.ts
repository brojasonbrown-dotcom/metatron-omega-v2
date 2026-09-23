/**
 * R3 — Ω-REAL Phase 3 certification: the causal (directed) layer.
 *
 * The battery is adversarial by design: every estimator is shown a case where
 * it MUST fire, a case where it MUST stay silent, and a case where it MUST
 * abstain with `null` rather than report a zero.
 */

import { describe, expect, it } from 'vitest';
import { SeedStream } from '../src/core/determinism';
import {
  dmlPartialLinear,
  directedReport,
  fSurvival,
  grangerCausality,
  lgamma,
  normalCdf,
  olsFit,
  regIncBeta,
  RegressionForest,
  transferEntropyGaussian,
  transferEntropyScan,
} from '../src/substrate/causal';
import { STAT_FLOOR } from '../src/substrate/correlation';

/** Deterministic standard normal (Box–Muller on the seeded stream). */
function gauss(rng: SeedStream): number {
  const u = Math.max(1e-12, rng.next());
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function noise(n: number, seed: string): Float64Array {
  const rng = new SeedStream(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = gauss(rng);
  return out;
}

describe('R3.1 special functions', () => {
  it('lgamma matches known values', () => {
    expect(lgamma(1)).toBeCloseTo(0, 12);
    expect(lgamma(2)).toBeCloseTo(0, 12);
    expect(lgamma(5)).toBeCloseTo(Math.log(24), 10);
    expect(lgamma(0.5)).toBeCloseTo(0.5 * Math.log(Math.PI), 10);
  });

  it('regIncBeta is a proper CDF: monotone, endpoints exact, symmetric identity', () => {
    expect(regIncBeta(2, 3, 0)).toBe(0);
    expect(regIncBeta(2, 3, 1)).toBe(1);
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = regIncBeta(2.5, 4.5, i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // I_x(a,b) = 1 − I_{1−x}(b,a)
    expect(regIncBeta(3, 7, 0.31)).toBeCloseTo(1 - regIncBeta(7, 3, 0.69), 12);
  });

  it('F survival matches published critical values', () => {
    // F(1,10) 95th percentile = 4.9646; F(5,20) 95th = 2.7109
    expect(fSurvival(4.9646, 1, 10)).toBeCloseTo(0.05, 4);
    expect(fSurvival(2.7109, 5, 20)).toBeCloseTo(0.05, 4);
    expect(fSurvival(0, 3, 30)).toBe(1);
  });

  it('normalCdf matches the standard normal table', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 12);
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 7);
    expect(normalCdf(-2.5758293035489)).toBeCloseTo(0.005, 7);
  });
});

describe('R3.2 OLS core', () => {
  it('recovers exact coefficients on a noiseless linear system', () => {
    const n = 50;
    const k = 3;
    const X = new Float64Array(n * k);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = i / 10;
      const b = ((i * 7) % 13) / 5;
      X[i * k] = 1;
      X[i * k + 1] = a;
      X[i * k + 2] = b;
      y[i] = 2 - 3 * a + 0.5 * b;
    }
    const fit = olsFit(X, y, n, k);
    expect(fit.beta[0]).toBeCloseTo(2, 8);
    expect(fit.beta[1]).toBeCloseTo(-3, 8);
    expect(fit.beta[2]).toBeCloseTo(0.5, 8);
    expect(fit.rss).toBeLessThan(1e-16);
    expect(fit.singular).toBe(false);
  });

  it('flags a perfectly collinear design instead of returning NaN', () => {
    const n = 40;
    const k = 3;
    const X = new Float64Array(n * k);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      X[i * k] = 1;
      X[i * k + 1] = i;
      X[i * k + 2] = 2 * i; // exact duplicate direction
      y[i] = i;
    }
    const fit = olsFit(X, y, n, k);
    expect(fit.singular).toBe(true);
    expect(Number.isFinite(fit.rss)).toBe(true);
  });
});

describe('R3.3 Granger causality', () => {
  const N = 400;

  it('detects a true unidirectional drive x→y and rejects the reverse', () => {
    const ex = noise(N, 'r3/granger/ex');
    const ey = noise(N, 'r3/granger/ey');
    const x = new Float64Array(N);
    const y = new Float64Array(N);
    for (let t = 1; t < N; t++) {
      x[t] = 0.5 * x[t - 1] + ex[t];
      y[t] = 0.3 * y[t - 1] + 0.8 * x[t - 1] + ey[t];
    }
    const fwd = grangerCausality(x, y, 2);
    const rev = grangerCausality(y, x, 2);
    expect(fwd.abstained).toBe(false);
    expect(fwd.p as number).toBeLessThan(1e-6);
    expect(rev.p as number).toBeGreaterThan(0.01);
  });

  it('stays silent on two independent AR(1) processes', () => {
    const ex = noise(N, 'r3/granger/ind-x');
    const ey = noise(N, 'r3/granger/ind-y');
    const x = new Float64Array(N);
    const y = new Float64Array(N);
    for (let t = 1; t < N; t++) {
      x[t] = 0.6 * x[t - 1] + ex[t];
      y[t] = 0.6 * y[t - 1] + ey[t];
    }
    expect(grangerCausality(x, y, 2).p as number).toBeGreaterThan(0.01);
    expect(grangerCausality(y, x, 2).p as number).toBeGreaterThan(0.01);
  });

  it('abstains below the F9 floor with null, never 0', () => {
    const n = STAT_FLOOR; // n − lag < floor
    const x = noise(n, 'r3/short-x');
    const y = noise(n, 'r3/short-y');
    const r = grangerCausality(x, y, 2);
    expect(r.abstained).toBe(true);
    expect(r.value).toBeNull();
    expect(r.p).toBeNull();
    expect(r.reason).toContain('floor');
  });

  it('reports effective sample size n − lag, not raw length', () => {
    const x = noise(200, 'r3/eff-x');
    const y = noise(200, 'r3/eff-y');
    expect(grangerCausality(x, y, 5).n).toBe(195);
  });

  it('abstains on a degenerate zero-residual fit rather than dividing by zero', () => {
    const n = 120;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = i;
      y[i] = 2 * i; // exactly predictable from its own lag
    }
    const r = grangerCausality(x, y, 2);
    expect(r.value === null || Number.isFinite(r.value)).toBe(true);
    if (r.value === null) expect(r.reason).toBeTruthy();
  });
});

describe('R3.4 transfer entropy and the lag scan', () => {
  const N = 500;

  function coupled(lag: number, gain: number) {
    const ex = noise(N, `r3/te/ex${lag}`);
    const ey = noise(N, `r3/te/ey${lag}`);
    const x = new Float64Array(N);
    const y = new Float64Array(N);
    for (let t = lag; t < N; t++) {
      x[t] = 0.4 * x[t - 1] + ex[t];
      y[t] = 0.2 * y[t - 1] + gain * x[t - lag] + ey[t];
    }
    return { x, y };
  }

  it('satisfies the Barnett identity G = 2·TE at the same lag', () => {
    const { x, y } = coupled(1, 0.7);
    const g = grangerCausality(x, y, 3);
    const te = transferEntropyGaussian(x, y, 3);
    const n = te.n;
    const df1 = 3;
    const df2 = n - (1 + 6);
    // F ↔ likelihood ratio:  RSS_r/RSS_f = 1 + F·df1/df2,  TE = ½·ln(ratio)
    const expected = 0.5 * Math.log(1 + ((g.value as number) * df1) / df2);
    expect(te.value as number).toBeCloseTo(expected, 10);
  });

  it('is non-negative and larger for a stronger coupling', () => {
    const weak = transferEntropyGaussian(coupled(1, 0.15).x, coupled(1, 0.15).y, 2);
    const strong = transferEntropyGaussian(coupled(1, 1.2).x, coupled(1, 1.2).y, 2);
    expect(weak.value as number).toBeGreaterThanOrEqual(0);
    expect(strong.value as number).toBeGreaterThan(weak.value as number);
  });

  it('recovers the true coupling delay in the scan', () => {
    const { x, y } = coupled(4, 1.0);
    const scan = transferEntropyScan(x, y, { maxLag: 8 });
    expect(scan.abstained).toBe(false);
    expect(scan.bestLag).not.toBeNull();
    // the y-own-lag model absorbs shorter lags, so the detected lag must be ≥ 4
    expect(scan.bestLag as number).toBeGreaterThanOrEqual(4);
    expect(scan.perLag).toHaveLength(8);
  });

  it('returns bestLag === null (not 0) when every lag is insignificant', () => {
    const x = noise(300, 'r3/scan/ind-x');
    const y = noise(300, 'r3/scan/ind-y');
    const scan = transferEntropyScan(x, y, { maxLag: 6 });
    expect(scan.abstained).toBe(true);
    expect(scan.bestLag).toBeNull();
    expect(scan.best).toBeNull();
    expect(scan.reason).toBeTruthy();
  });

  it('returns bestLag === null when the series is too short to measure at all', () => {
    const scan = transferEntropyScan(noise(20, 'a'), noise(20, 'b'), { maxLag: 4 });
    expect(scan.bestLag).toBeNull();
    expect(scan.perLag.every((r) => r.value === null)).toBe(true);
  });

  it('directedReport signs the dominant direction', () => {
    const { x, y } = coupled(2, 1.1);
    const rep = directedReport(x, y, { maxLag: 6 });
    expect(rep.verdict === 'x→y' || rep.verdict === 'bidirectional').toBe(true);
    expect(rep.netDirection as number).toBeGreaterThan(0);
    const flipped = directedReport(y, x, { maxLag: 6 });
    expect(flipped.netDirection as number).toBeLessThan(0);
  });
});

describe('R3.5 regression forest', () => {
  it('learns a non-linear surface better than the best linear fit', () => {
    const n = 400;
    const p = 2;
    const rng = new SeedStream('r3/forest/data');
    const X = new Float64Array(n * p);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = rng.next() * 2 - 1;
      const b = rng.next() * 2 - 1;
      X[i * p] = a;
      X[i * p + 1] = b;
      y[i] = a * a + Math.sin(3 * b);
    }
    const forest = new RegressionForest(X, y, n, p, { trees: 32, minLeaf: 4, maxDepth: 10 });
    const pred = forest.predict(X, n);
    let sseF = 0;
    let sst = 0;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += y[i];
    mean /= n;
    for (let i = 0; i < n; i++) {
      sseF += (y[i] - pred[i]) ** 2;
      sst += (y[i] - mean) ** 2;
    }
    const Xl = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      Xl[i * 3] = 1;
      Xl[i * 3 + 1] = X[i * p];
      Xl[i * 3 + 2] = X[i * p + 1];
    }
    const lin = olsFit(Xl, y, n, 3);
    expect(1 - sseF / sst).toBeGreaterThan(0.8);
    expect(sseF).toBeLessThan(lin.rss);
  });

  it('is bit-deterministic for a fixed seed and seed-sensitive otherwise', () => {
    const n = 120;
    const p = 2;
    const rng = new SeedStream('r3/forest/det');
    const X = new Float64Array(n * p);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      X[i * p] = rng.next();
      X[i * p + 1] = rng.next();
      y[i] = X[i * p] * 2 - X[i * p + 1];
    }
    const a = new RegressionForest(X, y, n, p, { seed: 'fixed' }).predict(X, n);
    const b = new RegressionForest(X, y, n, p, { seed: 'fixed' }).predict(X, n);
    const c = new RegressionForest(X, y, n, p, { seed: 'other' }).predict(X, n);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });
});

describe('R3.6 DML partially linear model', () => {
  const SLOW = 30_000; // cross-fitted forests: generous under parallel CI load
  const n = 600;
  const p = 3;

  const cache = new Map<number, { X: Float64Array; d: Float64Array; y: Float64Array }>();

  function build(theta: number) {
    const rng = new SeedStream('r3/dml/data');
    const X = new Float64Array(n * p);
    const d = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x0 = gauss(rng);
      const x1 = gauss(rng);
      const x2 = gauss(rng);
      X[i * p] = x0;
      X[i * p + 1] = x1;
      X[i * p + 2] = x2;
      const m = Math.tanh(x0) + 0.5 * x1 * x1;
      const g = 1.5 * Math.tanh(x0) + 0.8 * x1 * x1 - 0.4 * x2;
      d[i] = m + 0.7 * gauss(rng);
      y[i] = theta * d[i] + g + 0.5 * gauss(rng);
    }
    return { X, d, y };
  }

  /** Memoised: the generator is deterministic, so regenerating it is pure cost. */
  function confounded(theta: number) {
    const hit = cache.get(theta);
    if (hit) return hit;
    const made = build(theta);
    cache.set(theta, made);
    return made;
  }

  it('recovers θ under strong non-linear confounding', () => {
    const { X, d, y } = confounded(1.25);
    const r = dmlPartialLinear(y, d, X, p, { folds: 5, trees: 24, minLeaf: 5, maxDepth: 8 });
    expect(r.abstained).toBe(false);
    expect(r.theta as number).toBeCloseTo(1.25, 1);
    expect(r.se as number).toBeGreaterThan(0);
    expect((r.ci as [number, number])[0]).toBeLessThan(1.25);
    expect((r.ci as [number, number])[1]).toBeGreaterThan(1.25);
    expect(r.p as number).toBeLessThan(1e-6);
  }, SLOW);

  it('beats the naive confounded OLS estimate', () => {
    const { X, d, y } = confounded(1.25);
    const Xl = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      Xl[i * 2] = 1;
      Xl[i * 2 + 1] = d[i];
    }
    const naive = olsFit(Xl, y, n, 2).beta[1];
    const dml = dmlPartialLinear(y, d, X, p, { folds: 5, trees: 24 }).theta as number;
    expect(Math.abs(dml - 1.25)).toBeLessThan(Math.abs(naive - 1.25));
  }, SLOW);

  it('reports a null effect honestly when θ = 0', () => {
    const { X, d, y } = confounded(0);
    const r = dmlPartialLinear(y, d, X, p, { folds: 5, trees: 24 });
    expect(Math.abs(r.theta as number)).toBeLessThan(0.15);
    expect((r.ci as [number, number])[0]).toBeLessThan(0);
    expect((r.ci as [number, number])[1]).toBeGreaterThan(0);
  }, SLOW);

  it('abstains below the floor and when the treatment has no residual variation', () => {
    const short = dmlPartialLinear(
      new Float64Array(10),
      new Float64Array(10),
      new Float64Array(10 * p),
      p,
      {},
    );
    expect(short.abstained).toBe(true);
    expect(short.theta).toBeNull();
    expect(short.reason).toContain('floor');

    const m = 200;
    const X = new Float64Array(m * 1);
    const d = new Float64Array(m);
    const y = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      X[i] = i / m;
      d[i] = 0; // constant treatment: no variation to exploit
      y[i] = X[i];
    }
    const flat = dmlPartialLinear(y, d, X, 1, { folds: 5, trees: 8 });
    expect(flat.abstained).toBe(true);
    expect(flat.theta).toBeNull();
  }, SLOW);

  it('is deterministic across repeated fits', () => {
    const { X, d, y } = confounded(0.8);
    const a = dmlPartialLinear(y, d, X, p, { folds: 4, trees: 16, seed: 'r3/dml/fixed' });
    const b = dmlPartialLinear(y, d, X, p, { folds: 4, trees: 16, seed: 'r3/dml/fixed' });
    expect(a.theta).toBe(b.theta);
    expect(a.se).toBe(b.se);
  }, SLOW);
});
