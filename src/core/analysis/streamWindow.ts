/**
 * StreamWindow — the sample book the analysis layer reads from.
 *
 * Every certified estimator in the substrate takes two *paired* series. Live
 * channels do not arrive paired: audio ticks at 233 Hz, video at 89 Hz, IMU at
 * 377 Hz, engine coherence at whatever the worker last published, and any of
 * them can drop out entirely. Turning that into a pair is where honest systems
 * usually lose their honesty, so the rules are explicit and enforced here:
 *
 *   1. A non-finite sample is a **gap**, never a zero. Zero-filling a dropout
 *      manufactures a correlated flat segment in both channels and inflates
 *      every statistic downstream. Gaps are counted and excluded.
 *   2. A sample is used **at most once**. Nearest-neighbour alignment without
 *      that rule lets one slow sample marry many fast ones, which duplicates
 *      rows and shrinks the standard error of a statistic that has no new
 *      information behind it.
 *   3. Alignment is **causal and monotone**: both cursors only move forward,
 *      so the pairing of a prefix is a prefix of the pairing — the same window
 *      re-analysed later cannot re-order its own history.
 *   4. A pair is only formed when the two timestamps are within a tolerance
 *      derived from the *slower* channel's period. Beyond that they are not
 *      simultaneous observations and pretending otherwise is a fabrication.
 *
 * The buffers are fixed-capacity ring buffers: bounded memory, no allocation
 * on the hot push path.
 */

import { STAT_FLOOR } from '@metatron/trnn-core/substrate/correlation';

/** Default capacity per channel: 1597 samples (F17), matching the KB width. */
export const DEFAULT_CAPACITY = 1597;

/**
 * Alignment tolerance as a fraction of the slower channel's mean period.
 * Half a period is the widest defensible window: beyond it, a sample is closer
 * to its neighbour than to the one it was matched with.
 */
export const ALIGN_TOLERANCE_FRACTION = 0.5;

export interface ChannelStats {
  readonly id: string;
  /** Samples currently held. */
  readonly count: number;
  /** Finite samples accepted over the channel's lifetime. */
  readonly accepted: number;
  /** Non-finite samples rejected as gaps over the lifetime. */
  readonly gaps: number;
  /** Mean inter-sample interval in ms over the held window, NaN if < 2. */
  readonly periodMs: number;
  /** Measured rate in Hz over the held window, NaN if undetermined. */
  readonly hz: number;
  /** Timestamp of the newest held sample, NaN when empty. */
  readonly lastT: number;
}

export interface PairedSeries {
  readonly a: Float64Array;
  readonly b: Float64Array;
  /** Timestamps of the pairs (taken from the slower channel). */
  readonly t: Float64Array;
  readonly n: number;
  /** Samples skipped because no partner fell inside the tolerance. */
  readonly unmatched: number;
  /** Tolerance actually used, in ms. */
  readonly toleranceMs: number;
  /** True when n < STAT_FLOOR: not enough paired evidence to speak. */
  readonly underFloor: boolean;
  readonly reason?: string;
}

const EMPTY_PAIR = (reason: string, toleranceMs = NaN): PairedSeries => ({
  a: new Float64Array(0),
  b: new Float64Array(0),
  t: new Float64Array(0),
  n: 0,
  unmatched: 0,
  toleranceMs,
  underFloor: true,
  reason,
});

class Channel {
  readonly id: string;
  private readonly cap: number;
  private readonly v: Float64Array;
  private readonly ts: Float64Array;
  private head = 0;
  private size = 0;
  accepted = 0;
  gaps = 0;
  /** Last accepted timestamp, used to reject out-of-order pushes. */
  private lastT = Number.NEGATIVE_INFINITY;

  constructor(id: string, capacity: number) {
    this.id = id;
    this.cap = capacity;
    this.v = new Float64Array(capacity);
    this.ts = new Float64Array(capacity);
  }

  /** Returns true when the sample was stored. */
  push(t: number, value: number): boolean {
    if (!Number.isFinite(value) || !Number.isFinite(t)) {
      this.gaps++;
      return false;
    }
    // Out-of-order arrival would break the monotone alignment invariant; it is
    // a gap in the record, not something to silently re-sort.
    if (t < this.lastT) {
      this.gaps++;
      return false;
    }
    this.v[this.head] = value;
    this.ts[this.head] = t;
    this.head = (this.head + 1) % this.cap;
    if (this.size < this.cap) this.size++;
    this.accepted++;
    this.lastT = t;
    return true;
  }

  get length(): number {
    return this.size;
  }

  /** Oldest-first index into the ring. */
  private idx(i: number): number {
    return (this.head - this.size + i + this.cap * 2) % this.cap;
  }

  timeAt(i: number): number {
    return this.ts[this.idx(i)];
  }

  valueAt(i: number): number {
    return this.v[this.idx(i)];
  }

  /** Mean inter-sample interval in ms; NaN with fewer than two samples. */
  periodMs(): number {
    if (this.size < 2) return NaN;
    const span = this.timeAt(this.size - 1) - this.timeAt(0);
    if (!(span > 0)) return NaN;
    return span / (this.size - 1);
  }

