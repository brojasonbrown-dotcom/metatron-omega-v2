/**
 * Ω-CORPUS — the tiered store, proved area by area.
 *
 * Every test uses the in-memory blob store so the substrate is exercised
 * without a browser; the adapter contract is identical for IndexedDB and OPFS.
 */
import { describe, it, expect } from 'vitest';
import {
  Corpus,
  CorpusLedger,
  HotCache,
  WarmShards,
  ColdArchive,
  MemoryBlobStore,
  encodeShard,
  decodeShard,
  contentHashHex,
  framesOf,
  compactFrame,
  isRefusal,
  recall,
  COLD_WIDTH,
  FLAG_RESAMPLED,
  type CorpusFrame,
} from '@/core/corpus';

const W = 8;

function frame(tick: number, seed = 1): CorpusFrame {
  const values = new Float64Array(W);
  for (let i = 0; i < W; i++) values[i] = Math.sin((tick + 1) * (i + 1) * 0.1 * seed);
  return { tick, rank: 0, values, surprise: NaN };
}

describe('Ω-CORPUS · codec', () => {
  it('round-trips frames byte-exactly at float32 fidelity, ticks exact', () => {
    const frames = [frame(1), frame(2), frame(3)];
    const bytes = encodeShard(frames, W);
    const d = decodeShard(bytes);
    expect(d.count).toBe(3);
    expect(d.width).toBe(W);
    expect(Array.from(d.ticks)).toEqual([1, 2, 3]);
    const back = framesOf(d);
    for (let i = 0; i < 3; i++) {
      expect(back[i].tick).toBe(frames[i].tick);
      for (let j = 0; j < W; j++) {
        expect(back[i].values[j]).toBeCloseTo(frames[i].values[j], 6);
      }
    }
  });

  it('is deterministic: the same stream hashes to the same bytes', () => {
    const a = encodeShard([frame(1), frame(2)], W);
    const b = encodeShard([frame(1), frame(2)], W);
    expect(contentHashHex(a)).toBe(contentHashHex(b));
    expect(contentHashHex(encodeShard([frame(2), frame(1)], W))).not.toBe(contentHashHex(a));
  });

  it('refuses a foreign or truncated buffer instead of guessing', () => {
    expect(() => decodeShard(new Uint8Array(4))).toThrow();
    const bytes = encodeShard([frame(1)], W);
    expect(() => decodeShard(bytes.subarray(0, bytes.length - 8))).toThrow(/truncated/);
    const bad = Uint8Array.from(bytes);
    bad[0] ^= 0xff;
    expect(() => decodeShard(bad)).toThrow(/magic/);
  });

  it('rejects a frame whose width disagrees with the shard', () => {
    const wrong: CorpusFrame = { tick: 0, rank: 0, values: new Float64Array(3), surprise: 0 };
    expect(() => encodeShard([wrong], W)).toThrow(/expected/);
  });
});

describe('Ω-CORPUS · HOT', () => {
  it('honours capacity and demotes the least surprising, never deletes', () => {
    const hot = new HotCache({ width: W, capacity: 4, floor: 0 });
    const demoted: number[] = [];
    for (let t = 0; t < 20; t++) {
      // Surprise rises with tick, so the earliest frames are the ones demoted.
      const r = hot.offer(frame(t), 0, 1, t);
      for (const d of r.demoted) demoted.push(d.tick);
    }
    expect(hot.count).toBe(4);
    expect(demoted.length).toBe(16);
    // Everything offered is accounted for: held + demoted = offered.
    expect(hot.count + demoted.length).toBe(20);
    expect(
      hot
        .entries()
        .map((e) => e.payload.tick)
        .sort((a, b) => a - b),
    ).toEqual([16, 17, 18, 19]);
  });

  it('admits during calibration warm-up (no band ⇒ infinite surprise)', () => {
    const hot = new HotCache({ width: W, capacity: 2 });
    const r = hot.offer(frame(0), 0, NaN, 0);
    expect(r.admitted).toBe(true);
    expect(r.surprise).toBe(Infinity);
  });

  it('rejects a frame inside its own calibrated band', () => {
    const hot = new HotCache({ width: W, capacity: 4, floor: 1 });
    const r = hot.offer(frame(0), 1, 10, 1.5); // 0.05 half-widths
    expect(r.admitted).toBe(false);
  });

  it('refuses a frame of the wrong width', () => {
    const hot = new HotCache({ width: W, capacity: 4 });
    expect(() =>
      hot.offer({ tick: 0, rank: 0, values: new Float64Array(2), surprise: 0 }, 0, 1, 9),
    ).toThrow(/width/);
  });
});

