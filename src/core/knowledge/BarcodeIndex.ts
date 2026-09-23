/**
 * BarcodeIndex — Fibonacci-stride LSH banding over the φ-plane bitmap.
 *
 * Candidate generation is sublinear: a chunk is only rescored when it shares
 * at least one band key with the cue. Bands are cut at Fibonacci strides
 * (8, 13, 21, 34 bits) across the 4 planes so coarse planes give recall and
 * fine planes give precision. The exact bitmap distance always rescores.
 */

import { BITMAP_WORDS, weightedDistance, bitmapToHex, bitmapFromHex } from '@/core/gematria/bitmap';

/** (word index, bit offset, width) — Fibonacci widths over the 8 lanes. */
const BANDS: Array<[number, number, number]> = [
  [0, 0, 21], [1, 0, 13], [2, 0, 21], [3, 0, 13],
  [4, 0, 13], [5, 0, 8], [6, 0, 13], [7, 0, 8],
];

function bandKey(bm: Uint32Array, b: number): string {
  const [w, off, width] = BANDS[b];
  const mask = width >= 32 ? 0xffffffff : ((1 << width) - 1) >>> 0;
  return `${b}:${(((bm[w] >>> off) & mask) >>> 0).toString(36)}`;
}

export class BarcodeIndex {
  private buckets = new Map<string, Set<string>>();
  private codes = new Map<string, Uint32Array>();

  add(id: string, bm: Uint32Array): void {
    if (this.codes.has(id)) this.remove(id);
    this.codes.set(id, bm.slice());
    for (let b = 0; b < BANDS.length; b++) {
      const k = bandKey(bm, b);
      let s = this.buckets.get(k);
      if (!s) { s = new Set(); this.buckets.set(k, s); }
      s.add(id);
    }
  }

  remove(id: string): void {
    const bm = this.codes.get(id);
    if (!bm) return;
    for (let b = 0; b < BANDS.length; b++) {
      const k = bandKey(bm, b);
      const s = this.buckets.get(k);
      if (s) { s.delete(id); if (s.size === 0) this.buckets.delete(k); }
    }
    this.codes.delete(id);
  }

  /** Candidates ranked by 1 − φ-weighted bitmap distance, in [0,1]. */
  query(bm: Uint32Array, topN = 256): Array<{ id: string; score: number }> {
    const votes = new Map<string, number>();
    for (let b = 0; b < BANDS.length; b++) {
      const s = this.buckets.get(bandKey(bm, b));
      if (!s) continue;
      for (const id of s) votes.set(id, (votes.get(id) ?? 0) + 1);
    }
    // Cold index / no band collision: fall back to a full scan, still exact.
    const ids = votes.size > 0 ? [...votes.keys()] : [...this.codes.keys()];
    const out = ids.map((id) => ({ id, score: 1 - weightedDistance(bm, this.codes.get(id)!) }));
    out.sort((a, b2) => b2.score - a.score || (a.id < b2.id ? -1 : 1));
    return out.slice(0, topN);
  }

  size(): number { return this.codes.size; }
  bandCount(): number { return this.buckets.size; }
  get(id: string): Uint32Array | undefined { return this.codes.get(id); }

  snapshot(): Array<[string, string]> {
    return [...this.codes.entries()].map(([id, bm]) => [id, bitmapToHex(bm)]);
  }

  restore(s: Array<[string, string]>): void {
    this.buckets.clear();
    this.codes.clear();
    for (const [id, hex] of s) {
      const bm = bitmapFromHex(hex);
      if (bm.length === BITMAP_WORDS) this.add(id, bm);
    }
  }

  clear(): void { this.buckets.clear(); this.codes.clear(); }
}
