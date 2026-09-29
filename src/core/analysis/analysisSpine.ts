/**
 * AnalysisSpine — where the certified estimators finally meet live channels.
 *
 * P0–P8 built and certified the measurement stack; until something feeds it
 * real streams it is worth nothing. This module is that feed. It takes a
 * `StreamWindow`, pairs channels under the alignment rules, runs the Level-2
 * correlation family and the Level-3 directed causal scan on each pair, and
 * fuses the *bounded* members through the resonance bus.
 *
 * Design rules, all of them consequences of earlier findings:
 *
 *   • Only quantities that genuinely live in [0,1] enter the bus. HSIC and
 *     Granger F are unbounded, so they are reported but never fused; mutual
 *     information enters through its Gaussian-equivalent correlation
 *     √(1−e^(−2I)), which is a real bounded statistic, not a squash function.
 *   • Abstention propagates. A pair under the F9 floor produces a finding with
 *     `verdict: 'abstain'` and null everywhere — never a confident zero.
 *   • Nothing here is on the tick path: the family contains O(n²) members and
 *     the causal scan fits 2·maxLag regressions per direction. Callers run it
 *     on a slow cadence and are given a pair budget to bound the work.
 *   • Pair order is deterministic (sorted ids, i<j), so a budgeted run always
 *     analyses the same pairs in the same order.
 */

import {
  correlationReport,
  STAT_FLOOR,
  type CorrelationReport,
} from '@metatron/trnn-core/substrate/correlation';
import { directedReport, type DirectedReport } from '@metatron/trnn-core/substrate/causal';
import {
  fuseResonance,
  type BusChannel,
  type BusFusionReport,
} from '@metatron/trnn-core/substrate/resonanceBus';
import { dexp } from '@metatron/trnn-core/core/dmath';
import type { PairedSeries, StreamWindow } from './streamWindow';

export type AnalysisVerdict = 'report' | 'abstain';

/** Default maximum causal lag scanned in each direction. */
export const DEFAULT_MAX_LAG = 8;

/** Default number of pairs analysed per run. Keeps a slow cadence bounded. */
export const DEFAULT_PAIR_BUDGET = 21;

export interface PairFinding {
  readonly a: string;
  readonly b: string;
  /** Paired samples actually used. */
  readonly n: number;
  /** Driver samples that found no partner inside tolerance. */
  readonly unmatched: number;
  readonly toleranceMs: number;
  readonly verdict: AnalysisVerdict;
  /** Why the spine abstained, when it did. Always set for 'abstain'. */
  readonly reason?: string;
  /** Full Level-2 family, or null when the pair never reached the floor. */
  readonly correlation: CorrelationReport | null;
  /** Level-3 directed scan, or null when it was not run. */
  readonly causal: DirectedReport | null;
  /** Fused association strength in [0,1], or null when the bus abstained. */
  readonly association: number | null;
  /** The bus report behind `association`, for auditing the veto. */
  readonly bus: BusFusionReport | null;
  /**
   * Signed directionality in [−1,1]: +1 means a drives b. Null when either
   * direction abstained and no single direction survived.
   */
  readonly direction: number | null;
  readonly directionVerdict: DirectedReport['verdict'] | null;
}

export interface SpineOptions {
  /** Maximum causal lag per direction. */
  readonly maxLag?: number;
  /** Significance level handed to the lag scan (Bonferroni-corrected inside). */
  readonly alpha?: number;
  /** Maximum pairs analysed in one run. */
  readonly pairBudget?: number;
  /** Skip the Level-3 causal scan (cheap mode). */
  readonly skipCausal?: boolean;
  /** Explicit alignment tolerance in ms; default is derived per pair. */
  readonly toleranceMs?: number;
}

export interface SpineReport {
  readonly findings: readonly PairFinding[];
  /** Pairs that produced a measured association. */
  readonly reported: number;
  /** Pairs that abstained. */
  readonly abstained: number;
  /** Pairs left unanalysed because the budget ran out. */
  readonly skipped: number;
  /** Strongest measured association, or null when everything abstained. */
  readonly strongest: PairFinding | null;
}

