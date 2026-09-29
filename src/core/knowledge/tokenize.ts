/**
 * Ω-VEC — deterministic tokenizer + hashed semantic vector.
 *
 * No model, no network, no randomness: the vector is a multi-probe signed
 * feature hash (FNV-1a) over unigrams, adjacent + skip-1 bigrams and character
 * n-grams, IDF-weighted and L2-normalised. Identical text ⇒ identical vector
 * on every device, which is the same determinism contract the engine holds
 * itself to.
 *
 * What changed from the 512-dim single-probe version, and why:
 *   • dim 512 → 1597 (F17)  — 512 buckets for tens of thousands of features is
 *     destructive interference, not compression.
 *   • 3 independent probes  — count-sketch: collision noise falls ≈ 1/√3.
 *   • character 3/4-grams   — morphology and typo tolerance; an unseen
 *     inflection is no longer a total miss.
 *   • skip-1 bigrams        — a little word order survives the bag.
 *   • numeric/symbol tokens — φ, φ⁻², 1.618, F13 survive tokenisation instead
 *     of being shredded into nothing.
 *   • IDF weighting         — "the field of" no longer weighs like
 *     "lucas closure residue".
 */

/** Fibonacci-tiered widths. 1597 = F17 is the default working resolution. */
export const VECTOR_DIM_TIERS = [610, 1597, 2584, 6765] as const;
export const VECTOR_DIM = 1597;

const STOP = new Set(
  (
    'a an and are as at be by for from has have he in is it its of on or that the to was were will with ' +
    'this these those they them their we you your i not but if then than so such can could would should ' +
    'about into over under after before between during also there here what which who whom whose how why'
  ).split(' '),
);

/**
 * Lowercase tokens. Words, numbers (1.618, 1e-9), and mathematical symbol
 * runs (φ, φ⁻², Ω, λ, ψ) are all preserved — the corpus is full of them and
 * the old tokenizer dropped every one.
 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const raw = text
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9+.#_-]*|[φϕπλψωσμτγδεθκ][\u2070-\u209f⁻¹²³⁴⁵⁶⁷⁸⁹\d^-]*/g);
  if (!raw) return out;
  for (const t of raw) {
    if (t.length > 32) continue;
    // symbol tokens are single-character-significant, keep them at length 1
    const symbolic = /[φϕπλψωσμτγδεθκ]/.test(t);
    if (!symbolic && t.length < 2) continue;
    if (STOP.has(t)) continue;
    out.push(t);
  }
  return out;
}

/** FNV-1a 32-bit — deterministic across runtimes. */
export function fnv1a(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Term frequencies (unigram + adjacent bigram) — the LEXICAL vocabulary.
 * Kept deliberately narrow: this feeds the inverted index, where character
 * grams would multiply postings for no exact-match gain.
 */
export function termCounts(tokens: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    m.set(tokens[i], (m.get(tokens[i]) ?? 0) + 1);
    if (i + 1 < tokens.length) {
      const bg = `${tokens[i]}_${tokens[i + 1]}`;
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
  }
  return m;
}

const CHAR_MIN_TOKEN = 5;

/**
 * Feature counts for the VECTOR channel: unigrams, adjacent bigrams, skip-1
 * bigrams, and character 3/4-grams of longer tokens. Superset of termCounts.
 */
export function featureCounts(tokens: readonly string[]): Map<string, number> {
  const m = termCounts(tokens);
  const bump = (k: string, w = 1) => m.set(k, (m.get(k) ?? 0) + w);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i + 2 < tokens.length) bump(`${t}~${tokens[i + 2]}`); // skip-1 order cue
    if (t.length >= CHAR_MIN_TOKEN) {
      const w = `#${t}#`;
      for (let n = 3; n <= 4; n++) {
        for (let j = 0; j + n <= w.length; j++) bump(`$${w.slice(j, j + n)}`, 0.5);
      }
    }
  }
  return m;
}

/** IDF provider: term → inverse document frequency multiplier. */
export type IdfFn = (term: string) => number;

/**
 * Multi-probe signed feature-hash vector, sublinear tf, optional IDF,
 * L2-normalised. Three probes per feature with distinct FNV seeds average out
 * collision noise (count-sketch) while staying exactly deterministic.
 */
export function hashVector(
  counts: Map<string, number>,
  dim = VECTOR_DIM,
  idf?: IdfFn,
): Float64Array {
  const v = new Float64Array(dim);
  const probes = 3;
  const norm = 1 / Math.sqrt(probes);
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b];
  for (const [term, c] of counts) {
    const base = (1 + Math.log(Math.max(c, 1e-9))) * (idf ? idf(term) : 1);
    if (base === 0) continue;
    for (let p = 0; p < probes; p++) {
      const h = fnv1a(term, seeds[p]);
      const idx = h % dim;
      const sign = (h >>> 31) & 1 ? -1 : 1;
      v[idx] += sign * base * norm;
    }
  }
  let n = 0;
  for (let i = 0; i < dim; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < dim; i++) v[i] /= n;
  return v;
}

export function cosine(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) d += a[i] * b[i];
  return d;
}

/** Vector straight from text (convenience for queries). */
export function embed(text: string, dim = VECTOR_DIM, idf?: IdfFn): Float64Array {
  return hashVector(featureCounts(tokenize(text)), dim, idf);
}
