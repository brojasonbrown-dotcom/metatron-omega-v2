/**
 * VisionFieldIndex — bounded, associative index over co-occurring
 * (vision embedding, engine field state) pairs.
 *
 * Purpose
 * =======
 * Answer TWO queries the rest of the memory stack cannot:
 *
 *   recallByFieldState(psi, k)  → "when the engine felt like THIS,
 *                                  what was Metatron looking at?"
 *   recallByImage(embed, k)     → "when this image was on-screen,
 *                                  what was the field doing?"
 *
 * Method
 * ------
 * Every capture with a live vision slot produces one entry:
 *   • quantised (int8) vision embed reference
 *   • densified & normalised Ψ vector (projected into the same
 *     coordinate space via VisionProjection)
 *   • scalar cosine between the two, precomputed for fast filtering
 *   • tick + episodeHash (if the capture also produced an episode)
 *
 * The index is a golden-ratio-sized ring (capacity F16 = 987 by default).
 * Drop-oldest eviction. O(N·d) scans are fine at this cap: at 8 Hz vision
 * capture, 987 entries = ~2 minutes of continuous perception; longer-term
 * material lives in EpisodicStore.recallByVision().
 *
 * Coordinate consistency: both the projected vision embed AND the
 * densified Ψ are compared in the SAME PROJECTION-SPACE dimension
 * (INDEX_DIM), so cosine values are directly comparable across queries.
 */

import { getProjectionBasis, projectInto, densifyTopK, quantizeInt8, dequantizeInt8, cosine, l2NormalizeInPlace, type QuantizedVector } from '@/core/sensory/VisionProjection';

/** F16. Cap sized to Fibonacci for aesthetic parity with the rest of the
 *  memory stack; drop-oldest eviction. */
export const VISION_FIELD_INDEX_CAP = 987;
/** Shared projection dimension. F11 = 89 keeps this cheap enough for
 *  linear scan at N=987 (≈87k mul-adds per query) and matches the
 *  SensoryCortex BIND_DIM for future cross-module comparison. */
export const INDEX_DIM = 89;

export interface VisionFieldEntry {
  tick: number;
  cosine: number;
  visionEmbedQ: QuantizedVector;
  psiProj: Float32Array;         // length INDEX_DIM, unit-norm
  episodeHash?: string;
}

export class VisionFieldIndex {
  private ring: VisionFieldEntry[] = [];
  private cap: number;
  private writeIdx = 0;
  /** Total append() calls — monotonic, useful for HUD. */
  private totalAppends = 0;

  constructor(cap: number = VISION_FIELD_INDEX_CAP) {
    this.cap = Math.max(16, cap | 0);
  }

  size(): number { return this.ring.length; }
  capacity(): number { return this.cap; }
  total(): number { return this.totalAppends; }

  /**
   * Append one co-occurrence. `visionEmbed` is L2-normalised (the frontend
   * publishes unit-norm vectors); `psi` is the current field vector; Ψ
   * top-K + amplitudes are extracted internally via `psiIndices/psiAmps`
   * if the caller already has them (cheaper than re-doing top-K here).
   *
   * Returns the entry's cosine so callers can store it on their episode.
   */
  append(
    tick: number,
    visionEmbed: Float32Array,
    psiIndices: Int32Array | ArrayLike<number>,
    psiAmps: Float64Array | Float32Array | ArrayLike<number>,
    episodeHash?: string,
  ): number {
    // Ensure basis exists at this dim pair (getProjectionBasis caches).
    void getProjectionBasis(visionEmbed.length, INDEX_DIM);

    const embedProj = new Float32Array(INDEX_DIM);
    projectInto(visionEmbed, embedProj);
    l2NormalizeInPlace(embedProj);

    const psiDense = densifyTopK(psiIndices, psiAmps, INDEX_DIM);
    l2NormalizeInPlace(psiDense);

    const cos = cosine(embedProj, psiDense);

    const entry: VisionFieldEntry = {
      tick,
      cosine: cos,
      visionEmbedQ: quantizeInt8(visionEmbed),
      psiProj: embedProj,
      episodeHash,
    };

    if (this.ring.length < this.cap) {
      this.ring.push(entry);
    } else {
      this.ring[this.writeIdx] = entry;
      this.writeIdx = (this.writeIdx + 1) % this.cap;
    }
    this.totalAppends++;
    return cos;
  }

  /**
   * Recall entries whose stored vision embed is most similar to `query`.
   * Returns top-k by cosine similarity, descending.
   */
  recallByImage(query: Float32Array, k: number): Array<{ entry: VisionFieldEntry; similarity: number }> {
    if (this.ring.length === 0 || query.length === 0) return [];
    let qn = 0;
    for (let i = 0; i < query.length; i++) qn += query[i] * query[i];
    qn = Math.sqrt(qn);
    if (qn < 1e-12) return [];
    const results: Array<{ entry: VisionFieldEntry; similarity: number }> = [];
    const scratch = new Float32Array(query.length);
    for (const e of this.ring) {
      if (e.visionEmbedQ.q.length !== query.length) continue;
      const dq = dequantizeInt8(e.visionEmbedQ, scratch);
      let dot = 0, en = 0;
      for (let i = 0; i < query.length; i++) {
        dot += query[i] * dq[i];
        en += dq[i] * dq[i];
      }
      en = Math.sqrt(en);
      const sim = en > 1e-12 ? dot / (en * qn) : 0;
      results.push({ entry: e, similarity: sim });
    }
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k);
  }

  /**
   * Recall entries whose stored Ψ projection is most similar to the
   * densified projection of `psiIndices/psiAmps`. Answers "what was I
   * looking at when the field state resembled the current one?"
   */
  recallByFieldState(psiIndices: Int32Array | ArrayLike<number>, psiAmps: Float64Array | Float32Array | ArrayLike<number>, k: number): Array<{ entry: VisionFieldEntry; similarity: number }> {
    if (this.ring.length === 0) return [];
    const query = densifyTopK(psiIndices, psiAmps, INDEX_DIM);
    l2NormalizeInPlace(query);
    const results: Array<{ entry: VisionFieldEntry; similarity: number }> = [];
    for (const e of this.ring) {
      const sim = cosine(query, e.psiProj);
      results.push({ entry: e, similarity: sim });
    }
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k);
  }

  clear(): void {
    this.ring = [];
    this.writeIdx = 0;
  }

  setCap(cap: number): void {
    const next = Math.max(16, cap | 0);
    if (next === this.cap) return;
    // Order the ring chronologically (oldest → newest) before truncation.
    const ordered: VisionFieldEntry[] = [];
    if (this.ring.length === this.cap) {
      for (let i = 0; i < this.cap; i++) ordered.push(this.ring[(this.writeIdx + i) % this.cap]);
    } else {
      ordered.push(...this.ring);
    }
    if (ordered.length > next) ordered.splice(0, ordered.length - next);
    this.ring = ordered;
    this.writeIdx = this.ring.length === next ? 0 : this.ring.length;
    this.cap = next;
  }
}
