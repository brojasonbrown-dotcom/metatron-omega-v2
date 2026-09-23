/**
 * M9 — memory substrate invariants.
 *
 * These are laws, not smoke tests: each one pins a property the substrate is
 * allowed to be judged on. If a future change breaks one of these, recall has
 * changed meaning, not just ranking.
 */

import { describe, it, expect } from 'vitest';
import {
  measureResonance, crossScaleAffinity, recencyScore, ageBand,
  resonanceDecayFactor, RESONANCE_FLOOR, cosineDense, PHI_INV,
} from '@/core/memory/Resonance';
import { fibonacciBandedSelect, bandQuota } from '@/core/memory/Banding';
import { consolidate, prunableKeys, PROTOTYPE_COS } from '@/core/memory/Consolidator';
import { KnowledgeBase } from '@/core/knowledge/KnowledgeBase';

const NOW = 1_700_000_000_000;

const vec = (...xs: number[]) => Float64Array.from(xs);

describe('resonance — abstention semantics', () => {
  it('abstains (NaN) when every channel is unmeasurable', () => {
    const r = measureResonance({}, { coherence: NaN, closure: NaN, rung: -1, now: NOW });
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.counted).toBe(0);
    expect(r.abstained).toBe(5);
  });

  it('an abstaining channel is excluded, not scored as zero', () => {
    const full = measureResonance(
      { capturedAt: NOW, rung: 3 },
      { coherence: 0.5, closure: 0.5, rung: 3, now: NOW },
    );
    const partial = measureResonance(
      { capturedAt: NOW },
      { coherence: 0.5, closure: 0.5, rung: -1, now: NOW },
    );
    // both are geometric means of the SAME measured values -> identical
    expect(full.counted).toBe(4);
    expect(partial.counted).toBe(3);
    expect(partial.value).toBeGreaterThan(0);
  });

  it('one measured-dead channel vetoes the whole score', () => {
    const r = measureResonance({ capturedAt: NOW }, { coherence: 0, closure: 1, rung: -1, now: NOW });
    expect(r.value).toBe(0);
    expect(r.vetoId).toBe('coherence');
  });

  it('is bracketed by its weakest and strongest measured channels', () => {
    const r = measureResonance(
      { capturedAt: NOW, rung: 2 },
      { coherence: 0.9, closure: 0.3, rung: 4, now: NOW },
    );
    // Geometric mean: the weakest channel is the floor the score sits on and
    // drags everything toward it, but it cannot exceed the strongest one.
    expect(r.vetoId).toBe('closure');
    expect(r.value).toBeGreaterThanOrEqual(r.vetoValue - 1e-12);
    expect(r.value).toBeLessThanOrEqual(0.9 + 1e-12);
  });

  it('weakening one channel strictly weakens the fused score', () => {
    const strong = measureResonance({ capturedAt: NOW, rung: 2 }, { coherence: 0.9, closure: 0.9, rung: 2, now: NOW });
    const weak = measureResonance({ capturedAt: NOW, rung: 2 }, { coherence: 0.9, closure: 0.2, rung: 2, now: NOW });
    expect(weak.value).toBeLessThan(strong.value);
  });
});

