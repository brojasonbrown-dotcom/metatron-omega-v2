/**
 * R4 — Ω-REAL P4 certification: the abstention-aware resonance bus.
 *
 * Proves the law itself (abstention ≠ zero, veto is absolute, γ is a channel,
 * the coherence gate silences rather than lies) AND A/B parity with the legacy
 * geometric mean that recall currently uses, so the port can be made without a
 * ranking regression.
 */
import { describe, it, expect } from 'vitest';
import {
  fuseResonance, phaseClosureGamma, circularPhaseDev, blendWithResonance,
  KAPPA_PHASE, COHERENCE_GATE, RESONANCE_FLOOR, PHI_INV,
} from '../src/index';

const ch = (id: string, value: number) => ({ id, value });

/** Legacy fusion exactly as src/core/memory/Resonance.ts computes it today. */
function legacyMean(values: readonly number[]): number {
  let logSum = 0, counted = 0, dead = false;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    counted++;
    if (v <= 0) { dead = true; continue; }
    logSum += Math.log(v);
  }
  if (counted === 0) return NaN;
  return dead ? 0 : Math.exp(logSum / counted);
}

describe('R4.1 fusion law', () => {
  it('reduces to the geometric mean when γ abstains', () => {
    const r = fuseResonance([ch('a', 0.5), ch('b', 0.8), ch('c', 0.2)]);
    expect(r.counted).toBe(3);
    expect(r.gamma).toBeNaN();
    expect(r.value).toBeCloseTo(Math.cbrt(0.5 * 0.8 * 0.2), 12);
  });

  it('abstention is removed from BOTH product and exponent', () => {
    const withAbstain = fuseResonance([ch('a', 0.5), ch('b', NaN), ch('c', 0.8)]);
    const without = fuseResonance([ch('a', 0.5), ch('c', 0.8)]);
    expect(withAbstain.value).toBe(without.value);
    expect(withAbstain.abstained).toBe(1);
    expect(withAbstain.counted).toBe(2);
  });

  it('abstention is NOT a zero and NOT a pass', () => {
    const abstain = fuseResonance([ch('a', 0.9), ch('b', NaN)]).value;
    const zero = fuseResonance([ch('a', 0.9), ch('b', 0)]).value;
    const pass = fuseResonance([ch('a', 0.9), ch('b', 1)]).value;
    const alone = fuseResonance([ch('a', 0.9)]).value;
    // A measured 0 vetoes; a measured 1 is evidence and lifts the mean; an
    // abstention does neither — it leaves the surviving evidence exactly as it
    // was, so it sits strictly between the two.
    expect(zero).toBe(0);
    expect(pass).toBeGreaterThan(abstain);
    expect(abstain).toBeGreaterThan(zero);
    expect(abstain).toBe(alone);
    expect(abstain).toBeCloseTo(0.9, 12);
  });

  it('a measured zero vetoes absolutely, whatever the neighbours say', () => {
    const r = fuseResonance([ch('a', 1), ch('b', 1), ch('c', 1), ch('dead', 0)]);
    expect(r.value).toBe(0);
    expect(r.dead).toBe(true);
    expect(r.vetoId).toBe('dead');
  });

  it('reports the weakest measured channel as the veto id', () => {
    const r = fuseResonance([ch('a', 0.9), ch('weak', 0.11), ch('c', 0.4)]);
    expect(r.vetoId).toBe('weak');
    expect(r.vetoValue).toBeCloseTo(0.11, 15);
  });

  it('all-abstain yields NaN, never 0 or 1', () => {
    const r = fuseResonance([ch('a', NaN), ch('b', NaN)]);
    expect(r.value).toBeNaN();
    expect(r.counted).toBe(0);
    expect(r.abstained).toBe(2);
  });

  it('empty bus abstains', () => {
    expect(fuseResonance([]).value).toBeNaN();
  });

  it('clamps out-of-range channels instead of poisoning the log', () => {
    const r = fuseResonance([ch('hi', 4), ch('lo', -2)]);
    expect(r.value).toBe(0);       // −2 clamps to a measured 0 → veto
    expect(r.channels[0].value).toBe(1);
  });

  it('is monotone in every channel', () => {
    const base = fuseResonance([ch('a', 0.4), ch('b', 0.6)]).value;
    const up = fuseResonance([ch('a', 0.5), ch('b', 0.6)]).value;
    const down = fuseResonance([ch('a', 0.3), ch('b', 0.6)]).value;
    expect(up).toBeGreaterThan(base);
    expect(down).toBeLessThan(base);
  });

  it('is bounded by the min and max of the measured channels', () => {
    const vals = [0.2, 0.55, 0.9];
    const r = fuseResonance(vals.map((v, i) => ch(`c${i}`, v))).value;
    expect(r).toBeGreaterThanOrEqual(Math.min(...vals) - 1e-12);
    expect(r).toBeLessThanOrEqual(Math.max(...vals) + 1e-12);
  });

  it('flags the Class C sub-floor without folding it into the value', () => {
    const r = fuseResonance([ch('a', 0.01), ch('b', 0.02)]);
    expect(r.subFloor).toBe(true);
    expect(r.value).toBeCloseTo(Math.sqrt(0.0002), 12);
    expect(RESONANCE_FLOOR).toBeGreaterThan(r.value);
  });
});

