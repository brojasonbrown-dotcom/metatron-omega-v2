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
  encodeBitmapSparse,
  weightedDistance,
  bucketOf,
  bitmapWeight,
  zeckAddress,
  fingerprint,
  crtModulus,
  collisionPValue,
  resonanceSparse,
  type Fingerprint,
} from '@/core/gematria';

export interface IndexedPattern {
  readonly hash: string;
  readonly bitmap: Uint32Array;
  readonly bucket: string;
  readonly address: string;
  readonly fingerprint: Fingerprint;
  readonly weight: number;
  readonly tick: number;
  /**
   * Times this entry has been returned by search(). Recall was previously
   * frequency-blind: a pattern retrieved 500 times ranked identically to one
   * seen once, so no amount of rehearsal made a structure easier to reach.
   */
  rehearsals: number;
  /** Tick of the most recent search() hit (its own tick until first recall). */
  lastRecalled: number;
}

export interface BitmapMatch {
  pattern: PatternSignature;
  /** Exact kernel score C(a,b) ∈ [0,1]. */
  resonance: number;
  /** φ-weighted bitmap distance ∈ [0,1] (prefilter score). */
  distance: number;
  /** Rank score: resonance · rehearsal gain · recency decay. */
  score: number;
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
/** φ⁻¹ = 0.6180339887498949 — rehearsal gain and recency decay base. */
const PHI_INV = 0.6180339887498949;
/** Recency time constant: one L3 consolidation window (34 observations). */
export const REHEARSAL_TAU = 34;

export class PatternBitmapIndex {
  private entries = new Map<string, IndexedPattern>();
  private buckets = new Map<string, Set<string>>();
  private fpKeys = new Map<string, number>();
  private dim = 0;
  private collisions = 0;
  private lastPrefiltered = 0;
  private lastRescored = 0;

  /** Dense dimension the bitmaps are computed at. Set on first index(). */
  dimension(): number {
    return this.dim;
  }
  size(): number {
    return this.entries.size;
  }
  get(hash: string): IndexedPattern | null {
    return this.entries.get(hash) ?? null;
  }

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
      rehearsals: 0,
      lastRecalled: sig.tick,
    };
    this.entries.set(sig.hash, entry);

    let b = this.buckets.get(entry.bucket);
    if (!b) {
      b = new Set();
      this.buckets.set(entry.bucket, b);
    }
    b.add(sig.hash);

    const seen = this.fpKeys.get(fp.key) ?? 0;
    if (seen > 0) this.collisions++;
    this.fpKeys.set(fp.key, seen + 1);

    return entry;
  }

  /** Drop entries whose pattern no longer exists in the store. */
  sync(patterns: readonly PatternSignature[], dim: number): void {
    const live = new Set<string>();
    for (const p of patterns) {
      live.add(p.hash);
      this.index(p, dim);
    }
    for (const hash of Array.from(this.entries.keys())) {
      if (live.has(hash)) continue;
      const e = this.entries.get(hash)!;
      this.entries.delete(hash);
      this.buckets.get(e.bucket)?.delete(hash);
      const n = (this.fpKeys.get(e.fingerprint.key) ?? 1) - 1;
      if (n <= 0) this.fpKeys.delete(e.fingerprint.key);
      else this.fpKeys.set(e.fingerprint.key, n);
    }
  }

  /**
   * Three-stage recall.
   *
   *   Stage 0  LSH bucket gather. The `buckets` map was built on every index()
   *            and never read by search(), so every recall paid a full O(N)
   *            prefilter. The cue's own bucket is now gathered first and the
   *            scan widens to all patterns only when the bucket cannot supply
   *            `prefilter` candidates — so candidate recall is never worse
   *            than the full scan, and is strictly cheaper when populated.
   *   Stage 1  φ-weighted Hamming (integer popcounts) over the candidates.
   *   Stage 2  Exact resonance kernel, then the frequency/recency rank:
   *
   *              score = C(a,b) · (1 + φ⁻¹·ln(1+rehearsals)) · φ^(−Δt/τ)
   *
   *            τ = REHEARSAL_TAU = 34 observations (the L3 consolidation
   *            cadence), so a memory that has not been reached for one
   *            consolidation window is worth φ⁻¹ of its fresh value, and the
   *            rehearsal term grows logarithmically — frequent structure wins
   *            without ever saturating the resonance term it multiplies.
   *
   * Every returned entry is marked rehearsed, so recall reinforces what recall
   * reaches. `now` defaults to the newest indexed tick when not supplied.
   */
  search(
    cue: Float64Array,
    patterns: readonly PatternSignature[],
    topN = 5,
    prefilter = DEFAULT_PREFILTER,
    now?: number,
  ): BitmapMatch[] {
    if (patterns.length === 0) return [];
    const dim = this.dim || cue.length;
    if (this.dim === 0) this.dim = dim;
    const cueBitmap = encodeBitmapSparse(
      Int32Array.from({ length: cue.length }, (_, i) => i),
      cue,
      dim,
    );

    // Stage 0 — bucket gather with full-scan fallback.
    for (const p of patterns) if (!this.entries.has(p.hash)) this.index(p, dim);
    const want = Math.max(topN, Math.min(prefilter, patterns.length));
    const cueBucket = bucketOf(cueBitmap);
    const inBucket = this.buckets.get(cueBucket);
    let candidates: readonly PatternSignature[] = patterns;
    if (inBucket && inBucket.size >= want) {
      const filtered = patterns.filter((p) => inBucket.has(p.hash));
      if (filtered.length >= want) candidates = filtered;
    }

    // Stage 1 — integer prefilter.
    const scored: Array<{ p: PatternSignature; e: IndexedPattern; d: number }> = [];
    for (const p of candidates) {
      const e = this.entries.get(p.hash)!;
      scored.push({ p, e, d: weightedDistance(cueBitmap, e.bitmap) });
    }
    scored.sort((a, b) => a.d - b.d);
    const keep = scored.slice(0, want);
    this.lastPrefiltered = scored.length;
    this.lastRescored = keep.length;

    // Stage 2 — exact kernel, then frequency/recency rank.
    const tNow = now ?? this.newestTick();
    const out: BitmapMatch[] = keep.map(({ p, e, d }) => {
      const resonance = resonanceSparse(p.indices, p.amplitudes, cue);
      return { pattern: p, entry: e, distance: d, resonance, score: this.rank(resonance, e, tNow) };
    });
    out.sort((a, b) => b.score - a.score || a.entry.address.localeCompare(b.entry.address));
    const winners = out.slice(0, topN);
    for (const w of winners) {
      w.entry.rehearsals++;
      if (tNow > w.entry.lastRecalled) w.entry.lastRecalled = tNow;
    }
    return winners;
  }

  /** score = C · (1 + φ⁻¹·ln(1+rehearsals)) · φ^(−Δt/τ). Monotone in C. */
  private rank(resonance: number, e: IndexedPattern, now: number): number {
    const rehearsal = 1 + PHI_INV * Math.log1p(e.rehearsals);
    const age = Math.max(0, now - e.lastRecalled);
    const recency = PHI_INV ** (age / REHEARSAL_TAU);
    return resonance * rehearsal * recency;
  }

  private newestTick(): number {
    let t = 0;
    for (const e of this.entries.values()) if (e.lastRecalled > t) t = e.lastRecalled;
    return t;
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