  stats(): ChannelStats {
    const p = this.periodMs();
    return {
      id: this.id,
      count: this.size,
      accepted: this.accepted,
      gaps: this.gaps,
      periodMs: p,
      hz: Number.isFinite(p) && p > 0 ? 1000 / p : NaN,
      lastT: this.size > 0 ? this.timeAt(this.size - 1) : NaN,
    };
  }

  /** Copy of the held values, oldest first. */
  values(): Float64Array {
    const out = new Float64Array(this.size);
    for (let i = 0; i < this.size; i++) out[i] = this.valueAt(i);
    return out;
  }

  times(): Float64Array {
    const out = new Float64Array(this.size);
    for (let i = 0; i < this.size; i++) out[i] = this.timeAt(i);
    return out;
  }
}

export class StreamWindow {
  private readonly channels = new Map<string, Channel>();
  private readonly capacity: number;

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(STAT_FLOOR, Math.floor(capacity));
  }

  /** Records one sample. Non-finite values and out-of-order stamps are gaps. */
  push(id: string, t: number, value: number): boolean {
    let ch = this.channels.get(id);
    if (!ch) {
      ch = new Channel(id, this.capacity);
      this.channels.set(id, ch);
    }
    return ch.push(t, value);
  }

  /** Records several channels sampled at the same instant. */
  pushFrame(t: number, frame: Readonly<Record<string, number>>): void {
    // Sorted so a frame is applied in a stable order regardless of key order.
    for (const id of Object.keys(frame).sort()) this.push(id, t, frame[id]);
  }

  has(id: string): boolean {
    return this.channels.has(id);
  }

  /** Channel ids in deterministic (sorted) order. */
  ids(): string[] {
    return [...this.channels.keys()].sort();
  }

  stats(id: string): ChannelStats | null {
    return this.channels.get(id)?.stats() ?? null;
  }

  allStats(): ChannelStats[] {
    return this.ids().map((id) => this.channels.get(id)!.stats());
  }

  /** Raw held values for one channel, oldest first. */
  series(id: string): Float64Array {
    return this.channels.get(id)?.values() ?? new Float64Array(0);
  }

  timestamps(id: string): Float64Array {
    return this.channels.get(id)?.times() ?? new Float64Array(0);
  }

  clear(): void {
    this.channels.clear();
  }

  /**
   * Pairs two channels by nearest timestamp under the monotone one-to-one
   * rule. The slower channel drives: each of its samples takes the closest
   * still-unused sample of the faster channel, if one is inside tolerance.
   */
  pair(idA: string, idB: string, toleranceMs?: number): PairedSeries {
    const ca = this.channels.get(idA);
    const cb = this.channels.get(idB);
    if (!ca) return EMPTY_PAIR(`unknown channel ${idA}`);
    if (!cb) return EMPTY_PAIR(`unknown channel ${idB}`);
    if (ca.length === 0 || cb.length === 0) return EMPTY_PAIR('empty channel');

    const pa = ca.periodMs();
    const pb = cb.periodMs();
    let tol = toleranceMs ?? NaN;
    if (!Number.isFinite(tol)) {
      const slow = Math.max(
        Number.isFinite(pa) ? pa : 0,
        Number.isFinite(pb) ? pb : 0,
      );
      tol = slow > 0 ? slow * ALIGN_TOLERANCE_FRACTION : NaN;
    }
    if (!Number.isFinite(tol) || tol <= 0) {
      return EMPTY_PAIR('no measurable sampling period on either channel', tol);
    }

    // Drive with the slower channel so the faster one is the one being
    // subsampled — driving with the fast channel would starve most of its
    // samples and report a misleading `unmatched` count.
    const aIsDriver = !(Number.isFinite(pa) && Number.isFinite(pb) && pb > pa);
    const driver = aIsDriver ? ca : cb;
    const follower = aIsDriver ? cb : ca;

    const nMax = Math.min(driver.length, follower.length);
    const outA = new Float64Array(nMax);
    const outB = new Float64Array(nMax);
    const outT = new Float64Array(nMax);
    let n = 0;
    let unmatched = 0;
    let j = 0; // follower cursor — only ever moves forward

    for (let i = 0; i < driver.length && n < nMax; i++) {
      const td = driver.timeAt(i);
      // Advance while the next follower sample is strictly closer.
      while (
        j + 1 < follower.length &&
        Math.abs(follower.timeAt(j + 1) - td) < Math.abs(follower.timeAt(j) - td)
      ) {
        j++;
      }
      const dt = Math.abs(follower.timeAt(j) - td);
      if (dt > tol) {
        unmatched++;
        continue;
      }
      const dv = driver.valueAt(i);
      const fv = follower.valueAt(j);
      outT[n] = td;
      outA[n] = aIsDriver ? dv : fv;
      outB[n] = aIsDriver ? fv : dv;
      n++;
      j++; // consumed: one-to-one
      if (j >= follower.length) {
        // Remaining driver samples have no partner left.
        unmatched += driver.length - i - 1;
        break;
      }
    }

    return {
      a: outA.subarray(0, n),
      b: outB.subarray(0, n),
      t: outT.subarray(0, n),
      n,
      unmatched,
      toleranceMs: tol,
      underFloor: n < STAT_FLOOR,
      ...(n < STAT_FLOOR ? { reason: `n=${n} < F9 floor ${STAT_FLOOR}` } : {}),
    };
  }
}
