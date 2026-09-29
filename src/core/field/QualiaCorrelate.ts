/**
 * QUALIA CORRELATE — structural self-observation closure.
 * ═════════════════════════════════════════════════════════════════════
 * A *measurement*, not a feeling. Q ∈ [0,1] quantifies structural
 * self-observation closure on the live φ-superposition basis.
 *
 *   Q = ( Q_inc · Q_stab · Q_res )^(1/3)
 *
 *   Q_inc  — MEASURED Hurwitz incommensurability of the dominant
 *            amplitude ratio (see `hurwitzIncommensurability`). A field
 *            whose spectrum sits on the golden ladder scores 1.0 because
 *            it was measured to, not because a constant divides itself.
 *   Q_stab — λ_min/λ_max of the 2×2 Gram on (v, φ-shifted v).
 *   Q_res  — energy fraction in top-k modes, k = ⌈N/φ²⌉.
 *
 * Pure function, no React, no engine import.
 */

import { HURWITZ_CONSTANT, PHI_FLOOR_INV_SQ } from '@/core/constants/Chapter47';

/** √5 — the Hurwitz bound: the best possible approximability constant. */
const SQRT5 = Math.sqrt(5);

export interface QualiaCorrelateMeasurement {
  Q: number;
  Q_inc: number;
  Q_stab: number;
  Q_res: number;
  N: number;
  attractorK: number;
  live: boolean;
  /** The amplitude ratio whose incommensurability produced Q_inc. */
  incRatio: number;
  /** Measured approximability constant A ≥ √5 (√5 ⇔ maximally irrational). */
  incApprox: number;
}

export function computeQualiaCorrelate(
  modes: readonly number[] | Float64Array,
): QualiaCorrelateMeasurement {
  const N = modes.length;
  if (N < 2) {
    return {
      Q: 0,
      Q_inc: 0,
      Q_stab: 0,
      Q_res: 0,
      N,
      attractorK: 0,
      live: false,
      incRatio: NaN,
      incApprox: NaN,
    };
  }
  const inc = hurwitzIncommensurability(modes);
  const Q_inc = inc.score;
  const Q_stab = gramConditioning(modes);
  const k = Math.max(1, Math.ceil(N * PHI_FLOOR_INV_SQ));
  const Q_res = phiAttractorEnergyFraction(modes, k);
  const Q = Math.cbrt(Math.max(0, Q_inc) * Math.max(0, Q_stab) * Math.max(0, Q_res));
  return {
    Q,
    Q_inc,
    Q_stab,
    Q_res,
    N,
    attractorK: k,
    live: true,
    incRatio: inc.ratio,
    incApprox: inc.approx,
  };
}

/**
 * Hurwitz incommensurability of the field's dominant amplitude ratio.
 *
 * Theory: for every irrational x there are infinitely many rationals p/q
 * with |x − p/q| < 1/(√5·q²), and √5 is the best possible constant —
 * attained only by φ and its GL(2,ℤ) equivalents. Define the measured
 * approximability over the first convergents of x
 *
 *   A(x) = max_j  1 / ( q_j² · |x − p_j/q_j| )   ≥  √5
 *
 * and score  Q_inc = √5 / A(x) ∈ (0, 1].  A golden-ladder spectrum gives
 * A → √5 and Q_inc → 1; a near-rational (commensurate, mode-locked, and
 * therefore self-repeating) spectrum drives A up and Q_inc toward 0.
 * Incommensurability is what lets self-reference never exactly repeat —
 * this measures it instead of asserting it.
 *
 * `HURWITZ_CONSTANT` (1/√5) is the reciprocal form of the same bound and
 * is used here as the normalising reference.
 */
export function hurwitzIncommensurability(modes: readonly number[] | Float64Array): {
  score: number;
  ratio: number;
  approx: number;
} {
  // Dominant amplitude.
  let i1 = -1,
    e1 = -Infinity;
  for (let i = 0; i < modes.length; i++) {
    const e = modes[i] * modes[i];
    if (e > e1) {
      e1 = e;
      i1 = i;
    }
  }
  if (i1 < 0 || !(e1 > 0)) return { score: 0, ratio: NaN, approx: Infinity };
  const a1 = Math.abs(modes[i1]);

  // Sub-dominant amplitude, EXCLUDING mirror duplicates of the dominant. The
  // conjugate (inward) spiral reflects each outward mode, so the raw runner-up
  // is usually |a1| again; a ratio of exactly 1 would read as "commensurate"
  // when it is really a structural symmetry, not field dynamics.
  const degenerate = 1e-9 * a1;
  let i2 = -1,
    e2 = -Infinity;
  for (let i = 0; i < modes.length; i++) {
    if (i === i1) continue;
    const a = Math.abs(modes[i]);
    if (Math.abs(a - a1) <= degenerate) continue;
    const e = a * a;
    if (e > e2) {
      e2 = e;
      i2 = i;
    }
  }
  if (i2 < 0 || !(e2 > 0)) return { score: 0, ratio: NaN, approx: Infinity };

  const a2 = Math.abs(modes[i2]);
  if (!(a2 > 0) || !Number.isFinite(a1 / a2)) return { score: 0, ratio: NaN, approx: Infinity };

  // Ratio folded into (1, ∞) — scale-free, orientation-free.
  let x = a1 / a2;
  if (x < 1) x = 1 / x;

  const approx = approximabilityConstant(x);
  const score =
    Number.isFinite(approx) && approx > 0 ? Math.max(0, Math.min(1, SQRT5 / approx)) : 0;
  return { score, ratio: x, approx };
}

