/**
 * Resonance kernel (Certificate 2).
 *
 *   C(a,b) = |⟨a|b⟩|² / (‖a‖²‖b‖²) ∈ [0,1]
 *
 * Bounded by Cauchy–Schwarz, C(a,a)=1, phase-invariant, and the Gram matrix
 * over any set of vectors is PSD — verified in
 * packages/brain-core/src/formal/cert_resonance_hopfield.wl.
 *
 * Used as the EXACT rescorer after the bitmap Hamming prefilter.
 */

export const PHI = 1.618033988749895;
/** Modern-Hopfield merge floor 1 − 1/φ³ ≈ 0.7639320225. */
export const MERGE_THRESHOLD = 1 - 1 / (PHI * PHI * PHI);

export function resonance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { const x = a[i], y = b[i]; dot += x * y; na += x * x; nb += y * y; }
  for (let i = n; i < a.length; i++) na += a[i] * a[i];
  for (let i = n; i < b.length; i++) nb += b[i] * b[i];
  const denom = na * nb;
  if (denom <= 0) return 0;
  const c = (dot * dot) / denom;
  return c > 1 ? 1 : c;
}

/** Sparse variant: index/amplitude pairs against a dense vector. */
export function resonanceSparse(
  indices: ArrayLike<number>, amps: ArrayLike<number>, dense: ArrayLike<number>,
): number {
  let dot = 0, na = 0;
  for (let i = 0; i < indices.length; i++) {
    const a = amps[i];
    na += a * a;
    const j = indices[i];
    if (j >= 0 && j < dense.length) dot += a * dense[j];
  }
  let nb = 0;
  for (let i = 0; i < dense.length; i++) nb += dense[i] * dense[i];
  const denom = na * nb;
  if (denom <= 0) return 0;
  const c = (dot * dot) / denom;
  return c > 1 ? 1 : c;
}

/** β = φ/√d — the verified inverse-temperature for the Hopfield update. */
export function hopfieldBeta(d: number): number {
  return d > 0 ? PHI / Math.sqrt(d) : PHI;
}

/**
 * One modern-Hopfield step: ξ ← Xᵀ·softmax(β·X·ξ), unit-normalised.
 * `patterns` are the stored rows (all length d). Energy decreases
 * monotonically (Ramsauer et al. 2020, re-verified in Certificate 2.4).
 */
export function hopfieldStep(
  patterns: ReadonlyArray<Float64Array>, query: Float64Array, beta = hopfieldBeta(query.length),
): Float64Array {
  const m = patterns.length;
  const d = query.length;
  const out = new Float64Array(d);
  if (m === 0) return out;
  const scores = new Float64Array(m);
  let max = -Infinity;
  for (let k = 0; k < m; k++) {
    const p = patterns[k];
    let dot = 0;
    for (let i = 0; i < d && i < p.length; i++) dot += p[i] * query[i];
    scores[k] = beta * dot;
    if (scores[k] > max) max = scores[k];
  }
  let sum = 0;
  for (let k = 0; k < m; k++) { scores[k] = Math.exp(scores[k] - max); sum += scores[k]; }
  if (sum <= 0) return out;
  for (let k = 0; k < m; k++) {
    const w = scores[k] / sum;
    const p = patterns[k];
    for (let i = 0; i < d && i < p.length; i++) out[i] += w * p[i];
  }
  let norm = 0;
  for (let i = 0; i < d; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < d; i++) out[i] /= norm;
  return out;
}

/** Modern-Hopfield energy E(x) = −logsumexp(β·Xx)/β + ½⟨x,x⟩. */
export function hopfieldEnergy(
  patterns: ReadonlyArray<Float64Array>, x: Float64Array, beta = hopfieldBeta(x.length),
): number {
  if (patterns.length === 0) return 0;
  let max = -Infinity;
  const s: number[] = [];
  for (const p of patterns) {
    let dot = 0;
    for (let i = 0; i < x.length && i < p.length; i++) dot += p[i] * x[i];
    const v = beta * dot;
    s.push(v);
    if (v > max) max = v;
  }
  let sum = 0;
  for (const v of s) sum += Math.exp(v - max);
  const lse = max + Math.log(sum);
  let xx = 0;
  for (let i = 0; i < x.length; i++) xx += x[i] * x[i];
  return -lse / beta + 0.5 * xx;
}
