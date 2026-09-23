/**
 * LatentSpace — distributional semantics for the local corpus.
 *
 * Phase 3 of Ω-VEC. The hashed feature vector (tokenize.ts) is a *surface*
 * channel: it matches text that looks alike. This layer learns what terms
 * MEAN from their company — a term–term co-occurrence matrix, reweighted by
 * PPMI (positive pointwise mutual information, with the α=0.75 context
 * smoothing that is standard for count-based embeddings), then factorised by
 * a deterministic block power iteration into k latent axes.
 *
 * Every step is exact and reproducible:
 *   • vocabulary is chosen by frequency with a lexicographic tie-break
 *   • the iteration is seeded from FNV-1a signs, never Math.random
 *   • orthonormalisation is modified Gram–Schmidt with a fixed sweep count
 * so the same corpus yields byte-identical embeddings on every device.
 *
 * Untrained, the space ABSTAINS: `similarity()` returns NaN and the recall
 * cascade renormalises without it, so ranking is unchanged until a build has
 * actually run. No channel is ever allowed to score on empty structure.
 */

import { fnv1a } from './tokenize';

export interface LatentOptions {
  /** vocabulary cap — top terms by corpus frequency */
  vocab?: number;
  /** latent axes (F9 = 34 by default) */
  dims?: number;
  /** power-iteration sweeps */
  iters?: number;
  /** salient terms taken from each document */
  perDoc?: number;
}

export interface LatentBuildReport {
  vocab: number;
  dims: number;
  documents: number;
  pairs: number;
  iters: number;
  /** spectral energy captured on each axis, descending */
  spectrum: number[];
  ms: number;
}

const CDS_ALPHA = 0.75;   // context distribution smoothing
const EPS = 1e-12;

/** Deterministic ±1 seed for the iteration block — no RNG anywhere. */
function seedValue(term: string, axis: number): number {
  const h = fnv1a(`${term}#${axis}`, 0x9e3779b9);
  // map to (-1,1) with a stable, uniform-ish spread
  return ((h % 2097152) / 1048576) - 1;
}

export class LatentSpace {
  private terms: string[] = [];
  private index = new Map<string, number>();
  /** term → latent row (dims) */
  private vectors: Float64Array[] = [];
  private spectrum: number[] = [];
  private dims = 0;
  private built = false;
  private lastReport: LatentBuildReport | null = null;

  get trained(): boolean { return this.built; }
  get size(): number { return this.terms.length; }
  get axes(): number { return this.dims; }
  report(): LatentBuildReport | null { return this.lastReport; }

  /**
   * Build the space from salience-ordered term lists (one per document/chunk).
   * `docs` is consumed once; nothing is retained but the factorisation.
   */
  build(docs: ReadonlyArray<readonly string[]>, opts: LatentOptions = {}): LatentBuildReport {
    const t0 = Date.now();
    const V = Math.max(32, Math.min(opts.vocab ?? 2048, 16384));
    const K = Math.max(2, Math.min(opts.dims ?? 34, 144));
    const ITERS = Math.max(4, Math.min(opts.iters ?? 24, 128));
    const PER = Math.max(4, Math.min(opts.perDoc ?? 24, 64));

    // ── 1. vocabulary by frequency, lexicographic tie-break ──────────────
    const freq = new Map<string, number>();
    for (const d of docs) {
      const k = Math.min(d.length, PER);
      for (let i = 0; i < k; i++) freq.set(d[i], (freq.get(d[i]) ?? 0) + 1);
    }
    const vocab = [...freq.entries()]
      .filter(([, c]) => c >= 2)                       // a hapax has no distribution
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, V)
      .map(([t]) => t);

    this.terms = vocab;
    this.index = new Map(vocab.map((t, i) => [t, i]));
    this.dims = Math.min(K, Math.max(2, vocab.length - 1));
    const n = vocab.length;

    if (n < 4) {
      this.built = false;
      this.vectors = [];
      this.spectrum = [];
      this.lastReport = { vocab: n, dims: 0, documents: docs.length, pairs: 0, iters: 0, spectrum: [], ms: Date.now() - t0 };
      return this.lastReport;
    }

