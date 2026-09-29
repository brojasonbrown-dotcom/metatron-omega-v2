/**
 * Gate R0 — Ω-REAL Class-A substrate parity.
 *
 * Every claim the report labels Class A must be *derived* here, not restated.
 * A failure in this battery means the substrate no longer proves itself.
 */
import { describe, expect, it } from 'vitest';
import { PHI, PHI_INV, KAPPA, phiPow } from '../src/core/constants';
import { lucasBig } from '../src/core/fibonacci';
import {
  CARRIER_DIM,
  CONSOLIDATION_COS,
  EMPIRICAL_CONSTANTS,
  FLUX_WINDOW_HI,
  FLUX_WINDOW_LO,
  MIN_PAIRED,
  PROMOTION_THRESHOLD,
  PSI,
  RESONANCE_FLOOR,
  STRESS_THRESHOLD,
  boundaryFlux,
  carrierPack,
  carrierUnpack,
  corridor,
  fluxFirstInWindow,
  heartbeatGaps,
  heartbeatSchedule,
  isStableRung,
  lucasMod13Cycle,
  metatronSpectrum,
  pisotDefect,
  sns,
  stableRungsMod28,
  substrateParity,
  substrateParityHolds,
} from '../src/substrate/phiSubstrate';

describe('R0 — root identities', () => {
  it('phi^-1 + phi^-2 = 1 and psi = -phi^-1', () => {
    expect(Math.abs(PHI_INV + phiPow(-2) - 1)).toBeLessThan(1e-15);
    expect(Math.abs(PSI + PHI_INV)).toBeLessThan(1e-15);
  });

  it('kappa = 1/(phi*pi) closes exactly', () => {
    expect(Math.abs(KAPPA * PHI * Math.PI - 1)).toBeLessThan(1e-15);
  });

  it('Binet: phi^n = L_n - psi^n, and the Pisot defect is exactly phi^-n', () => {
    for (const n of [5, 13, 21, 28]) {
      const L = Number(lucasBig(n));
      // Both comparisons are between quantities of magnitude phi^n, so the
      // tolerance must scale with phi^n: an absolute epsilon would be below
      // the ulp of phi^28 (~1.2e-10) and would fail for numerical, not
      // mathematical, reasons.
      const ulp = Number.EPSILON * phiPow(n);
      expect(Math.abs(phiPow(n) - (L - Math.pow(PSI, n)))).toBeLessThan(64 * ulp);
      expect(Math.abs(Math.abs(phiPow(n) - L) - pisotDefect(n))).toBeLessThan(64 * ulp);
      // The defect shrinks geometrically — that is the Pisot property itself.
      expect(pisotDefect(n)).toBeLessThan(1);
    }
  });
});

describe('R0 — Lucas mod-13 closure (finding F1)', () => {
  it('the cycle has period 28 and never hits zero, so exact closure is impossible', () => {
    const cycle = lucasMod13Cycle();
    expect(cycle).toHaveLength(28);
    expect(cycle).not.toContain(0);
    for (let n = 0; n < 56; n++) {
      expect(Number(lucasBig(n) % 13n)).toBe(cycle[n % 28]);
    }
  });

  it('there are FOUR stable rungs, derived not hardcoded', () => {
    expect(stableRungsMod28()).toEqual([1, 13, 15, 27]);
    for (const n of [1, 13, 15, 27, 29, 41]) expect(isStableRung(n)).toBe(true);
    for (const n of [0, 2, 12, 14, 26]) expect(isStableRung(n)).toBe(false);
  });

  it('the heartbeat alternates long(12) and short(2)', () => {
    expect(heartbeatGaps()).toEqual([12, 2, 12, 2]);
    const sched = heartbeatSchedule(2);
    expect(sched.map((s) => s.tick)).toEqual([1, 13, 15, 27, 29, 41, 43, 55]);
    expect(sched.map((s) => s.kind)).toEqual([
      'long',
      'long',
      'short',
      'long',
      'short',
      'long',
      'short',
      'long',
    ]);
  });
});

