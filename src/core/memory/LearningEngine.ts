/**
 * LearningEngine — error-driven learning on top of the existing memory
 * substrate. Additive: it observes MemoryStore after capture() and never
 * changes the capture path's own math.
 *
 * Three mechanisms, all deterministic:
 *
 *   1. Predictive pathway learning. PathwayGraph already counts transitions;
 *      here we PREDICT the next pattern from the successor edges, measure
 *      surprise = 1 − C(predicted, actual), and use that surprise to scale
 *      how strongly the rest of the loop learns. Learning becomes error
 *      driven instead of cadence driven.
 *
 *   2. Eligibility-trace temporal binding. e ← φ⁻¹·e + Ψ. The residual
 *      (e − Ψ) carries what was active *just before* now, so a Hebbian
 *      update on the surprise-scaled residual binds temporally adjacent
 *      activations without double-counting the instantaneous update the
 *      capture kernel already performed.
 *
 *   3. Hopfield consolidation. Attractors whose exact resonance exceeds
 *      1 − 1/φ³ ≈ 0.7639 are merged (lower-qualia duplicate dropped, survivor
 *      refreshed), which bounds pattern growth by attractor count rather than
 *      by tick count. Candidates come from the bitmap prefilter, so the pass
 *      is O(N·k) not O(N²·d).
 */

import type { MemoryStore } from './MemoryStore';
import { PatternBitmapIndex, densify } from './PatternBitmapIndex';
import { resonance, resonanceSparse, MERGE_THRESHOLD, PHI_INV } from '@/core/gematria';

export interface LearningOptions {
  predictive: boolean;
  temporalBinding: boolean;
  consolidation: boolean;
  /** Observations between consolidation passes (Fibonacci cadence). */
  consolidateEvery: number;
}

export const DEFAULT_LEARNING: LearningOptions = {
  predictive: true,
  temporalBinding: true,
  consolidation: true,
  consolidateEvery: 34,
};

export interface LearningMetrics {
  tick: number;
  /** Best-matching stored pattern for the current Ψ. */
  currentHash: string | null;
  /** Pattern the pathway graph expected. */
  predictedHash: string | null;
  /** C(predicted, actual) ∈ [0,1]. */
  predictionResonance: number;
  /** 1 − predictionResonance. Drives learning rate. */
  surprise: number;
  /** ‖eligibility trace‖. */
  traceNorm: number;
  /** Hebbian pairs touched by the temporal-binding update. */
  boundPairs: number;
  /** Patterns merged by the last consolidation pass. */
  merged: number;
  /** Observations since start. */
  observations: number;
  /** Exact rescore count of the last recall (bitmap efficiency readout). */
  rescored: number;
  prefiltered: number;
}

const EMPTY: LearningMetrics = {
  tick: 0,
  currentHash: null,
  predictedHash: null,
  predictionResonance: 0,
  surprise: 0,
  traceNorm: 0,
  boundPairs: 0,
  merged: 0,
  observations: 0,
  rescored: 0,
  prefiltered: 0,
};

export class LearningEngine {
  readonly index = new PatternBitmapIndex();
  private opts: LearningOptions = { ...DEFAULT_LEARNING };
  private trace: Float64Array | null = null;
  private lastHash: string | null = null;
  private observations = 0;
  private mergedTotal = 0;
  private last: LearningMetrics = EMPTY;
  private surpriseEma = 0;

  constructor(private readonly store: MemoryStore) {}

  setOptions(next: Partial<LearningOptions>): void {
    this.opts = { ...this.opts, ...next };
  }
  options(): LearningOptions {
    return { ...this.opts };
  }
  metrics(): LearningMetrics {
    return this.last;
  }
  /** φ⁻²-smoothed surprise — the "is it still learning?" readout. */
  meanSurprise(): number {
    return this.surpriseEma;
  }
  totalMerged(): number {
    return this.mergedTotal;
  }

  reset(): void {
    this.index.clear();
    this.trace = null;
    this.lastHash = null;
    this.observations = 0;
    this.mergedTotal = 0;
    this.surpriseEma = 0;
    this.last = EMPTY;
  }

