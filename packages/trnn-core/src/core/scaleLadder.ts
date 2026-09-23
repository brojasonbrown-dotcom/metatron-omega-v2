/**
 * The nested toroid stack (BRAINMAP 2.1).
 *
 * Stability law [MATH]: rung n is stable  <=>  L(n) = +/-1 (mod 13)
 *                                          <=>  n = {1, 13, 15, 27} (mod 28).
 * Both forms are computed here and cross-checked in the gate battery, so the
 * law is *verified* rather than asserted.
 *
 * Ladder spans phi^292 ~ 10^61, so radii and clocks are carried in LOG space
 * (Law L5). Linear values are exposed only where they are representable.
 */

import { lucasBig } from './fibonacci';
import { PHI } from './constants';
import { dlog, dlog1p, dpow } from './dmath';

export const LADDER_MAX_N = 293;
export const STABLE_RESIDUES = [1, 13, 15, 27] as const;
/** Dense core = the 18 lowest stable rungs (n <= 125). */
export const DENSE_CORE_COUNT = 18;

const LN_PHI = dlog(PHI);

export interface Rung {
  /** Ladder index n. */
  readonly n: number;
  /** Position within the stable list, 0-based. */
  readonly rank: number;
  /** L(n) mod 13, always 1 or 12 for a stable rung. */
  readonly lucasResidue: number;
  /** ln(major radius / planck length) = n ln phi. */
  readonly logRadius: number;
  /** ln(minor radius / planck length) = (n-1) ln phi. */
  readonly logMinorRadius: number;
  /** ln(clock / planck time) = n ln phi + ln(1 + 0.01 n). */
  readonly logTau: number;
  /** Attenuation qrf(n) = phi^(-n/89), representable. */
  readonly qrf: number;
  /** Dense core membership. */
  readonly dense: boolean;
}

/** L(n) mod 13 as a small number. */
export function lucasMod13(n: number): number {
  return Number(lucasBig(n) % 13n);
}

/** Residue form of the stability law. */
export function isStableByResidue(n: number): boolean {
  const r = ((n % 28) + 28) % 28;
  return (STABLE_RESIDUES as readonly number[]).includes(r);
}

/** Lucas form of the stability law. */
export function isStableByLucas(n: number): boolean {
  const m = lucasMod13(n);
  return m === 1 || m === 12;
}

function makeRung(n: number, rank: number): Rung {
  return {
    n,
    rank,
    lucasResidue: lucasMod13(n),
    logRadius: n * LN_PHI,
    logMinorRadius: (n - 1) * LN_PHI,
    logTau: n * LN_PHI + dlog1p(0.01 * n),
    qrf: dpow(PHI, -n / 89),
    dense: false,
  };
}

function buildLadder(): Rung[] {
  const out: Rung[] = [];
  for (let n = 1; n <= LADDER_MAX_N; n++) {
    if (!isStableByResidue(n)) continue;
    out.push(makeRung(n, out.length));
  }
  return out.map((r, i) => ({ ...r, dense: i < DENSE_CORE_COUNT }));
}

/** The 42 stable rungs, ascending. */
export const LADDER: readonly Rung[] = Object.freeze(buildLadder());

/** The 18-rung dense core the MultiTorusEngine runs over. */
export const DENSE_CORE: readonly Rung[] = Object.freeze(LADDER.slice(0, DENSE_CORE_COUNT));

export function rungByIndex(n: number): Rung | undefined {
  return LADDER.find((r) => r.n === n);
}

/**
 * Closure obstruction [MATH]: L(n) mod 13 is never 0, so no torus closes
 * exactly and residual flux must always be routed (see cell/closure).
 */
export function closureObstructionHolds(maxN = LADDER_MAX_N): boolean {
  for (let n = 1; n <= maxN; n++) if (lucasMod13(n) === 0) return false;
  return true;
}
