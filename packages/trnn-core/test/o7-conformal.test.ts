import { describe, it, expect } from 'vitest';
import {
  ConformalCalibrator,
  CalibrationBank,
  conformalQuantile,
  minCalibrationFor,
  DEFAULT_ALPHA,
} from '../src/operator/conformal';

/** Deterministic uniform-ish stream — no Math.random anywhere in the suite. */
function weyl(i: number): number {
  const x = (i + 1) * 0.6180339887498949;
  return x - Math.floor(x);
}

describe('Ω-SCALE P1 — split-conformal calibration', () => {
  it('abstains until the finite-sample guarantee is non-vacuous', () => {
    const c = new ConformalCalibrator({ alpha: 0.1 });
    expect(minCalibrationFor(0.1)).toBe(20);
    for (let i = 0; i < 19; i++) c.observe(0, weyl(i));
    expect(Number.isNaN(c.quantile())).toBe(true);
    expect(c.interval(1)).toBeNull();
    c.observe(0, weyl(19));
    expect(Number.isFinite(c.quantile())).toBe(true);
    expect(c.interval(1)).not.toBeNull();
  });

  it('quantile is the ceil((n+1)(1-alpha))-th smallest score', () => {
    const scores = Array.from({ length: 100 }, (_, i) => i / 100);
    const q = conformalQuantile(scores, 0.1);
    // idx = ceil(101*0.9) = 91 → the 91st smallest = 0.90
    expect(q).toBeCloseTo(0.9, 12);
  });

  it('achieves nominal coverage on an exchangeable stream', () => {
    const c = new ConformalCalibrator({ alpha: 0.1, capacity: 400, minCoverageSamples: 100 });
    for (let i = 0; i < 2000; i++) {
      const truth = weyl(i); // predictor says 0.5, residual uniform on [-.5,.5]
      c.interval(0.5);
      c.observe(0.5, truth);
    }
    const cov = c.coverage;
    expect(Number.isFinite(cov)).toBe(true);
    expect(cov).toBeGreaterThan(0.85);
    expect(cov).toBeLessThanOrEqual(1);
    expect(c.stale).toBe(false);
  });

  it('flags itself stale when the signal shifts out from under the calibration', () => {
    const c = new ConformalCalibrator({ alpha: 0.1, capacity: 5000, minCoverageSamples: 50 });
    // Calibrate on a tight signal.
    for (let i = 0; i < 600; i++) {
      c.interval(0);
      c.observe(0, weyl(i) * 0.01);
    }
    expect(c.stale).toBe(false);
    // Regime change: residuals blow up by 100×. The ring is large enough that
    // old tight scores dominate the quantile, so coverage must collapse.
    for (let i = 0; i < 300; i++) {
      c.interval(0);
      c.observe(0, 1 + weyl(i));
    }
    expect(c.coverage).toBeLessThan(0.9 - c.coverageTolerance);
    expect(c.stale).toBe(true);
  });

  it('never fabricates a band for an unmeasured value', () => {
    const c = new ConformalCalibrator();
    for (let i = 0; i < 200; i++) c.observe(0, weyl(i));
    expect(c.interval(NaN)).toBeNull();
    expect(c.interval(Infinity)).toBeNull();
    const before = c.samples;
    c.observe(NaN, 1);
    c.observe(1, NaN);
    expect(c.samples).toBe(before);
  });

  it('interval brackets the value symmetrically and reports provenance', () => {
    const c = new ConformalCalibrator({ alpha: 0.2 });
    for (let i = 0; i < 300; i++) c.observe(0, weyl(i));
    const iv = c.interval(3)!;
    expect(iv.value).toBe(3);
    expect(iv.lower).toBeCloseTo(3 - iv.halfWidth, 12);
    expect(iv.upper).toBeCloseTo(3 + iv.halfWidth, 12);
    expect(iv.level).toBeCloseTo(0.8, 12);
    expect(iv.samples).toBe(c.samples);
    expect(iv.halfWidth).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic — identical input gives identical bands', () => {
    const mk = () => {
      const c = new ConformalCalibrator({ alpha: DEFAULT_ALPHA });
      for (let i = 0; i < 500; i++) c.observe(0, weyl(i));
      return c.quantile();
    };
    expect(mk()).toBe(mk());
  });

  it('bank isolates channels and only allocates on use', () => {
    const bank = new CalibrationBank<'a' | 'b'>({ alpha: 0.1 });
    expect(bank.ids()).toEqual([]);
    for (let i = 0; i < 300; i++) {
      bank.get('a').observe(0, weyl(i) * 0.001);
      bank.get('b').observe(0, weyl(i) * 10);
    }
    expect(bank.ids().sort()).toEqual(['a', 'b']);
    const qa = bank.get('a').quantile();
    const qb = bank.get('b').quantile();
    expect(qa).toBeLessThan(qb);
    bank.reset();
    expect(Number.isNaN(bank.get('a').quantile())).toBe(true);
  });

  it('ring capacity bounds memory and forgets stale scores', () => {
    const c = new ConformalCalibrator({ alpha: 0.1, capacity: 50 });
    for (let i = 0; i < 500; i++) c.observe(0, 100);
    expect(c.samples).toBe(50);
    expect(c.quantile()).toBeCloseTo(100, 12);
    for (let i = 0; i < 50; i++) c.observe(0, 1);
    expect(c.quantile()).toBeCloseTo(1, 12);
  });
});
