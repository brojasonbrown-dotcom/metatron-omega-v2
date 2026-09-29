/**
 * FibonacciPatterns — Fibonacci-tick field-pattern store.
 *
 * Snapshots Ψ only at Fibonacci ticks (1,2,3,5,8,13,21,…). Each pattern is
 * compressed to a top-K φ-weighted harmonic signature so storage stays
 * O(K) per pattern regardless of mode count. Recall is cosine similarity
 * in signature space — O(N·K) with N capped by MemoryGovernor.
 *
 * Sphere/dimensional stability is preserved: each signature carries its
 * poloidal/toroidal magnitudes from a torus split satisfying p²+t²=‖Ψ‖².
 */

import { PHI, PHI_INV } from '@/core/frameworks/constants';
import { computeMemoryCaps, lruScore } from './MemoryGovernor';
import { toInt32Array, toFloat64Array } from './typedJson';

export interface PatternSignature {
  readonly tick: number;
  readonly fibIndex: number;
  /** Top-K indices (sorted by descending |amplitude|·φ⁻ᵏ). */
  readonly indices: Int32Array;
  /** Matching amplitudes. */
  readonly amplitudes: Float64Array;
  readonly norm: number;
  readonly poloidal: number;
  readonly toroidal: number;
  readonly qualiaScalar: number;
  readonly hash: string;
  lastSeen: number;
}

export interface PatternRecall {
  pattern: PatternSignature;
  cosine: number;
}

const DEFAULT_TOPK = 32;

/** Generate the Fibonacci sequence up to <= maxTick. */
function fibsUpTo(maxTick: number): Set<number> {
  const out = new Set<number>([1, 2]);
  let a = 1,
    b = 2;
  while (b <= maxTick) {
    const c = a + b;
    a = b;
    b = c;
    out.add(b);
  }
  return out;
}

export function isFibonacciTick(tick: number, cache = new Map<number, Set<number>>()): boolean {
  if (tick < 1) return false;
  let s = cache.get(tick);
  if (!s) {
    s = fibsUpTo(Math.max(tick, 144));
    cache.set(tick, s);
  }
  return s.has(tick);
}

export class FibonacciPatterns {
  private store: PatternSignature[] = [];
  private fibSet = new Set<number>([1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]);
  /** Sorted-ascending mirror of `fibSet`. Maintained in lock-step so
   *  `compress` can resolve fibIndex via O(log F) binary search instead of
   *  `Array.from(fibSet).sort().indexOf()` (O(F log F) + allocation). */
  private fibList: number[] = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
  private maxFib = 144;
  private readonly topK: number;
  private cap: number;

  constructor(topK = DEFAULT_TOPK, cap?: number) {
    this.topK = topK;
    this.cap = cap ?? computeMemoryCaps().maxPatterns;
  }

  setCap(cap: number): void {
    this.cap = Math.max(8, Math.floor(cap));
    if (this.store.length > this.cap) this.evict();
  }

  capacity(): number {
    return this.cap;
  }

  private ensureFibsUpTo(tick: number): void {
    while (this.maxFib < tick) {
      const n = this.fibList.length;
      const next = this.fibList[n - 1] + this.fibList[n - 2];
      this.fibList.push(next);
      this.fibSet.add(next);
      this.maxFib = next;
    }
  }

  /**
   * Returns true if Ψ was stored (i.e. tick is Fibonacci).
   *
   * Optional sensory modulation (Gap #3 — attention-biased consolidation):
   *   sensoryMask  — set of psi-space indices recently perturbed by sensory ΔΨ
   *   arousal      — cortex arousal ∈ [0,1] from the latest percept
   * When provided, sensory-touched indices receive an EXACTLY one-φ-rung
   * score promotion in the top-K cut (boost factor = 1 + arousal·φ⁻¹,
   * maxing out at 1 + φ⁻¹ = φ). Amplitudes stored in the signature are
   * unchanged — only the K-of-N ranking shifts to surface sensory-relevant
   * channels. Wolfram-verified: monotone bound prevents runaway promotion.
   */
  ingest(
    tick: number,
    psi: Float64Array,
    qualiaScalar = 0,
    sensoryMask?: ReadonlySet<number>,
    arousal = 0,
  ): PatternSignature | null {
    if (tick < 1) return null;
    this.ensureFibsUpTo(tick);
    if (!this.fibSet.has(tick)) return null;

    const sig = this.compress(tick, psi, qualiaScalar, sensoryMask, arousal);
    this.store.push(sig);
    if (this.store.length > this.cap) this.evict();
    return sig;
  }