describe('Ω-CORPUS · WARM', () => {
  it('seals at the shard size, reloads byte-identically, and indexes ranges', async () => {
    const store = new MemoryBlobStore();
    const ledger = new CorpusLedger();
    const warm = new WarmShards({ store, ledger, width: W, shardFrames: 4 });

    const sealed = await warm.accept([frame(1), frame(2), frame(3), frame(4), frame(5)], 100);
    expect(sealed.length).toBe(1);
    expect(warm.pending).toBe(1);
    expect(sealed[0].tickFrom).toBe(1);
    expect(sealed[0].tickTo).toBe(4);

    const back = await warm.readFrames(sealed[0].key);
    expect(back.map((f) => f.tick)).toEqual([1, 2, 3, 4]);

    expect(warm.select(2, 3).map((s) => s.key)).toEqual([sealed[0].key]);
    expect(warm.select(50, 60)).toEqual([]);
  });

  it('rejects a corrupted payload by hash instead of parsing it', async () => {
    const store = new MemoryBlobStore();
    const warm = new WarmShards({ store, ledger: new CorpusLedger(), width: W, shardFrames: 2 });
    const [s] = await warm.accept([frame(1), frame(2)], 1);
    const raw = (await store.get(s.key))!;
    raw[raw.length - 1] ^= 0xff;
    await store.put(s.key, raw);
    await expect(warm.read(s.key)).rejects.toThrow(/hash mismatch/);
  });
});

describe('Ω-CORPUS · COLD', () => {
  it('compacts to signature width with the exact spectral resample', async () => {
    const store = new MemoryBlobStore();
    const cold = new ColdArchive({ store, ledger: new CorpusLedger() });
    const wide = new Float64Array(64).fill(2.5);
    const small = compactFrame(wide, COLD_WIDTH);
    expect(small.length).toBe(COLD_WIDTH);
    // A constant field survives band limitation exactly — that is the proof
    // the reduction is band-limiting rather than truncating.
    for (const v of small) expect(v).toBeCloseTo(2.5, 10);

    const frames: CorpusFrame[] = [0, 1, 2].map((t) => ({
      tick: t,
      rank: 0,
      values: Float64Array.from(wide),
      surprise: 1,
    }));
    const seg = await cold.compact(frames, 5);
    expect(isRefusal(seg)).toBe(false);
    if (isRefusal(seg)) return;
    expect(seg.width).toBe(COLD_WIDTH);
    const d = (await cold.read(seg.key))!;
    expect(d.flags).toBe(FLAG_RESAMPLED);
  });

  it('refuses rather than evicting when the quota guard trips', async () => {
    const store = new MemoryBlobStore();
    (store as unknown as { estimate: () => Promise<{ usage: number; quota: number }> }).estimate =
      async () => ({ usage: 99, quota: 100 });
    const cold = new ColdArchive({ store, ledger: new CorpusLedger() });
    const r = await cold.compact([frame(1)], 1);
    expect(isRefusal(r)).toBe(true);
    if (isRefusal(r)) expect(r.reason).toMatch(/quota/);
    expect(cold.segments.length).toBe(0);
    expect(cold.refusedCount).toBe(1);
  });
});

