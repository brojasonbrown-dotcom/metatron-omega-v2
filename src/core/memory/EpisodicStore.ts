/**
 * EpisodicStore (L2) — salience-triggered field snapshots.
 *
 * Where FieldTape (L0) writes EVERY tick at low resolution, EpisodicStore
 * writes only when something matters: high salience, high surprise, a
 * Fibonacci tick, an external event, or a framework grade shift.
 *
 * Each episode keeps a full top-K φ-signature plus the scalars that drove
 * the capture, the trigger reason, and a back-pointer to the tape frame
 * index so the full Ψ can be retrieved from L0 if needed.
 *
 * Eviction: priority = (salience · φ + 1) · exp(-Δt / τ). Lowest priority
 * goes first. This is the "important memories stay" rule.
 */

import { PHI } from '@/core/frameworks/constants';
import { dequantizeInt8 } from '@/core/sensory/VisionProjection';
import { toInt32Array, toFloat64Array } from './typedJson';

export type EpisodeReason =
  | 'fibonacci'
  | 'salience'
  | 'novelty'
  | 'surprise'
  | 'event'
  | 'grade-shift'
  | 'manual';

export interface Episode {
  tick: number;
  reason: EpisodeReason;
  hash: string;
  norm: number;
  poloidal: number;
  toroidal: number;
  qualiaScalar: number;
  coherence: number;
  energy: number;
  salience: number;
  novelty: number;
  surprise: number;
  indices: Int32Array;
  amplitudes: Float64Array;
  tapeIndex: number; // logical age at write-time
  reinforcements: number; // how many times the reflective index rematched
  lastReinforced: number;
  text?: string;
  /** Int8-quantised vision embedding at capture time (typically 768 bytes
   *  for ViT-B). Absent when the camera was off. Enables visual recall. */
  visionEmbedQ?: Int8Array;
  visionEmbedScale?: number;
  /** Cosine(projected vision embed, densified Ψ) at capture — the
   *  scalar tying THIS visual moment to THIS engine state. */
  visionFieldCosine?: number;
}

const TAU_TICKS = 6765; // F20 — recency half-life baseline

export class EpisodicStore {
  private store: Episode[] = [];
  private cap: number;

  constructor(cap: number) {
    this.cap = Math.max(8, Math.floor(cap));
  }

  setCap(cap: number): void {
    this.cap = Math.max(8, Math.floor(cap));
    if (this.store.length > this.cap) this.evictTo(this.cap, this.lastTick());
  }

  capacity(): number {
    return this.cap;
  }
  size(): number {
    return this.store.length;
  }
  all(): readonly Episode[] {
    return this.store;
  }

  append(ep: Episode): void {
    this.store.push(ep);
    if (this.store.length > this.cap) this.evictTo(this.cap, ep.tick);
  }

  /** Reinforce an existing episode by hash; returns true if found. */
  reinforce(hash: string, tick: number, gain: number): boolean {
    for (let i = this.store.length - 1; i >= 0; i--) {
      const e = this.store[i];
      if (e.hash === hash) {
        e.reinforcements++;
        e.lastReinforced = tick;
        e.salience = Math.min(8, e.salience + gain);
        return true;
      }
    }
    return false;
  }

  /** Cosine-match top-N episodes against a top-K cue signature. */
  recall(
    cue: { indices: Int32Array; amplitudes: Float64Array; norm: number },
    topN: number,
  ): Array<{ ep: Episode; cosine: number }> {
    if (this.store.length === 0) return [];
    const results: Array<{ ep: Episode; cosine: number }> = [];
    const map = new Map<number, number>();
    for (let i = 0; i < cue.indices.length; i++) map.set(cue.indices[i], cue.amplitudes[i]);
    let cueNorm = 0;
    for (let i = 0; i < cue.amplitudes.length; i++)
      cueNorm += cue.amplitudes[i] * cue.amplitudes[i];
    cueNorm = Math.sqrt(cueNorm);
    if (cueNorm === 0) return [];
    for (const ep of this.store) {
      let dot = 0,
        epNorm = 0;
      for (let i = 0; i < ep.indices.length; i++) {
        const a = map.get(ep.indices[i]);
        const b = ep.amplitudes[i];
        if (a !== undefined) dot += a * b;
        epNorm += b * b;
      }
      epNorm = Math.sqrt(epNorm);
      const cos = epNorm > 0 ? dot / (epNorm * cueNorm) : 0;
      results.push({ ep, cosine: cos });
    }
    results.sort((a, b) => b.cosine - a.cosine);
    return results.slice(0, topN);
  }

