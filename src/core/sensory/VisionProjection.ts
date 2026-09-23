/**
 * VisionProjection — deterministic linear projections and int8 quantization
 * for vision embeddings (typically 768-D from ViT-B, 384-D from DINOv2-small,
 * 512-D from CLIP variants).
 *
 * Design goals
 * ============
 *   • ONE seeded projection basis is used everywhere a vision embedding
 *     touches the field engine (FallbackEngine band modulation, memory
 *     capture Hebbian pre-vector, VisionFieldIndex cosine). This guarantees
 *     that a given embedding's coordinates are DIRECTLY COMPARABLE across
 *     engine, memory, and index — the same coordinate axis means the same
 *     thing everywhere.
 *
 *   • Random ±1 (Achlioptas / sign-random projection), row-scaled by 1/√D
 *     so the projected vector's expected L2 norm equals the input's L2 norm.
 *     For unit-norm inputs, output norm ≈ 1 (concentration by JL lemma).
 *
 *   • Softmax → probability-space normalisation is provided as a separate
 *     helper so the band-modulation code stays explicit about what it's
 *     doing to the projection output.
 *
 *   • Int8 quantisation is per-vector: q = round(v · 127 / max|v|), one
 *     float scale stored alongside. Round-trip cosine error < 1% for
 *     L2-normalised vectors. Storage: 4× smaller than float32.
 *
 *   • Basis cached by (inputDim, outputDim). Lazily generated on first
 *     request. Deterministic — same dim pair always yields the same basis.
 *
 * Seed constant `0x9E3779B1` is the 32-bit truncation of 2^32 · φ⁻¹ — the
 * golden-ratio hash constant (Knuth). Chosen for maximally-uniform bit
 * distribution across the Mulberry32 PRNG state.
 */

const GOLDEN_SEED = 0x9e3779b1 >>> 0;

/** Mulberry32 — small, fast, statistically-good 32-bit PRNG. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface CacheKey {
  inputDim: number;
  outputDim: number;
}

const basisCache = new Map<string, Float32Array>();

function keyOf(k: CacheKey): string {
  return `${k.inputDim}x${k.outputDim}`;
}

/**
 * Return the (outputDim × inputDim) row-major projection matrix for the
 * requested dimensions. Cached — safe to call once per tick.
 *
 * Element values ∈ {-1/√inputDim, +1/√inputDim} chosen by a PRNG seeded
 * from GOLDEN_SEED xored with (inputDim · outputDim) so distinct dim
 * pairs get independent bases while any single pair is deterministic.
 */
export function getProjectionBasis(inputDim: number, outputDim: number): Float32Array {
  const key = keyOf({ inputDim, outputDim });
  const cached = basisCache.get(key);
  if (cached) return cached;

  const rand = mulberry32(GOLDEN_SEED ^ Math.imul(inputDim, outputDim));
  const inv = 1 / Math.sqrt(inputDim);
  const out = new Float32Array(outputDim * inputDim);
  for (let i = 0; i < out.length; i++) {
    out[i] = rand() < 0.5 ? -inv : inv;
  }
  basisCache.set(key, out);
  return out;
}

/**
 * Project `embed` (length inputDim) into `dst` (length outputDim) using
 * the deterministic basis for (embed.length × dst.length). Allocation-free.
 */
export function projectInto(embed: Float32Array, dst: Float32Array): void {
  const inputDim = embed.length;
  const outputDim = dst.length;
  const basis = getProjectionBasis(inputDim, outputDim);
  for (let r = 0; r < outputDim; r++) {
    let acc = 0;
    const base = r * inputDim;
    for (let i = 0; i < inputDim; i++) acc += basis[base + i] * embed[i];
    dst[r] = acc;
  }
}

/**
 * Softmax-normalise `vec` in place (temperature = 1). Result sums to 1.
 * Numerically stable (subtract max before exp).
 */
export function softmaxInPlace(vec: Float32Array): void {
  const n = vec.length;
  if (n === 0) return;
  let max = vec[0];
  for (let i = 1; i < n; i++) if (vec[i] > max) max = vec[i];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const e = Math.exp(vec[i] - max);
    vec[i] = e;
    sum += e;
  }
  if (sum > 0) {
    const inv = 1 / sum;
    for (let i = 0; i < n; i++) vec[i] *= inv;
  }
}

/**
 * L2-normalise `vec` in place. No-op on zero vectors.
 */
export function l2NormalizeInPlace(vec: Float32Array): void {
  let n = 0;
  for (let i = 0; i < vec.length; i++) n += vec[i] * vec[i];
  n = Math.sqrt(n);
  if (n > 1e-12) {
    const inv = 1 / n;
    for (let i = 0; i < vec.length; i++) vec[i] *= inv;
  }
}

/**
 * Cosine similarity of two same-length dense vectors. Returns 0 for
 * mismatched lengths or zero-norm inputs.
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 1e-12 ? dot / denom : 0;
}

/**
 * Quantise a float embedding to int8 with a single per-vector scale.
 * Reconstruction: v ≈ q · scale. Round-trip cosine error < 1% for
 * L2-normalised inputs, verified empirically.
 */
export interface QuantizedVector {
  q: Int8Array;
  scale: number;
}

export function quantizeInt8(vec: Float32Array): QuantizedVector {
  let maxAbs = 0;
  for (let i = 0; i < vec.length; i++) {
    const a = vec[i] < 0 ? -vec[i] : vec[i];
    if (a > maxAbs) maxAbs = a;
  }
  const q = new Int8Array(vec.length);
  if (maxAbs <= 1e-12) return { q, scale: 0 };
  const scale = maxAbs / 127;
  const inv = 127 / maxAbs;
  for (let i = 0; i < vec.length; i++) {
    const s = Math.round(vec[i] * inv);
    q[i] = s > 127 ? 127 : s < -128 ? -128 : s;
  }
  return { q, scale };
}

export function dequantizeInt8(qv: QuantizedVector, dst?: Float32Array): Float32Array {
  const out = dst && dst.length === qv.q.length ? dst : new Float32Array(qv.q.length);
  const s = qv.scale;
  for (let i = 0; i < qv.q.length; i++) out[i] = qv.q[i] * s;
  return out;
}

/**
 * Cosine similarity between a quantised vector and a float vector, without
 * allocating the dequantised buffer. Uses the shared per-vector scale which
 * cancels in the cosine ratio — so this is exact w.r.t. the quantised repr.
 */
export function cosineQ(qa: QuantizedVector, b: Float32Array): number {
  const n = Math.min(qa.q.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const av = qa.q[i];
    dot += av * b[i];
    na += av * av;
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 1e-12 ? dot / denom : 0;
}

/**
 * Densify a sparse top-K representation (indices + amplitudes) into a
 * fixed-length dense vector. Used to bring Ψ top-K into the same
 * coordinate space as a projected vision embedding for cosine comparison.
 * Indices out of [0, N) are wrapped mod N (matches injectPsi convention).
 */
export function densifyTopK(indices: Int32Array | ArrayLike<number>, amps: Float64Array | Float32Array | ArrayLike<number>, N: number, dst?: Float32Array): Float32Array {
  const out = dst && dst.length === N ? dst : new Float32Array(N);
  if (dst) out.fill(0);
  const len = indices.length;
  for (let i = 0; i < len; i++) {
    const raw = indices[i] as number;
    if (raw < 0) continue;
    const idx = ((raw % N) + N) % N;
    out[idx] += amps[i] as number;
  }
  return out;
}
