/**
 * Gate G0 — foundation: constants bit-parity, stability law, determinism.
 */
import { describe, expect, it } from 'vitest';
import {
  CELL,
  JURY_GAIN,
  JURY_GAIN_REFERENCE,
  KAPPA,
  LAMBDA_MEMORY,
  PHI,
  PHI_INV,
  PHI_INV_7,
  phiPow,
} from '../src/core/constants';
import { DENSE_CORE, LADDER, closureObstructionHolds, isStableByLucas, isStableByResidue, lucasMod13 } from '../src/core/scaleLadder';
import { PROFILES, fib, isFibonacci, lucasBig } from '../src/core/fibonacci';
import { DigestChain, SeedStream } from '../src/core/determinism';
import { at, wrapAt } from '../src/core/indexing';

describe('G0 constants', () => {
  it('phi identities are exact to float64', () => {
    expect(PHI * PHI - PHI).toBeCloseTo(1, 15);
    expect(PHI_INV).toBe(PHI - 1);
    // 1/PHI and PHI-1 differ by exactly 1 ulp in float64 — recorded, not hidden.
    expect(Math.abs(1 / PHI - PHI_INV)).toBeLessThanOrEqual(Number.EPSILON / 2);
  });

  it('Jury contraction certificate is bit-exact', () => {
    expect(JURY_GAIN).toBe(JURY_GAIN_REFERENCE);
    expect(JURY_GAIN).toBeLessThan(1);
  });

  it('cell coefficients follow the phi law', () => {
    expect(CELL.alpha).toBe(phiPow(-2));
    expect(CELL.beta).toBe(phiPow(-5));
    expect(CELL.gamma).toBe(phiPow(-3));
    expect(CELL.delta).toBe(CELL.gamma);
    expect(CELL.zeta).toBe(CELL.gamma);
    expect(CELL.epsilon).toBe(phiPow(-8));
    expect(CELL.eta).toBe(CELL.beta);
    expect(CELL.mu).toBe(CELL.beta);
    expect(CELL.xi).toBe(CELL.beta);
  });

  it('kappa * phi * pi = 1 exactly (cert C6)', () => {
    expect(Math.abs(KAPPA * PHI * Math.PI - 1)).toBeLessThan(1e-15);
  });

  it('phi^-7 is the stamped 60-digit value, not a float composition', () => {
    expect(PHI_INV_7).not.toBe(Math.pow(PHI, -7));
    expect(Math.abs(PHI_INV_7 - Math.pow(PHI, -7))).toBeLessThan(1e-17);
  });

  it('memory lambda is phi^-2', () => {
    expect(LAMBDA_MEMORY).toBe(phiPow(-2));
  });
});

describe('G0 ladder', () => {
  it('has exactly 42 stable rungs with an 18-rung dense core', () => {
    expect(LADDER.length).toBe(42);
    expect(DENSE_CORE.length).toBe(18);
    expect(DENSE_CORE[DENSE_CORE.length - 1].n).toBeLessThanOrEqual(125);
  });

  it('the two forms of the stability law agree for all n <= 293', () => {
    for (let n = 1; n <= 293; n++) expect(isStableByResidue(n)).toBe(isStableByLucas(n));
  });

  it('stable rungs have L(n) = +/-1 mod 13', () => {
    for (const r of LADDER) expect([1, 12]).toContain(r.lucasResidue);
  });

  it('closure obstruction holds: L(n) mod 13 is never 0', () => {
    expect(closureObstructionHolds(400)).toBe(true);
    for (let n = 1; n <= 60; n++) expect(lucasMod13(n)).not.toBe(0);
  });

  it('rung geometry is monotone in log space and attenuates', () => {
    for (let i = 1; i < LADDER.length; i++) {
      expect(LADDER[i].logRadius).toBeGreaterThan(LADDER[i - 1].logRadius);
      expect(LADDER[i].logTau).toBeGreaterThan(LADDER[i - 1].logTau);
      expect(LADDER[i].qrf).toBeLessThan(LADDER[i - 1].qrf);
    }
  });
});

describe('G0 fibonacci', () => {
  it('lucas/fib recurrences are exact in BigInt', () => {
    expect(lucasBig(0)).toBe(2n);
    expect(lucasBig(7)).toBe(29n);
    expect(fib(78)).toBe(8944394323791464);
  });

  it('every profile size is Fibonacci', () => {
    for (const v of Object.values(PROFILES)) expect(isFibonacci(v)).toBe(true);
  });
});

describe('G0 determinism', () => {
  it('digest chains from the same seed and payloads are identical', () => {
    const a = new DigestChain('omega');
    const b = new DigestChain('omega');
    for (let i = 0; i < 50; i++) {
      const p = Float64Array.from([i, i * Math.PI, Math.sin(i)]);
      expect(a.link(p)).toBe(b.link(p));
    }
  });

  it('a one-ulp payload change diverges the chain', () => {
    const a = new DigestChain('omega');
    const b = new DigestChain('omega');
    a.link(Float64Array.from([1]));
    b.link(Float64Array.from([1 + Number.EPSILON]));
    expect(a.head()).not.toBe(b.head());
  });

  it('seed stream is reproducible and in range', () => {
    const a = new SeedStream('s');
    const b = new SeedStream('s');
    for (let i = 0; i < 100; i++) {
      const x = a.next();
      expect(x).toBe(b.next());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('G0 indexing', () => {
  it('bounds-checks and wraps', () => {
    const xs = [1, 2, 3];
    expect(at(xs, 2)).toBe(3);
    expect(() => at(xs, 3)).toThrow();
    expect(wrapAt(xs, -1)).toBe(3);
  });
});
