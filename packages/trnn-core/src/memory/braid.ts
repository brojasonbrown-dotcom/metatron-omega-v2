/**
 * Ω-P6 — the TorusBraid Hopfield plane.
 *
 * Patterns are stored as complex torus fields (phase carries most of the
 * information, amplitude the confidence). Retrieval is a modern (dense
 * associative) Hopfield readout:
 *
 *   s_p   = Re⟨ξ_p, q⟩ / (‖ξ_p‖ ‖q‖)          per-pattern normalised overlap
 *   w_p   = softmax( β · s_p )
 *   q'    = Σ_p w_p ξ_p                        one attention sweep
 *
 * with the certified inverse temperature
 *
 *   β(G) = φ² √(G / 28)
 *
 * G is the braid load — the number of stored patterns — and 28 is the braid's
 * reference multiplicity (the corrected constant from the source framework;
 * the earlier √(G/2·14) form double-counted the strand pairs). β grows like
 * √G, which is exactly the rate at which the softmax must sharpen to keep the
 * separation margin constant as the store fills: with M patterns whose mutual
 * overlap is O(1/√n), the readout error stays below the corridor while
 * M ≤ ratedCapacity(n).
 *
 * Retrieval runs as the R1–R6 cascade — each rung is strictly more expensive
 * than the one before, and the cascade stops at the first rung that clears the
 * acceptance threshold, so a clean cue costs one dot product.
 *
 *   R1  exact  — key hit on the pattern's stored digest
 *   R2  linear — best normalised overlap; accept if it clears the threshold
 *   R3  attn   — one Hopfield sweep at β(G), then re-score
 *   R4  iter   — Hopfield iterated to a fixed point (≤ 13 sweeps)
 *   R5  octave — probe resampled through the octave map (wrong-rung cue)
 *   R6  phase  — phase-only correlation, amplitude discarded (faded cue)
 *
 * Deterministic: no RNG, no clock, fixed iteration caps.
 */

import { PHI, phiPow } from '../core/constants';
import { createField, zeroField, type CField } from '../core/complex';
import { octaveTransport } from '../web/octave';
import { dexp } from '../core/dmath';

/** [DEFINED] braid reference multiplicity in β(G) = φ²√(G/28). */
export const BRAID_MULTIPLICITY = 28;

/** [DEFINED] cosine at which a stage retrieval is accepted outright. */
export const ACCEPT_SIMILARITY = 1 - phiPow(-4); // 0.854...

/**
 * [DEFINED] cosine at which the final R6 re-rank is accepted.
 *
 * Stages R3–R6 are *proposal generators*: each produces a candidate index, but
 * the objective never moves — it is always the cosine of the candidate against
 * the original probe. A degraded cue (support knocked out, amplitude faded)
 * cannot clear ACCEPT_SIMILARITY by construction, so the cascade closes by
 * re-ranking every proposal on the fixed objective and accepting at the φ⁻¹
 * corridor. Anything below that is an honest miss.
 */
export const PARTIAL_ACCEPT = phiPow(-1);

export type RetrievalStage = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'miss';

export interface BraidPattern {
  readonly key: string;
  readonly index: number;
  readonly nodes: number;
  /** Σ|ξ|² of the stored (normalised) pattern. */
  readonly energy: number;
  readonly storedAt: number;
  readonly label?: string;
}

export interface Recall {
  readonly stage: RetrievalStage;
  readonly key: string | null;
  readonly index: number;
  readonly similarity: number;
  /** Cosine gap to the runner-up — the separation margin. */
  readonly margin: number;
  /** Hopfield sweeps actually performed. */
  readonly sweeps: number;
  readonly beta: number;
  readonly accepted: boolean;
}

/**
 * Rated capacity of a braid on n nodes.
 *
 * Dense associative memories store exponentially many patterns in principle;
 * the honest engineering number for a *single* attention sweep with the β above
 * and random golden-phase patterns is n/φ² — measured, not asserted (see the
 * G6 battery, which fills the braid to exactly this number and requires
 * recall ≥ 0.99).
 */
