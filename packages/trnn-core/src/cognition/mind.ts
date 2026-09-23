/**
 * Ω-P7 — the mind: one object that turns a stream of engine observations into
 * concepts, predictions and thoughts, and keeps an honest score of both.
 *
 * Per fold the mind does exactly four things, in this order:
 *
 *   1. recognise — kNN the observation against the concept store (HNSW+PQ)
 *   2. predict   — ask the self-model for the next observation, score the
 *                  prediction it made last fold (surprise)
 *   3. gate      — store the observation as a new concept only if it is novel;
 *                  a familiar observation refreshes the concept it matched
 *   4. record    — emit one Thought, the auditable unit of cognition
 *
 * Novelty and surprise are orthogonal and both are kept: novelty asks "have I
 * seen this shape before", surprise asks "did I expect it now". A high-novelty
 * low-surprise event is a new region of a trajectory the model already tracks;
 * low-novelty high-surprise is a familiar shape arriving at the wrong time —
 * exactly the signal a self-model should be judged on.
 */

import { phiPow } from '../core/constants';
import { ConceptStore, type ConceptRecord, type ConceptStats } from './concepts';
import { SelfModel, type SelfModelReport } from './selfModel';

/** [DEFINED] cosine distance above which an observation earns a new concept. */
export const NOVELTY_THRESHOLD = phiPow(-3);

export interface Thought {
  readonly tick: number;
  /** 1 − cosine to the nearest concept; 1 when the store is empty. */
  readonly novelty: number;
  /**
   * Bounded prediction error e/(e + ‖y‖) ∈ [0, 1): scale-free, and finite even
   * when the observation itself is near zero (where a plain relative error
   * divides by nothing and reports nonsense).
   */
  readonly surprise: number;
  /** Concept the observation matched or created. */
  readonly conceptKey: string | null;
  readonly conceptId: number;
  readonly action: 'seed' | 'store' | 'recognise';
  /** Predictor in force when this thought was formed. */
  readonly source: 'ssm' | 'rls';
  /** Exact distance computations the search spent. */
  readonly exactOps: number;
}

export interface MindReport {
  readonly thoughts: number;
  readonly meanNovelty: number;
  readonly meanSurprise: number;
  readonly noveltyThreshold: number;
  readonly concepts: ConceptStats;
  readonly selfModel: SelfModelReport;
  readonly recent: readonly Thought[];
  readonly top: readonly ConceptRecord[];
}

export interface MindOptions {
  readonly dim: number;
  readonly capacity?: number;
  readonly seed?: string;
  readonly M?: number;
  readonly efSearch?: number;
  readonly sub?: number;
  readonly centroids?: number;
  readonly window?: number;
  readonly noveltyThreshold?: number;
}

export class Mind {
  readonly store: ConceptStore;
  readonly self: SelfModel;
  readonly dim: number;
  readonly noveltyThreshold: number;

  private readonly predicted: Float64Array;
  private readonly obs: Float64Array;
  private havePrediction = false;
  private readonly log: Thought[] = [];
  private noveltySum = 0;
  private surpriseSum = 0;
  private count = 0;

  constructor(opts: MindOptions) {
    this.dim = Math.max(1, Math.floor(opts.dim));
    this.noveltyThreshold = opts.noveltyThreshold ?? NOVELTY_THRESHOLD;
    this.store = new ConceptStore({
      dim: this.dim,
      capacity: opts.capacity ?? 610,
      M: opts.M ?? 16,
      efSearch: opts.efSearch ?? 32,
      seed: opts.seed ?? 'omega-mind',
      sub: opts.sub ?? 8,
      centroids: opts.centroids ?? 16,
    });
    this.self = new SelfModel(this.dim, opts.window ?? 144);
    this.predicted = new Float64Array(this.dim);
    this.obs = new Float64Array(this.dim);
  }

  /** One cognitive fold. `vec` is the engine's observation for this tick. */
  observe(vec: ArrayLike<number>, tick: number, key?: string): Thought {
    for (let i = 0; i < this.dim; i++) {
      const v = i < vec.length ? vec[i] : 0;
      this.obs[i] = Number.isFinite(v) ? v : 0;
    }

    // 1 — recognise
    const trace = this.store.search(this.obs, 3);
    const best = trace.hits[0];
    const novelty = best ? Math.max(0, 1 - best.score) : 1;

    // 2 — surprise against the prediction standing for this tick
    let surprise = 0;
    if (this.havePrediction) {
      let num = 0;
      let den = 0;
      for (let i = 0; i < this.dim; i++) {
        const d = this.predicted[i] - this.obs[i];
        num += d * d;
        den += this.obs[i] * this.obs[i];
      }
      const e = Math.sqrt(num);
      const y = Math.sqrt(den);
      // Bounded, never divides by a vanishing observation.
      surprise = Number.isFinite(e) && Number.isFinite(y) && e > 0 ? e / (e + y) : 0;
    }
    const next = this.self.observe(this.obs, tick);
    this.predicted.set(next);
    this.havePrediction = true;

    // 3 — novelty gate
    let action: Thought['action'];
    let conceptId: number;
    let conceptKey: string | null;
    if (!best) {
      conceptKey = key ?? `c${tick}`;
      conceptId = this.store.add(conceptKey, this.obs, tick);
      action = 'seed';
    } else if (novelty >= this.noveltyThreshold) {
      conceptKey = key ?? `c${tick}`;
      conceptId = this.store.add(conceptKey, this.obs, tick);
      action = 'store';
    } else {
      // familiar: refresh the matched concept's recency without adding a slot
      conceptKey = best.key;
      conceptId = best.id;
      this.store.add(best.key, this.obs, tick);
      action = 'recognise';
    }

    // 4 — record
    const t: Thought = {
      tick,
      novelty,
      surprise,
      conceptKey,
      conceptId,
      action,
      source: this.self.enabled ? 'ssm' : 'rls',
      exactOps: trace.exactOps,
    };
    this.log.push(t);
    if (this.log.length > 55) this.log.shift();
    this.noveltySum += novelty;
    this.surpriseSum += surprise;
    this.count++;
    return t;
  }

  /** Nearest concepts to an arbitrary probe — the read side of semantic memory. */
  recall(vec: ArrayLike<number>, k = 5) {
    return this.store.search(vec, k);
  }

  report(): MindReport {
    const records = this.store.records();
    const top = records.slice().sort((a, b) => b.hits - a.hits || b.tick - a.tick).slice(0, 13);
    return {
      thoughts: this.count,
      meanNovelty: this.count ? this.noveltySum / this.count : 0,
      meanSurprise: this.count ? this.surpriseSum / this.count : 0,
      noveltyThreshold: this.noveltyThreshold,
      concepts: this.store.stats(),
      selfModel: this.self.report(),
      recent: this.log.slice(-13),
      top,
    };
  }
}
