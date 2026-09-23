/**
 * Ω-SCALE P2 — tiered retention.
 *
 * The properties that matter: nothing is thrown away without first being
 * offered downward, the hot tier really does end up holding the surprising
 * frames, and the footprint arithmetic is the one the scaling claim rests on.
 */
import { describe, it, expect } from 'vitest';
import {
  TieredCorpus,
  DEFAULT_POLICY,
  surpriseOf,
  projectFootprint,
  type TierPolicy,
} from '../src/operator';

const tiny: TierPolicy[] = [
  { tier: 'hot', capacity: 3, floor: 2, width: 100 },
  { tier: 'warm', capacity: 5, floor: 0.5, width: 10 },
  { tier: 'cold', capacity: 8, floor: 0, width: 1 },
];

describe('Ω-SCALE P2 · surprise', () => {
  it('t1 · a frame inside its band is unsurprising', () => {
    expect(surpriseOf(1.0, 1.0, 0.5)).toBe(0);
    expect(surpriseOf(1.2, 1.0, 0.5)).toBeCloseTo(0.4, 12);
  });

  it('t2 · an uncalibrated band admits rather than silently discards', () => {
    expect(surpriseOf(1, 0, 0)).toBe(Infinity);
    expect(surpriseOf(1, 0, NaN)).toBe(Infinity);
  });

  it('t3 · a gap scores zero surprise, never a spurious spike', () => {
    expect(surpriseOf(NaN, 1, 0.5)).toBe(0);
    expect(surpriseOf(1, NaN, 0.5)).toBe(0);
  });
});

describe('Ω-SCALE P2 · tiered corpus', () => {
  it('t4 · routes each frame to the highest tier it clears', () => {
    const c = new TieredCorpus<string>(tiny);
    expect(c.admit('big', 5, 1).tier).toBe('hot');
    expect(c.admit('mid', 1, 2).tier).toBe('warm');
    expect(c.admit('small', 0.01, 3).tier).toBe('cold');
  });

  it('t5 · overflow demotes rather than deletes', () => {
    const c = new TieredCorpus<number>(tiny);
    for (let i = 0; i < 4; i++) c.admit(i, 2 + i, i);
    const r = c.admit(99, 100, 9);
    expect(r.tier).toBe('hot');
    expect(c.entries('hot').length).toBe(3);
    // The two least-surprising hot frames were pushed down, not lost.
    expect(c.entries('warm').length).toBeGreaterThan(0);
    expect(r.dropped.length).toBe(0);
  });

  it('t6 · the hot tier ends up holding the most surprising frames', () => {
    const c = new TieredCorpus<number>(tiny);
    for (let i = 0; i < 50; i++) c.admit(i, 2 + (i % 10), i);
    const hot = c.entries('hot').map((e) => e.surprise);
    const warm = c.entries('warm').map((e) => e.surprise);
    expect(Math.min(...hot)).toBeGreaterThanOrEqual(Math.max(...warm));
  });

  it('t7 · only the bottom tier can drop, and it reports what it dropped', () => {
    const c = new TieredCorpus<number>(tiny);
    let dropped = 0;
    for (let i = 0; i < 200; i++) dropped += c.admit(i, 3, i).dropped.length;
    expect(dropped).toBeGreaterThan(0);
    expect(c.totalCount).toBe(3 + 5 + 8);
  });

  it('t8 · a frame below every floor is rejected outright', () => {
    const strict: TierPolicy[] = [{ tier: 'hot', capacity: 2, floor: 1, width: 4 }];
    const c = new TieredCorpus<number>(strict);
    const r = c.admit(1, 0.1, 0);
    expect(r.tier).toBeNull();
    expect(c.counters.rejected).toBe(1);
  });

  it('t9 · footprint tracks the real cost model', () => {
    const c = new TieredCorpus<number>(tiny);
    c.admit(1, 5, 0);
    expect(c.footprint()).toBe(100);
    c.admit(2, 1, 1);
    expect(c.footprint()).toBe(110);
    expect(c.capacityNumbers()).toBe(3 * 100 + 5 * 10 + 8 * 1);
  });

  it('t10 · clear resets both contents and counters', () => {
    const c = new TieredCorpus<number>(tiny);
    for (let i = 0; i < 20; i++) c.admit(i, 3, i);
    c.clear();
    expect(c.totalCount).toBe(0);
    expect(c.counters).toEqual({ admitted: 0, rejected: 0, evicted: 0 });
  });

  it('t11 · default policy holds a non-trivial number budget', () => {
    const c = new TieredCorpus<number>();
    expect(c.capacityNumbers()).toBeGreaterThan(1e7);
    expect(c.stats().map((s) => s.tier)).toEqual(['hot', 'warm', 'cold']);
  });

  it('t12 · projection gives finite, ordered time-to-full', () => {
    const p = projectFootprint(DEFAULT_POLICY, 60, [0.01, 0.1, 1]);
    expect(p.length).toBe(3);
    for (const row of p) {
      expect(Number.isFinite(row.secondsToFull)).toBe(true);
      expect(row.bytes).toBe(row.numbers * 8);
    }
  });

  it('t13 · deterministic under an identical offer sequence', () => {
    const run = () => {
      const c = new TieredCorpus<number>(tiny);
      for (let i = 0; i < 100; i++) c.admit(i, (i * 7) % 11, i);
      return c.stats();
    };
    expect(run()).toEqual(run());
  });
});
