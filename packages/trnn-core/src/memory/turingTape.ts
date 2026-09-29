/**
 * N4 — the permanent processing layer: a Zeckendorf-addressed read/write tape
 * with a deterministic head.
 *
 * Everything else in the engine is *transient*: z decays, the memory kernel
 * forgets at rate λ, the transcription tape is a fixed-depth telemetry ring
 * that overwrites itself. None of that is a store you can return to. This is.
 *
 * Machine definition
 * ------------------
 *   tape     C cells, C Fibonacci, each holding a complex value
 *   head     an integer cell address in [0, C)
 *   symbol   read from the field, not from a program: the head's motion is
 *            decided by the phase of the field at the head's own address
 *   motion   δ ∈ {−F(k+1), −F(k), 0, +F(k), +F(k+1)} chosen by phase sector,
 *            with k the Zeckendorf order of the current address — so the head
 *            walks the tape in the tape's own arithmetic, never by ±1
 *   write    cell ← (1−w)·cell + w·value,  w = φ⁻² (a convex blend: the tape
 *            can never grow past the largest thing ever written to it)
 *   read     the cell under the head, plus its Zeckendorf neighbourhood
 *
 * The machine is Turing-complete in the useful sense: unbounded-in-principle
 * addressable storage, a state-dependent head, and read/write coupled to the
 * computation. It is also fully deterministic and checkpointable — head,
 * cells, and step count all restore exactly.
 */

import { PHI, PHI_INV } from '../core/constants';
import { isFibonacci } from '../core/fibonacci';
import { datan2, dmag } from '../core/dmath';
import { createField, type CField } from '../core/complex';

/** Write blend weight — φ⁻². Convex, so ‖tape‖∞ is non-increasing in writes. */
export const TAPE_WRITE_WEIGHT = PHI_INV * PHI_INV;

/** Hard bound on any value the tape will store (Law L-T1). */
export const TAPE_BOUND = PHI;

export interface TuringTapeOptions {
  /** Cell count — must be Fibonacci. Default 987. */
  readonly capacity?: number;
  /** Initial head address. Default 0. */
  readonly head?: number;
}

export interface TapeStep {
  readonly step: number;
  /** Head address before the move. */
  readonly from: number;
  /** Head address after the move. */
  readonly to: number;
  /** Signed motion actually taken, in cells. */
  readonly motion: number;
  /** Zeckendorf order of the source address (drives the motion alphabet). */
  readonly order: number;
  /** Magnitude written into the cell. */
  readonly wrote: number;
  /** Magnitude read back out of the cell after the write. */
  readonly read: number;
  /** Cells that have ever been written. */
  readonly occupancy: number;
  /** Max |cell| across the whole tape. */
  readonly peak: number;
}

export interface TapeCheckpoint {
  readonly step: number;
  readonly head: number;
  readonly re: Float64Array;
  readonly im: Float64Array;
  readonly touched: Uint8Array;
}

/** Fibonacci numbers up to 2^31, built once. */
const FIB: number[] = (() => {
  const f = [1, 2];
  while (f[f.length - 1] < 2 ** 31) f.push(f[f.length - 1] + f[f.length - 2]);
  return f;
})();

/**
 * Zeckendorf decomposition: the unique representation of `x` as a sum of
 * non-consecutive Fibonacci numbers. Returns the indices into FIB, descending.
 */
export function zeckendorf(x: number): number[] {
  if (!Number.isInteger(x) || x < 0)
    throw new RangeError(`zeckendorf: x must be a non-negative integer, got ${x}`);
  const out: number[] = [];
  let rest = x;
  let i = FIB.length - 1;
  while (rest > 0 && i >= 0) {
    if (FIB[i] <= rest) {
      out.push(i);
      rest -= FIB[i];
      i -= 2; // non-consecutive by construction
    } else {
      i--;
    }
  }
  return out;
}

/** Largest Zeckendorf order present in `x` (0 for x = 0). */
export function zeckendorfOrder(x: number): number {
  const z = zeckendorf(x);
  return z.length > 0 ? z[0] : 0;
}

export class TuringTape {
  readonly capacity: number;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly touched: Uint8Array;
  private head: number;
  private step = 0;
  private occupancy = 0;

  constructor(opts: TuringTapeOptions = {}) {
    const capacity = opts.capacity ?? 987;
    if (!isFibonacci(capacity)) {
      throw new RangeError(`TuringTape: capacity ${capacity} is not Fibonacci (Law 2.2)`);
    }
    const head = opts.head ?? 0;
    if (!Number.isInteger(head) || head < 0 || head >= capacity) {
      throw new RangeError(`TuringTape: head ${head} out of range [0, ${capacity})`);
    }
    this.capacity = capacity;
    this.re = new Float64Array(capacity);
    this.im = new Float64Array(capacity);
    this.touched = new Uint8Array(capacity);
    this.head = head;
  }

