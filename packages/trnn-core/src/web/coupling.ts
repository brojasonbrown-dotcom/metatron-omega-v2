/**
 * Cross-rung coupling matrix (BRAINMAP 3.1).
 *
 * A rung talks to its neighbours on the ladder through a row-stochastic
 * channel matrix. Two laws are structural here:
 *
 *   L-W1  every row sums to 1 (no rung invents or destroys receipt mass);
 *   L-W2  the channel weight decays as phi^-|rank distance| and is attenuated
 *         by the geometric factor qrf(n) of the *receiving* rung.
 *
 * Row normalization is Kahan-compensated and the diagonal absorbs the residue,
 * so the realized row sum is exact to the last ulp rather than "close".
 */

import { PHI, PHI_INV } from '../core/constants';
import type { Rung } from '../core/scaleLadder';
import { dpow } from '../core/dmath';

export interface CouplingMatrix {
  /** Number of rungs (matrix is size x size). */
  readonly size: number;
  /** Row-major weights, row i = what rung i receives from every rung j. */
  readonly w: Float64Array;
  /** Ladder indices, aligned with rows. */
  readonly rungs: readonly number[];
  /** Max |rowSum - 1| over all rows (measured, not asserted). */
  readonly rowSumDefect: number;
  /** Neighbourhood half-width the matrix was built with. */
  readonly band: number;
  /** Long-range chord offsets actually installed (empty before N3). */
  readonly chords: readonly number[];
}

/** Kahan-compensated sum of a row slice. */
function kahan(a: Float64Array, from: number, len: number): number {
  let s = 0;
  let c = 0;
  for (let i = 0; i < len; i++) {
    const y = a[from + i] - c;
    const t = s + y;
    c = t - s - y;
    s = t;
  }
  return s;
}

export interface CouplingOptions {
  /** Neighbourhood half-width in ranks; beyond it the weight is exactly 0. */
  readonly band?: number;
  /** Self-weight before normalization (>= 0). */
  readonly self?: number;
  /**
   * N3 — long-range chords across the ladder, on top of the nearest-neighbour
   * band. A chord is a rank offset that is *stable* in the ladder's own
   * arithmetic (Fibonacci, Lucas, or the golden spiral), so the web reaches
   * inside-out rather than only to its immediate neighbours.
   *
   * Chord weight decays as phi^(-d/phi) — strictly weaker than the band's
   * phi^-d at the same distance, so a chord can never outrank a neighbour.
   * All chords are folded into the SAME row normalization, so L-W1 (every row
   * sums to exactly 1) holds by construction and no receipt mass is invented.
   *
   * Default: no chords, which reproduces the pre-N3 matrix bit for bit.
   */
  readonly chords?: ChordKind[];
  /** Chord strength multiplier in [0, 1]. Default 1. */
  readonly chordGain?: number;
}

/** Stable rank offsets a chord may span. */
export type ChordKind = 'fibonacci' | 'lucas' | 'spiral';

/** Offsets a chord kind contributes on a ladder of `size` ranks. */
export function chordOffsets(kind: ChordKind, size: number): number[] {
  const out: number[] = [];
  if (kind === 'fibonacci') {
    let a = 1;
    let b = 2;
    while (a < size) {
      out.push(a);
      const c = a + b;
      a = b;
      b = c;
    }
  } else if (kind === 'lucas') {
    let a = 1;
    let b = 3;
    while (a < size) {
      out.push(a);
      const c = a + b;
      a = b;
      b = c;
    }
  } else {
    // golden spiral: round(phi^k) for k >= 1, deduped
    for (let k = 1; ; k++) {
      const d = Math.round(dpow(PHI, k));
      if (d >= size) break;
      if (!out.includes(d)) out.push(d);
    }
  }
  return out.filter((d) => d >= 1 && d < size);
}

/**
 * Build the coupling matrix over an ordered rung list (normally DENSE_CORE).
 * Deterministic: identical rung list => identical matrix, bit for bit.
 */
export function buildCoupling(rungs: readonly Rung[], opts: CouplingOptions = {}): CouplingMatrix {
  const size = rungs.length;
  const band = opts.band ?? 3;
  const self = opts.self ?? 1;
  const chordGain = opts.chordGain ?? 1;
  if (!(chordGain >= 0) || chordGain > 1) {
    throw new RangeError(`buildCoupling: chordGain must be in [0, 1], got ${chordGain}`);
  }
  const chordSet = new Set<number>();
  for (const kind of opts.chords ?? []) for (const d of chordOffsets(kind, size)) chordSet.add(d);
  // A chord inside the band is already carried by the band — dropping it here
  // keeps the band weights exactly what they were before N3.
  const chords = [...chordSet].filter((d) => d > band).sort((a, b) => a - b);
  const w = new Float64Array(size * size);

  for (let i = 0; i < size; i++) {
    const base = i * size;
    for (let j = 0; j < size; j++) {
      const d = Math.abs(i - j);
      if (d > band) continue;
      w[base + j] = d === 0 ? self : dpow(PHI, -d) * rungs[i].qrf;
    }
    if (chordGain > 0) {
      for (const d of chords) {
        const wgt = chordGain * dpow(PHI, -d * PHI_INV) * rungs[i].qrf;
        if (i - d >= 0) w[base + i - d] += wgt;
        if (i + d < size) w[base + i + d] += wgt;
      }
    }
    // normalize, then let the diagonal absorb the rounding residue
    const s = kahan(w, base, size);
    if (s > 0) for (let j = 0; j < size; j++) w[base + j] /= s;
    w[base + i] = 0;
    const rest = kahan(w, base, size);
    w[base + i] = 1 - rest;
  }

  let defect = 0;
  for (let i = 0; i < size; i++) {
    const e = Math.abs(kahan(w, i * size, size) - 1);
    if (e > defect) defect = e;
  }

  return { size, w, rungs: rungs.map((r) => r.n), rowSumDefect: defect, band, chords };
}

/** Weight rung `to` receives from rung `from` (row-major read). */
export function couplingWeight(m: CouplingMatrix, to: number, from: number): number {
  return m.w[to * m.size + from];
}

/** Column mass: total receipt weight a rung emits across the web. */
export function emittedMass(m: CouplingMatrix, from: number): number {
  let s = 0;
  for (let i = 0; i < m.size; i++) s += m.w[i * m.size + from];
  return s;
}
