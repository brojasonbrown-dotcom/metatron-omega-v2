/**
 * Gate R1 — Ω-REAL innovation-form coherence C(t).
 *
 * The point of this battery is to prove the estimator CANNOT report the false
 * "full coherence" reading: on the raw unit-root state the naive estimator
 * saturates at 1, while the innovation form tracks the analytic corridor.
 */
import { describe, expect, it } from 'vitest';
import { PHI, phiPow } from '../src/core/constants';
import {
  COHERENCE_GATE,
  KERNEL_LAMBDA,
  PhiCoherenceKernel,
  analyticExpectedC,
  kernelRoots,
  expectedCBias,
  ouInnovation,
} from '../src/substrate/coherenceKernel';

/** Deterministic uniform source — the certification owns its seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('R1 — kernel roots', () => {
  it('lambda is phi^-2 and the roots are exactly {1, -phi^-2}', () => {
    expect(KERNEL_LAMBDA).toBe(phiPow(-2));
    const [r1, r2] = kernelRoots();
    expect(Math.abs(r1 - 1)).toBeLessThan(1e-15);
    expect(Math.abs(r2 + phiPow(-2))).toBeLessThan(1e-15);
  });

  it('the recursion reproduces its own characteristic polynomial', () => {
    const lam = KERNEL_LAMBDA;
    for (const z of kernelRoots()) {
      expect(Math.abs(z * z - (1 - lam) * z - lam)).toBeLessThan(1e-14);
    }
  });
});

describe('R1 — abstention is not zero', () => {
  it('coherence is null until tau+1 innovations have arrived', () => {
    const k = new PhiCoherenceKernel(8, 2);
    const re = new Float64Array(8);
    const im = new Float64Array(8);
    const rand = mulberry32(11);
    expect(k.coherence()).toBeNull();
    for (let t = 0; t < 3; t++) {
      ouInnovation(rand, re, im, 1, t === 0);
      const rep = k.step(re, im);
      if (t < 2) {
        expect(rep.coherence).toBeNull();
        expect(rep.gateOpen).toBe(false);
      } else {
        expect(rep.coherence).not.toBeNull();
      }
    }
  });

  it('a silent drive abstains rather than reporting zero coherence', () => {
    const k = new PhiCoherenceKernel(8, 2);
    const zero = new Float64Array(8);
    for (let t = 0; t < 10; t++) k.step(zero, zero);
    expect(k.coherence()).toBeNull();
    expect(k.gateOpen()).toBe(false);
  });

  it('the default dimension is the calibrated d = 8', () => {
    expect(new PhiCoherenceKernel().d).toBe(8);
  });
});

describe('R1 — the innovation form defeats unit-root saturation', () => {
  const d = 8;
  const runs = 4;
  const steps = 900;

  function measure(seed: number, tau = 2) {
    const k = new PhiCoherenceKernel(d, tau);
    const re = new Float64Array(d);
    const im = new Float64Array(d);
    const rand = mulberry32(seed);
    const cs: number[] = [];
    const rawCs: number[] = [];
    let prevRe: Float64Array | null = null;
    let prevIm: Float64Array | null = null;
    for (let t = 0; t < steps; t++) {
      ouInnovation(rand, re, im, 1, t === 0);
      const rep = k.step(re, im);
      if (rep.coherence !== null) cs.push(rep.coherence);
      // Naive raw-state estimator, for contrast.
      if (prevRe && prevIm) {
        let dr = 0;
        let di = 0;
        let nn = 0;
        let ll = 0;
        for (let i = 0; i < d; i++) {
          const ar = k.psiRe[i];
          const ai = k.psiIm[i];
          const br = prevRe[i];
          const bi = prevIm[i];
          dr += ar * br + ai * bi;
          di += ar * bi - ai * br;
          nn += ar * ar + ai * ai;
          ll += br * br + bi * bi;
        }
        if (nn * ll > 0) rawCs.push((dr * dr + di * di) / (nn * ll));
      }
      prevRe = Float64Array.from(k.psiRe);
      prevIm = Float64Array.from(k.psiIm);
    }
    const mean = cs.reduce((a, b) => a + b, 0) / cs.length;
    const rawMean = rawCs.reduce((a, b) => a + b, 0) / rawCs.length;
    return { cs, rawCs, mean, rawMean };
  }

  it('the analytic corridor centre is phi^-2-adjacent at the calibrated tau = 1', () => {
    const expected = analyticExpectedC(1, d, 1);
    expect(expected).toBeCloseTo(0.3794, 3);
    expect(Math.abs(expected - phiPow(-2))).toBeLessThan(0.008);
  });

  it('measured mean C(t) matches the BIAS-CORRECTED prediction at tau = 1 and tau = 2', () => {
    // A prediction, not a band: the mean must track E[C] as tau changes the
    // decorrelation distance, once the known finite-d bias is accounted for.
    for (const tau of [1, 2]) {
      const predicted = analyticExpectedC(1, d, tau) - expectedCBias(d, tau);
      for (let s = 0; s < runs; s++) {
        const { cs, mean } = measure(1000 + s * 7, tau);
        const variance = cs.reduce((a, c) => a + (c - mean) * (c - mean), 0) / (cs.length - 1);
        const se = Math.sqrt((variance * tau) / cs.length);
        expect(se).toBeLessThan(0.02);
        expect(Math.abs(mean - predicted)).toBeLessThan(5 * se);
      }
    }
    // And the two regimes are genuinely distinct, so the match is not vacuous.
    expect(analyticExpectedC(1, d, 1) - analyticExpectedC(1, d, 2)).toBeGreaterThan(0.15);
  });

  it('the finite-d bias is real, signed, and shrinks toward the asymptote as d grows', () => {
    // This pins the honest statement: analyticExpectedC is a large-d limit.
    // If the bias ever stopped shrinking, the estimator would be wrong.
    const biasAt = (dim: number) => {
      const k = new PhiCoherenceKernel(dim, 1);
      const re = new Float64Array(dim);
      const im = new Float64Array(dim);
      const rand = mulberry32(2024);
      const cs: number[] = [];
      for (let t = 0; t < 6000; t++) {
        ouInnovation(rand, re, im, 1, t === 0);
        const r = k.step(re, im);
        if (r.coherence !== null) cs.push(r.coherence);
      }
      const m = cs.reduce((a, b) => a + b, 0) / cs.length;
      return m - analyticExpectedC(1, dim, 1);
    };
    const b8 = biasAt(8);
    const b128 = biasAt(128);
    expect(b8).toBeLessThan(0); // the bias is negative, never optimistic
    expect(b128).toBeLessThan(0);
    expect(Math.abs(b128)).toBeLessThan(Math.abs(b8) / 3);
    expect(Math.abs(b128)).toBeLessThan(0.01);
    // The declared correction matches the measurement at the operating dim.
    expect(Math.abs(Math.abs(b8) - expectedCBias(8, 1))).toBeLessThan(0.01);
  });


  it('the naive raw-state estimator saturates — which is why it is not used', () => {
    const { mean, rawMean } = measure(4242);
    // The unit root drags the raw estimator far above the true innovation
    // coherence: this is precisely the false "full coherence" reading.
    expect(rawMean).toBeGreaterThan(0.6);
    expect(rawMean - mean).toBeGreaterThan(0.35);
    expect(mean).toBeLessThan(phiPow(-2));
  });

  it('C(t) crosses the corridor floor in both directions — it is not pinned', () => {
    const { cs } = measure(77);
    const above = cs.filter((c) => c > COHERENCE_GATE).length;
    expect(above).toBeGreaterThan(0);
    expect(above).toBeLessThan(cs.length);
    // Full dynamic range: the estimator reaches both extremes of [0,1].
    expect(Math.max(...cs)).toBeGreaterThan(0.6);
    expect(Math.min(...cs)).toBeLessThan(0.05);
  });


  it('the gate mirrors the measurement exactly', () => {
    const k = new PhiCoherenceKernel(d, 2);
    const re = new Float64Array(d);
    const im = new Float64Array(d);
    const rand = mulberry32(5);
    for (let t = 0; t < 200; t++) {
      ouInnovation(rand, re, im, 1, t === 0);
      const rep = k.step(re, im);
      expect(rep.gateOpen).toBe(rep.coherence !== null && rep.coherence > COHERENCE_GATE);
      expect(rep.gateOpen).toBe(k.gateOpen());
    }
  });
});

describe('R1 — energy stays finite under the unit root', () => {
  it('900 driven steps never produce a non-finite state', () => {
    const k = new PhiCoherenceKernel(8, 2);
    const re = new Float64Array(8);
    const im = new Float64Array(8);
    const rand = mulberry32(31337);
    for (let t = 0; t < 900; t++) {
      ouInnovation(rand, re, im, 1, t === 0);
      const rep = k.step(re, im);
      expect(Number.isFinite(rep.energy)).toBe(true);
    }
    expect(Math.exp(-1 / PHI)).toBeGreaterThan(0);
  });
});