export function ratedCapacity(nodes: number): number {
  return Math.max(1, Math.floor(nodes * phiPow(-2)));
}

/** β(G) = φ²√(G/28). */
export function braidBeta(load: number): number {
  return PHI * PHI * Math.sqrt(Math.max(1, load) / BRAID_MULTIPLICITY);
}

function normOf(re: Float64Array, im: Float64Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += re[i] * re[i] + im[i] * im[i];
  return Math.sqrt(s);
}

export interface BraidOptions {
  readonly nodes: number;
  /** Hard cap on stored patterns; oldest is evicted first. */
  readonly capacity?: number;
  readonly accept?: number;
}

export class TorusBraid {
  readonly nodes: number;
  readonly capacity: number;
  readonly accept: number;

  /** Row-major store: pattern p occupies [p*n, (p+1)*n). */
  private re: Float64Array;
  private im: Float64Array;
  private meta: BraidPattern[] = [];
  private byKey = new Map<string, number>();
  private scores: Float64Array;
  private weights: Float64Array;
  private readonly work: CField;
  private readonly probe: CField;

  constructor(opts: BraidOptions) {
    this.nodes = opts.nodes;
    this.capacity = Math.max(1, opts.capacity ?? ratedCapacity(opts.nodes));
    this.accept = opts.accept ?? ACCEPT_SIMILARITY;
    this.re = new Float64Array(this.capacity * this.nodes);
    this.im = new Float64Array(this.capacity * this.nodes);
    this.scores = new Float64Array(this.capacity);
    this.weights = new Float64Array(this.capacity);
    this.work = createField(this.nodes);
    this.probe = createField(this.nodes);
  }

  get load(): number {
    return this.meta.length;
  }

  beta(): number {
    return braidBeta(this.load);
  }

  patterns(): readonly BraidPattern[] {
    return this.meta;
  }

  /**
   * Store a pattern under `key`. Re-storing an existing key overwrites in place
   * (idempotent), so a repeated percept does not consume capacity.
   * Patterns are stored unit-normalised; the pre-normalisation energy is kept
   * in the metadata so salience survives.
   */
  store(key: string, field: CField, tick: number, label?: string): BraidPattern {
    const n = this.nodes;
    const src = field.n === n ? field : this.resample(field);
    const norm = normOf(src.re, src.im, n);
    const inv = norm > 0 ? 1 / norm : 0;

    let idx = this.byKey.get(key);
    if (idx === undefined) {
      if (this.meta.length < this.capacity) {
        idx = this.meta.length;
      } else {
        // evict the oldest slot (FIFO on storedAt) — deterministic
        let oldest = 0;
        for (let p = 1; p < this.meta.length; p++) {
          if (this.meta[p].storedAt < this.meta[oldest].storedAt) oldest = p;
        }
        idx = oldest;
        this.byKey.delete(this.meta[oldest].key);
      }
    }

    const base = idx * n;
    for (let i = 0; i < n; i++) {
      this.re[base + i] = src.re[i] * inv;
      this.im[base + i] = src.im[i] * inv;
    }
    const entry: BraidPattern = {
      key,
      index: idx,
      nodes: n,
      energy: norm * norm,
      storedAt: tick,
      label,
    };
    this.meta[idx] = entry;
    this.byKey.set(key, idx);
    return entry;
  }

  private resample(field: CField): CField {
    octaveTransport(field, this.work);
    return this.work;
  }

