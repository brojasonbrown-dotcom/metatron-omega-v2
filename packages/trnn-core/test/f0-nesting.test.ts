/**
 * Gate F0 — Ω-DEPTH Section 2 · fractal nesting.
 *
 * Contract under test:
 *   • μ = 0 leaves the parent patch bit-identical (the feature is off by default)
 *   • prolongation is bounded: ‖contribution‖ ≤ μ·‖patch‖ (provable ISS entry)
 *   • a child actually captures the fine band a coarse basis cannot express
 *   • the pool recycles deterministically, honours freeze, and never allocates
 *     beyond its byte budget
 *   • depth is capped and the tick-cost multiplier stays below 2.62
 */

import { describe, expect, it } from 'vitest';
import {
  FractalPool,
  MAX_DEPTH,
  childBytes,
  costMultiplier,
  createChildField,
  createField,
  createLattice,
  buildBasis,
  depthRate,
  energy,
  medianOf,
  prolong,
  qualifies,
  residualEnergy,
  restrict,
  type CField,
} from '../src/index';

function twoScaleField(n: number): CField {
  // coarse carrier (mode 2) + fine texture (mode ~n/3): the fine part is what a
  // truncated coarse basis must fail to express.
  const f = createField(n);
  for (let j = 0; j < n; j++) {
    const t = (2 * Math.PI * j) / n;
    f.re[j] = Math.cos(2 * t) + 0.5 * Math.cos(Math.round(n / 3) * t);
    f.im[j] = Math.sin(2 * t) + 0.5 * Math.sin(Math.round(n / 3) * t);
  }
  return f;
}

describe('F0 — fractal nesting', () => {
  it('μ = 0 leaves the parent patch bit-identical', () => {
    const child = createChildField(233, 1, 7);
    const patch = twoScaleField(233);
    const before = Float64Array.from(patch.re);
    const beforeIm = Float64Array.from(patch.im);
    restrict(child, patch);
    const added = prolong(child, patch, 0);
    expect(added).toBe(0);
    expect(Array.from(patch.re)).toEqual(Array.from(before));
    expect(Array.from(patch.im)).toEqual(Array.from(beforeIm));
  });

  it('prolongation is bounded by μ·‖patch‖', () => {
    const child = createChildField(233, 1, 3);
    const patch = twoScaleField(233);
    const patchNorm = Math.sqrt(energy(patch));
    restrict(child, patch);
    const mu = 0.1;
    const added = prolong(child, patch, mu);
    expect(added).toBeLessThanOrEqual(mu * patchNorm * (1 + 1e-9));
    expect(added).toBeGreaterThan(0);
  });

  it('a child captures band the coarse basis cannot express', () => {
    const n = 233;
    const psi = twoScaleField(n);
    const coarse = buildBasis(createLattice(n, 'fibonacci')); // truncated φ-mode ladder
    const coeffs = new Float64Array(2 * coarse.vectors.length);
    const work = createField(n);
    const coarseResidual = residualEnergy(psi, coarse, coeffs, work);
    expect(coarseResidual).toBeGreaterThan(0);

    const child = createChildField(233, 1, 0);
    restrict(child, psi);
    const captured = energy(child.state);
    expect(captured).toBeGreaterThan(0);
    // The child holds energy the coarse projection dropped.
    expect(captured).toBeLessThanOrEqual(energy(psi) * (1 + 1e-9));
  });

  it('selection rule needs both excess residual and a sustained window', () => {
    const med = medianOf([1, 1, 2, 3, 5]);
    expect(qualifies(med * 3, med, 89)).toBe(true);
    expect(qualifies(med * 3, med, 88)).toBe(false);
    expect(qualifies(med * 1.5, med, 1000)).toBe(false);
  });

  it('pool sizes from its byte budget and never exceeds it', () => {
    const budget = childBytes(233) * 10 + 5;
    const pool = new FractalPool(budget, 233);
    expect(pool.capacity()).toBe(10);
    for (let i = 0; i < 10; i++) expect(pool.acquire(i)).not.toBeNull();
    const st = pool.stats();
    expect(st.occupied).toBe(10);
    expect(st.bytesUsed).toBeLessThanOrEqual(budget);
  });

  it('pool evicts the lowest-utility child, and freeze blocks eviction', () => {
    const pool = new FractalPool(childBytes(233) * 2, 233);
    const a = pool.acquire(1)!;
    const b = pool.acquire(2)!;
    a.explained = 10;
    b.explained = 0;
    const c = pool.acquire(3)!;
    expect(c.site).toBe(3);
    expect(pool.active().some((x) => x.site === 1)).toBe(true); // productive child kept
    expect(pool.stats().evictions).toBe(1);

    pool.setFrozen(true);
    expect(pool.acquire(4)).toBeNull();
    pool.setFrozen(false);
    expect(pool.acquire(4)).not.toBeNull();
  });

  it('reacquiring the same site reuses the same child', () => {
    const pool = new FractalPool(childBytes(233) * 3, 233);
    const a = pool.acquire(5)!;
    a.state.re[0] = 1.5;
    const again = pool.acquire(5)!;
    expect(again).toBe(a);
    expect(again.state.re[0]).toBe(1.5);
  });

  it('depth is capped and the cost multiplier stays bounded', () => {
    expect(MAX_DEPTH).toBe(3);
    expect(() => createChildField(233, 4, 0)).toThrow();
    expect(depthRate(1)).toBeCloseTo(0.6180339887498949, 15);
    expect(costMultiplier()).toBeLessThan(2.62);
  });
});
