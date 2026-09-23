/**
 * SimHashPhi — content-addressed hashing for sensory feature vectors.
 *
 * Uses 64 fixed φ-seeded random projection vectors; each bit of the
 * hash is sign(dot(x, v_k)). Similar inputs produce hashes with low
 * Hamming distance; identical inputs collide in O(1). Deterministic:
 * the projection matrix is seeded by a φ-recurrence so identical
 * recorded input ⇒ identical hash across runs and devices.
 *
 * Returns the hash as a 16-char lowercase hex string. We avoid bigint
 * because Map<bigint> lookups and bigint XOR are ~20–80× slower than
 * the equivalent number/string operations; the dedup bucketing only
 * needs equality, ordering, and a popcount-based distance.
 */

const BITS = 64;
const PHI = 1.6180339887498949;

// φ-recurrence seeded LCG — deterministic & dependency-free.
function phiSeededFloats(n: number, seed: number): Float32Array {
  const out = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    // Weyl sequence over φ — uniform, low-discrepancy
    s = (s + 0x9e3779b9) >>> 0; // 2^32 / φ
    const u = (s & 0xffffffff) / 0x1_0000_0000;
    // Box-Muller, deterministic
    const v = (((s ^ (s >>> 15)) * 0x85ebca6b) >>> 0) / 0x1_0000_0000;
    const r = Math.sqrt(-2 * Math.log(Math.max(1e-12, u)));
    out[i] = r * Math.cos(2 * Math.PI * v);
  }
  return out;
}

const projectionCache = new Map<number, Float32Array[]>();

function projectionsFor(featureDim: number): Float32Array[] {
  const hit = projectionCache.get(featureDim);
  if (hit) return hit;
  const projs: Float32Array[] = [];
  for (let k = 0; k < BITS; k++) {
    // each band seeded by φ^k mod 2^32
    const seed = Math.floor((Math.pow(PHI, k + 1) * 1e9) % 0x1_0000_0000);
    projs.push(phiSeededFloats(featureDim, seed));
  }
  projectionCache.set(featureDim, projs);
  return projs;
}

/** Hash a feature vector to a 64-bit SimHash, returned as 16-char lowercase hex. */
export function simHash64(feature: Float32Array): string {
  const projs = projectionsFor(feature.length);
  const N = feature.length;
  let hi = 0 >>> 0;
  let lo = 0 >>> 0;
  for (let k = 0; k < BITS; k++) {
    const v = projs[k];
    let acc = 0;
    for (let i = 0; i < N; i++) acc += feature[i] * v[i];
    if (acc >= 0) {
      if (k < 32) lo = (lo | (1 << k)) >>> 0;
      else hi = (hi | (1 << (k - 32))) >>> 0;
    }
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

// Popcount via SWAR (Hamming weight).
function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Hamming distance between two 16-char hex SimHashes. */
export function hamming64(a: string, b: string): number {
  if (a === b) return 0;
  const aHi = parseInt(a.slice(0, 8), 16) >>> 0;
  const aLo = parseInt(a.slice(8, 16), 16) >>> 0;
  const bHi = parseInt(b.slice(0, 8), 16) >>> 0;
  const bLo = parseInt(b.slice(8, 16), 16) >>> 0;
  return popcount32(aHi ^ bHi) + popcount32(aLo ^ bLo);
}

/** Parse the (hi, lo) halves of a 16-char hex SimHash. */
export function parseHash64(h: string): { hi: number; lo: number } {
  return {
    hi: parseInt(h.slice(0, 8), 16) >>> 0,
    lo: parseInt(h.slice(8, 16), 16) >>> 0,
  };
}

/**
 * Hot-loop variant: caller pre-parses the query once with parseHash64()
 * and reuses (qHi, qLo) across an entire bucket scan, skipping 2 parseInt
 * calls per candidate vs hamming64(h, query).
 */
export function hammingPre(qHi: number, qLo: number, b: string): number {
  const bHi = parseInt(b.slice(0, 8), 16) >>> 0;
  const bLo = parseInt(b.slice(8, 16), 16) >>> 0;
  let x = qHi ^ bHi;
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  const h1 = (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  let y = qLo ^ bLo;
  y = y - ((y >>> 1) & 0x55555555);
  y = (y & 0x33333333) + ((y >>> 2) & 0x33333333);
  const h2 = (((y + (y >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  return h1 + h2;
}

/** Coarsen a hash by retaining the top `bits` bits — bucket key for near-duplicates. */
export function bucketKey(h: string, bits = 12): string {
  // First `ceil(bits/4)` hex chars contain the top `bits` bits (≤ 16).
  const chars = Math.max(1, Math.min(16, Math.ceil(bits / 4)));
  return h.slice(0, chars);
}
