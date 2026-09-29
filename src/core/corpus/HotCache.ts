/**
 * Ω-CORPUS area 1 — HOT: the in-RAM signature cache.
 *
 * The only tier the tick path ever touches. Admission is surprise-based
 * against the calibrated band (Ω-SCALE P1), so a frame that sits inside its
 * own 90% interval never occupies hot memory: it is unremarkable by
 * construction, and paying RAM for it would crowd out the frames that are not.
 *
 * Nothing is deleted here. An evicted entry is handed to the caller as a
 * demotion so the WARM tier can seal it — the "demotion only" invariant of the
 * ladder is enforced at this boundary, not assumed downstream.
 *
 * Capacity comes from the memory governor's working envelope rather than a
 * constant, so a small host holds fewer frames instead of pushing the engine
 * into garbage collection.
 */

import { TieredCorpus, surpriseOf, type TierPolicy } from '@metatron/trnn-core/operator/retention';
import { PHI } from '@metatron/trnn-core/core/constants';
import { computeMemoryCaps } from '@/core/memory/MemoryGovernor';
import type { CorpusFrame } from './types';

/** Share of the working RAM budget the hot cache may hold. φ⁻⁵ ≈ 9%. */
export const HOT_SHARE = Math.pow(1 / PHI, 5);

export interface HotCacheOptions {
  /** Numbers per frame. Must match what the caller admits. */
  readonly width: number;
  /** Explicit capacity; when omitted it is derived from the RAM envelope. */
  readonly capacity?: number;
  /** Admission floor in band half-widths. */
  readonly floor?: number;
}

export interface HotAdmission {
  readonly admitted: boolean;
  readonly surprise: number;
  /** Frames pushed out, oldest tick first — the WARM tier's input. */
  readonly demoted: readonly CorpusFrame[];
}

/** Frames the RAM envelope can hold at this width, floored so tests stay real. */
export function hotCapacityFor(width: number, ramBytes?: number): number {
  const ram = ramBytes ?? computeMemoryCaps().ramBytes;
  const perFrame = Math.max(1, width) * 8 + 64; // values + entry overhead
  return Math.max(64, Math.min(65536, Math.floor((ram * HOT_SHARE) / perFrame)));
}

export class HotCache {
  readonly width: number;
  readonly capacity: number;
  private readonly corpus: TieredCorpus<CorpusFrame>;
  private demotedTotal = 0;

  constructor(opts: HotCacheOptions) {
    this.width = opts.width;
    this.capacity = opts.capacity ?? hotCapacityFor(opts.width);
    const policy: TierPolicy[] = [
      {
        tier: 'hot',
        capacity: this.capacity,
        floor: Number.isFinite(opts.floor) ? (opts.floor as number) : 1 / PHI,
        width: opts.width,
      },
    ];
    this.corpus = new TieredCorpus<CorpusFrame>(policy);
  }

  get count(): number {
    return this.corpus.totalCount;
  }
  get numbers(): number {
    return this.corpus.footprint();
  }
  get counters() {
    return { ...this.corpus.counters, demoted: this.demotedTotal };
  }
  stats() {
    return this.corpus.stats()[0];
  }
  entries() {
    return this.corpus.entries('hot');
  }
  clear() {
    this.corpus.clear();
    this.demotedTotal = 0;
  }

  /**
   * Offer one observation. `predicted` / `halfWidth` come from the conformal
   * layer; when no band exists yet the surprise is Infinity and the frame is
   * admitted, because discarding calibration data would freeze the calibrator.
   */
  offer(frame: CorpusFrame, predicted: number, halfWidth: number, actual: number): HotAdmission {
    if (frame.values.length !== this.width) {
      throw new RangeError(
        `HotCache: frame width ${frame.values.length} != cache width ${this.width}`,
      );
    }
    const s = surpriseOf(actual, predicted, halfWidth);
    const r = this.corpus.admit(frame, s, frame.tick);
    // A single-tier ladder drops out of its bottom tier: that is the demotion.
    const demoted = r.dropped.map((e) => e.payload).sort((a, b) => a.tick - b.tick);
    this.demotedTotal += demoted.length;
    return { admitted: r.tier !== null, surprise: s, demoted };
  }

  /** Flush every held frame downward, oldest first. Used on seal and shutdown. */
  drain(): CorpusFrame[] {
    const out = this.entries()
      .map((e) => e.payload)
      .sort((a, b) => a.tick - b.tick);
    this.corpus.clear();
    this.demotedTotal += out.length;
    return out;
  }
}