  /**
   * Cosine-match the top-N episodes whose captured vision embedding is
   * closest to `queryEmbed` (L2-normalised expected). Episodes without a
   * vision embed are skipped. This is the "show me moments that LOOKED
   * like this" query — the first honest visual associative recall in the
   * memory stack.
   */
  recallByVision(queryEmbed: Float32Array, topN: number): Array<{ ep: Episode; cosine: number }> {
    if (this.store.length === 0 || queryEmbed.length === 0) return [];
    let qn = 0;
    for (let i = 0; i < queryEmbed.length; i++) qn += queryEmbed[i] * queryEmbed[i];
    qn = Math.sqrt(qn);
    if (qn < 1e-12) return [];
    const results: Array<{ ep: Episode; cosine: number }> = [];
    const scratch = new Float32Array(queryEmbed.length);
    for (const ep of this.store) {
      if (!ep.visionEmbedQ || ep.visionEmbedQ.length !== queryEmbed.length) continue;
      const dq = dequantizeInt8({ q: ep.visionEmbedQ, scale: ep.visionEmbedScale ?? 0 }, scratch);
      let dot = 0,
        en = 0;
      for (let i = 0; i < queryEmbed.length; i++) {
        dot += queryEmbed[i] * dq[i];
        en += dq[i] * dq[i];
      }
      en = Math.sqrt(en);
      const cos = en > 1e-12 ? dot / (en * qn) : 0;
      results.push({ ep, cosine: cos });
    }
    results.sort((a, b) => b.cosine - a.cosine);
    return results.slice(0, topN);
  }

  /** Episodes ordered by priority desc (for re-measurement queue). */
  prioritised(now: number, n: number): Episode[] {
    const len = this.store.length;
    if (n <= 0 || len === 0) return [];
    // Partial top-N via a size-N min-heap: O(N log n) instead of O(N log N).
    // For typical n=16, N=2000 this is ~2.7× faster and avoids the per-episode
    // `{e,p}` object + intermediate array allocations.
    const cap = Math.min(n, len);
    // heap[i] = { p, e }; root (index 0) is the smallest priority in the heap.
    const heap: Array<{ p: number; e: Episode }> = new Array(cap);
    let size = 0;
    for (let i = 0; i < len; i++) {
      const e = this.store[i];
      const p = priority(e, now);
      if (size < cap) {
        heap[size++] = { p, e };
        // sift up
        let k = size - 1;
        while (k > 0) {
          const parent = (k - 1) >> 1;
          if (heap[parent].p > heap[k].p) {
            const t = heap[parent];
            heap[parent] = heap[k];
            heap[k] = t;
            k = parent;
          } else break;
        }
      } else if (p > heap[0].p) {
        heap[0] = { p, e };
        // sift down
        let k = 0;
        for (;;) {
          const l = 2 * k + 1,
            r = l + 1;
          let smallest = k;
          if (l < cap && heap[l].p < heap[smallest].p) smallest = l;
          if (r < cap && heap[r].p < heap[smallest].p) smallest = r;
          if (smallest === k) break;
          const t = heap[k];
          heap[k] = heap[smallest];
          heap[smallest] = t;
          k = smallest;
        }
      }
    }
    // Final sort the small heap (size ≤ n) by priority desc.
    heap.length = size;
    heap.sort((a, b) => b.p - a.p);
    const out: Episode[] = new Array(size);
    for (let i = 0; i < size; i++) out[i] = heap[i].e;
    return out;
  }

  private lastTick(): number {
    let t = 0;
    for (const e of this.store) if (e.tick > t) t = e.tick;
    return t;
  }

  private evictTo(cap: number, now: number): void {
    this.store.sort((a, b) => priority(a, now) - priority(b, now)); // asc — drop lowest
    this.store.splice(0, this.store.length - cap);
  }

  snapshot(): Episode[] {
    return this.store.map((e) => ({
      ...e,
      indices: new Int32Array(e.indices),
      amplitudes: new Float64Array(e.amplitudes),
    }));
  }

  /** Tolerant of JSON transport, where typed arrays arrive index-keyed. */
  restore(snap: Episode[]): void {
    this.store = snap.map((e) => ({
      ...e,
      indices: toInt32Array(e.indices),
      amplitudes: toFloat64Array(e.amplitudes),
    }));
  }

  clear(): void {
    this.store = [];
  }
}

function priority(e: Episode, now: number): number {
  const dt = Math.max(0, now - Math.max(e.tick, e.lastReinforced));
  const rec = Math.exp(-dt / TAU_TICKS);
  return (e.salience * PHI + 1) * rec * (1 + Math.log2(1 + e.reinforcements));
}