describe('Ω-CORPUS · ledger', () => {
  it('proves inclusion of every sealed unit without consulting the store', async () => {
    const store = new MemoryBlobStore();
    const ledger = new CorpusLedger();
    const warm = new WarmShards({ store, ledger, width: W, shardFrames: 2 });
    const sealed = [
      ...(await warm.accept([frame(1), frame(2)], 1)),
      ...(await warm.accept([frame(3), frame(4)], 2)),
    ];
    expect(ledger.size).toBe(2);

    for (const s of sealed) {
      const p = ledger.proofFor(s.leafIndex)!;
      const record = ledger.entries()[s.leafIndex];
      const ok = CorpusLedger.verify({
        data: null,
        record,
        leafIndex: s.leafIndex,
        proofHex: p.proofHex,
        head: p.head,
      });
      expect(ok).toBe(true);
    }
  });

  it('detects a tampered record before the payload is ever decoded', () => {
    const ledger = new CorpusLedger();
    const record = {
      kind: 'warm-shard' as const,
      tier: 'warm' as const,
      index: 0,
      key: 'warm:0',
      tickFrom: 0,
      tickTo: 9,
      count: 10,
      width: W,
      bytes: 400,
      payloadHashHex: 'ab'.repeat(32),
    };
    const e = ledger.seal(record, 1);
    const p = ledger.proofFor(e.leafIndex)!;
    const forged = { ...record, count: 11 };
    expect(
      CorpusLedger.verify({
        data: null,
        record: forged,
        leafIndex: e.leafIndex,
        proofHex: p.proofHex,
        head: p.head,
      }),
    ).toBe(false);
  });

  it('verifies consistency across a reload of the index', async () => {
    const store = new MemoryBlobStore();
    const ledger = new CorpusLedger();
    const warm = new WarmShards({ store, ledger, width: W, shardFrames: 2 });
    await warm.accept([frame(1), frame(2)], 1);
    const prevSize = ledger.size;
    const prevRoot = ledger.rootHex;

    await warm.accept([frame(3), frame(4)], 2);
    expect(ledger.consistentWith(prevSize, prevRoot)).toBe(true);

    const restored = CorpusLedger.fromJSON(ledger.toJSON());
    expect(restored.rootHex).toBe(ledger.rootHex);
    expect(restored.consistentWith(prevSize, prevRoot)).toBe(true);
  });
});

describe('Ω-CORPUS · ladder + recall', () => {
  it('moves frames HOT → WARM → COLD and keeps every one of them', async () => {
    const store = new MemoryBlobStore();
    const c = new Corpus({
      width: W,
      store,
      hotCapacity: 4,
      hotFloor: 0,
      shardFrames: 4,
      segmentShards: 2,
    });
    for (let t = 0; t < 40; t++) await c.offer(frame(t), 0, 1, t, t);
    await c.flush(1000);

    const s = c.stats();
    expect(s.warm.shards).toBeGreaterThan(0);
    expect(s.cold.segments).toBeGreaterThan(0);
    expect(s.ledger.size).toBe(s.warm.shards + s.cold.segments);
    // Nothing vanished between the tiers.
    const warmFrames = s.warm.numbers / W;
    expect(warmFrames).toBe(40);
    expect(c.retainedNumbers).toBeGreaterThan(0);
  });

  it('serves from the nearest tier and abstains when the budget cannot cover it', async () => {
    const store = new MemoryBlobStore();
    const c = new Corpus({
      width: W,
      store,
      hotCapacity: 8,
      hotFloor: 0,
      shardFrames: 4,
      segmentShards: 100,
    });
    for (let t = 0; t < 20; t++) await c.offer(frame(t), 0, 1, t, t);

    const hot = await c.recall({ tickFrom: 18, tickTo: 19, budgetNumbers: 1000 });
    expect(hot.tier).toBe('hot');
    expect(hot.frames.length).toBeGreaterThan(0);

    const warm = await c.recall({ tickFrom: 0, tickTo: 3, budgetNumbers: 1000 });
    expect(warm.tier).toBe('warm');
    expect(warm.frames.map((f) => f.tick)).toEqual([0, 1, 2, 3]);

    const broke = await c.recall({ tickFrom: 0, tickTo: 3, budgetNumbers: 1 });
    expect(broke.tier).toBe(null);
    expect(broke.abstained).toBeTruthy();

    const nowhere = await c.recall({ tickFrom: 9000, tickTo: 9001, budgetNumbers: 1e9 });
    expect(nowhere.abstained).toMatch(/no tier/);
  });

  it('recall with an empty budget abstains before any I/O', async () => {
    const store = new MemoryBlobStore();
    const c = new Corpus({ width: W, store });
    const r = await recall(
      { hot: c.hot, warm: c.warm, cold: c.cold },
      { tickFrom: 0, tickTo: 1, budgetNumbers: 0 },
    );
    expect(r.abstained).toBe('no read budget');
  });
});
