/**
 * Ω-CAPACITY C4 — what durable storage really costs.
 *
 * This probe writes real shards through the real codec into a real store and
 * reads them back. The figure that matters is bytes per retained *number*: it
 * decides how far the host quota stretches, and it can only be measured on
 * sealed bytes, because the header amortises differently at every shard size.
 */

import { Corpus } from '@/core/corpus/Corpus';
import { MemoryBlobStore, type BlobStore } from '@/core/corpus/storage';
import type { CorpusFrame } from '@/core/corpus/types';
import type { ResidencyCapacity } from './types';

function now(): number {
  const p = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof p?.now === 'function' ? p.now() : Date.now();
}

export interface ResidencyOptions {
  readonly frames?: number;
  readonly width?: number;
  readonly shardFrames?: number;
  readonly segmentShards?: number;
  readonly store?: BlobStore;
}

export async function measureResidency(o: ResidencyOptions = {}): Promise<ResidencyCapacity> {
  const frames = o.frames ?? 512;
  const width = o.width ?? 233;
  const store = o.store ?? new MemoryBlobStore();
  const corpus = new Corpus({
    width,
    store,
    hotCapacity: 64,
    hotFloor: 0,
    shardFrames: o.shardFrames ?? 89,
    segmentShards: o.segmentShards ?? 2,
  });

  const t0 = now();
  for (let t = 0; t < frames; t++) {
    const values = new Float64Array(width);
    for (let i = 0; i < width; i++) values[i] = Math.sin((t + 1) * (i + 1) * 0.001);
    const frame: CorpusFrame = { tick: t, rank: t % 13, values, surprise: 1 };
    // Predicted/actual chosen so every frame is surprising: this probe measures
    // the storage path, not the admission policy.
    await corpus.offer(frame, 0, 1, 3, t);
  }
  await corpus.flush(frames);
  const sealMs = now() - t0;

  const t1 = now();
  const back = await corpus.recall({
    tickFrom: 0,
    tickTo: frames,
    budgetNumbers: frames * width * 4,
  });
  const readMs = now() - t1;

  const s = corpus.stats();
  const retained = corpus.retainedNumbers;
  const bytes = s.warm.bytes + s.cold.bytes;

  return {
    storeKind: store.kind,
    framesWritten: frames,
    width,
    warmBytes: s.warm.bytes,
    coldBytes: s.cold.bytes,
    bytesPerNumber: retained > 0 ? bytes / retained : NaN,
    sealMs,
    readMs: back.frames.length > 0 ? readMs : readMs,
    durableNumbersPerSecond: sealMs > 0 ? (frames * width * 1000) / sealMs : Infinity,
    ledgerLeaves: s.ledger.size,
    rootHex: s.ledger.rootHex,
  };
}
