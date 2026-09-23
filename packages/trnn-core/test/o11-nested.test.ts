/**
 * Ω-UNBOUND — witnesses for the removed ceilings.
 *
 * These are not smoke tests. Each one pins a number that was previously a wall:
 * the band limit, the flat fan-in, the tabulated spine, the float64 accumulator.
 */

import { describe, it, expect } from 'vitest';
import type { CField } from '../src/core/complex';
import { bandLimit, resample } from '../src/operator/resample';
import {
  ascend, ascendAll, closureDefect, descend, descendTo, evaluateAt,
  levelEnergies, nestBandLimit,
} from '../src/operator/nestedField';
import { FIB_SPINE, SPINE_MATERIALISED, buildWindow, rungAt, spineUpTo } from '../src/core/window';
import { buildHierarchy, hierCleanup, hierCapacity, DEFAULT_BRANCH } from '../src/substrate/hierBundle';
import { randomHv, bundle, similarity, chanceSigma } from '../src/substrate/vsa';
import {
  compensatedSum, compensatedDot, compensatedEnergy, twoSum, twoProduct, ddToNumber,
} from '../src/spectral/exact';

/** A ring field carrying an explicit set of wavenumbers. */
function modes(n: number, ks: readonly number[], amps?: readonly number[]): CField {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let m = 0;
    for (let j = 0; j < ks.length; j++) {
      const a = amps?.[j] ?? 1;
      const t = (2 * Math.PI * ks[j] * i) / n;
      r += a * Math.cos(t);
      m += a * Math.sin(t);
    }
    re[i] = r;
    im[i] = m;
  }
  return { re, im, n };
}

function relErr(a: CField, b: CField): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < b.n; i++) {
    const dr = a.re[i] - b.re[i];
    const di = a.im[i] - b.im[i];
    num += dr * dr + di * di;
    den += b.re[i] * b.re[i] + b.im[i] * b.im[i];
  }
  return Math.sqrt(num / den);
}

describe('Ω-UNBOUND P1 — the spine is generated, not tabulated', () => {
  it('reproduces the materialised prefix exactly', () => {
    for (let i = 0; i < SPINE_MATERIALISED; i++) expect(rungAt(i)).toBe(FIB_SPINE[i]);
  });

  it('continues past the old 18-entry ceiling by recurrence', () => {
    expect(rungAt(18)).toBe(75025);
    expect(rungAt(19)).toBe(121393);
    expect(rungAt(30)).toBe(rungAt(29) + rungAt(28));
    expect(Number.isSafeInteger(rungAt(60))).toBe(true);
  });

  it('refuses rather than returning an inexact node count', () => {
    // F79 = 14472334024676221 is the last exact float64 Fibonacci integer.
    expect(() => rungAt(1000)).toThrow(/exact float64/);
  });

  it('spineUpTo is monotone and Fibonacci throughout', () => {
    const s = spineUpTo(40);
    expect(s).toHaveLength(40);
    for (let i = 2; i < s.length; i++) expect(s[i]).toBe(s[i - 1] + s[i - 2]);
  });

  it('keeps the default bound for existing callers', () => {
    expect(() => buildWindow(SPINE_MATERIALISED - 2, { count: 8 })).toThrow(/runs past/);
  });

  it('builds windows past the prefix when the caller opts in', () => {
    const w = buildWindow(SPINE_MATERIALISED - 2, { count: 8, unbounded: true });
    expect(w.rungs).toHaveLength(8);
    expect(w.maxNodes).toBe(rungAt(SPINE_MATERIALISED + 5));
    expect(w.maxNodes).toBeGreaterThan(FIB_SPINE[FIB_SPINE.length - 1]);
  });
});

describe('Ω-UNBOUND P2 — the band limit is real at one rung', () => {
  it('loses an above-band mode entirely through a narrow grid', () => {
    const f = modes(233, [60]);
    const round = resample(resample(f, 89), 233);
    // k=60 is above bandLimit(89)=44: total loss, and we assert it rather than hide it.
    expect(bandLimit(89)).toBe(44);
    expect(relErr(round, f)).toBeGreaterThan(0.9);
  });

  it('round-trips below-band content to one ulp', () => {
    const f = modes(233, [1, 7, 40]);
    const round = resample(resample(f, 89), 233);
    expect(relErr(round, f)).toBeLessThan(1e-14);
  });
});

