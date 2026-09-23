/**
 * Ω-READY R7 — the host recall scorer, mirrored.
 *
 * The host ranks facts with a deterministic weighted scorer
 * (`src/brain/ontology.ts` SCORE_WEIGHTS): keyword β, validity γ, recency δ,
 * importance α, plus an ADDITIVE resonance bonus ε and a cluster prior ζ, with a
 * pinned multiplier and a recency floor. Ω supplies the resonance term from the
 * field, so if Ω computed the total differently the ranking a user sees would
 * depend on which side computed it.
 *
 * Two invariants are load-bearing and tested:
 *   • Zero regression — with no resonance supplied, the score is exactly the
 *     host's pre-resonance score. The bonus is additive, never a re-weighting.
 *   • Recency floor — a fact ever recorded stays reachable: its recency term can
 *     never fall below RECENCY_FLOOR, however old it is.
 */

export const RECENCY_FLOOR = 0.05;

export const SCORE_WEIGHTS = {
  keyword: 0.40,        // β
  validity: 0.30,       // γ
  recency: 0.15,        // δ
  importance: 0.15,     // α
  resonance: 0.50,      // ε — additive bonus, only when provided
  cluster_prior: 0.25,  // ζ
} as const;

export const PINNED_MULTIPLIER = 4;

export interface RecallTerms {
  /** [0,1] lexical match. */
  readonly keyword: number;
  /** [0,1] validation state. */
  readonly validity: number;
  /** [0,1] raw recency, before the floor. */
  readonly recency: number;
  /** [0,1] curated importance. */
  readonly importance: number;
  /** [-1,1] field-signature cosine. Omit when the field did not answer. */
  readonly resonance?: number;
  /** [-1,1] learned centroid cosine. Omit when no centroid exists yet. */
  readonly clusterPrior?: number;
  readonly pinned?: boolean;
}

function u(x: number, lo: number, hi: number, name: string): number {
  if (!Number.isFinite(x)) throw new RangeError(`recall: ${name} is not finite`);
  if (x < lo || x > hi) throw new RangeError(`recall: ${name} must lie in [${lo},${hi}], got ${x}`);
  return x;
}

/** Recency with the host's floor applied. */
export function flooredRecency(recency: number): number {
  return Math.max(RECENCY_FLOOR, u(recency, 0, 1, 'recency'));
}

/** The host's base score, before any Ω contribution. */
export function baseScore(t: RecallTerms): number {
  const s =
    SCORE_WEIGHTS.keyword * u(t.keyword, 0, 1, 'keyword') +
    SCORE_WEIGHTS.validity * u(t.validity, 0, 1, 'validity') +
    SCORE_WEIGHTS.recency * flooredRecency(t.recency) +
    SCORE_WEIGHTS.importance * u(t.importance, 0, 1, 'importance');
  return t.pinned ? s * PINNED_MULTIPLIER : s;
}

/** Full score: base plus the additive resonance and cluster-prior bonuses. */
export function recallScore(t: RecallTerms): number {
  let s = baseScore(t);
  if (t.resonance !== undefined) s += SCORE_WEIGHTS.resonance * u(t.resonance, -1, 1, 'resonance');
  if (t.clusterPrior !== undefined) {
    s += SCORE_WEIGHTS.cluster_prior * u(t.clusterPrior, -1, 1, 'clusterPrior');
  }
  return s;
}

/**
 * Rank candidates. Ties break on a stable key so two runs over the same data
 * produce the same order — a ranking that reshuffles on equal scores is not
 * reproducible evidence.
 */
export function rank<T extends { readonly key: string; readonly terms: RecallTerms }>(
  candidates: readonly T[],
): readonly (T & { score: number })[] {
  return candidates
    .map((c) => ({ ...c, score: recallScore(c.terms) }))
    .sort((a, b) => (b.score - a.score) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
