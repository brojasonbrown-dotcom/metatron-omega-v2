/**
 * Consolidator — the background plane that turns experience into structure.
 *
 * Capture is cheap and indiscriminate by design; without a consolidation pass
 * the substrate grows monotonically and recall degrades to keyword lookup over
 * noise. This plane runs OFF the critical path and does three things:
 *
 *   1. PROTOTYPE  — cluster near-duplicate vectors and elect one exemplar, so
 *                   a fact repeated a hundred times occupies one slot with a
 *                   support count instead of a hundred competing hits.
 *   2. CONTRADICT — mark pairs that are lexically close but vectorially
 *                   opposed; contradictions are RECORDED, never resolved
 *                   silently. Recall surfaces both sides.
 *   3. PRUNE      — drop links whose weight has decayed below the Wolfram-
 *                   verified emergent floor. Nothing above the floor is ever
 *                   removed, so pruning cannot erase live structure.
 *
 * Every pass is budgeted (a fixed number of comparisons per invocation) so it
 * can be driven from an idle callback without ever stalling a frame.
 */

import { PHI_INV, EMERGENT_FLOOR, cosineDense } from './Resonance';
import { hopfieldBeta, hopfieldEnergy, hopfieldStep } from '@/core/gematria/resonanceKernel';

/**
 * ENERGY + SEPARATION ADMISSION GATE (modern Hopfield).
 *
 * Cosine says two vectors point the same way. It does not say the member is
 * unambiguously in THIS prototype's retrieval basin rather than a neighbour's.
 * `hopfieldEnergy` / `hopfieldStep` sat in the kernel with zero callers, so
 * basin membership was asserted and never measured.
 *
 *     E(x) = −logsumexp(β·Xx)/β + ½⟨x,x⟩,      β = φ/√d
 *
 * Two facts govern the gate, and only the second is informative:
 *
 *   • With a single stored pattern the retrieval step provably cannot raise E
 *     on the unit sphere (ΔE = cos − 1 ≤ 0), so an isolated energy check is
 *     VACUOUS. An earlier version of this gate tested exactly that and, on
 *     un-normalised inputs, ended up rejecting on vector norm — measuring the
 *     wrong quantity. It is fixed here: energies are computed on unit vectors
 *     and the energy term is retained only as a finiteness/monotonicity guard.
 *   • The informative condition is Ramsauer's SEPARATION requirement: one
 *     retrieval step from the member, taken against the FULL set of live
 *     prototypes, must land nearest to the prototype we are merging into. If
 *     another prototype claims the retrieved point, the member is ambiguous
 *     and merging it would make both memories harder to reach.
 *
 * At d = 256, β = 0.10112712429686842801.
 */
export interface MergeVerdict {
  readonly admitted: boolean;
  /** E(retrieved) − E(member), both on the unit sphere. Must be ≤ 0. */
  readonly deltaE: number;
  /** ⟨retrieved, prototype⟩ − max over competing prototypes. Must be ≥ 0. */
  readonly margin: number;
  readonly beta: number;
}

function unit(v: Float64Array): Float64Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (!(n > 0)) return new Float64Array(v.length);
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function mergeAdmissible(
  prototype: Float64Array,
  member: Float64Array,
  competitors: ReadonlyArray<Float64Array> = [],
  beta = hopfieldBeta(member.length),
): MergeVerdict {
  const p = unit(prototype);
  const m = unit(member);
  const basis = [p, ...competitors.map(unit)];
  const retrieved = hopfieldStep(basis, m, beta);
  const deltaE = hopfieldEnergy(basis, retrieved, beta) - hopfieldEnergy(basis, m, beta);
  let rival = -Infinity;
  for (let k = 1; k < basis.length; k++) rival = Math.max(rival, dot(retrieved, basis[k]));
  const margin = basis.length > 1 ? dot(retrieved, p) - rival : Number.POSITIVE_INFINITY;
  const admitted = Number.isFinite(deltaE) && deltaE <= 1e-12 && margin >= 0;
  return { admitted, deltaE, margin, beta };
}

/** Cosine at or above this counts as the same thing said twice. */
export const PROTOTYPE_COS = 1 - PHI_INV * PHI_INV * PHI_INV; // ≈ 0.7639

/** Lexically overlapping but vectorially opposed ⇒ a contradiction candidate. */
export const CONTRADICTION_COS = -PHI_INV * PHI_INV; // ≈ -0.382

export interface ConsolidationItem {
  readonly id: string;
  readonly vec: Float64Array;
  /** term set used for the lexical-overlap precondition on contradictions */
  readonly terms?: ReadonlySet<string>;
}

