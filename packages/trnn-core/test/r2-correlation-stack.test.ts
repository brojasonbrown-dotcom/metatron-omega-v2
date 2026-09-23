/**
 * Ω-REAL · P2 battery — Level-1 signal statistics and the Level-2 correlation
 * family.
 *
 * The battery is written so that it FAILS IF A NUMBER IS FABRICATED:
 *  • every estimator must abstain (null, not 0) below the F9=34 floor;
 *  • dCor/HSIC must see a dependence that Pearson provably cannot (y = x²);
 *  • the permutation null must not call independent data significant;
 *  • the band-pass must null DC and Nyquist exactly (structural property);
 *  • MSC must abstain on a single segment rather than report the identity 1.
 */

import { describe, expect, it } from 'vitest';
import {
  QUADRATIC_CAP,
  STAT_FLOOR,
  correlationReport,
  distanceCorrelation,
  gaussianMI,
  hsic,
  invNormalCdf,
  kendallTauB,
  normalScores,
  pearson,
  permutationTest,
  rank,
  spearman,
} from '../src/substrate/correlation';
import {
  MSC_MIN_SEGMENTS,
  bandPLV,
  butterBandpass,
  gccPhat,
  hann,
  hilbertAnalytic,
  sosFiltFilt,
  welchMSC,
} from '../src/substrate/signalStats';
import { SeedStream } from '../src/core/determinism';

const rng = (seed: string) => new SeedStream(seed);

