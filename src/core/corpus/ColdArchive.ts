/**
 * Ω-CORPUS area 3 — COLD: immutable archive segments.
 *
 * A cold segment is a compaction of K sealed WARM shards down to signature
 * width. That compaction is the only lossy step anywhere in the corpus, and it
 * is explicit: the reduction uses the exact spectral resample from
 * `operator/resample.ts`, so what is lost is the band above the target's Nyquist
 * — a stated band limit, not an arbitrary truncation. The segment header
 * records the FLAG_RESAMPLED flag so no reader can mistake it for raw tape.
 *
 * COLD is the archive of record, so it never evicts. Under storage pressure it
 * refuses admission and says so; silently dropping the oldest evidence would
 * make every inclusion proof over it meaningless.
 */

import { resample } from '@metatron/trnn-core/operator/resample';
import type { BlobStore } from './storage';
import type { CorpusLedger, SealRecord } from './CorpusLedger';
import {
  encodeShard, decodeShard, contentHashHex, framesOf,
  FLAG_RESAMPLED, type CorpusFrame, type DecodedShard,
} from './types';

/** Signature width of a cold frame. */
export const COLD_WIDTH = 13;
/**
 * Ω-UNBOUND P5 — the retention ladder.
 *
 * COLD used to refuse admission at the quota guard. Refusal is a wall: past it
 * the archive simply stops being the archive of record, which is the failure it
 * was trying to avoid. The ladder replaces the wall with a descent — under
 * pressure the OLDEST segments are recompacted a Fibonacci step narrower
 * (13 → 8 → 5 → 3) instead of new evidence being turned away.
 *
 * Nothing is deleted and no tick disappears: every frame that ever entered COLD
 * is still addressable, at a coarser band limit. Each recompaction seals a
 * `cold-recompact` record naming the prior payload hash, so the chain of
 * custody stays auditable even though the original bytes are gone — the ledger
 * can always prove what a segment used to be and when it was narrowed.
 *
 * Refusal remains, but only as the true terminal case: every segment already at
 * the narrowest rung and the host still out of room. That is the host's limit,
 * not ours, and it is reported as such.
 */
export const COLD_WIDTH_LADDER = [13, 8, 5, 3] as const;
/** Warm shards folded into one segment. */
export const DEFAULT_SEGMENT_SHARDS = 13;
/** Refuse to write once the origin is this close to its quota. */
export const QUOTA_GUARD = 0.95;

/** Next narrower rung for a cold width, or null when already narrowest. */
export function narrowerWidth(width: number): number | null {
  for (let i = 0; i < COLD_WIDTH_LADDER.length - 1; i++) {
    if (width > COLD_WIDTH_LADDER[i + 1] && width <= COLD_WIDTH_LADDER[i]) {
      return COLD_WIDTH_LADDER[i + 1];
    }
  }
  return width > COLD_WIDTH_LADDER[COLD_WIDTH_LADDER.length - 1]
    ? COLD_WIDTH_LADDER[COLD_WIDTH_LADDER.length - 1]
    : null;
}


export interface SegmentIndexEntry {
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

export interface ColdRefusal {
  readonly refused: true;
  readonly reason: string;
  readonly usage: number;
  readonly quota: number;
}

export type ColdResult = SegmentIndexEntry | ColdRefusal;

export function isRefusal(r: ColdResult): r is ColdRefusal {
  return (r as ColdRefusal).refused === true;
}

/**
 * Band-limit one frame to the cold width by exact spectral resampling.
 *
 * The frame is treated as a real ring field (imaginary part zero); resample is
 * unitary and amplitude-preserving, so a constant stays that constant and a
 * retained mode keeps its amplitude.
 */
export function compactFrame(values: Float64Array, width = COLD_WIDTH): Float64Array {
  if (values.length === width) return Float64Array.from(values);
  const f = { re: Float64Array.from(values), im: new Float64Array(values.length), n: values.length };
  const g = resample(f, width);
  return Float64Array.from(g.re);
}

export interface ColdOptions {
  readonly store: BlobStore;
  readonly ledger: CorpusLedger;
  readonly width?: number;
  readonly segmentShards?: number;
}

export class ColdArchive {
  private readonly store: BlobStore;
  private readonly ledger: CorpusLedger;
  readonly width: number;
  readonly segmentShards: number;
  private index: SegmentIndexEntry[] = [];
  private nextIndex = 0;
  private refusals = 0;
  private recompactions = 0;

  constructor(o: ColdOptions) {
    this.store = o.store;
    this.ledger = o.ledger;
    this.width = o.width ?? COLD_WIDTH;
    this.segmentShards = o.segmentShards ?? DEFAULT_SEGMENT_SHARDS;
  }

  get segments(): readonly SegmentIndexEntry[] { return this.index; }
  get numbers(): number { return this.index.reduce((a, s) => a + s.count * s.width, 0); }
  get bytes(): number { return this.index.reduce((a, s) => a + s.bytes, 0); }
  get refusedCount(): number { return this.refusals; }
  /** Segments narrowed by the retention ladder rather than refused. */
  get recompactedCount(): number { return this.recompactions; }