  private compress(
    tick: number,
    psi: Float64Array,
    qualiaScalar: number,
    sensoryMask?: ReadonlySet<number>,
    arousal = 0,
  ): PatternSignature {
    const n = psi.length;
    // φ-rung promotion factor for sensory-touched indices.
    // α ∈ [0, φ⁻¹] ⇒ boost ∈ [1, φ]. Cap at φ⁻¹ to bound promotion to ≤1 rung.
    const alpha =
      sensoryMask && sensoryMask.size > 0 ? Math.max(0, Math.min(PHI_INV, arousal * PHI_INV)) : 0;
    // Score each mode by |a_i| · φ⁻ⁱ · (1 + α · 1_{i ∈ sensoryMask}). The
    // multiplicative running power avoids a transcendental per node — see
    // pre-Gap#3 invariant; mask membership is a single Set.has().
    const scored: Array<{ idx: number; score: number; amp: number }> = new Array(n);
    let norm2 = 0;
    let phiPow = 1; // PHI_INV ** 0
    for (let i = 0; i < n; i++) {
      const a = psi[i];
      norm2 += a * a;
      const absA = a < 0 ? -a : a;
      const boost = alpha > 0 && sensoryMask!.has(i) ? 1 + alpha : 1;
      scored[i] = { idx: i, score: absA * phiPow * boost, amp: a };
      phiPow *= PHI_INV;
    }
    scored.sort((a, b) => b.score - a.score);
    const K = Math.min(this.topK, n);
    const indices = new Int32Array(K);
    const amplitudes = new Float64Array(K);
    for (let i = 0; i < K; i++) {
      indices[i] = scored[i].idx;
      amplitudes[i] = scored[i].amp;
    }
    const norm = Math.sqrt(norm2);

    // Torus split: poloidal = even modes, toroidal = odd modes, rescaled to ‖Ψ‖.
    let evenSq = 0,
      oddSq = 0;
    for (let i = 0; i < n; i++) {
      const a = psi[i];
      if ((i & 1) === 0) evenSq += a * a;
      else oddSq += a * a;
    }
    const total = evenSq + oddSq;
    let poloidal = 0,
      toroidal = 0;
    if (total > 0) {
      const scale = norm / Math.sqrt(total);
      poloidal = Math.sqrt(evenSq) * scale;
      toroidal = Math.sqrt(oddSq) * scale;
    }

    // fibIndex via binary search on the maintained sorted fibList — no per-call
    // Array.from + sort allocation. Returns -1 if tick is not a Fibonacci
    // (callers gate on fibSet.has before getting here, so this is defensive).
    const fibIdx = binarySearch(this.fibList, tick);
    const hash = this.hash(indices, amplitudes);
    return {
      tick,
      fibIndex: fibIdx,
      indices,
      amplitudes,
      norm,
      poloidal,
      toroidal,
      qualiaScalar,
      hash,
      lastSeen: tick,
    };
  }

  private hash(indices: Int32Array, amplitudes: Float64Array): string {
    // Deterministic FNV-1a over rounded amplitudes.
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < indices.length; i++) {
      h ^= indices[i] >>> 0;
      h = Math.imul(h, 0x01000193) >>> 0;
      const q = Math.round(amplitudes[i] * 1e6) | 0;
      h ^= q;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  /** Cosine similarity to a query Ψ, returns top-N matches. */
  recall(cue: Float64Array, topN = 5, currentTick?: number): PatternRecall[] {
    if (this.store.length === 0) return [];
    const cueSig = this.compress(currentTick ?? 0, cue, 0);
    const results: PatternRecall[] = [];
    for (const p of this.store) {
      const cos = cosineSparse(cueSig, p);
      results.push({ pattern: p, cosine: cos });
      if (currentTick !== undefined) p.lastSeen = Math.max(p.lastSeen, currentTick);
    }
    results.sort((a, b) => b.cosine - a.cosine);
    return results.slice(0, topN);
  }

  private evict(): void {
    // Drop lowest lruScore.
    this.store.sort(
      (a, b) => lruScore(b.lastSeen, b.qualiaScalar) - lruScore(a.lastSeen, a.qualiaScalar),
    );
    this.store.length = this.cap;
  }

  size(): number {
    return this.store.length;
  }
  all(): readonly PatternSignature[] {
    return this.store;
  }

  /**
   * Drop patterns by hash. Used by the Hopfield consolidation pass to merge
   * near-duplicate attractors. Returns how many were removed.
   */
  removeByHash(hashes: ReadonlySet<string>): number {
    if (hashes.size === 0) return 0;
    const before = this.store.length;
    this.store = this.store.filter((p) => !hashes.has(p.hash));
    return before - this.store.length;
  }

  snapshot(): PatternSignature[] {
    return this.store.map((p) => ({
      ...p,
      indices: new Int32Array(p.indices),
      amplitudes: new Float64Array(p.amplitudes),
    }));
  }
  /**
   * Restore from a snapshot that may have crossed a JSON transport, where
   * typed arrays arrive as index-keyed objects. See core/memory/typedJson.
   */
  restore(snap: PatternSignature[]): void {
    this.store = snap.map((p) => ({
      ...p,
      indices: toInt32Array(p.indices),
      amplitudes: toFloat64Array(p.amplitudes),
    }));
  }
}

/** Binary search a sorted-ascending number[]. Returns index of `target` or -1. */
function binarySearch(arr: number[], target: number): number {
  let lo = 0,
    hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = arr[mid];
    if (v === target) return mid;
    if (v < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Cosine between two sparse signatures (treat missing indices as 0). */
function cosineSparse(a: PatternSignature, b: PatternSignature): number {
  if (a.norm === 0 || b.norm === 0) return 0;
  const map = new Map<number, number>();
  for (let i = 0; i < a.indices.length; i++) map.set(a.indices[i], a.amplitudes[i]);
  let dot = 0;
  for (let i = 0; i < b.indices.length; i++) {
    const av = map.get(b.indices[i]);
    if (av !== undefined) dot += av * b.amplitudes[i];
  }
  // Norms over the sparse selection (consistent with what was stored).
  let na = 0;
  for (let i = 0; i < a.amplitudes.length; i++) na += a.amplitudes[i] * a.amplitudes[i];
  let nb = 0;
  for (let i = 0; i < b.amplitudes.length; i++) nb += b.amplitudes[i] * b.amplitudes[i];
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}