    // ── 2. symmetric co-occurrence counts ────────────────────────────────
    const rows: Array<Map<number, number>> = Array.from({ length: n }, () => new Map());
    const marginal = new Float64Array(n);
    let total = 0;
    let pairs = 0;
    for (const d of docs) {
      const ids: number[] = [];
      const k = Math.min(d.length, PER);
      for (let i = 0; i < k; i++) {
        const id = this.index.get(d[i]);
        if (id !== undefined) ids.push(id);
      }
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i], b = ids[j];
          if (a === b) continue;
          // salience-decayed weight: nearer the head of the list ⇒ heavier
          const w = 1 / Math.sqrt((i + 1) * (j + 1));
          rows[a].set(b, (rows[a].get(b) ?? 0) + w);
          rows[b].set(a, (rows[b].get(a) ?? 0) + w);
          marginal[a] += w; marginal[b] += w;
          total += 2 * w;
          pairs++;
        }
      }
    }
    if (total <= 0) {
      this.built = false;
      this.lastReport = { vocab: n, dims: 0, documents: docs.length, pairs: 0, iters: 0, spectrum: [], ms: Date.now() - t0 };
      return this.lastReport;
    }

    // ── 3. PPMI with context distribution smoothing ──────────────────────
    let ctxTotal = 0;
    const ctxP = new Float64Array(n);
    for (let i = 0; i < n; i++) { ctxP[i] = Math.pow(marginal[i], CDS_ALPHA); ctxTotal += ctxP[i]; }
    for (let i = 0; i < n; i++) ctxP[i] /= ctxTotal || 1;

    const ppmi: Array<Map<number, number>> = Array.from({ length: n }, () => new Map());
    for (let i = 0; i < n; i++) {
      const pi = marginal[i] / total;
      if (pi <= 0) continue;
      for (const [j, c] of rows[i]) {
        const pij = c / total;
        const v = Math.log(pij / (pi * ctxP[j] + EPS) + EPS);
        if (v > 0) ppmi[i].set(j, v);
      }
    }

    // ── 4. deterministic block power iteration on the symmetric PPMI ─────
    const K2 = this.dims;
    // X: n × K2, column-major blocks stored as array of rows
    let X: Float64Array[] = Array.from({ length: n }, (_, i) => {
      const r = new Float64Array(K2);
      for (let a = 0; a < K2; a++) r[a] = seedValue(vocab[i], a);
      return r;
    });
    orthonormalise(X, K2);

    for (let it = 0; it < ITERS; it++) {
      const Y: Float64Array[] = Array.from({ length: n }, () => new Float64Array(K2));
      for (let i = 0; i < n; i++) {
        const yi = Y[i];
        for (const [j, w] of ppmi[i]) {
          const xj = X[j];
          for (let a = 0; a < K2; a++) yi[a] += w * xj[a];
        }
      }
      orthonormalise(Y, K2);
      X = Y;
    }

    // Rayleigh quotients = eigenvalues; scale each axis by √λ so that a
    // dot product between term rows approximates the PPMI inner product.
    const lambda = new Float64Array(K2);
    for (let i = 0; i < n; i++) {
      const xi = X[i];
      for (const [j, w] of ppmi[i]) {
        const xj = X[j];
        for (let a = 0; a < K2; a++) lambda[a] += xi[a] * w * xj[a];
      }
    }
    const order = [...Array(K2).keys()].sort((a, b) => Math.abs(lambda[b]) - Math.abs(lambda[a]) || a - b);
    this.vectors = X.map((row) => {
      const out = new Float64Array(K2);
      for (let a = 0; a < K2; a++) {
        const src = order[a];
        out[a] = row[src] * Math.sqrt(Math.max(lambda[src], 0));
      }
      return out;
    });
    this.spectrum = order.map((src) => Math.max(lambda[src], 0));
    this.built = this.spectrum[0] > 0;

    this.lastReport = {
      vocab: n, dims: K2, documents: docs.length, pairs, iters: ITERS,
      spectrum: this.spectrum.slice(0, 12).map((v) => Number(v.toFixed(6))),
      ms: Date.now() - t0,
    };
    return this.lastReport;
  }

  /** Latent embedding of a term list; null when nothing in it is known. */
  embed(terms: readonly string[], weight?: (t: string) => number): Float64Array | null {
    if (!this.built) return null;
    const v = new Float64Array(this.dims);
    let hits = 0;
    for (const t of terms) {
      const id = this.index.get(t);
      if (id === undefined) continue;
      const w = weight ? weight(t) : 1;
      if (!(w > 0)) continue;
      const row = this.vectors[id];
      for (let a = 0; a < this.dims; a++) v[a] += w * row[a];
      hits++;
    }
    if (hits === 0) return null;
    let n = 0;
    for (let a = 0; a < this.dims; a++) n += v[a] * v[a];
    n = Math.sqrt(n);
    if (!(n > 0)) return null;
    for (let a = 0; a < this.dims; a++) v[a] /= n;
    return v;
  }

  /** Cosine in latent space, NaN when either side is unrepresentable. */
  similarity(a: Float64Array | null, b: Float64Array | null): number {
    if (!a || !b) return NaN;
    const n = Math.min(a.length, b.length);
    let d = 0;
    for (let i = 0; i < n; i++) d += a[i] * b[i];
    return d;
  }

  /** Nearest terms — the human-readable proof the space learned something. */
  neighbours(term: string, n = 8): Array<{ term: string; sim: number }> {
    if (!this.built) return [];
    const id = this.index.get(term);
    if (id === undefined) return [];
    const q = normalised(this.vectors[id]);
    if (!q) return [];
    const out: Array<{ term: string; sim: number }> = [];
    for (let i = 0; i < this.terms.length; i++) {
      if (i === id) continue;
      const v = normalised(this.vectors[i]);
      if (!v) continue;
      let d = 0;
      for (let a = 0; a < this.dims; a++) d += q[a] * v[a];
      out.push({ term: this.terms[i], sim: d });
    }
    out.sort((x, y) => y.sim - x.sim || (x.term < y.term ? -1 : 1));
    return out.slice(0, n);
  }

  clear(): void {
    this.terms = []; this.index.clear(); this.vectors = [];
    this.spectrum = []; this.dims = 0; this.built = false; this.lastReport = null;
  }
}

function normalised(v: Float64Array): Float64Array | null {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (!(n > 0)) return null;
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** Modified Gram–Schmidt over the K columns of an n×K row-major block. */
function orthonormalise(X: Float64Array[], K: number): void {
  const n = X.length;
  for (let a = 0; a < K; a++) {
    for (let b = 0; b < a; b++) {
      let d = 0;
      for (let i = 0; i < n; i++) d += X[i][a] * X[i][b];
      if (d === 0) continue;
      for (let i = 0; i < n; i++) X[i][a] -= d * X[i][b];
    }
    let nn = 0;
    for (let i = 0; i < n; i++) nn += X[i][a] * X[i][a];
    nn = Math.sqrt(nn);
    if (nn > 1e-12) {
      for (let i = 0; i < n; i++) X[i][a] /= nn;
    } else {
      // A collapsed axis is re-seeded deterministically rather than left at
      // zero, so the block keeps full rank without any randomness.
      for (let i = 0; i < n; i++) X[i][a] = seedValue(`collapse${a}`, i % 64) / Math.sqrt(n);
    }
  }
}