  /** Normalised real overlap of the probe with every stored pattern. */
  private score(pre: Float64Array, pim: Float64Array): { best: number; second: number; arg: number } {
    const n = this.nodes;
    const pn = normOf(pre, pim, n);
    let best = -Infinity;
    let second = -Infinity;
    let arg = -1;
    for (let p = 0; p < this.meta.length; p++) {
      const base = p * n;
      let dot = 0;
      for (let i = 0; i < n; i++) {
        dot += this.re[base + i] * pre[i] + this.im[base + i] * pim[i];
      }
      const s = pn > 0 ? dot / pn : 0; // stored rows are already unit norm
      this.scores[p] = s;
      if (s > best) {
        second = best;
        best = s;
        arg = p;
      } else if (s > second) {
        second = s;
      }
    }
    if (!Number.isFinite(second)) second = 0;
    return { best: Number.isFinite(best) ? best : 0, second, arg };
  }

  /** One Hopfield sweep at β; writes the readout into `out`. */
  private sweep(out: CField, beta: number): void {
    const n = this.nodes;
    const G = this.meta.length;
    let max = -Infinity;
    for (let p = 0; p < G; p++) if (this.scores[p] > max) max = this.scores[p];
    let z = 0;
    for (let p = 0; p < G; p++) {
      const w = dexp(beta * (this.scores[p] - max));
      this.weights[p] = w;
      z += w;
    }
    const inv = z > 0 ? 1 / z : 0;
    zeroField(out);
    for (let p = 0; p < G; p++) {
      const w = this.weights[p] * inv;
      if (w === 0) continue;
      const base = p * n;
      for (let i = 0; i < n; i++) {
        out.re[i] += w * this.re[base + i];
        out.im[i] += w * this.im[base + i];
      }
    }
  }

  /** Cosine of a probe against a stored pattern index. */
  similarityTo(index: number, field: CField): number {
    if (index < 0 || index >= this.meta.length) return 0;
    const n = this.nodes;
    const base = index * n;
    let dot = 0;
    let pn = 0;
    for (let i = 0; i < n; i++) {
      const pr = field.re[i] ?? 0;
      const pi = field.im[i] ?? 0;
      dot += this.re[base + i] * pr + this.im[base + i] * pi;
      pn += pr * pr + pi * pi;
    }
    return pn > 0 ? dot / Math.sqrt(pn) : 0;
  }

  /** R1 — exact key hit. */
  lookup(key: string): BraidPattern | null {
    const idx = this.byKey.get(key);
    return idx === undefined ? null : this.meta[idx];
  }

  /** Copy a stored pattern out (unit-normalised). */
  read(index: number, out: CField): boolean {
    if (index < 0 || index >= this.meta.length) return false;
    const n = Math.min(this.nodes, out.n);
    const base = index * this.nodes;
    for (let i = 0; i < n; i++) {
      out.re[i] = this.re[base + i];
      out.im[i] = this.im[base + i];
    }
    return true;
  }

