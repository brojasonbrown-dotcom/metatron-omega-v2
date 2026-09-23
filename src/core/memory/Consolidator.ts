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
 * ENERGY ADMISSION GATE (modern Hopfield).
 *
 * Cosine alone says two vectors point the same way; it does not say the member
 * actually lies in the prototype's retrieval basin. `hopfieldEnergy` and
 * `hopfieldStep` existed in the kernel with zero callers, so coherence was
 * asserted and never measured. The theorem (Ramsauer et al. 2020, Certificate
 * 2.4) is that one retrieval step never raises
 *
 *     E(x) = −logsumexp(β·Xx)/β + ½⟨x,x⟩,      β = φ/√d
 *
 * so ΔE > 0 for a candidate merge is proof the member is NOT in the basin, and
 * the merge is refused with the number that failed. At d = 256,
 * β = 0.10112712429686842801.
 */
export interface MergeVerdict {
  readonly admitted: boolean;
  /** E(retrieved) − E(member). Admission requires ΔE ≤ 0. */
  readonly deltaE: number;
  readonly beta: number;
}

export function mergeAdmissible(
  prototype: Float64Array,
  member: Float64Array,
  beta = hopfieldBeta(member.length),
): MergeVerdict {
  const basis = [prototype];
  const before = hopfieldEnergy(basis, member, beta);
  const after = hopfieldEnergy(basis, hopfieldStep(basis, member, beta), beta);
  const deltaE = after - before;
  return { admitted: Number.isFinite(deltaE) && deltaE <= 0, deltaE, beta };
}

/** Cosine at or above this counts as the same thing said twice. */
export const PROTOTYPE_COS = 1 - PHI_INV * PHI_INV * PHI_INV;   // ≈ 0.7639

/** Lexically overlapping but vectorially opposed ⇒ a contradiction candidate. */
export const CONTRADICTION_COS = -PHI_INV * PHI_INV;            // ≈ -0.382

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
  readonly energyRejected: ReadonlyArray<{ prototypeId: string; memberId: string; deltaE: number }>;
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
  const energyRejected: Array<{ prototypeId: string; memberId: string; deltaE: number }> = [];
  const assigned = new Set<string>();
  let compared = 0;
  let exhausted = false;

  const ordered = [...items].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  for (const seed of ordered) {
    if (assigned.has(seed.id)) continue;
    const members: string[] = [seed.id];
    let cosSum = 0;
    assigned.add(seed.id);

    for (const other of ordered) {
      if (other.id === seed.id || assigned.has(other.id)) continue;
      if (compared >= budget) { exhausted = true; break; }
      compared++;
      const cos = cosineDense(seed.vec, other.vec);
      if (!Number.isFinite(cos)) continue;

      if (cos >= PROTOTYPE_COS) {
        // Cosine says "same direction"; the energy gate says "same basin".
        // Both must hold, or the two stay separate memories.
        const verdict = mergeAdmissible(seed.vec, other.vec);
        if (!verdict.admitted) {
          energyRejected.push({ prototypeId: seed.id, memberId: other.id, deltaE: verdict.deltaE });
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

  return { clusters, contradictions, compared, budgetExhausted: exhausted, redundantIds, energyRejected };
}

/**
 * Weights at or below the emergent floor carry no structure and are pruned.
 * Returns the keys to drop — the caller owns the mutation.
 */
export function prunableKeys(weights: ReadonlyMap<string, number>, floor = EMERGENT_FLOOR): string[] {
  const out: string[] = [];
  for (const [k, w] of weights) if (!Number.isFinite(w) || Math.abs(w) <= floor) out.push(k);
  return out.sort();
}
