import { describe, expect, it } from 'vitest';
import { gradedError, h1, h2, l2, relL2 } from '../src/operator/sobolev';
import type { CField } from '../src/core/complex';

const TWO_PI = 2 * Math.PI;

function mode(n: number, k: number, amp = 1): CField {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const u = (TWO_PI * j) / n;
    re[j] = amp * Math.cos(k * u);
  }
  return { re, im, n };
}

function zero(n: number): CField {
  return { re: new Float64Array(n), im: new Float64Array(n), n };
}

describe('O4 — Sobolev-graded error', () => {
  it('L² of cos(ku) against zero is amplitude/√2', () => {
    expect(l2(mode(233, 3), zero(233))).toBeCloseTo(1 / Math.SQRT2, 12);
  });

  it('H¹ ≥ L² always', () => {
    for (const k of [1, 3, 8, 21]) {
      const a = mode(233, k);
      const b = zero(233);
      expect(h1(a, b)).toBeGreaterThanOrEqual(l2(a, b));
    }
  });

  it('H¹ separates two fields with identical L² and different roughness', () => {
    const smooth = mode(233, 1);
    const rough = mode(233, 21);
    const z = zero(233);
    expect(l2(smooth, z)).toBeCloseTo(l2(rough, z), 12);
    expect(h1(rough, z)).toBeGreaterThan(h1(smooth, z) * 5);
  });

  it('closed form: ‖cos(ku)‖_{H¹}² = ½(1 + k²)', () => {
    for (const k of [2, 5, 13]) {
      const v = h1(mode(233, k), zero(233));
      expect(v * v).toBeCloseTo(0.5 * (1 + k * k), 9);
    }
  });

  it('H² adds the second-derivative term: ½(1 + k² + k⁴)', () => {
    const k = 5;
    const v = h2(mode(233, k), zero(233));
    expect(v * v).toBeCloseTo(0.5 * (1 + k * k + k ** 4), 8);
  });

  it('roughness reports √(1+k²) for a pure mode', () => {
    const g = gradedError(mode(233, 8), zero(233));
    expect(g.roughness).toBeCloseTo(Math.sqrt(1 + 64), 9);
    expect(g.h2).toBeGreaterThan(g.h1);
    expect(g.h1).toBeGreaterThan(g.l2);
  });

  it('relative L² is 0 for identical fields and finite otherwise', () => {
    const a = mode(89, 3);
    expect(relL2(a, a)).toBe(0);
    expect(relL2(zero(89), zero(89))).toBe(0);
    expect(Number.isFinite(relL2(mode(89, 3, 1.5), a))).toBe(true);
  });

  it('width mismatch is a hard error, never a silent truncation', () => {
    expect(() => l2(mode(89, 1), mode(144, 1))).toThrow(/width mismatch/);
  });
});
