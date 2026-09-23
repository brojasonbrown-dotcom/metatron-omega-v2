/**
 * Ω-CORPUS — the coordinator.
 *
 * Binds the four areas into one ladder: HOT admits by surprise, demotions seal
 * into WARM shards, WARM shards compact into COLD segments, and every sealed
 * unit is a leaf in the Merkle ledger. All disk work is scheduled off the tick,
 * so no engine tick ever awaits storage.
 */

import { HotCache } from './HotCache';
import { WarmShards, type ShardIndexEntry } from './WarmShards';
import { ColdArchive, isRefusal, type ColdResult } from './ColdArchive';
import { CorpusLedger } from './CorpusLedger';
import { recall, type RecallQuery, type RecallResult } from './CorpusRecall';
import { selectBlobStore, type BlobStore } from './storage';
import type { CorpusFrame } from './types';

export interface CorpusOptions {
  readonly width: number;
  readonly store?: BlobStore;
  readonly ledger?: CorpusLedger;
  readonly hotCapacity?: number;
  /** Admission floor in band half-widths; 0 keeps everything offered. */
  readonly hotFloor?: number;
  readonly shardFrames?: number;
  readonly segmentShards?: number;
}

export interface CorpusStats {
  readonly storeKind: string;
  readonly hot: { count: number; capacity: number; numbers: number; meanSurprise: number };
  readonly warm: { shards: number; pending: number; numbers: number; bytes: number };
  readonly cold: { segments: number; numbers: number; bytes: number; refused: number };
  readonly ledger: { size: number; rootHex: string; headTimestamp: number | null };
  readonly counters: { admitted: number; rejected: number; evicted: number; demoted: number };
  readonly quota: { usage: number; quota: number };
}

export class Corpus {
  readonly hot: HotCache;
  readonly warm: WarmShards;
  readonly cold: ColdArchive;
  readonly ledger: CorpusLedger;
  readonly store: BlobStore;
  /** Warm shards awaiting compaction into a cold segment. */
  private pendingShards: ShardIndexEntry[] = [];
  private quota = { usage: NaN, quota: NaN };

  constructor(o: CorpusOptions) {
    this.store = o.store ?? selectBlobStore();
    this.ledger = o.ledger ?? new CorpusLedger();
    this.hot = new HotCache({ width: o.width, capacity: o.hotCapacity, floor: o.hotFloor });
    this.warm = new WarmShards({
      store: this.store, ledger: this.ledger, width: o.width, shardFrames: o.shardFrames,
    });
    this.cold = new ColdArchive({
      store: this.store, ledger: this.ledger, segmentShards: o.segmentShards,
    });
  }

  /**
   * Offer one observation with its calibrated band. Returns once any sealing
   * this offer triggered has completed, so callers that care about durability
   * can await it — the tick path does not.
   */
  async offer(
    frame: CorpusFrame,
    predicted: number,
    halfWidth: number,
    actual: number,
    timestamp: number,
  ): Promise<{ admitted: boolean; surprise: number; sealed: ShardIndexEntry[]; cold: ColdResult | null }> {
    const a = this.hot.offer(frame, predicted, halfWidth, actual);
    let sealed: ShardIndexEntry[] = [];
    if (a.demoted.length > 0) sealed = await this.warm.accept(a.demoted, timestamp);
    const cold = sealed.length > 0 ? await this.maybeCompact(timestamp) : null;
    return { admitted: a.admitted, surprise: a.surprise, sealed, cold };
  }

  /** Seal every buffered frame and compact if the segment is due. */
  async flush(timestamp: number): Promise<{ shard: ShardIndexEntry | null; cold: ColdResult | null }> {
    const drained = this.hot.drain();
    if (drained.length > 0) {
      const sealedNow = await this.warm.accept(drained, timestamp);
      this.pendingShards.push(...sealedNow);
    }
    const shard = await this.warm.flush(timestamp);
    if (shard) this.pendingShards.push(shard);
    const cold = await this.maybeCompact(timestamp, true);
    return { shard, cold };
  }

  private async maybeCompact(timestamp: number, force = false): Promise<ColdResult | null> {
    // Track newly sealed shards that have not yet been folded into a segment.
    const known = new Set(this.pendingShards.map((s) => s.key));
    for (const s of this.warm.shards) {
      if (!known.has(s.key) && !this.compacted.has(s.key)) this.pendingShards.push(s);
    }
    if (this.pendingShards.length === 0) return null;
    if (!force && this.pendingShards.length < this.cold.segmentShards) return null;

    const batch = this.pendingShards.splice(0, this.pendingShards.length);
    const frames: CorpusFrame[] = [];
    for (const s of batch) frames.push(...(await this.warm.readFrames(s.key)));
    if (frames.length === 0) return null;

    const result = await this.cold.compact(frames, timestamp);
    if (isRefusal(result)) {
      // Refusal is not data loss: the warm shards stay exactly where they are.
      this.pendingShards.unshift(...batch);
      return result;
    }
    for (const s of batch) this.compacted.add(s.key);
    return result;
  }

  private compacted = new Set<string>();

  recall(q: RecallQuery): Promise<RecallResult> {
    return recall({ hot: this.hot, warm: this.warm, cold: this.cold }, q);
  }

  async refreshQuota(): Promise<void> {
    this.quota = await this.store.estimate();
  }

  stats(): CorpusStats {
    const h = this.hot.stats();
    const head = this.ledger.head;
    return {
      storeKind: this.store.kind,
      hot: { count: h.count, capacity: h.capacity, numbers: h.numbers, meanSurprise: h.meanSurprise },
      warm: {
        shards: this.warm.shards.length, pending: this.warm.pending,
        numbers: this.warm.numbers, bytes: this.warm.bytes,
      },
      cold: {
        segments: this.cold.segments.length, numbers: this.cold.numbers,
        bytes: this.cold.bytes, refused: this.cold.refusedCount,
      },
      ledger: {
        size: this.ledger.size,
        rootHex: this.ledger.size > 0 ? this.ledger.rootHex : '',
        headTimestamp: head?.timestamp ?? null,
      },
      counters: this.hot.counters,
      quota: this.quota,
    };
  }

  /** Total numbers durably held below HOT — the figure that scales. */
  get retainedNumbers(): number {
    return this.warm.numbers + this.cold.numbers;
  }
}