  /**
   * Narrow the oldest segment that is not already at the narrowest rung.
   * Returns bytes reclaimed, or null when the ladder is exhausted.
   */
  async relieve(timestamp: number): Promise<{ key: string; from: number; to: number; reclaimed: number } | null> {
    const candidates = this.index
      .filter((s) => narrowerWidth(s.width) !== null)
      .sort((a, b) => a.tickFrom - b.tickFrom);
    if (candidates.length === 0) return null;

    const target = candidates[0];
    const to = narrowerWidth(target.width);
    if (to === null) return null;

    const frames = await this.readFrames(target.key);
    if (frames.length === 0) return null;

    const reduced: CorpusFrame[] = frames.map((f) => ({ ...f, values: compactFrame(f.values, to) }));
    const bytes = encodeShard(reduced, to, FLAG_RESAMPLED);
    const hashHex = contentHashHex(bytes);
    const key = `cold:${String(target.index).padStart(8, '0')}:w${to}:${hashHex.slice(0, 16)}.bin`;

    await this.store.put(key, bytes);
    if (key !== target.key) await this.store.erase(target.key);

    const sealed = this.ledger.seal(
      {
        kind: 'cold-recompact',
        tier: 'cold',
        index: target.index,
        key,
        tickFrom: target.tickFrom,
        tickTo: target.tickTo,
        count: target.count,
        width: to,
        bytes: bytes.byteLength,
        payloadHashHex: hashHex,
        priorHashHex: target.hashHex,
      },
      timestamp,
    );

    const reclaimed = target.bytes - bytes.byteLength;
    const at = this.index.findIndex((s) => s.key === target.key);
    this.index[at] = {
      ...target,
      key,
      width: to,
      bytes: bytes.byteLength,
      hashHex,
      leafIndex: sealed.leafIndex,
    };
    this.recompactions++;
    return { key, from: target.width, to, reclaimed };
  }


  /** Headroom check. NaN quota means the host declined to say — we proceed. */
  async headroom(): Promise<{ ok: boolean; usage: number; quota: number }> {
    const e = await this.store.estimate();
    if (!Number.isFinite(e.quota) || e.quota <= 0) return { ok: true, usage: e.usage, quota: e.quota };
    return { ok: e.usage / e.quota < QUOTA_GUARD, usage: e.usage, quota: e.quota };
  }

  /**
   * Compact frames into one immutable segment. Frames arrive at warm width and
   * leave at signature width; the caller supplies them in tick order.
   */
  async compact(frames: readonly CorpusFrame[], timestamp: number): Promise<ColdResult> {
    if (frames.length === 0) {
      return { refused: true, reason: 'no frames offered', usage: NaN, quota: NaN };
    }
    let room = await this.headroom();
    // Ω-UNBOUND P5: descend the retention ladder before ever refusing evidence.
    while (!room.ok) {
      const relieved = await this.relieve(timestamp);
      if (!relieved) break;
      room = await this.headroom();
    }
    if (!room.ok) {
      this.refusals++;
      return {
        refused: true,
        reason: `storage quota guard: ${(100 * room.usage / room.quota).toFixed(1)}% used; retention ladder exhausted (all segments at width ${COLD_WIDTH_LADDER[COLD_WIDTH_LADDER.length - 1]})`,
        usage: room.usage,
        quota: room.quota,
      };
    }

    const reduced: CorpusFrame[] = frames
      .map((f) => ({ ...f, values: compactFrame(f.values, this.width) }))
      .sort((a, b) => a.tick - b.tick);

    const bytes = encodeShard(reduced, this.width, FLAG_RESAMPLED);
    const hashHex = contentHashHex(bytes);
    const index = this.nextIndex++;
    const key = `cold:${String(index).padStart(8, '0')}:${hashHex.slice(0, 16)}.bin`;

    await this.store.put(key, bytes);

    const record: SealRecord = {
      kind: 'cold-segment',
      tier: 'cold',
      index,
      key,
      tickFrom: reduced[0].tick,
      tickTo: reduced[reduced.length - 1].tick,
      count: reduced.length,
      width: this.width,
      bytes: bytes.byteLength,
      payloadHashHex: hashHex,
    };
    const sealed = this.ledger.seal(record, timestamp);

    const entry: SegmentIndexEntry = {
      key, index,
      tickFrom: record.tickFrom, tickTo: record.tickTo,
      count: record.count, width: record.width,
      bytes: record.bytes, hashHex, leafIndex: sealed.leafIndex,
    };
    this.index.push(entry);
    return entry;
  }

  select(from: number, to: number): SegmentIndexEntry[] {
    return this.index.filter((s) => s.tickTo >= from && s.tickFrom <= to);
  }

  async read(key: string): Promise<DecodedShard | null> {
    const meta = this.index.find((s) => s.key === key);
    const bytes = await this.store.get(key);
    if (!bytes) return null;
    if (meta && contentHashHex(bytes) !== meta.hashHex) {
      throw new Error(`ColdArchive: content hash mismatch for ${key}`);
    }
    return decodeShard(bytes);
  }

  async readFrames(key: string): Promise<CorpusFrame[]> {
    const s = await this.read(key);
    return s ? framesOf(s) : [];
  }

  toJSON() {
    return { width: this.width, nextIndex: this.nextIndex, index: this.index, recompactions: this.recompactions };
  }

  restore(data: { nextIndex: number; index: SegmentIndexEntry[]; recompactions?: number }): void {
    this.nextIndex = data.nextIndex;
    this.index = [...data.index];
    this.recompactions = data.recompactions ?? 0;
  }
}