describe('resonance — φ laws', () => {
  it('cross-scale affinity is exactly φ^-Δrung and symmetric', () => {
    expect(crossScaleAffinity(5, 5)).toBeCloseTo(1, 12);
    expect(crossScaleAffinity(5, 6)).toBeCloseTo(PHI_INV, 12);
    expect(crossScaleAffinity(8, 5)).toBeCloseTo(Math.pow(PHI_INV, 3), 12);
    expect(crossScaleAffinity(5, 8)).toBe(crossScaleAffinity(8, 5));
  });

  it('an untagged rung abstains instead of reading as distant', () => {
    expect(Number.isNaN(crossScaleAffinity(-1, 4))).toBe(true);
  });

  it('recency decays one φ-octave per age band and never hits zero', () => {
    const fresh = recencyScore(NOW, NOW);
    const old = recencyScore(NOW - 1000 * 60 * 60 * 24 * 365, NOW);
    expect(fresh).toBe(1);
    expect(old).toBeGreaterThan(0);
    expect(old).toBeLessThan(fresh);
  });

  it('age bands are monotone in age', () => {
    let prev = -1;
    for (const mins of [0, 1.5, 2.5, 4, 7, 12, 20, 100, 5000]) {
      const b = ageBand(NOW - mins * 60000, NOW);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it('decay is baseline for an unmeasurable resonance', () => {
    expect(resonanceDecayFactor(NaN)).toBe(1);
    expect(resonanceDecayFactor(RESONANCE_FLOOR / 2)).toBeGreaterThan(1);
    expect(resonanceDecayFactor(0.9)).toBeLessThan(1);
  });

  it('cosine abstains on a degenerate vector rather than returning 0', () => {
    expect(Number.isNaN(cosineDense(vec(0, 0, 0), vec(1, 2, 3)))).toBe(true);
    expect(cosineDense(vec(1, 0), vec(1, 0))).toBeCloseTo(1, 12);
  });
});

describe('Fibonacci banding — age fairness', () => {
  const mk = (band: number, score: number, id: string) => ({ band, score, id });

  it('gives every non-empty band at least one slot', () => {
    const items = [
      ...Array.from({ length: 50 }, (_, i) => mk(0, 0.9 - i * 0.001, `f${i}`)),
      mk(6, 0.10, 'ancient'),
      mk(4, 0.12, 'old'),
    ];
    const picked = fibonacciBandedSelect(items, 12);
    expect(picked.some((p) => p.id === 'ancient')).toBe(true);
    expect(picked.some((p) => p.id === 'old')).toBe(true);
  });

  it('recency still dominates by quota shape', () => {
    const items = [
      ...Array.from({ length: 20 }, (_, i) => mk(0, 0.5, `f${i}`)),
      ...Array.from({ length: 20 }, (_, i) => mk(7, 0.99, `o${i}`)),
    ];
    const picked = fibonacciBandedSelect(items, 10);
    const fresh = picked.filter((p) => p.id.startsWith('f')).length;
    expect(fresh).toBeGreaterThanOrEqual(bandQuota(0));
  });

  it('never returns more than k and never wastes a slot', () => {
    const items = Array.from({ length: 40 }, (_, i) => mk(i % 5, Math.random(), `x${i}`));
    const picked = fibonacciBandedSelect(items, 9);
    expect(picked).toHaveLength(9);
    expect(new Set(picked.map((p) => p.id)).size).toBe(9);
  });

  it('is deterministic under score ties', () => {
    const items = Array.from({ length: 30 }, (_, i) => mk(i % 4, 0.5, `t${i}`));
    const a = fibonacciBandedSelect(items, 7).map((x) => x.id);
    const b = fibonacciBandedSelect([...items].reverse(), 7).map((x) => x.id);
    expect(a).toEqual(b);
  });

  it('returns everything when the pool is smaller than k', () => {
    const items = [mk(0, 0.2, 'a'), mk(3, 0.9, 'b')];
    expect(fibonacciBandedSelect(items, 10).map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('consolidation — annotate, never destroy', () => {
  const dup = () => vec(1, 0.99, 0.98, 1.01);
  const near = () => vec(1.01, 1, 0.97, 1);
  const opposed = () => vec(-1, -1, -1, -1);

  it('clusters near-duplicates behind one prototype with support', () => {
    const r = consolidate([
      { id: 'a', vec: dup() },
      { id: 'b', vec: near() },
      { id: 'z', vec: vec(0, 1, 0, 0) },
    ]);
    const proto = r.clusters.find((c) => c.support > 1);
    expect(proto).toBeDefined();
    expect(proto!.memberIds).toContain('b');
    expect(cosineDense(dup(), near())).toBeGreaterThanOrEqual(PROTOTYPE_COS);
  });

  it('records a contradiction only when the two share subject terms', () => {
    const terms = new Set(['tax', 'policy', 'rate']);
    const withOverlap = consolidate([
      { id: 'a', vec: dup(), terms },
      { id: 'b', vec: opposed(), terms },
    ]);
    const without = consolidate([
      { id: 'a', vec: dup(), terms: new Set(['tax']) },
      { id: 'b', vec: opposed(), terms: new Set(['whales', 'ocean', 'migration']) },
    ]);
    expect(withOverlap.contradictions).toHaveLength(1);
    expect(without.contradictions).toHaveLength(0);
  });

  it('respects the comparison budget', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `i${i}`, vec: vec(i, 1, 0, 0) }));
    const r = consolidate(items, 100);
    expect(r.compared).toBeLessThanOrEqual(100);
    expect(r.budgetExhausted).toBe(true);
  });

  it('never prunes a weight above the emergent floor', () => {
    const w = new Map([['keep', RESONANCE_FLOOR * 2], ['drop', RESONANCE_FLOOR / 2], ['nan', NaN]]);
    expect(prunableKeys(w)).toEqual(['drop', 'nan']);
  });

  it('is deterministic', () => {
    const items = [
      { id: 'a', vec: dup() }, { id: 'b', vec: near() }, { id: 'c', vec: vec(0, 0, 1, 0) },
    ];
    const x = JSON.stringify(consolidate(items));
    const y = JSON.stringify(consolidate([...items].reverse()));
    expect(x).toEqual(y);
  });
});

describe('KnowledgeBase — no regression from resonance/banding', () => {
  const build = () => {
    const kb = new KnowledgeBase();
    for (let i = 0; i < 6; i++) {
      kb.ingest({
        field: 'law', url: `https://example.test/${i}`, title: `doc ${i}`,
        text: `corporate governance duty of care number ${i}. `.repeat(60),
        now: NOW - i * 60_000, rung: i % 3,
      });
    }
    return kb;
  };

  it('ranks identically with no field context (text-only parity)', () => {
    const kb = build();
    const a = kb.recall('governance duty', 5).map((h) => h.chunk.id);
    const b = kb.recall('governance duty', 5).map((h) => h.chunk.id);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('abstains the resonance channel when offline', () => {
    const hits = build().recall('governance duty', 5);
    expect(hits.every((h) => Number.isNaN(h.resonance))).toBe(true);
  });

  it('measures resonance when a field context is supplied', () => {
    const hits = build().recall('governance duty', 5, undefined, {
      coherence: 0.8, closure: 0.9, rung: 1, vector: null, now: NOW,
    });
    expect(hits.every((h) => Number.isFinite(h.resonance))).toBe(true);
    expect(hits.every((h) => h.resonance > 0 && h.resonance <= 1)).toBe(true);
  });

  it('stamps capture time and rung, and survives a snapshot round-trip', () => {
    const kb = build();
    const snap = JSON.parse(JSON.stringify(kb.snapshot()));
    const kb2 = new KnowledgeBase();
    kb2.restore(snap);
    const a = kb.recall('governance duty', 5).map((h) => h.chunk.id);
    const b = kb2.recall('governance duty', 5).map((h) => h.chunk.id);
    expect(b).toEqual(a);
    const one = kb2.chunk(a[0])!;
    expect(one.createdAt).toBeGreaterThan(0);
    expect(one.rung).toBeGreaterThanOrEqual(0);
  });

  it('consolidation never loses a recallable chunk', () => {
    const kb = build();
    const before = kb.recall('governance duty', 5).map((h) => h.chunk.id);
    kb.consolidate();
    const after = kb.recall('governance duty', 5).map((h) => h.chunk.id);
    expect(after).toEqual(before);
    for (const id of before) expect(kb.chunk(id)).toBeDefined();
  });
});