/**
 * Gaussian-equivalent correlation from mutual information, |ρ| = √(1−e^(−2I)).
 * For a jointly Gaussian pair this is an identity, not a heuristic squash.
 */
export function miToCorrelation(mi: number): number {
  if (!Number.isFinite(mi) || mi < 0) return NaN;
  const v = 1 - dexp(-2 * mi);
  return v <= 0 ? 0 : v >= 1 ? 1 : Math.sqrt(v);
}

function bounded(id: string, value: number | null): BusChannel | null {
  if (value === null || !Number.isFinite(value)) return null;
  return { id, value: Math.abs(value) };
}

/** Analyses one already-paired series. Exposed so callers can supply pairs. */
export function analysePaired(
  a: string,
  b: string,
  pair: PairedSeries,
  opts: SpineOptions = {},
): PairFinding {
  const base = {
    a,
    b,
    n: pair.n,
    unmatched: pair.unmatched,
    toleranceMs: pair.toleranceMs,
  };
  if (pair.n < STAT_FLOOR) {
    return {
      ...base,
      verdict: 'abstain',
      reason: pair.reason ?? `n=${pair.n} < F9 floor ${STAT_FLOOR}`,
      correlation: null,
      causal: null,
      association: null,
      bus: null,
      direction: null,
      directionVerdict: null,
    };
  }

  const correlation = correlationReport(pair.a, pair.b);
  const causal = opts.skipCausal
    ? null
    : directedReport(pair.a, pair.b, {
        maxLag: opts.maxLag ?? DEFAULT_MAX_LAG,
        ...(opts.alpha === undefined ? {} : { alpha: opts.alpha }),
      });

  // Only bounded, [0,1]-valued statistics may enter the product. HSIC and the
  // Granger F are unbounded and stay out of the fusion by construction.
  const channels: BusChannel[] = [];
  for (const ch of [
    bounded('pearson', correlation.pearson.value),
    bounded('spearman', correlation.spearman.value),
    bounded('kendall', correlation.kendall.value),
    bounded('dcor', correlation.dcor.value),
    bounded('mi', correlation.mi.value === null ? null : miToCorrelation(correlation.mi.value)),
  ]) {
    if (ch) channels.push(ch);
  }

  const bus = fuseResonance(channels);
  const association = Number.isFinite(bus.value) ? bus.value : null;
  const verdict: AnalysisVerdict = association === null ? 'abstain' : 'report';

  return {
    ...base,
    verdict,
    ...(verdict === 'abstain' ? { reason: 'every bounded statistic abstained' } : {}),
    correlation,
    causal,
    association,
    bus,
    direction: causal?.netDirection ?? null,
    directionVerdict: causal?.verdict ?? null,
  };
}

/** Analyses one channel pair straight out of a window. */
export function analysePair(
  win: StreamWindow,
  a: string,
  b: string,
  opts: SpineOptions = {},
): PairFinding {
  return analysePaired(a, b, win.pair(a, b, opts.toleranceMs), opts);
}

/**
 * Analyses every unordered pair of channels, in deterministic order, up to the
 * pair budget. Pairs beyond the budget are counted as `skipped` rather than
 * silently dropped: an unanalysed pair is not an uncorrelated one.
 */
export function analyseWindow(win: StreamWindow, opts: SpineOptions = {}): SpineReport {
  const ids = win.ids();
  const budget = Math.max(0, Math.floor(opts.pairBudget ?? DEFAULT_PAIR_BUDGET));
  const findings: PairFinding[] = [];
  let skipped = 0;

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (findings.length >= budget) {
        skipped++;
        continue;
      }
      findings.push(analysePair(win, ids[i], ids[j], opts));
    }
  }

  let reported = 0;
  let strongest: PairFinding | null = null;
  for (const f of findings) {
    if (f.verdict !== 'report' || f.association === null) continue;
    reported++;
    if (
      strongest === null ||
      f.association > (strongest.association as number) ||
      // Deterministic tie-break so a replay picks the same winner.
      (f.association === strongest.association && `${f.a}|${f.b}` < `${strongest.a}|${strongest.b}`)
    ) {
      strongest = f;
    }
  }

  return {
    findings,
    reported,
    abstained: findings.length - reported,
    skipped,
    strongest,
  };
}
