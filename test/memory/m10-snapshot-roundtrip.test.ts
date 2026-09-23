/**
 * M10 — memory substrate snapshot round-trip law.
 *
 * The substrate's own self-probe asserts `restore(JSON.parse(JSON.stringify(
 * snapshot()))) ⇒ byte-identical snapshot`. That is the persistence contract:
 * a snapshot must survive a plain JSON transport with no loss.
 *
 * The regression this pins: PatternSignature carries Int32Array/Float64Array
 * fields. `JSON.stringify` renders a typed array as a plain object
 * (`{"0":1,"1":2}`), and `new Int32Array(thatObject)` yields a ZERO-length
 * array — so every L3 pattern silently lost its indices and amplitudes on
 * replay, shrinking the snapshot instead of reproducing it.
 */

import { describe, it, expect } from 'vitest';
import { MemoryStore } from '@/core/memory/MemoryStore';

function seed(store: MemoryStore, ticks = 64): void {
  for (let t = 1; t <= ticks; t++) {
    const psi = new Float64Array(64);
    for (let i = 0; i < psi.length; i++) {
      psi[i] = Math.sin((i + 1) * 0.37 + t * 0.11) * (1 + (i % 5) * 0.13);
    }
    store.ingest({ tick: t, psi, qualiaScalar: 0.3 + (t % 7) * 0.05, text: `tick ${t}` });
  }
}

describe('M10 — snapshot round-trip', () => {
  it('survives a plain JSON transport byte-for-byte', () => {
    const store = new MemoryStore();
    seed(store);

    const a = JSON.stringify(store.snapshot());
    store.restore(JSON.parse(a));
    const b = JSON.stringify(store.snapshot());

    expect(b.length).toBe(a.length);
    expect(b).toBe(a);
  });

  it('preserves every L3 pattern payload across the transport', () => {
    const store = new MemoryStore();
    seed(store);

    const before = store.patterns.snapshot();
    expect(before.length).toBeGreaterThan(0);
    const beforeCells = before.reduce((n, p) => n + p.indices.length, 0);
    expect(beforeCells).toBeGreaterThan(0);

    store.restore(JSON.parse(JSON.stringify(store.snapshot())));

    const after = store.patterns.snapshot();
    expect(after.length).toBe(before.length);
    expect(after.reduce((n, p) => n + p.indices.length, 0)).toBe(beforeCells);
    for (let i = 0; i < before.length; i++) {
      expect(after[i].indices).toBeInstanceOf(Int32Array);
      expect(after[i].amplitudes).toBeInstanceOf(Float64Array);
      expect(Array.from(after[i].indices)).toEqual(Array.from(before[i].indices));
      expect(Array.from(after[i].amplitudes)).toEqual(Array.from(before[i].amplitudes));
    }
  });

  it('recall is unchanged by a round-trip', () => {
    const store = new MemoryStore();
    seed(store);
    const cue = new Float64Array(64);
    for (let i = 0; i < cue.length; i++) cue[i] = Math.sin((i + 1) * 0.37 + 33 * 0.11);

    const before = store.recall(cue, 64, 5).patterns.map((r) => [r.pattern.hash, r.cosine]);
    store.restore(JSON.parse(JSON.stringify(store.snapshot())));
    const after = store.recall(cue, 64, 5).patterns.map((r) => [r.pattern.hash, r.cosine]);

    expect(after).toEqual(before);
  });

  it('is idempotent — a second round-trip changes nothing', () => {
    const store = new MemoryStore();
    seed(store);
    store.restore(JSON.parse(JSON.stringify(store.snapshot())));
    const once = JSON.stringify(store.snapshot());
    store.restore(JSON.parse(once));
    expect(JSON.stringify(store.snapshot())).toBe(once);
  });
});
