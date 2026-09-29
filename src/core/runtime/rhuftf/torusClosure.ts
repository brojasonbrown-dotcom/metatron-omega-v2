/**
 * Torus loop closure — principle ④ "close the loop and audit the ring
 * residual".
 *
 * The top rung's output is fed back into the base one tick later, and the
 * mismatch is the ring residual:
 *
 *     ringResidual = ‖ y_0(t) − P( y_8(t−1) ) ‖ / ‖ y_0(t) ‖
 *
 * P is a deterministic resample from the top rung's node count onto the base
 * rung's node count (same linear kernel the ladder already uses), followed by
 * an RMS-gain match so the comparison measures SHAPE mismatch, not scale
 * mismatch between rungs of different width.
 *
 * OBSERVER ONLY. This module never writes to a live ψ; the caller holds the
 * delayed buffer and decides what, if anything, to do with the residual.
 */

interface NAcc {
  s: number;
  c: number;
}
function nAcc(): NAcc {
  return { s: 0, c: 0 };
}
function nAdd(a: NAcc, x: number): void {
  if (!Number.isFinite(x)) return;
  const s = a.s;
  const t = s + x;
  a.c += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s;
  a.s = t;
}
function nVal(a: NAcc): number {
  return a.s + a.c;
}

/** Deterministic linear resample of `src` onto `dst.length` nodes. */
export function projectOnto(src: Float64Array, dst: Float64Array): void {
  const n = dst.length;
  const m = src.length;
  if (m === 0) {
    dst.fill(0);
    return;
  }
  if (m === 1) {
    dst.fill(src[0]);
    return;
  }
  for (let i = 0; i < n; i++) {
    const x = (i * (m - 1)) / Math.max(1, n - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(m - 1, i0 + 1);
    const t = x - i0;
    dst[i] = src[i0] * (1 - t) + src[i1] * t;
  }
}

function rms(x: Float64Array): number {
  if (x.length === 0) return 0;
  const acc = nAcc();
  for (let i = 0; i < x.length; i++) nAdd(acc, x[i] * x[i]);
  return Math.sqrt(nVal(acc) / x.length);
}

export interface RingReport {
  /** Normalised loop mismatch. NaN until the delay line is primed. */
  readonly residual: number;
  /** Gain ratio applied to match RMS between rungs (shape-only compare). */
  readonly gain: number;
  /** Per-node residual vector (caller-owned scratch, valid until next call). */
  readonly vector: Float64Array;
  readonly primed: boolean;
  /**
   * Theoretical floor on the residual at the operating rung: |ψ|ⁿ, the Pisot
   * defect. Exact loop closure is IMPOSSIBLE — Lₙ is the nearest integer to φⁿ
   * and the gap |φⁿ − Lₙ| = |ψ|ⁿ never vanishes. Driving the residual below
   * this is not success, it is float64 noise.
   */
  readonly floor: number;
  /** residual ≤ floor ⇒ the measurement has hit the theorem, not the target. */
  readonly floorLimited: boolean;
  /** log_φ(residual / floor) — headroom in rungs above the theoretical floor. */
  readonly margin: number;
}

/** |ψ| = φ⁻¹, the Pisot conjugate magnitude. */
const PSI_ABS = 0.6180339887498949; // exact: 0.6180339887498948482045868343656381
const LN_PHI = Math.log(1 / PSI_ABS);

/** Irreducible closure defect at rung n, floored at machine epsilon. */
export function pisotFloor(rung: number): number {
  if (!Number.isFinite(rung) || rung < 0) return Number.EPSILON;
  return Math.max(Math.pow(PSI_ABS, rung), Number.EPSILON);
}

export class TorusLoop {
  private delayed: Float64Array | null = null;
  private projected: Float64Array;
  private residualVec: Float64Array;

  constructor(private readonly baseNodes: number) {
    this.projected = new Float64Array(baseNodes);
    this.residualVec = new Float64Array(baseNodes);
  }

  /**
   * Advance one tick. `base` is y_0(t), `top` is y_8(t) — the top value is
   * stored for use on the NEXT call (the one-tick delay that closes the ring).
   * `rung` is the physical φ-ladder index the loop is operating at; it sets the
   * theoretical floor the residual is scored against.
   */
  step(base: Float64Array, top: Float64Array, rung = 0): RingReport {
    const prev = this.delayed;
    const floor = pisotFloor(rung);

    // capture y_8(t) for the next tick
    if (!this.delayed || this.delayed.length !== top.length) {
      this.delayed = new Float64Array(top.length);
    }
    this.delayed.set(top);

    if (!prev) {
      this.residualVec.fill(0);
      return {
        residual: NaN,
        gain: NaN,
        vector: this.residualVec,
        primed: false,
        floor,
        floorLimited: false,
        margin: NaN,
      };
    }

    projectOnto(prev, this.projected);

    const rb = rms(base);
    const rp = rms(this.projected);
    const gain = rp > 0 ? rb / rp : NaN;
    const g = Number.isFinite(gain) ? gain : 0;

    const n = Math.min(base.length, this.projected.length, this.residualVec.length);
    const acc = nAcc();
    const den = nAcc();
    for (let i = 0; i < n; i++) {
      const d = base[i] - g * this.projected[i];
      this.residualVec[i] = d;
      nAdd(acc, d * d);
      nAdd(den, base[i] * base[i]);
    }
    const b = nVal(den);
    const residual = b > 0 ? Math.sqrt(nVal(acc) / b) : NaN;
    return {
      residual,
      gain,
      vector: this.residualVec,
      primed: true,
      floor,
      floorLimited: Number.isFinite(residual) && residual <= floor,
      margin: Number.isFinite(residual) && residual > 0 ? Math.log(residual / floor) / LN_PHI : NaN,
    };
  }

  reset(): void {
    this.delayed = null;
    this.residualVec.fill(0);
    this.projected.fill(0);
  }
}

// ───────────────────────── rung-enable criterion ─────────────────────────
//
// A rung turns ON only when its ring residual is non-increasing across a full
// Fibonacci window. Two admissions, and nothing else:
//
//   1. r[i] ≤ r[i−1]           — the loop is closing, not drifting; or
//   2. r[i] ≤ pisotFloor(rung) — the residual is already at the theoretical
//                                floor |ψ|ⁿ, where further "improvement" is
//                                float64 noise, so an increase inside the
//                                floor is not evidence of instability.
//
// An unfilled window is NOT stable. NaN is NOT stable. Absence of evidence is
// never scored as convergence.

export interface RingWindowVerdict {
  /** Window is full and the residual is non-increasing (or floor-limited). */
  readonly stable: boolean;
  /** Samples currently held. */
  readonly count: number;
  /** Window length (a Fibonacci number). */
  readonly window: number;
  /** Oldest and newest residual in the window. NaN when empty. */
  readonly first: number;
  readonly last: number;
  /**
   * Mean decay in φ-rungs per tick: log_φ(last/first)/(count−1). Negative means
   * the loop is closing. NaN when not computable.
   */
  readonly decayPhiPerTick: number;
  /** Index of the first violating step, or −1. */
  readonly violation: number;
  readonly floor: number;
}

const FIB_WINDOWS = [3, 5, 8, 13, 21, 34, 55, 89] as const;

/** Nearest Fibonacci window ≥ n (capped at 89). */
export function fibWindow(n: number): number {
  for (const f of FIB_WINDOWS) if (f >= n) return f;
  return FIB_WINDOWS[FIB_WINDOWS.length - 1];
}

/**
 * Rolling monotonicity witness over the ring residual. Observer only — it
 * decides nothing itself; the caller reads `stable` to enable a rung.
 */
export class RingWindow {
  private readonly buf: number[] = [];
  readonly window: number;
  readonly floor: number;

  constructor(rung: number, window = 13) {
    this.window = fibWindow(window);
    this.floor = pisotFloor(rung);
  }

  push(residual: number): RingWindowVerdict {
    // A non-finite residual is an unprimed or broken measurement: it clears the
    // window rather than being averaged into it.
    if (!Number.isFinite(residual)) {
      this.buf.length = 0;
      return this.verdict();
    }
    this.buf.push(residual);
    if (this.buf.length > this.window) this.buf.shift();
    return this.verdict();
  }

  verdict(): RingWindowVerdict {
    const n = this.buf.length;
    const first = n > 0 ? this.buf[0] : NaN;
    const last = n > 0 ? this.buf[n - 1] : NaN;
    let violation = -1;
    for (let i = 1; i < n; i++) {
      if (this.buf[i] > this.buf[i - 1] && this.buf[i] > this.floor) {
        violation = i;
        break;
      }
    }
    const decay = n > 1 && first > 0 && last > 0 ? Math.log(last / first) / LN_PHI / (n - 1) : NaN;
    return {
      stable: n === this.window && violation === -1,
      count: n,
      window: this.window,
      first,
      last,
      decayPhiPerTick: decay,
      violation,
      floor: this.floor,
    };
  }

  reset(): void {
    this.buf.length = 0;
  }
}