describe('R4.2 phase-closure γ', () => {
  it('perfect closure is 1, κ deviation is e⁻¹', () => {
    expect(phaseClosureGamma(0)).toBe(1);
    expect(phaseClosureGamma(KAPPA_PHASE)).toBeCloseTo(Math.exp(-1), 12);
  });

  it('is even and monotone decreasing in |dev|', () => {
    expect(phaseClosureGamma(0.3)).toBeCloseTo(phaseClosureGamma(-0.3), 15);
    expect(phaseClosureGamma(0.3)).toBeGreaterThan(phaseClosureGamma(0.6));
  });

  it('abstains on an unmeasured deviation', () => {
    expect(phaseClosureGamma(NaN)).toBeNaN();
    expect(fuseResonance([ch('a', 0.5)]).gamma).toBeNaN();
  });

  it('enters as a channel: exponent becomes 1/(k+1)', () => {
    const r = fuseResonance([ch('a', 0.5), ch('b', 0.8)], { phaseDev: 0.2 });
    const g = phaseClosureGamma(0.2);
    expect(r.counted).toBe(3);
    expect(r.value).toBeCloseTo(Math.cbrt(0.5 * 0.8 * g), 12);
  });

  it('a fully open phase (γ→0) vetoes the fusion', () => {
    const r = fuseResonance([ch('a', 1)], { phaseDev: 1e6 });
    expect(r.value).toBe(0);
    expect(r.vetoId).toBe('gamma');
  });

  it('circular deviation is 0 for locked phases and grows with scatter', () => {
    const locked = circularPhaseDev([1.1, 1.1, 1.1, 1.1]);
    const loose = circularPhaseDev([1.0, 1.2, 0.8, 1.4]);
    expect(locked).toBeCloseTo(0, 12);
    expect(loose).toBeGreaterThan(locked);
    expect(circularPhaseDev([0.5])).toBeNaN();
  });

  it('antipodal phases scatter to infinity, not to a small number', () => {
    expect(circularPhaseDev([0, Math.PI])).toBe(Number.POSITIVE_INFINITY);
    expect(phaseClosureGamma(circularPhaseDev([0, Math.PI]))).toBe(0);
  });
});

describe('R4.3 coherence gate', () => {
  it('gates below φ⁻² and reports abstention, not a small value', () => {
    const r = fuseResonance([ch('a', 0.9), ch('b', 0.9)], { coherence: COHERENCE_GATE / 2 });
    expect(r.gated).toBe(true);
    expect(r.value).toBeNaN();
    expect(r.counted).toBe(0);
  });

  it('passes at or above the gate', () => {
    const r = fuseResonance([ch('a', 0.9)], { coherence: COHERENCE_GATE });
    expect(r.gated).toBe(false);
    expect(r.value).toBeCloseTo(0.9, 12);
  });

  it('an unmeasured coherence never gates', () => {
    expect(fuseResonance([ch('a', 0.9)], { coherence: NaN }).gated).toBe(false);
  });
});

describe('R4.4 A/B parity with the legacy geometric mean', () => {
  const seeds = Array.from({ length: 200 }, (_, i) => i);
  it('matches the legacy fusion to 1e-12 on random channel sets', () => {
    let worst = 0;
    for (const s of seeds) {
      let x = (s * 2654435761) >>> 0;
      const next = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
      const vals = Array.from({ length: 5 }, () => (next() < 0.25 ? NaN : next()));
      const bus = fuseResonance(vals.map((v, i) => ch(`c${i}`, v))).value;
      const legacy = legacyMean(vals);
      if (Number.isNaN(legacy)) { expect(bus).toBeNaN(); continue; }
      worst = Math.max(worst, Math.abs(bus - legacy));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('produces an identical ranking to the legacy fusion', () => {
    const sets = Array.from({ length: 120 }, (_, s) => {
      let x = (s * 22695477 + 1) >>> 0;
      const next = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
      return Array.from({ length: 4 }, () => (next() < 0.2 ? NaN : next()));
    });
    const key = (score: number, i: number) => `${Number.isNaN(score) ? -1 : score.toFixed(9)}|${i}`;
    const busOrder = sets
      .map((v, i) => key(fuseResonance(v.map((x, j) => ch(`c${j}`, x))).value, i))
      .sort();
    const legacyOrder = sets.map((v, i) => key(legacyMean(v), i)).sort();
    expect(busOrder).toEqual(legacyOrder);
  });
});

describe('R4.5 φ-weighted blend', () => {
  it('leaves the prior untouched when resonance abstains', () => {
    expect(blendWithResonance(0.42, NaN)).toBe(0.42);
  });

  it('matches the legacy recall blend to 1e-12', () => {
    for (const prior of [0.05, 0.2, 0.5, 0.87, 1]) {
      for (const res of [1e-9, 0.1, 0.5, 0.99]) {
        const legacy = Math.pow(prior, 1 / (1 + PHI_INV)) * Math.pow(res, PHI_INV / (1 + PHI_INV));
        expect(Math.abs(blendWithResonance(prior, res) - legacy)).toBeLessThan(1e-12);
      }
    }
  });

  it('lifts on strong resonance and damps on weak, but never inverts a big gap', () => {
    expect(blendWithResonance(0.5, 0.95)).toBeGreaterThan(0.5);
    expect(blendWithResonance(0.5, 0.05)).toBeLessThan(0.5);
    expect(blendWithResonance(0.9, 0.2)).toBeGreaterThan(blendWithResonance(0.2, 0.2));
  });

  it('a zero prior stays zero', () => {
    expect(blendWithResonance(0, 0.9)).toBe(0);
  });
});