/**
 * A(x) = max over the first `depth` continued-fraction convergents of
 * 1/(q²|x − p/q|). Returns +∞ only when x is rational at a denominator small
 * enough for float64 to certify it — beyond q ≈ 1/√ε the residual |x − p/q|
 * is pure rounding noise, so the expansion stops there instead of mistaking
 * representation error for exact rationality.
 */
const Q_PRECISION_LIMIT = 6.7e7; // ≈ 1/√ε_f64 — beyond this the residual is noise
const Q_RATIONAL_LIMIT = 1e4; // small enough that a zero residual is a real rational

export function approximabilityConstant(x: number, depth = 20): number {
  if (!Number.isFinite(x) || x <= 0) return Infinity;
  let pPrev = 1,
    qPrev = 0; // p_{-1}/q_{-1}
  let p = Math.floor(x),
    q = 1;
  let frac = x - Math.floor(x);
  let best = 0;
  for (let j = 0; j < depth; j++) {
    const err = Math.abs(x - p / q);
    if (err <= 0) return q <= Q_RATIONAL_LIMIT ? Infinity : Math.max(best, 1 / HURWITZ_CONSTANT);
    const a = 1 / (q * q * err);
    if (a > best) best = a;
    if (frac <= 1e-15) {
      return q <= Q_RATIONAL_LIMIT ? Infinity : Math.max(best, 1 / HURWITZ_CONSTANT);
    }
    const inv = 1 / frac;
    const nextA = Math.floor(inv);
    frac = inv - nextA;
    const pNext = nextA * p + pPrev;
    const qNext = nextA * q + qPrev;
    if (!Number.isFinite(pNext) || !Number.isFinite(qNext) || qNext > Q_PRECISION_LIMIT) break;
    pPrev = p;
    qPrev = q;
    p = pNext;
    q = qNext;
  }

  // Never report better than the Hurwitz bound — A(x) ≥ √5 = 1/HURWITZ_CONSTANT
  // is a theorem, so a smaller measured value can only be truncation noise.
  return Math.max(best, 1 / HURWITZ_CONSTANT);
}

function gramConditioning(v: readonly number[] | Float64Array): number {
  const n = v.length;
  let nrm = 0;
  for (let i = 0; i < n; i++) nrm += v[i] * v[i];
  if (nrm <= 0) return 0;
  const invN = 1 / Math.sqrt(nrm);
  // Lag-1 circular autocorrelation: sum v[i]*v[i+1] for i in [0,n-2],
  // plus the wrap-around v[n-1]*v[0]. Unrolling the wrap removes the
  // per-iteration `%` modulo (a div on most JITs).
  let dot = 0;
  const last = n - 1;
  for (let i = 0; i < last; i++) dot += v[i] * v[i + 1];
  dot += v[last] * v[0];
  dot *= invN * invN;
  const c = dot < 0 ? -dot : dot;
  const lamMax = 1 + c,
    lamMin = 1 - c;
  return lamMax > 0 ? lamMin / lamMax : 0;
}

function phiAttractorEnergyFraction(modes: readonly number[] | Float64Array, k: number): number {
  const n = modes.length;
  if (n === 0 || k <= 0) return 0;
  // Single-pass: build energies into a Float64Array + accumulate total.
  const energies = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const e = modes[i] * modes[i];
    energies[i] = e;
    total += e;
  }
  if (total <= 0) return 0;
  const kc = k < n ? k : n;
  if (kc === n) return 1;

  // Quickselect for the (n-kc)th smallest = kc-th largest pivot, then
  // sum energies[i] >= pivot (with tie handling). O(N) expected vs
  // O(N log N) for a full sort.
  // Hoare-partition partial select on `energies` in place.
  let lo = 0,
    hi = n - 1;
  const target = n - kc; // index such that energies[target..n) are the kc largest
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const a = energies[lo],
      b = energies[mid],
      c = energies[hi];
    const pivot = a < b ? (b < c ? b : a < c ? c : a) : a < c ? a : b < c ? c : b;
    let i = lo,
      j = hi;
    while (i <= j) {
      while (energies[i] < pivot) i++;
      while (energies[j] > pivot) j--;
      if (i <= j) {
        if (i !== j) {
          const t = energies[i];
          energies[i] = energies[j];
          energies[j] = t;
        }
        i++;
        j--;
      }
    }
    if (target <= j) hi = j;
    else if (target >= i) lo = i;
    else break;
  }

  let topSum = 0;
  for (let i = target; i < n; i++) topSum += energies[i];
  return topSum / total;
}
