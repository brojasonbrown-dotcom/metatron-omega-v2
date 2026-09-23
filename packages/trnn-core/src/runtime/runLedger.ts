/**
 * Ω-P4 — the run ledger.
 *
 * A run is `(profileId, seed, startedAt)` plus the digest chain it produced.
 * The ledger keeps a bounded, append-only record of marks (tick, digest,
 * coherence, energy, flux) so a run can be replayed and compared tick-for-tick
 * against a later run of the same profile+seed. Divergence localisation is the
 * whole point: the first mark whose digest differs names the tick.
 */

export interface RunMark {
  readonly tick: number;
  readonly digest: string;
  readonly coherence: number;
  readonly energy: number;
  readonly fluxImbalance: number;
  readonly orderingViolations: number;
  readonly finite: boolean;
}

export interface RunHeader {
  readonly id: string;
  readonly profileId: string;
  readonly seed: string;
  readonly nodes: readonly number[];
  readonly startedAt: number;
}

export interface RunDivergence {
  readonly diverged: boolean;
  /** First differing tick, or null when the shorter run is a prefix. */
  readonly tick: number | null;
  readonly comparedMarks: number;
}

export class RunLedger {
  readonly header: RunHeader;
  private readonly marks: RunMark[] = [];
  private readonly cap: number;
  private dropped = 0;
  /** Cadence: only every `stride`-th tick is marked (Fibonacci by default). */
  readonly stride: number;

  constructor(header: RunHeader, cap = 4181, stride = 13) {
    this.header = header;
    this.cap = Math.max(1, cap);
    this.stride = Math.max(1, stride);
  }

  /** Returns true when the tick was recorded (cadence hit). */
  mark(m: RunMark): boolean {
    if (m.tick % this.stride !== 0) return false;
    this.marks.push(m);
    if (this.marks.length > this.cap) {
      this.marks.shift();
      this.dropped++;
    }
    return true;
  }

  snapshot(): readonly RunMark[] {
    return this.marks.slice();
  }

  tail(n = 13): readonly RunMark[] {
    return this.marks.slice(Math.max(0, this.marks.length - n));
  }

  head(): RunMark | null {
    return this.marks.length ? this.marks[this.marks.length - 1] : null;
  }

  size(): number {
    return this.marks.length;
  }

  droppedCount(): number {
    return this.dropped;
  }

  /** Locate the first tick at which two ledgers disagree. */
  static compare(a: RunLedger, b: RunLedger): RunDivergence {
    const xs = a.snapshot();
    const ys = b.snapshot();
    const n = Math.min(xs.length, ys.length);
    for (let i = 0; i < n; i++) {
      if (xs[i].tick !== ys[i].tick || xs[i].digest !== ys[i].digest) {
        return { diverged: true, tick: xs[i].tick, comparedMarks: n };
      }
    }
    return { diverged: false, tick: null, comparedMarks: n };
  }
}
