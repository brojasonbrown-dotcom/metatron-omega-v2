/**
 * PatternBitmapIndex — deterministic bitmap address book over the semantic
 * pattern store (L3 FibonacciPatterns).
 *
 * Every pattern gets:
 *   • a PLANES×64 φ-projection bitmap        → O(1) popcount prefilter
 *   • an LSH bucket key                      → sublinear candidate gather
 *   • a Zeckendorf address (from its tick)   → canonical reversible slot id
 *   • a multi-base residue fingerprint       → exact secondary index
 *
 * Recall is two-stage: cheap integer Hamming over every entry, then the exact
 * resonance kernel on the top candidates only. O(N) int + O(k·d) float instead
 * of O(N·d) float.
 *
 * Pure and additive: the index observes the store, it never mutates it.
 */

import type { PatternSignature } from './FibonacciPatterns';
import {
  encodeBitmapSparse, weightedDistance, bucketOf, bitmapWeight,
  zeckAddress, fingerprint, crtModulus, collisionPValue,
  resonanceSparse, type Fingerprint,
} from '@/core/gematria';

export interface IndexedPattern {
  readonly hash: string;
  readonly bitmap: Uint32Array;
  readonly bucket: string;
  readonly address: string;
  readonly fingerprint: Fingerprint;
  readonly weight: number;
  readonly tick: number;
}

export interface BitmapMatch {
  pattern: PatternSignature;
  /** Exact kernel score C(a,b) ∈ [0,1]. */
  resonance: number;
  /** φ-weighted bitmap distance ∈ [0,1] (prefilter score). */
  distance: number;
  entry: IndexedPattern;
}

export interface BitmapIndexStats {
  size: number;
  dim: number;
  buckets: number;
  fingerprintCollisions: number;
  collisionPValue: number;
  crtModulus: number;
  lastPrefiltered: number;
  lastRescored: number;
}

/** Reconstruct a dense vector from a sparse signature. */
export function densify(sig: PatternSignature, dim: number): Float64Array {
  const out = new Float64Array(dim);
  for (let i = 0; i < sig.indices.length; i++) {
    const j = sig.indices[i];
    if (j >= 0 && j < dim) out[j] = sig.amplitudes[i];
  }
  return out;
}

const DEFAULT_PREFILTER = 34; // Fibonacci — candidates kept for exact rescore

export class PatternBitmapIndex {
  private entries = new Map<string, IndexedPattern>();
  private buckets = new Map<string, Set<string>>();
  private fpKeys = new Map<string, number>();
  private dim = 0;
  private collisions = 0;
  private lastPrefiltered = 0;
  private lastRescored = 0;

  /** Dense dimension the bitmaps are computed at. Set on first index(). */
  dimension(): number { return this.dim; }
  size(): number { return this.entries.size; }
  get(hash: string): IndexedPattern | null { return this.entries.get(hash) ?? null; }

  /** Index a pattern (idempotent by hash). `dim` is the live Ψ length. */
  index(sig: PatternSignature, dim: number): IndexedPattern {
    if (this.dim === 0) this.dim = dim;
    const existing = this.entries.get(sig.hash);
    if (existing) return existing;

    const bitmap = encodeBitmapSparse(sig.indices, sig.amplitudes, this.dim);
    const fp = fingerprint(Math.max(1, sig.tick));
    const entry: IndexedPattern = {
      hash: sig.hash,
      bitmap,
      bucket: bucketOf(bitmap),
      address: zeckAddress(Math.max(0, sig.tick)),
      fingerprint: fp,
      weight: bitmapWeight(bitmap),
      tick: sig.tick,
    };
    this.entries.set(sig.hash, entry);

    let b = this.buckets.get(entry.bucket);
    if (!b) { b = new Set(); this.buckets.set(entry.bucket, b); }
    b.add(sig.hash);

    const seen = this.fpKeys.get(fp.key) ?? 0;
    if (seen > 0) this.collisions++;
    this.fpKeys.set(fp.key, seen + 1);

    return entry;
  }

  /** Drop entries whose pattern no longer exists in the store. */
  sync(patterns: readonly PatternSignature[], dim: number): void {
    const live = new Set<string>();
    for (const p of patterns) { live.add(p.hash); this.index(p, dim); }
    for (const hash of Array.from(this.entries.keys())) {
      if (live.has(hash)) continue;
      const e = this.entries.get(hash)!;
      this.entries.delete(hash);
      this.buckets.get(e.bucket)?.delete(hash);
      const n = (this.fpKeys.get(e.fingerprint.key) ?? 1) - 1;
      if (n <= 0) this.fpKeys.delete(e.fingerprint.key); else this.fpKeys.set(e.fingerprint.key, n);
    }
  }

  /**
   * Two-stage recall. Stage 1: φ-weighted Hamming over every indexed pattern
   * (integer popcounts). Stage 2: exact resonance kernel on the survivors.
   */
  search(
    cue: Float64Array,
    patterns: readonly PatternSignature[],
    topN = 5,
    prefilter = DEFAULT_PREFILTER,
  ): BitmapMatch[] {
    if (patterns.length === 0) return [];
    const dim = this.dim || cue.length;
    if (this.dim === 0) this.dim = dim;
    const cueBitmap = encodeBitmapSparse(
      Int32Array.from({ length: cue.length }, (_, i) => i), cue, dim,
    );

    const scored: Array<{ p: PatternSignature; e: IndexedPattern; d: number }> = [];
    for (const p of patterns) {
      const e = this.entries.get(p.hash) ?? this.index(p, dim);
      scored.push({ p, e, d: weightedDistance(cueBitmap, e.bitmap) });
    }
    scored.sort((a, b) => a.d - b.d);
    const keep = scored.slice(0, Math.max(topN, Math.min(prefilter, scored.length)));
    this.lastPrefiltered = scored.length;
    this.lastRescored = keep.length;

    const out: BitmapMatch[] = keep.map(({ p, e, d }) => ({
      pattern: p,
      entry: e,
      distance: d,
      resonance: resonanceSparse(p.indices, p.amplitudes, cue),
    }));
    out.sort((a, b) => b.resonance - a.resonance);
    return out.slice(0, topN);
  }

  stats(): BitmapIndexStats {
    const n = this.entries.size;
    const pairs = (n * (n - 1)) / 2;
    const M = crtModulus();
    return {
      size: n,
      dim: this.dim,
      buckets: this.buckets.size,
      fingerprintCollisions: this.collisions,
      collisionPValue: collisionPValue(this.collisions, pairs, M),
      crtModulus: M,
      lastPrefiltered: this.lastPrefiltered,
      lastRescored: this.lastRescored,
    };
  }

  clear(): void {
    this.entries.clear();
    this.buckets.clear();
    this.fpKeys.clear();
    this.collisions = 0;
    this.dim = 0;
  }
}