  /** Call once per memory tick, AFTER store.capture(). */
  observe(tick: number, psi: Float64Array): LearningMetrics {
    this.observations++;
    const patterns = this.store.patterns.all();
    const dim = psi.length;
    this.index.sync(patterns, dim);

    // ── eligibility trace ────────────────────────────────────────────────
    if (!this.trace || this.trace.length !== dim) this.trace = new Float64Array(dim);
    const trace = this.trace;
    let traceNorm = 0;
    for (let i = 0; i < dim; i++) {
      trace[i] = trace[i] * PHI_INV + psi[i];
      traceNorm += trace[i] * trace[i];
    }
    traceNorm = Math.sqrt(traceNorm);

    // ── current attractor via two-stage recall ───────────────────────────
    let currentHash: string | null = null;
    if (patterns.length > 0) {
      const hits = this.index.search(psi, patterns, 1);
      currentHash = hits[0]?.pattern.hash ?? null;
    }

    // ── prediction + surprise ────────────────────────────────────────────
    let predictedHash: string | null = null;
    let predictionResonance = 0;
    if (this.opts.predictive && this.lastHash) {
      const succ = this.store.pathway.successors(this.lastHash, 1);
      predictedHash = succ[0]?.to ?? null;
      if (predictedHash) {
        const p = patterns.find((x) => x.hash === predictedHash);
        if (p) predictionResonance = resonanceSparse(p.indices, p.amplitudes, psi);
      }
    }
    const surprise = predictedHash ? 1 - predictionResonance : 1;
    this.surpriseEma =
      this.surpriseEma === 0
        ? surprise
        : this.surpriseEma * (1 - PHI_INV * PHI_INV) + surprise * PHI_INV * PHI_INV;

    // ── temporal binding: Hebbian on the surprise-scaled trace residual ──
    let boundPairs = 0;
    if (this.opts.temporalBinding && traceNorm > 0) {
      const residual = new Float64Array(dim);
      const scale = Math.max(0, Math.min(1, surprise)) / traceNorm;
      let active = 0;
      for (let i = 0; i < dim; i++) {
        const r = (trace[i] - psi[i]) * scale;
        residual[i] = r;
        if (Math.abs(r) >= 1e-4) active++;
      }
      if (active >= 2) {
        this.store.hebbian.update(residual);
        boundPairs = (active * (active - 1)) / 2;
      }
    }

    // ── pathway transition (only between distinct attractors) ────────────
    if (currentHash && this.lastHash && currentHash !== this.lastHash) {
      this.store.pathway.observe(this.lastHash, currentHash, tick);
    }
    if (currentHash) this.lastHash = currentHash;

    // ── periodic Hopfield consolidation ──────────────────────────────────
    let merged = 0;
    if (
      this.opts.consolidation &&
      this.observations % Math.max(2, this.opts.consolidateEvery) === 0
    ) {
      merged = this.consolidate(dim, tick);
      this.mergedTotal += merged;
    }

    const istats = this.index.stats();
    this.last = {
      tick,
      currentHash,
      predictedHash,
      predictionResonance,
      surprise,
      traceNorm,
      boundPairs,
      merged,
      observations: this.observations,
      rescored: istats.lastRescored,
      prefiltered: istats.lastPrefiltered,
    };
    return this.last;
  }

  /**
   * Merge near-duplicate attractors. Candidate pairs come from the bitmap
   * prefilter; the exact kernel decides. Survivor = higher qualia (ties →
   * older tick, so the merge is order-independent and deterministic).
   */
  consolidate(dim: number, tick: number): number {
    const patterns = this.store.patterns.all();
    if (patterns.length < 2) return 0;
    const dropped = new Set<string>();

    for (const p of patterns) {
      if (dropped.has(p.hash)) continue;
      const dense = densify(p, dim);
      const hits = this.index.search(dense, patterns, 5);
      for (const h of hits) {
        const q = h.pattern;
        if (q.hash === p.hash || dropped.has(q.hash)) continue;
        if (h.resonance < MERGE_THRESHOLD) continue;
        const survivor =
          q.qualiaScalar > p.qualiaScalar || (q.qualiaScalar === p.qualiaScalar && q.tick < p.tick)
            ? q
            : p;
        const victim = survivor === p ? q : p;
        dropped.add(victim.hash);
        survivor.lastSeen = Math.max(survivor.lastSeen, tick);
        if (survivor === q) break; // p is gone — stop scanning its neighbours
      }
    }

    if (dropped.size === 0) return 0;
    const removed = this.store.patterns.removeByHash(dropped);
    this.index.sync(this.store.patterns.all(), dim);
    return removed;
  }

  /** Exact-kernel resonance helper for panels. */
  static resonance = resonance;
}