export interface Cluster {
  readonly prototypeId: string;
  readonly memberIds: readonly string[];
  /** number of independent captures backing the prototype */
  readonly support: number;
  /** mean intra-cluster cosine — how tight the agreement is */
  readonly tightness: number;
}

export interface Contradiction {
  readonly a: string;
  readonly b: string;
  readonly cosine: number;
  readonly overlap: number;
}

export interface ConsolidationReport {
  readonly clusters: readonly Cluster[];
  readonly contradictions: readonly Contradiction[];
  readonly compared: number;
  readonly budgetExhausted: boolean;
  /** ids whose only role was duplicating a prototype */
  readonly redundantIds: readonly string[];
  /**
   * Merges the cosine accepted but the Hopfield energy refused (ΔE > 0), with
   * the number that failed. These stay as independent items: a merge that
   * raises retrieval energy would make both memories harder to reach.
   */
  readonly energyRejected: ReadonlyArray<{
    prototypeId: string;
    memberId: string;
    deltaE: number;
    margin: number;
  }>;
}

function jaccard(a?: ReadonlySet<string>, b?: ReadonlySet<string>): number {
  if (!a || !b || a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Single consolidation pass over `items`, capped at `budget` comparisons.
 * Deterministic: items are processed in the order given, ties by id.
 */
export function consolidate(
  items: readonly ConsolidationItem[],
  budget = 20000,
): ConsolidationReport {
  const clusters: Cluster[] = [];
  const contradictions: Contradiction[] = [];
  const redundantIds: string[] = [];
  const energyRejected: Array<{
    prototypeId: string;
    memberId: string;
    deltaE: number;
    margin: number;
  }> = [];
  const assigned = new Set<string>();
  let compared = 0;
  let exhausted = false;

  const ordered = [...items].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const byId = new Map(ordered.map((it) => [it.id, it.vec]));

  for (const seed of ordered) {
    if (assigned.has(seed.id)) continue;
    const members: string[] = [seed.id];
    let cosSum = 0;
    assigned.add(seed.id);

    for (const other of ordered) {
      if (other.id === seed.id || assigned.has(other.id)) continue;
      if (compared >= budget) {
        exhausted = true;
        break;
      }
      compared++;
      const cos = cosineDense(seed.vec, other.vec);
      if (!Number.isFinite(cos)) continue;

      if (cos >= PROTOTYPE_COS) {
        // Cosine says "same direction"; the energy gate says "same basin".
        // Both must hold, or the two stay separate memories.
        // Competitors = the prototypes already elected in this pass. The member
        // must retrieve to THIS seed, not to one of them.
        const competitors: Float64Array[] = [];
        for (const c of clusters) {
          const cv = byId.get(c.prototypeId);
          if (cv && c.prototypeId !== seed.id) competitors.push(cv);
        }
        const verdict = mergeAdmissible(seed.vec, other.vec, competitors);
        if (!verdict.admitted) {
          energyRejected.push({
            prototypeId: seed.id,
            memberId: other.id,
            deltaE: verdict.deltaE,
            margin: verdict.margin,
          });
          continue;
        }
        members.push(other.id);
        redundantIds.push(other.id);
        cosSum += cos;
        assigned.add(other.id);
      } else if (cos <= CONTRADICTION_COS) {
        // Opposition only MEANS something when the two are talking about the
        // same subject — otherwise unrelated topics look like disagreements.
        const overlap = jaccard(seed.terms, other.terms);
        if (overlap >= PHI_INV * PHI_INV) {
          contradictions.push({ a: seed.id, b: other.id, cosine: cos, overlap });
        }
      }
    }

    clusters.push({
      prototypeId: seed.id,
      memberIds: members,
      support: members.length,
      tightness: members.length > 1 ? cosSum / (members.length - 1) : 1,
    });

    if (exhausted) break;
  }

  return {
    clusters,
    contradictions,
    compared,
    budgetExhausted: exhausted,
    redundantIds,
    energyRejected,
  };
}

/**
 * Weights at or below the emergent floor carry no structure and are pruned.
 * Returns the keys to drop — the caller owns the mutation.
 */
export function prunableKeys(
  weights: ReadonlyMap<string, number>,
  floor = EMERGENT_FLOOR,
): string[] {
  const out: string[] = [];
  for (const [k, w] of weights) if (!Number.isFinite(w) || Math.abs(w) <= floor) out.push(k);
  return out.sort();
}
