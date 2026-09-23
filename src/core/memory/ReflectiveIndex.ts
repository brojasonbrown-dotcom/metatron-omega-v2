/**
 * ReflectiveIndex (L6) — re-measurement queue.
 *
 * Every tick we re-project the top-N episodes (by priority) against the
 * live Ψ and reinforce their salience by the cosine match. Important
 * memories therefore "are felt more often" — the user's literal rule.
 *
 * Pure consumer of EpisodicStore; no state of its own beyond a tiny
 * rolling log of the last few reflections (for the UI sparkline).
 */

import type { EpisodicStore } from './EpisodicStore';

export interface Reflection {
  tick: number;
  hash: string;
  cosine: number;
  reinforcement: number;
}

export class ReflectiveIndex {
  private log: Reflection[] = [];
  private logCap = 64;

  constructor(private readonly episodic: EpisodicStore) {}

  /**
   * Run one re-measurement pass.
   * @param tick      current engine tick
   * @param topN      how many priority candidates to re-probe
   * @param cue       live Ψ signature (top-K)
   * @returns         the reflections that fired (cosine > 0.05)
   */
  reflect(tick: number, topN: number, cue: { indices: Int32Array; amplitudes: Float64Array; norm: number }): Reflection[] {
    if (topN <= 0 || this.episodic.size() === 0) return [];
    const candidates = this.episodic.prioritised(tick, topN);
    if (candidates.length === 0) return [];

    // Build cue lookup once (was: rebuilt for every candidate × every tick).
    const cueMap = new Map<number, number>();
    for (let i = 0; i < cue.indices.length; i++) cueMap.set(cue.indices[i], cue.amplitudes[i]);
    let cueNormSq = 0;
    for (let i = 0; i < cue.amplitudes.length; i++) cueNormSq += cue.amplitudes[i] * cue.amplitudes[i];
    if (cueNormSq === 0) return [];
    const cueNorm = Math.sqrt(cueNormSq);

    const fired: Reflection[] = [];
    for (const ep of candidates) {
      // Inline cosine — avoids fn-call overhead and the per-candidate Map alloc.
      let dot = 0, epNormSq = 0;
      const idx = ep.indices, amp = ep.amplitudes;
      for (let i = 0; i < idx.length; i++) {
        const a = cueMap.get(idx[i]);
        const b = amp[i];
        if (a !== undefined) dot += a * b;
        epNormSq += b * b;
      }
      const denom = cueNorm * Math.sqrt(epNormSq);
      const cos = denom > 0 ? dot / denom : 0;
      if (cos < 0.05) continue;
      const gain = cos * cos; // quadratic reinforcement — high matches dominate
      this.episodic.reinforce(ep.hash, tick, gain);
      fired.push({ tick, hash: ep.hash, cosine: cos, reinforcement: gain });
    }
    if (fired.length > 0) {
      this.log.push(...fired);
      if (this.log.length > this.logCap) this.log.splice(0, this.log.length - this.logCap);
    }
    return fired;
  }

  recent(n: number): Reflection[] {
    return this.log.slice(-n).reverse();
  }
}