describe('R0 — flux ladder (finding F2)', () => {
  it('the tolerance window is [phi^-26, phi^-25) and is first entered at n = 13', () => {
    expect(FLUX_WINDOW_LO).toBeLessThan(FLUX_WINDOW_HI);
    expect(fluxFirstInWindow()).toBe(13);
    expect(boundaryFlux(13)).toBeCloseTo(3.684015e-6, 12);
    expect(boundaryFlux(13)).toBeGreaterThanOrEqual(FLUX_WINDOW_LO);
    expect(boundaryFlux(13)).toBeLessThan(FLUX_WINDOW_HI);
    expect(boundaryFlux(12)).toBeGreaterThanOrEqual(FLUX_WINDOW_HI);
  });
});

describe('R0 — geometry and thresholds', () => {
  it('the Metatron spectrum is round(phi^k), k = 0..12', () => {
    expect(metatronSpectrum()).toEqual([1, 2, 3, 4, 7, 11, 18, 29, 47, 76, 123, 199, 322]);
  });

  it('carrier is 28 slots and packs/unpacks losslessly', () => {
    expect(CARRIER_DIM).toBe(28);
    const re = Float64Array.from({ length: 14 }, (_, i) => i * 0.5);
    const im = Float64Array.from({ length: 14 }, (_, i) => -i);
    const packed = carrierPack(re, im);
    expect(packed).toHaveLength(28);
    const back = carrierUnpack(packed);
    expect(Array.from(back.re)).toEqual(Array.from(re));
    expect(Array.from(back.im)).toEqual(Array.from(im));
  });

  it('promotion = ceil(phi^4) = 7, consolidation cosine = 1 - phi^-3, F9 floor = 34', () => {
    expect(PROMOTION_THRESHOLD).toBe(7);
    expect(CONSOLIDATION_COS).toBeCloseTo(0.7639320225002102, 15);
    expect(MIN_PAIRED).toBe(34);
  });

  it('SNS has exact closed forms only on d in {3,4,5,6}', () => {
    expect(sns(3)).toBe(3);
    expect(Math.abs(sns(4) - 4 * PHI)).toBeLessThan(1e-15);
    expect(sns(5)).toBe(15);
    expect(() => sns(7)).toThrow();
  });
});

describe('R0 — corridor and epistemic labelling', () => {
  it('the default corridor spans [phi^-2, phi^-1]', () => {
    const c = corridor();
    expect(c.lower).toBeCloseTo(phiPow(-2), 15);
    expect(c.upper).toBeCloseTo(PHI_INV, 15);
    expect(c.classify(0.9)).toBe('STABLE');
    expect(c.classify(0.5)).toBe('WATCH');
    expect(c.classify(0.1)).toBe('STRESS');
    expect(c.classify(STRESS_THRESHOLD)).toBe('WATCH');
  });

  it('the two tunables are declared Class C, never Class A', () => {
    expect(EMPIRICAL_CONSTANTS.RESONANCE_FLOOR.class).toBe('C');
    expect(EMPIRICAL_CONSTANTS.STRESS_THRESHOLD.class).toBe('C');
    expect(EMPIRICAL_CONSTANTS.RESONANCE_FLOOR.value).toBe(RESONANCE_FLOOR);
    expect(RESONANCE_FLOOR).toBe(0.05625982094858675);
    expect(STRESS_THRESHOLD).toBe(0.432);
  });
});

describe('R0 — the runtime self-proof', () => {
  it('every Class-A parity check passes', () => {
    const failed = substrateParity().filter((c) => c.class === 'A' && !c.ok);
    expect(failed.map((f) => `${f.name}: ${f.detail}`)).toEqual([]);
    expect(substrateParityHolds()).toBe(true);
  });
});
