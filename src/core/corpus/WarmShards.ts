/**
 * Ω-CORPUS area 2 — WARM: sealed binary shards on the blob substrate.
 *
 * Demoted HOT frames accumulate into an open buffer. When the buffer reaches
 * the shard size (φ-spaced, 1597 frames by default) it is encoded once,
 * content-hashed, written atomically, and sealed into the Merkle ledger. A
 * sealed shard is immutable: there is no code path that rewrites one.
 *
 * The index holds only ranges and hashes, so recall can pick the covering
 * shards without reading a single payload byte.
 */

import type { BlobStore } from './storage';
import type { CorpusLedger, SealRecord } from './CorpusLedger';
import {
  encodeShard, decodeShard, contentHashHex, framesOf,
  FLAG_RAW, type CorpusFrame, type DecodedShard,
} from './types';

export const DEFAULT_SHARD_FRAMES = 1597;

export interface ShardIndexEntry {
  readonly key: string;
  readonly index: number;
  readonly tickFrom: number;
  readonly tickTo: number;
  readonly count: number;
  readonly width: number;
  readonly bytes: number;
  readonly hashHex: string;
  readonly leafIndex: number;
}

export interface WarmOptions {
  readonly store: BlobStore;
  readonly ledger: CorpusLedger;
  readonly width: number;
  readonly shardFrames?: number;
}

export class WarmShards {
  private readonly store: BlobStore;
  private readonly ledger: CorpusLedger;
  readonly width: number;
  readonly shardFrames: number;
  private open: CorpusFrame[] = [];
  private index: ShardIndexEntry[] = [];
  private nextIndex = 0;

  constructor(o: WarmOptions) {
    this.store = o.store;
    this.ledger = o.ledger;
    this.width = o.width;
    this.shardFrames = o.shardFrames ?? DEFAULT_SHARD_FRAMES;
  }

  get pending(): number { return this.open.length; }
  get shards(): readonly ShardIndexEntry[] { return this.index; }
  get numbers(): number {
    return this.index.reduce((a, s) => a + s.count * s.width, 0);
  }
  get bytes(): number { return this.index.reduce((a, s) => a + s.bytes, 0); }

  /**
   * Accept demoted frames. Returns the shards sealed by this call — usually
   * none, which is the point: sealing is amortised, never per frame.
   */
  async accept(frames: readonly CorpusFrame[], timestamp: number): Promise<ShardIndexEntry[]> {
    for (const f of frames) {
      if (f.values.length !== this.width) {
        throw new RangeError(`WarmShards: frame width ${f.values.length} != ${this.width}`);
      }
      this.open.push(f);
    }
    const sealed: ShardIndexEntry[] = [];
    while (this.open.length >= this.shardFrames) {
      const batch = this.open.splice(0, this.shardFrames);
      sealed.push(await this.sealBatch(batch, timestamp));
    }
    return sealed;
  }

  /** Seal whatever is buffered, even a partial shard. Called on idle/shutdown. */
  async flush(timestamp: number): Promise<ShardIndexEntry | null> {
    if (this.open.length === 0) return null;
    const batch = this.open;
    this.open = [];
    return this.sealBatch(batch, timestamp);
  }

  private async sealBatch(batch: CorpusFrame[], timestamp: number): Promise<ShardIndexEntry> {
    batch.sort((a, b) => a.tick - b.tick);
    const bytes = encodeShard(batch, this.width, FLAG_RAW);
    const hashHex = contentHashHex(bytes);
    const index = this.nextIndex++;
    const key = `warm:${String(index).padStart(8, '0')}:${hashHex.slice(0, 16)}`;

    await this.store.put(key, bytes);

    const record: SealRecord = {
      kind: 'warm-shard',
      tier: 'warm',
      index,
      key,
      tickFrom: batch[0].tick,
      tickTo: batch[batch.length - 1].tick,
      count: batch.length,
      width: this.width,
      bytes: bytes.byteLength,
      payloadHashHex: hashHex,
    };
    const entry = this.ledger.seal(record, timestamp);

    const idx: ShardIndexEntry = {
      key, index,
      tickFrom: record.tickFrom, tickTo: record.tickTo,
      count: record.count, width: record.width,
      bytes: record.bytes, hashHex, leafIndex: entry.leafIndex,
    };
    this.index.push(idx);
    return idx;
  }

  /** Shards whose tick range intersects [from, to] — no payload is read. */
  select(from: number, to: number): ShardIndexEntry[] {
    return this.index.filter((s) => s.tickTo >= from && s.tickFrom <= to);
  }

  /**
   * Read a sealed shard. The stored bytes are re-hashed before decoding, so a
   * corrupted or substituted payload is rejected rather than parsed.
   */
  async read(key: string): Promise<DecodedShard | null> {
    const meta = this.index.find((s) => s.key === key);
    const bytes = await this.store.get(key);
    if (!bytes) return null;
    if (meta && contentHashHex(bytes) !== meta.hashHex) {
      throw new Error(`WarmShards: content hash mismatch for ${key}`);
    }
    return decodeShard(bytes);
  }

  /** Frames of a sealed shard, exact ticks preserved. */
  async readFrames(key: string): Promise<CorpusFrame[]> {
    const s = await this.read(key);
    return s ? framesOf(s) : [];
  }

  /** Index payload for persistence. Sealed bytes stay where they are. */
  toJSON() {
    return { width: this.width, nextIndex: this.nextIndex, index: this.index };
  }

  restore(data: { nextIndex: number; index: ShardIndexEntry[] }): void {
    this.nextIndex = data.nextIndex;
    this.index = [...data.index];
  }
}