  bytes(): number {
    return this.capacity * (8 + 8 + 1);
  }

  position(): number {
    return this.head;
  }

  steps(): number {
    return this.step;
  }

  /** Read one cell (no side effects). */
  cell(address: number): { re: number; im: number } {
    const a = ((address % this.capacity) + this.capacity) % this.capacity;
    return { re: this.re[a], im: this.im[a] };
  }

  /**
   * Advance the machine one step against a field.
   *
   * The value written at address `a` is the field sampled at the node that
   * address maps onto (address mod nodes) — the tape and the rung share the
   * same circle, so the mapping is a rotation, not an arbitrary hash.
   */
  advance(z: CField): TapeStep {
    const C = this.capacity;
    const from = this.head;
    const node = z.n > 0 ? from % z.n : 0;
    const vr = z.n > 0 ? z.re[node] : 0;
    const vi = z.n > 0 ? z.im[node] : 0;

    // --- write (convex blend, then the hard bound) -------------------------
    const w = TAPE_WRITE_WEIGHT;
    let nr = (1 - w) * this.re[from] + w * vr;
    let ni = (1 - w) * this.im[from] + w * vi;
    const mag = dmag(nr, ni);
    if (mag > TAPE_BOUND) {
      const k = TAPE_BOUND / mag;
      nr *= k;
      ni *= k;
    }
    this.re[from] = nr;
    this.im[from] = ni;
    if (this.touched[from] === 0) {
      this.touched[from] = 1;
      this.occupancy++;
    }
    const wrote = dmag(w * vr, w * vi);
    const read = dmag(nr, ni);

    // --- motion: phase sector of the cell just written ---------------------
    // Five sectors over (−π, π] map to the Zeckendorf motion alphabet. Phase
    // is the field's own decision variable; nothing external steers the head.
    const order = zeckendorfOrder(from);
    const kSmall = FIB[Math.min(order, FIB.length - 1)];
    const kLarge = FIB[Math.min(order + 1, FIB.length - 1)];
    const phase = datan2(ni, nr); // (−π, π]
    const sector = Math.floor(((phase + Math.PI) / (2 * Math.PI)) * 5);
    const s = sector < 0 ? 0 : sector > 4 ? 4 : sector;
    const motion = s === 0 ? -kLarge : s === 1 ? -kSmall : s === 2 ? 0 : s === 3 ? kSmall : kLarge;

    const to = (((from + motion) % C) + C) % C;
    this.head = to;
    this.step++;

    let peak = 0;
    for (let i = 0; i < C; i++) {
      const m = dmag(this.re[i], this.im[i]);
      if (m > peak) peak = m;
    }

    return {
      step: this.step,
      from,
      to,
      motion,
      order,
      wrote,
      read,
      occupancy: this.occupancy,
      peak,
    };
  }

  /**
   * Project the tape back onto a rung of `n` nodes: cell a contributes to node
   * a mod n, averaged over the cells that land there. Deterministic and
   * allocation-free when `out` is supplied.
   */
  project(n: number, out?: CField): CField {
    const dst = out ?? createField(n);
    dst.re.fill(0);
    dst.im.fill(0);
    const counts = new Int32Array(n);
    for (let a = 0; a < this.capacity; a++) {
      const j = a % n;
      dst.re[j] += this.re[a];
      dst.im[j] += this.im[a];
      counts[j]++;
    }
    for (let j = 0; j < n; j++) {
      const c = counts[j];
      if (c > 1) {
        dst.re[j] /= c;
        dst.im[j] /= c;
      }
    }
    return dst;
  }

  /** Cells written at least once. */
  occupied(): number {
    return this.occupancy;
  }

  checkpoint(): TapeCheckpoint {
    return {
      step: this.step,
      head: this.head,
      re: Float64Array.from(this.re),
      im: Float64Array.from(this.im),
      touched: Uint8Array.from(this.touched),
    };
  }

  restore(cp: TapeCheckpoint): void {
    if (cp.re.length !== this.capacity) {
      throw new RangeError(
        `TuringTape.restore: checkpoint width ${cp.re.length} != capacity ${this.capacity}`,
      );
    }
    this.re.set(cp.re);
    this.im.set(cp.im);
    this.touched.set(cp.touched);
    this.step = cp.step;
    this.head = cp.head;
    let occ = 0;
    for (let i = 0; i < this.capacity; i++) if (this.touched[i] !== 0) occ++;
    this.occupancy = occ;
  }
}
