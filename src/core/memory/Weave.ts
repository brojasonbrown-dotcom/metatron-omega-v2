/**
 * Weave — reconstruct a MOMENT, not a list of rows.
 *
 * Every memory layer stores a different projection of the same instant: the
 * corpus holds what was read, the journal what was said, the episodic store
 * what the field looked like, the percept registry what was recognised. Query
 * them separately and you get four disconnected lists; the moment itself is
 * never returned.
 *
 * Weave groups strands into moments by TEMPORAL PROXIMITY on a φ-graded
 * window, scores each moment as a coherence-gated geometric mean over the
 * strands it contains, and returns the moments — with their strands attached
 * as evidence.
 *
 * Pure and deterministic: identical strand input ⇒ identical weave.
 */

import { PHI, PHI_INV, ageBand, RESONANCE_FLOOR } from './Resonance';
import { fibonacciBandedSelect } from './Banding';

export type StrandKind = 'corpus' | 'journal' | 'episode' | 'percept' | 'vision';

export interface Strand {
  readonly id: string;
  readonly kind: StrandKind;
  /** capture time (ms) */
  readonly t: number;
  /** relevance of this strand to the query, [0,1] */
  readonly score: number;
  /** short human-readable evidence line */
  readonly text: string;
  /** ladder rung at capture, -1 when untagged */
  readonly rung?: number;
}

export interface Moment {
  readonly id: string;
  /** earliest and latest strand times in the moment */
  readonly from: number;
  readonly to: number;
  readonly strands: readonly Strand[];
  /** distinct modalities present — the breadth of the reconstruction */
  readonly kinds: readonly StrandKind[];
  /** geometric mean of strand scores, lifted by cross-modal agreement */
  readonly coherence: number;
  /** final ranking score */
  readonly score: number;
  readonly band: number;
}

/**
 * Grouping window in ms. Strands within φ seconds of each other belong to the
 * same moment; the window widens by φ per age band so distant memories, whose
 * timestamps are coarser, still weave instead of shattering into singletons.
 */
export const WEAVE_WINDOW_MS = Math.round(PHI * 1000);

export function weaveWindowFor(band: number): number {
  return WEAVE_WINDOW_MS * Math.pow(PHI, Math.max(0, band));
}

function geoMean(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let logSum = 0;
  for (const v of values) {
    if (!Number.isFinite(v) || v <= 0) return 0;   // a dead strand vetoes
    logSum += Math.log(v);
  }
  return Math.exp(logSum / values.length);
}

export interface WeaveOptions {
  readonly now?: number;
  /** how many moments to return */
  readonly topN?: number;
  /** drop moments below the emergent floor (default true) */
  readonly floor?: boolean;
}

/** Group strands into coherent moments and rank them. */
export function weave(strands: readonly Strand[], opts: WeaveOptions = {}): Moment[] {
  const now = opts.now ?? Date.now();
  const topN = opts.topN ?? 8;
  if (strands.length === 0) return [];

  const sorted = [...strands].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  const groups: Strand[][] = [];
  let current: Strand[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    const prev = current[current.length - 1];
    const window = weaveWindowFor(ageBand(prev.t, now));
    if (s.t - prev.t <= window) current.push(s);
    else { groups.push(current); current = [s]; }
  }
  groups.push(current);

  const moments: Moment[] = groups.map((g) => {
    const kinds = [...new Set(g.map((s) => s.kind))].sort();
    const base = geoMean(g.map((s) => s.score));
    // Cross-modal agreement is real evidence: each ADDITIONAL modality lifts
    // the moment by one φ-step toward 1, capped at 1. A single-strand moment
    // gets no lift at all, so breadth is earned rather than assumed.
    const lift = 1 - Math.pow(PHI_INV, kinds.length - 1);
    const coherence = Math.min(1, base + (1 - base) * lift);
    const from = g[0].t;
    const to = g[g.length - 1].t;
    const band = ageBand(to, now);
    return {
      id: `m:${from}:${g[0].id}`,
      from, to,
      strands: g,
      kinds,
      coherence,
      score: coherence,
      band,
    };
  });

  const kept = opts.floor === false
    ? moments
    : moments.filter((m) => m.score >= RESONANCE_FLOOR);

  return fibonacciBandedSelect(
    kept.map((m) => ({ band: m.band, score: m.score, id: m.id, moment: m })),
    topN,
  ).map((b) => b.moment);
}