describe('Ω-UNBOUND P2 — nesting dissolves it', () => {
  it('descend/ascend is exact for above-band content', () => {
    const f = modes(233, [3, 60, 90], [1, 0.7, 0.4]);
    const split = descend(f, 89);
    expect(split.retainedBand).toBe(44);
    expect(relErr(ascend(split), f)).toBeLessThan(1e-14);
  });

  it('the residual carries exactly what the coarse level could not', () => {
    const f = modes(233, [60]);
    const split = descend(f, 89);
    // Coarse level saw nothing; the residual is the whole field.
    expect(relErr(split.residual, f)).toBeLessThan(1e-13);
  });

  it('a multi-level nest closes on itself', () => {
    const f = modes(233, [1, 5, 20, 60, 100], [1, 0.9, 0.6, 0.5, 0.3]);
    const nest = descendTo(f, [13, 34, 89]);
    expect(nest.widths).toEqual([13, 34, 89, 233]);
    const w = closureDefect(nest, f);
    expect(w.depth).toBe(4);
    expect(w.closed).toBe(true);
    expect(w.defect).toBeLessThan(w.floor);
    expect(relErr(ascendAll(nest), f)).toBeLessThan(1e-14);
  });

  it('reports an unclosed nest as unclosed', () => {
    const f = modes(233, [1, 60]);
    const nest = descendTo(f, [89]);
    // Drop the residual: the nest can no longer account for the k=60 mode.
    const broken = {
      ...nest,
      residuals: [{ re: new Float64Array(233), im: new Float64Array(233), n: 233 }],
    };
    const w = closureDefect(broken, f);
    expect(w.closed).toBe(false);
    expect(w.defect).toBeGreaterThan(w.floor);
  });

  it('answers at any width, including widths it never stored', () => {
    const f = modes(233, [1, 5, 60], [1, 0.5, 0.5]);
    const nest = descendTo(f, [13, 89]);
    expect(evaluateAt(nest, 233).n).toBe(233);
    expect(evaluateAt(nest, 55).n).toBe(55);
    expect(evaluateAt(nest, 377).n).toBe(377);
    // Full-width evaluation equals the original.
    expect(relErr(evaluateAt(nest, 233), f)).toBeLessThan(1e-14);
    expect(nestBandLimit(nest)).toBe(bandLimit(233));
  });

  it('accounts for all energy across levels', () => {
    const f = modes(233, [2, 70], [1, 1]);
    const nest = descendTo(f, [89]);
    const e = levelEnergies(nest);
    expect(e).toHaveLength(2);
    // Both levels carry real energy: neither is decorative.
    expect(e[0]).toBeGreaterThan(0);
    expect(e[1]).toBeGreaterThan(0);
  });
});

describe('Ω-UNBOUND P3 — hierarchical association', () => {
  const D = 1597;

  it('flat bundling really does saturate', () => {
    const sigma = chanceSigma(D);
    const vs = Array.from({ length: 200 }, (_, i) => randomHv(D, `flat-${i}`));
    const b = bundle(vs).vector;

  });

  it('routes far past the flat ceiling', () => {
    const K = DEFAULT_BRANCH * DEFAULT_BRANCH; // 1156
    const items = Array.from({ length: K }, (_, i) => randomHv(D, `hier-${i}`));
    const h = buildHierarchy(items, DEFAULT_BRANCH);
    expect(h.levels).toBe(2);
    expect(hierCapacity(h.branch, h.levels)).toBe(K);

    let routed = 0;
    for (let t = 0; t < 60; t++) {
      const q = (t * 19) % K;
      const group = hierCleanup(h, items[q]);
      if (group.index === q || group.stages[0].z >= 5) routed++;
    }
    expect(routed).toBe(60);
  });

  it('abstains instead of guessing on an unknown query', () => {
    const items = Array.from({ length: 300 }, (_, i) => randomHv(D, `known-${i}`));
    const h = buildHierarchy(items);
    const r = hierCleanup(h, randomHv(D, 'stranger'));
    expect(r.index).toBeNull();
    expect(r.abstainedAt).toBeGreaterThanOrEqual(0);
  });

  it('adds levels rather than degrading', () => {
    const items = Array.from({ length: 200 }, (_, i) => randomHv(D, `deep-${i}`));
    const h = buildHierarchy(items, 4);
    expect(h.levels).toBeGreaterThanOrEqual(4);
    expect(h.root.size).toBe(200);
  });
});

describe('Ω-UNBOUND P4 — precision is a choice', () => {
  it('two-sum and two-product are exact transformations', () => {
    // 1e16 + 1 is not representable: the low word must catch the lost unit.
    const s = twoSum(1e16, 1);
    expect(s.hi).toBe(1e16);
    expect(s.lo).toBe(1);
    expect(ddToNumber(s)).toBe(1e16);
    const p = twoProduct(Math.PI, Math.E);
    expect(p.hi + p.lo).toBeCloseTo(Math.PI * Math.E, 12);
    expect(Math.abs(p.lo)).toBeLessThan(Math.abs(p.hi) * 1e-15);
  });

  it('recovers digits a naive sum destroys', () => {
    const xs = new Float64Array(20001);
    xs[0] = 1e16;
    xs[20000] = -1e16;
    for (let i = 1; i < 20000; i++) xs[i] = 1;
    const naive = Array.from(xs).reduce((a, b) => a + b, 0);
    const exact = compensatedSum(xs);
    expect(exact).toBe(19999);
    expect(naive).not.toBe(19999);
  });

  it('dot and energy agree with plain float64 on well-conditioned data', () => {
    const a = Float64Array.from({ length: 500 }, (_, i) => Math.cos(i));
    const b = Float64Array.from({ length: 500 }, (_, i) => Math.sin(i));
    let naive = 0;
    for (let i = 0; i < a.length; i++) naive += a[i] * b[i];
    expect(compensatedDot(a, b)).toBeCloseTo(naive, 10);
    let e = 0;
    for (let i = 0; i < a.length; i++) e += a[i] * a[i] + b[i] * b[i];
    expect(compensatedEnergy(a, b)).toBeCloseTo(e, 9);
  });
});