  /**
   * The R1–R6 retrieval cascade. `key` short-circuits at R1 when supplied.
   */
  recall(field: CField, key?: string): Recall {
    const beta = this.beta();
    if (this.meta.length === 0) {
      return { stage: 'miss', key: null, index: -1, similarity: 0, margin: 0, sweeps: 0, beta, accepted: false };
    }

    // R1 — exact key
    if (key !== undefined) {
      const idx = this.byKey.get(key);
      if (idx !== undefined) {
        return {
          stage: 'R1',
          key,
          index: idx,
          similarity: 1,
          margin: 1,
          sweeps: 0,
          beta,
          accepted: true,
        };
      }
    }

    const n = this.nodes;
    // stage the probe on the braid lattice
    if (field.n === n) {
      this.probe.re.set(field.re.subarray(0, n));
      this.probe.im.set(field.im.subarray(0, n));
    } else {
      octaveTransport(field, this.probe);
    }

    // Stages R3-R6 are proposal generators; the objective is fixed as the
    // cosine against this original probe, so a sweep can never talk the braid
    // into a pattern the cue does not actually support.
    const candidates = new Set<number>();
    const propose = (arg: number) => { if (arg >= 0) candidates.add(arg); };

    // R2 — linear overlap
    const r2 = this.score(this.probe.re, this.probe.im);
    if (r2.best >= this.accept) return this.hit('R2', r2, 0, beta);
    propose(r2.arg);

    // R3 — one Hopfield sweep, then re-score against the readout
    this.sweep(this.work, beta);
    let r3 = this.score(this.work.re, this.work.im);
    if (this.confirms(r3.arg)) return this.hit('R3', r3, 1, beta);
    propose(r3.arg);

    // R4 — iterate to a fixed point (<= 13 sweeps, phi-scale cap)
    let sweeps = 1;
    let prev = r3.best;
    for (let it = 0; it < 12; it++) {
      this.sweep(this.work, beta);
      sweeps++;
      const rr = this.score(this.work.re, this.work.im);
      if (this.confirms(rr.arg)) return this.hit('R4', rr, sweeps, beta);
      propose(rr.arg);
      if (Math.abs(rr.best - prev) < 1e-12) break;
      prev = rr.best;
      r3 = rr;
    }

    // R5 — octave retry: the cue may have arrived from another rung, so fold it
    // through the transport once (a no-op when it was already native).
    octaveTransport(this.probe, this.work);
    const r5 = this.score(this.work.re, this.work.im);
    if (this.confirms(r5.arg)) return this.hit('R5', r5, sweeps, beta);
    propose(r5.arg);

    // R6 — phase-only proposal (faded / clipped cue), then the final re-rank.
    for (let i = 0; i < n; i++) {
      const a = Math.sqrt(this.probe.re[i] * this.probe.re[i] + this.probe.im[i] * this.probe.im[i]);
      if (a > 0) {
        this.work.re[i] = this.probe.re[i] / a;
        this.work.im[i] = this.probe.im[i] / a;
      } else {
        this.work.re[i] = 0;
        this.work.im[i] = 0;
      }
    }
    const r6 = this.score(this.work.re, this.work.im);
    if (this.confirms(r6.arg)) return this.hit('R6', r6, sweeps, beta);
    propose(r6.arg);

    // final re-rank on the fixed objective
    let bestIdx = -1;
    let bestSim = -Infinity;
    let secondSim = -Infinity;
    for (const c of candidates) {
      const sim = this.similarityTo(c, this.probe);
      if (sim > bestSim) {
        secondSim = bestSim;
        bestSim = sim;
        bestIdx = c;
      } else if (sim > secondSim) {
        secondSim = sim;
      }
    }
    if (!Number.isFinite(secondSim)) secondSim = 0;
    const accepted = bestIdx >= 0 && bestSim >= PARTIAL_ACCEPT;
    return {
      stage: accepted ? 'R6' : 'miss',
      key: bestIdx >= 0 ? this.meta[bestIdx].key : null,
      index: bestIdx,
      similarity: Number.isFinite(bestSim) ? bestSim : 0,
      margin: bestSim - secondSim,
      sweeps,
      beta,
      accepted,
    };
  }

  /**
   * A sweep readout is a *proposal*, not a verdict: the readout is a blend of
   * every stored pattern, so a high score against the blend says nothing about
   * the cue. A stage may only terminate the cascade when its candidate clears
   * the acceptance cosine against the original probe.
   */
  private confirms(arg: number): boolean {
    return arg >= 0 && this.similarityTo(arg, this.probe) >= this.accept;
  }

  private hit(stage: RetrievalStage, r: { best: number; second: number; arg: number }, sweeps: number, beta: number): Recall {
    return {
      stage,
      key: r.arg >= 0 ? this.meta[r.arg].key : null,
      index: r.arg,
      similarity: r.best,
      margin: r.best - r.second,
      sweeps,
      beta,
      accepted: true,
    };
  }

  clear(): void {
    this.re.fill(0);
    this.im.fill(0);
    this.meta = [];
    this.byKey.clear();
  }
}
