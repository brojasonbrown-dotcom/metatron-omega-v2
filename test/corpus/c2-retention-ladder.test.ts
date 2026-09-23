/**
 * Ω-UNBOUND P5 — the COLD retention ladder.
 *
 * The archive used to refuse admission at the quota guard. These tests pin the
 * new behaviour: under pressure it NARROWS the oldest evidence a Fibonacci step
 * rather than turning new evidence away, and it still refuses — honestly — when
 * the ladder is genuinely exhausted.
 */
import { describe, it, expect } from 'vitest';
import {
  CorpusLedger, ColdArchive, MemoryBlobStore, isRefusal,
  type CorpusFrame,
} from '@/core/corpus';
import { COLD_WIDTH_LADDER, narrowerWidth } from '@/core/corpus/ColdArchive';
import type { QuotaEstimate } from '@/core/corpus/storage';

const W = 21;

function frame(tick: number): CorpusFrame {
  const values = new Float64Array(W);
  for (let i = 0; i < W; i++) values[i] = Math.sin((tick + 1) * (i + 1) * 0.1);
  return { tick, rank: 0, values, surprise: NaN };
}

/** A store whose reported quota we can squeeze at will. */
class SqueezableStore extends MemoryBlobStore {
  quotaBytes = Number.NaN;
  override async estimate(): Promise<QuotaEstimate> {
    const e = await super.estimate();
    return { usage: e.usage, quota: this.quotaBytes };
  }
}

function makeArchive() {
  const store = new SqueezableStore();
  const ledger = new CorpusLedger();
  const cold = new ColdArchive({ store, ledger });
  return { store, ledger, cold };
}

describe('Ω-UNBOUND · width ladder', () => {
  it('steps down the Fibonacci rungs and stops at the narrowest', () => {
    expect(narrowerWidth(13)).toBe(8);
    expect(narrowerWidth(8)).toBe(5);
    expect(narrowerWidth(5)).toBe(3);
    expect(narrowerWidth(3)).toBeNull();
    expect(COLD_WIDTH_LADDER[COLD_WIDTH_LADDER.length - 1]).toBe(3);
  });
});

describe('Ω-UNBOUND · COLD narrows instead of refusing', () => {
  it('admits new evidence under pressure by narrowing the oldest segment', async () => {
    const { store, ledger, cold } = makeArchive();

    // Seed three segments with plenty of room.
    for (let s = 0; s < 3; s++) {
      const r = await cold.compact([frame(s * 10), frame(s * 10 + 1)], 1000 + s);
      expect(isRefusal(r)).toBe(false);
    }
    const before = cold.segments.map((s) => s.width);
    expect(before.every((w) => w === 13)).toBe(true);

    // Now squeeze: report a quota the store is already over the guard on.
    const e = await store.estimate();
    store.quotaBytes = e.usage / 0.99;

    const r = await cold.compact([frame(999)], 2000);
    expect(isRefusal(r)).toBe(false);
    expect(cold.recompactedCount).toBeGreaterThan(0);

    // The OLDEST segment is the one that gave ground.
    const oldest = [...cold.segments].sort((a, b) => a.tickFrom - b.tickFrom)[0];
    expect(oldest.width).toBeLessThan(13);
  });

  it('loses no tick: narrowed segments are still readable at the coarser width', async () => {
    const { ledger, cold } = makeArchive();
    await cold.compact([frame(1), frame(2), frame(3)], 1000);
    const before = cold.segments[0];

    const relieved = await cold.relieve(1001);
    expect(relieved).not.toBeNull();
    expect(relieved!.from).toBe(13);
    expect(relieved!.to).toBe(8);

    const after = cold.segments[0];
    expect(after.width).toBe(8);
    expect(after.count).toBe(before.count);
    expect(after.tickFrom).toBe(before.tickFrom);
    expect(after.tickTo).toBe(before.tickTo);

    const frames = await cold.readFrames(after.key);
    expect(frames.map((f) => f.tick)).toEqual([1, 2, 3]);
    expect(frames[0].values.length).toBe(8);
  });

  it('seals the narrowing so the chain of custody survives it', async () => {
    const { ledger, cold } = makeArchive();
    await cold.compact([frame(1), frame(2)], 1000);
    const originalHash = cold.segments[0].hashHex;

    await cold.relieve(1001);
    const kinds = ledger.entries().map((r) => r.kind);
    expect(kinds).toContain('cold-recompact');

    const rec = ledger.entries().find((r) => r.kind === 'cold-recompact')!;
    expect(rec.priorHashHex).toBe(originalHash);
    expect(rec.width).toBe(8);
    expect(rec.payloadHashHex).not.toBe(originalHash);
  });

  it('still refuses once every segment is at the narrowest rung', async () => {
    const { store, ledger, cold } = makeArchive();
    await cold.compact([frame(1), frame(2)], 1000);

    // Walk the ladder all the way down.
    let steps = 0;
    while (await cold.relieve(1000 + ++steps)) {
      if (steps > 10) break;
    }
    expect(cold.segments[0].width).toBe(3);

    const e = await store.estimate();
    store.quotaBytes = e.usage / 0.99;

    const r = await cold.compact([frame(50)], 2000);
    expect(isRefusal(r)).toBe(true);
    if (isRefusal(r)) expect(r.reason).toMatch(/retention ladder exhausted/);
    expect(cold.refusedCount).toBe(1);
  });
});
