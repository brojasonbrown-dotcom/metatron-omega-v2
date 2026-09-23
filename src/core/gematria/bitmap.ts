/**
 * FieldBitmap — deterministic multi-plane bitmap encoding of a field vector.
 *
 * Extends the single-plane φ-seeded SimHash (src/core/sensory/SimHashPhi.ts)
 * to P planes of 64 bits. Each bit is sign(⟨x, v_k⟩) against a φ-recurrence
 * seeded projection, so the code is:
 *
 *   • deterministic  — identical input ⇒ identical bitmap on every device
 *   • locality-sensitive — Hamming distance ∝ angular distance
 *   • O(1) to compare — popcount only, no string parsing in the hot path
 *
 * Planes are weighted by φ⁻ᵖ (Zeckendorf-style decreasing significance) so
 * plane 0 dominates the coarse ordering while later planes break ties.
 *
 * This is a PREFILTER. The exact resonance kernel always rescores the
 * survivors — bitmaps never decide a match on their own.
 */

import { PHI_INV } from './zphi';

export const PLANES = 4;
const BITS_PER_PLANE = 64;
export const BITMAP_WORDS = PLANES * 2; // two uint32 lanes per plane
export const MAX_DISTANCE = PLANES * BITS_PER_PLANE;

/** Deterministic φ-recurrence (Weyl + Box–Muller) projection generator. */
function phiSeededFloats(n: number, seed: number): Float32Array {
  const out = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s + 0x9e3779b9) >>> 0; // 2³²/φ
    const u = (s & 0xffffffff) / 0x1_0000_0000;
    const v = (((s ^ (s >>> 15)) * 0x85ebca6b) >>> 0) / 0x1_0000_0000;
    const r = Math.sqrt(-2 * Math.log(Math.max(1e-12, u)));
    out[i] = r * Math.cos(2 * Math.PI * v);
  }
  return out;
}

const cache = new Map<string, Float32Array[]>();

function projections(dim: number): Float32Array[] {
  const key = `${dim}:${PLANES}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const total = PLANES * BITS_PER_PLANE;
  const projs: Float32Array[] = new Array(total);
  for (let k = 0; k < total; k++) {
    // seed = φ^(k+1) scaled — distinct, low-discrepancy, reproducible
    const seed = Math.floor((Math.pow(1.618033988749895, (k % 64) + 1) * 1e9 + k * 2654435761) % 0x1_0000_0000);
    projs[k] = phiSeededFloats(dim, seed);
  }
  cache.set(key, projs);
  return projs;
}

/** Encode a dense vector to a PLANES×64 bitmap (Uint32Array of 2·PLANES lanes). */
export function encodeBitmap(vec: ArrayLike<number>): Uint32Array {
  const dim = vec.length;
  const projs = projections(dim);
  const out = new Uint32Array(BITMAP_WORDS);
  for (let k = 0; k < PLANES * BITS_PER_PLANE; k++) {
    const v = projs[k];
    let acc = 0;
    for (let i = 0; i < dim; i++) acc += (vec[i] as number) * v[i];
    if (acc >= 0) {
      const lane = (k >>> 5); // 32 bits per lane
      out[lane] = (out[lane] | (1 << (k & 31))) >>> 0;
    }
  }
  return out;
}

/** Encode a sparse (indices, amplitudes) signature at a known dense dim. */
export function encodeBitmapSparse(
  indices: ArrayLike<number>, amps: ArrayLike<number>, dim: number,
): Uint32Array {
  const dense = new Float64Array(dim);
  for (let i = 0; i < indices.length; i++) {
    const j = indices[i] as number;
    if (j >= 0 && j < dim) dense[j] = amps[i] as number;
  }
  return encodeBitmap(dense);
}

function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Raw Hamming distance over all planes (0…MAX_DISTANCE). */
export function hamming(a: Uint32Array, b: Uint32Array): number {
  let d = 0;
  for (let i = 0; i < BITMAP_WORDS; i++) d += popcount32((a[i] ^ b[i]) >>> 0);
  return d;
}

/** φ⁻ᵖ plane-weighted distance, normalised to [0,1]. Lower = closer. */
export function weightedDistance(a: Uint32Array, b: Uint32Array): number {
  let d = 0, wsum = 0, w = 1;
  for (let p = 0; p < PLANES; p++) {
    const lo = popcount32((a[p * 2] ^ b[p * 2]) >>> 0);
    const hi = popcount32((a[p * 2 + 1] ^ b[p * 2 + 1]) >>> 0);
    d += w * (lo + hi);
    wsum += w * BITS_PER_PLANE;
    w *= PHI_INV;
  }
  return wsum > 0 ? d / wsum : 1;
}

/** Cheap resonance proxy in [0,1]: cos²(π·d/2) style angular estimate. */
export function bitmapResonance(a: Uint32Array, b: Uint32Array): number {
  const frac = hamming(a, b) / MAX_DISTANCE;      // ≈ θ/π
  const cos = Math.cos(Math.PI * frac);
  return cos * cos;                                // matches |⟨a|b⟩|²/(‖a‖²‖b‖²)
}

/** LSH bucket key — top `bits` bits of plane 0. Near-duplicates collide. */
export function bucketOf(bm: Uint32Array, bits = 12): string {
  const lo = bm[0] >>> 0;
  const mask = bits >= 32 ? 0xffffffff : ((1 << bits) - 1) >>> 0;
  return (lo & mask).toString(16);
}

export function bitmapToHex(bm: Uint32Array): string {
  let s = '';
  for (let i = 0; i < BITMAP_WORDS; i++) s += bm[i].toString(16).padStart(8, '0');
  return s;
}

export function bitmapFromHex(hex: string): Uint32Array {
  const out = new Uint32Array(BITMAP_WORDS);
  for (let i = 0; i < BITMAP_WORDS; i++) out[i] = parseInt(hex.slice(i * 8, i * 8 + 8), 16) >>> 0;
  return out;
}

/** Total set bits — a structural density feature (data, not meaning). */
export function bitmapWeight(bm: Uint32Array): number {
  let w = 0;
  for (let i = 0; i < BITMAP_WORDS; i++) w += popcount32(bm[i]);
  return w;
}