/** Box–Muller from the deterministic seed stream. */
function gauss(s: SeedStream): number {
  const u = Math.max(1e-12, s.next());
  const v = s.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function series(n: number, f: (i: number) => number): Float64Array {
  const a = new Float64Array(n);
  for (let i = 0; i < n; i++) a[i] = f(i);
  return a;
}

describe('P2 · Level-2 correlation stack', () => {
  it('every estimator abstains below the F9 floor — null, never zero', () => {
    const n = STAT_FLOOR - 1;
    const s = rng('floor');
    const x = series(n, () => gauss(s));
    const y = series(n, () => gauss(s));
    for (const f of [pearson, spearman, kendallTauB, distanceCorrelation, hsic, gaussianMI]) {
      const r = f(x, y);
      expect(r.value).toBeNull();
      expect(r.abstained).toBe(true);
      expect(r.n).toBe(n);
      expect(r.reason).toContain(String(STAT_FLOOR));
    }
  });

  it('speaks at exactly the floor', () => {
    const s = rng('at-floor');
    const x = series(STAT_FLOOR, (i) => i + 0.01 * gauss(s));
    const y = series(STAT_FLOOR, (i) => 2 * i);
    const r = pearson(x, y);
    expect(r.abstained).toBe(false);
    expect(r.value).toBeGreaterThan(0.99);
  });

  it('pearson is exact on a perfect affine relation and sign-correct', () => {
    const x = series(64, (i) => i);
    expect(pearson(x, series(64, (i) => 3 * i + 7)).value).toBeCloseTo(1, 12);
    expect(pearson(x, series(64, (i) => -3 * i + 7)).value).toBeCloseTo(-1, 12);
  });

  it('pearson abstains on a constant channel instead of dividing by zero', () => {
    const r = pearson(series(64, (i) => i), series(64, () => 5));
    expect(r.value).toBeNull();
    expect(r.reason).toContain('variance');
  });

  it('spearman is 1 on any monotone map where pearson is not', () => {
    const x = series(64, (i) => i + 1);
    const y = series(64, (i) => Math.exp((i + 1) / 8));
    expect(spearman(x, y).value).toBeCloseTo(1, 12);
    expect(pearson(x, y).value!).toBeLessThan(0.95);
  });

  it('rank uses average ranks for ties', () => {
    const r = rank(Float64Array.from([10, 20, 20, 30]));
    expect(Array.from(r)).toEqual([1, 2.5, 2.5, 4]);
  });

  it('kendall tau-b is tie-corrected and stays in [-1,1]', () => {
    const x = series(64, (i) => Math.floor(i / 4)); // heavily tied
    const y = series(64, (i) => Math.floor(i / 4));
    const r = kendallTauB(x, y);
    expect(r.value).toBeCloseTo(1, 12);
    const rev = kendallTauB(x, series(64, (i) => -Math.floor(i / 4)));
    expect(rev.value).toBeCloseTo(-1, 12);
  });

  it('dCor and HSIC detect the quadratic dependence pearson is blind to', () => {
    const n = 300;
    const s = rng('quadratic');
    const x = series(n, () => 2 * (s.next() - 0.5));
    const y = series(n, (i) => x[i] * x[i]);
    expect(Math.abs(pearson(x, y).value!)).toBeLessThan(0.2);
    expect(distanceCorrelation(x, y).value!).toBeGreaterThan(0.4);
    expect(hsic(x, y).value!).toBeGreaterThan(0.2);
  });

  it('dCor is ~0 for independent draws and 1 for identity', () => {
    const n = 300;
    const s = rng('indep');
    const x = series(n, () => gauss(s));
    const y = series(n, () => gauss(s));
    expect(distanceCorrelation(x, y).value!).toBeLessThan(0.25);
    expect(distanceCorrelation(x, x).value!).toBeCloseTo(1, 6);
  });

  it('quadratic estimators cap their sample count deterministically', () => {
    const n = QUADRATIC_CAP * 3;
    const s = rng('cap');
    const x = series(n, () => gauss(s));
    const y = series(n, (i) => x[i]);
    const a = distanceCorrelation(x, y);
    const b = distanceCorrelation(x, y);
    expect(a.n).toBe(QUADRATIC_CAP);
    expect(hsic(x, y).n).toBe(QUADRATIC_CAP);
    expect(a.value).toBe(b.value); // deterministic subsample, no RNG
  });

  it('gaussian copula MI is 0 for independence and grows with |rho|', () => {
    const n = 400;
    const s = rng('mi');
    const x = series(n, () => gauss(s));
    const indep = series(n, () => gauss(s));
    const dep = series(n, (i) => 0.9 * x[i] + 0.4359 * gauss(s));
    const mi0 = gaussianMI(x, indep).value!;
    const mi1 = gaussianMI(x, dep).value!;
    expect(mi0).toBeLessThan(0.05);
    expect(mi1).toBeGreaterThan(mi0 + 0.3);
    expect(mi1).toBeGreaterThan(0);
  });

  it('inverse normal CDF and normal scores are sane', () => {
    expect(invNormalCdf(0.5)).toBeCloseTo(0, 9);
    expect(invNormalCdf(0.975)).toBeCloseTo(1.959963985, 6);
    expect(invNormalCdf(0.025)).toBeCloseTo(-1.959963985, 6);
    const z = normalScores(series(101, (i) => i));
    expect(z[50]).toBeCloseTo(0, 9);
    expect(z[0]).toBeLessThan(-1.9);
    expect(z[100]).toBeGreaterThan(1.9);
  });

  it('permutation test: significant on real dependence, not on noise', () => {
    const n = 120;
    const s = rng('perm');
    const x = series(n, () => gauss(s));
    const dep = series(n, (i) => x[i] + 0.3 * gauss(s));
    const indep = series(n, () => gauss(s));
    const pDep = permutationTest(pearson, x, dep, { permutations: 199, seed: 'p2/dep' });
    const pInd = permutationTest(pearson, x, indep, { permutations: 199, seed: 'p2/ind' });
    expect(pDep.p!).toBeLessThanOrEqual(0.01);
    expect(pInd.p!).toBeGreaterThan(0.05);
    // (B+1) correction keeps p strictly positive
    expect(pDep.p!).toBeGreaterThan(0);
  });

  it('permutation test propagates abstention instead of inventing a p-value', () => {
    const s = rng('perm-abstain');
    const x = series(10, () => gauss(s));
    const r = permutationTest(pearson, x, x, { permutations: 50 });
    expect(r.value).toBeNull();
    expect(r.p).toBeNull();
    expect(r.permutations).toBe(0);
  });

  it('correlationReport runs the whole family and agrees on a linear signal', () => {
    const n = 200;
    const s = rng('report');
    const x = series(n, () => gauss(s));
    const y = series(n, (i) => 1.5 * x[i] + 0.2 * gauss(s));
    const r = correlationReport(x, y);
    expect(r.abstained).toBe(false);
    expect(r.pearson.value!).toBeGreaterThan(0.9);
    expect(r.spearman.value!).toBeGreaterThan(0.85);
    expect(r.kendall.value!).toBeGreaterThan(0.65);
    expect(r.dcor.value!).toBeGreaterThan(0.7);
    expect(r.hsic.value!).toBeGreaterThan(0.3);
    expect(r.mi.value!).toBeGreaterThan(0.5);
  });
});

describe('P2 · Level-1 signal statistics', () => {
  it('hann window is periodic and normalised at the ends', () => {
    const w = hann(8);
    expect(w[0]).toBeCloseTo(0, 12);
    expect(w[4]).toBeCloseTo(1, 12);
    expect(w[1]).toBeCloseTo(w[7], 12);
  });

  it('MSC abstains rather than reporting the single-segment identity 1', () => {
    const fs = 256;
    const x = series(64, (i) => Math.sin((2 * Math.PI * 10 * i) / fs));
    const r = welchMSC(x, x, { fs, nperseg: 64 });
    expect(r.msc).toBeNull();
    expect(r.abstained).toBe(true);
    expect(r.segments).toBeLessThan(MSC_MIN_SEGMENTS);
  });

  it('MSC is ~1 in-band for a shared tone and low for independent noise', () => {
    const fs = 256;
    const n = 1024;
    const s = rng('msc');
    const tone = (i: number) => Math.sin((2 * Math.PI * 16 * i) / fs);
    const x = series(n, (i) => tone(i) + 0.05 * gauss(s));
    const y = series(n, (i) => tone(i - 3) + 0.05 * gauss(s));
    const shared = welchMSC(x, y, { fs, nperseg: 128, band: [15, 17] });
    expect(shared.abstained).toBe(false);
    expect(shared.segments).toBeGreaterThanOrEqual(MSC_MIN_SEGMENTS);
    expect(shared.bandMean!).toBeGreaterThan(0.9);

    const a = series(n, () => gauss(s));
    const b = series(n, () => gauss(s));
    const noise = welchMSC(a, b, { fs, nperseg: 128 });
    expect(noise.bandMean!).toBeLessThan(0.5);
  });

  it('band-pass biquads null DC and Nyquist exactly (structural zeros)', () => {
    const sos = butterBandpass(8, 24, 256, 2);
    expect(sos.length).toBe(2);
    for (const s of sos) {
      expect(s.b0 + s.b1 + s.b2).toBeCloseTo(0, 12); // z = +1 → DC
      expect(s.b0 - s.b1 + s.b2).toBeCloseTo(0, 12); // z = −1 → Nyquist
      const stable = Math.abs(s.a2) < 1 && Math.abs(s.a1) < 1 + s.a2;
      expect(stable).toBe(true); // Jury criterion for a biquad
    }
  });

  it('band-pass rejects out-of-band tones and passes in-band ones', () => {
    const fs = 256;
    const n = 1024;
    const sos = butterBandpass(12, 20, fs, 2);
    const power = (a: Float64Array) => {
      let p = 0;
      for (let i = 200; i < n - 200; i++) p += a[i] * a[i];
      return p / (n - 400);
    };
    const inBand = sosFiltFilt(sos, series(n, (i) => Math.sin((2 * Math.PI * 16 * i) / fs)));
    const outBand = sosFiltFilt(sos, series(n, (i) => Math.sin((2 * Math.PI * 80 * i) / fs)));
    expect(power(inBand)).toBeGreaterThan(0.4);
    expect(power(outBand)).toBeLessThan(0.01);
  });

  it('hilbert analytic signal has the right envelope and quadrature phase', () => {
    const n = 512;
    const fs = 256;
    const a = hilbertAnalytic(series(n, (i) => Math.cos((2 * Math.PI * 16 * i) / fs)));
    for (let i = 100; i < n - 100; i++) {
      expect(Math.sqrt(a.re[i] * a.re[i] + a.im[i] * a.im[i])).toBeCloseTo(1, 3);
    }
    // imaginary part is the −90° shifted copy: sin
    expect(a.im[128]).toBeCloseTo(Math.sin((2 * Math.PI * 16 * 128) / fs), 3);
  });

  it('PLV is ~1 for a fixed phase offset and low for independent phases', () => {
    const fs = 256;
    const n = 1024;
    const s = rng('plv');
    const locked = bandPLV(
      series(n, (i) => Math.sin((2 * Math.PI * 16 * i) / fs)),
      series(n, (i) => Math.sin((2 * Math.PI * 16 * i) / fs + 0.7)),
      [12, 20],
      fs,
    );
    expect(locked.plv!).toBeGreaterThan(0.98);
    expect(locked.meanPhase!).toBeCloseTo(-0.7, 1);

    const free = bandPLV(
      series(n, () => gauss(s)),
      series(n, () => gauss(s)),
      [12, 20],
      fs,
    );
    expect(free.plv!).toBeLessThan(0.5);
  });

  it('PLV abstains on a short window', () => {
    const r = bandPLV(series(20, (i) => i), series(20, (i) => i), [12, 20], 256);
    expect(r.plv).toBeNull();
    expect(r.abstained).toBe(true);
  });

  it('GCC-PHAT recovers a known integer delay', () => {
    const n = 512;
    const s = rng('gcc');
    const base = series(n + 32, () => gauss(s));
    const D = 7;
    const x = series(n, (i) => base[i + 16]);
    const y = series(n, (i) => base[i + 16 - D]);
    const r = gccPhat(x, y, 32);
    expect(r.abstained).toBe(false);
    expect(Math.round(r.lag!)).toBe(D);
  });

  it('GCC-PHAT reports zero delay for identical channels and abstains when starved', () => {
    const s = rng('gcc0');
    const x = series(256, () => gauss(s));
    expect(Math.round(gccPhat(x, x, 16).lag!)).toBe(0);
    const short = gccPhat(series(4, (i) => i), series(4, (i) => i));
    expect(short.lag).toBeNull();
    expect(short.abstained).toBe(true);
  });
});
