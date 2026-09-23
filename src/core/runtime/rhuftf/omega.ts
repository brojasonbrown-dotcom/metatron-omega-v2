/**
 * Ω fusion — principle ② "fuse with a geometric, not arithmetic, mean".
 *
 *     Ω = exp( Σ w_i · ln(clamp(m_i, ε, 1)) / Σ w_i ),   w_i = φ^(−rank_i)
 *
 * Log-domain domination is the design intent: one dead rung vetoes the whole
 * score. Distant scales still count, but exponentially less.
 *
 * A metric that cannot be measured this tick reports NaN and ABSTAINS — it is
 * removed from both numerator and denominator. An unmeasurable rung must not
 * be scored as a failure, and must not be scored as a pass either; the number
 * of abstentions is surfaced next to Ω.
 *
 * Pure. No allocation on the hot path beyond the result array.
 */

import { PHI } from '@metatron/field-kernel-core';

export const OMEGA_EPS = 1e-6;

export interface OmegaMetricInput {
  readonly id: string;
  readonly label: string;
  /** φ^(−rank) weight exponent. rank 0 = base scale, larger = more distant. */
  readonly rank: number;
  /** Raw metric value in [0,1]; NaN = abstain. */
  readonly value: number;
  /** Optional φ-conjugate dual value (principle ③). NaN when absent. */
  readonly dual?: number;
}

export interface OmegaTerm {
  readonly id: string;
  readonly label: string;
  readonly rank: number;
  readonly weight: number;
  readonly value: number;
  readonly dual: number;
  /** w·ln(clamped value); the most negative term is the veto. */
  readonly logTerm: number;
  readonly abstain: boolean;
}

export interface OmegaReport {
  readonly omega: number;
  readonly terms: readonly OmegaTerm[];
  readonly abstained: number;
  readonly counted: number;
  /** id of the metric contributing the most negative log term. */
  readonly vetoId: string | null;
  readonly vetoLabel: string | null;
  readonly vetoValue: number;
  /** Arithmetic mean of the same metrics — shown only to expose the gap. */
  readonly arithmeticMean: number;
}

const LN_PHI = Math.log(PHI);

export function phiWeight(rank: number): number {
  return Math.exp(-rank * LN_PHI);
}

interface NAcc { s: number; c: number; }
function nAcc(): NAcc { return { s: 0, c: 0 }; }
function nAdd(a: NAcc, x: number): void {
  if (!Number.isFinite(x)) return;
  const s = a.s;
  const t = s + x;
  a.c += Math.abs(s) >= Math.abs(x) ? (s - t) + x : (x - t) + s;
  a.s = t;
}
function nVal(a: NAcc): number { return a.s + a.c; }

export function fuseOmega(inputs: readonly OmegaMetricInput[]): OmegaReport {
  const terms: OmegaTerm[] = [];
  const num = nAcc();
  const den = nAcc();
  const arith = nAcc();
  let counted = 0;
  let abstained = 0;
  let vetoId: string | null = null;
  let vetoLabel: string | null = null;
  let vetoValue = NaN;
  let worst = Infinity;

  for (const m of inputs) {
    const w = phiWeight(m.rank);
    const abstain = !Number.isFinite(m.value);
    if (abstain) {
      abstained++;
      terms.push({
        id: m.id, label: m.label, rank: m.rank, weight: w,
        value: NaN, dual: m.dual ?? NaN, logTerm: NaN, abstain: true,
      });
      continue;
    }
    const v = Math.min(1, Math.max(OMEGA_EPS, m.value));
    const logTerm = w * Math.log(v);
    nAdd(num, logTerm);
    nAdd(den, w);
    nAdd(arith, m.value);
    counted++;
    if (logTerm < worst) {
      worst = logTerm; vetoId = m.id; vetoLabel = m.label; vetoValue = m.value;
    }
    terms.push({
      id: m.id, label: m.label, rank: m.rank, weight: w,
      value: m.value, dual: m.dual ?? NaN, logTerm, abstain: false,
    });
  }

  const d = nVal(den);
  return {
    omega: counted > 0 && d > 0 ? Math.exp(nVal(num) / d) : NaN,
    terms,
    abstained,
    counted,
    vetoId,
    vetoLabel,
    vetoValue,
    arithmeticMean: counted > 0 ? nVal(arith) / counted : NaN,
  };
}
