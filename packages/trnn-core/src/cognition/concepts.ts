/**
 * Ω-P7 — the concept store: HNSW graph over product-quantised embeddings.
 *
 * The braid (Ω-P6) is an *episodic* memory: it holds whole field snapshots and
 * answers "have I been in this state". The concept store is *semantic*: it
 * holds many more, much smaller embeddings and answers "what is this like",
 * in sublinear time, with a bounded memory budget.
 *
 * Two structures, each doing exactly one job:
 *
 *   HNSW  — a navigable small-world graph in log levels. Level assignment is
 *           the standard geometric law l = ⌊−ln u · mL⌋ with mL = 1/ln M, but
 *           u comes from the deterministic SeedStream, never Math.random: the
 *           graph a seed builds is the graph every replay builds.
 *
 *   PQ    — product quantisation. The embedding is split into `sub` subspaces,
 *           each quantised to `centroids` codes by deterministic Lloyd (seeded
 *           k-means++ init, fixed iteration count). Search scores candidates
 *           from an asymmetric distance table (query kept in full precision),
 *           then re-ranks the shortlist on the exact vectors — so PQ only ever
 *           changes *which* candidates are examined, never the final ordering
 *           of what is returned.
 *
 * Every vector is stored L2-normalised, so inner product is cosine and the
 * squared distance is 2 − 2·cos: one monotone map, no second metric to keep in
 * sync.
 */

import { SeedStream } from '../core/determinism';
import { dlog } from '../core/dmath';

export interface ConceptRecord {
  readonly id: number;
  readonly key: string;
  readonly label?: string;
  readonly tick: number;
  /** How many searches have returned this concept as their best hit. */
  readonly hits: number;
  /** L2 norm of the embedding before normalisation (0 ⇒ degenerate input). */
  readonly rawNorm: number;
  readonly level: number;
}

export interface SearchHit {
  readonly id: number;
  readonly key: string;
  /** Exact cosine against the query (re-ranked, not the PQ estimate). */
  readonly score: number;
}

export interface SearchTrace {
  readonly hits: readonly SearchHit[];
  /** Exact distance computations performed (the cost that HNSW is buying down). */
  readonly exactOps: number;
  /** PQ table lookups performed. */
  readonly pqOps: number;
  /** Graph hops taken across all levels. */
  readonly hops: number;
}

export interface ConceptStoreOptions {
  readonly dim: number;
  readonly capacity: number;
  /** Neighbours per node per level (M in the HNSW paper). */
  readonly M?: number;
  readonly efConstruction?: number;
  readonly efSearch?: number;
  readonly seed?: string;
  /** PQ subspaces; must divide `dim` or PQ stays off. */
  readonly sub?: number;
  /** Codes per subspace (≤ 256, stored as bytes). */
  readonly centroids?: number;
  /** Train PQ once this many concepts are held. */
  readonly trainAt?: number;
}

export interface ConceptStats {
  readonly size: number;
  readonly capacity: number;
  readonly dim: number;
  readonly levels: number;
  readonly M: number;
  readonly efSearch: number;
  readonly pqReady: boolean;
  readonly sub: number;
  readonly centroids: number;
  /** Mean |exact − PQ| cosine error measured on the last search. */
  readonly pqError: number;
  /** Bytes held by the PQ codes vs the full vectors they stand in for. */
  readonly codeBytes: number;
  readonly vectorBytes: number;
  readonly searches: number;
  readonly evictions: number;
}

const LLOYD_ITERATIONS = 8;

/** Squared distance from cosine on unit vectors: d² = 2 − 2·cos. */
function cosFromD2(d2: number): number {
  return 1 - d2 / 2;
}

export class ConceptStore {
  readonly dim: number;
  readonly capacity: number;
  readonly M: number;
  readonly efConstruction: number;
  efSearch: number;

  private readonly vecs: Float64Array;
  private readonly rand: SeedStream;
  private readonly meta: {
    key: string;
    label?: string;
    tick: number;
    hits: number;
    rawNorm: number;
    level: number;
  }[] = [];
  private readonly byKey = new Map<string, number>();

  /** links[level][node] — neighbour ids, capped at M (2M on level 0). */
  private readonly links: number[][][] = [];
  private entry = -1;
  private topLevel = -1;
  private readonly mL: number;

  // ---- product quantisation ----
  private readonly sub: number;
  private readonly centroids: number;
  private readonly subDim: number;
  private readonly trainAt: number;
  private codebook: Float64Array | null = null; // sub × centroids × subDim
  private codes: Uint8Array | null = null; // capacity × sub
  private table: Float64Array; // sub × centroids scratch for the query
  private pqErrorLast = 0;
  private searches = 0;
  private evictions = 0;

  // search scratch, reused: no allocation on the query path
  private readonly visited: Int32Array;
  private visitMark = 0;
  private readonly qbuf: Float64Array;

  constructor(opts: ConceptStoreOptions) {
    this.dim = Math.max(1, Math.floor(opts.dim));
    this.capacity = Math.max(1, Math.floor(opts.capacity));
    this.M = Math.max(2, Math.floor(opts.M ?? 16));
    this.efConstruction = Math.max(this.M, Math.floor(opts.efConstruction ?? 64));
    this.efSearch = Math.max(1, Math.floor(opts.efSearch ?? 32));
    this.mL = 1 / dlog(this.M);
    this.rand = new SeedStream(opts.seed ?? 'omega-concepts');
    this.vecs = new Float64Array(this.capacity * this.dim);
    this.visited = new Int32Array(this.capacity);
    this.qbuf = new Float64Array(this.dim);

    const wanted = Math.max(1, Math.floor(opts.sub ?? 8));
    this.sub = this.dim % wanted === 0 ? wanted : 1;
    this.subDim = this.dim / this.sub;
    this.centroids = Math.min(256, Math.max(2, Math.floor(opts.centroids ?? 16)));
    this.trainAt = Math.max(this.centroids, Math.floor(opts.trainAt ?? this.centroids * 4));
    this.table = new Float64Array(this.sub * this.centroids);
  }

  get size(): number {
    return this.meta.length;
  }

  get pqReady(): boolean {
    return this.codebook !== null;
  }

  records(): readonly ConceptRecord[] {
    return this.meta.map((m, id) => ({
      id,
      key: m.key,
      label: m.label,
      tick: m.tick,
      hits: m.hits,
      rawNorm: m.rawNorm,
      level: m.level,
    }));
  }

  stats(): ConceptStats {
    return {
      size: this.meta.length,
      capacity: this.capacity,
      dim: this.dim,
      levels: this.topLevel + 1,
      M: this.M,
      efSearch: this.efSearch,
      pqReady: this.pqReady,
      sub: this.sub,
      centroids: this.centroids,
      pqError: this.pqErrorLast,
      codeBytes: this.meta.length * this.sub,
      vectorBytes: this.meta.length * this.dim * 8,
      searches: this.searches,
      evictions: this.evictions,
    };
  }

  /**
   * Insert (or refresh) a concept. Returns its id. An existing key overwrites
   * its embedding in place and keeps its graph position: a concept that drifts
   * is the same concept, and re-linking it would churn the graph for nothing.
   */
  add(key: string, vec: ArrayLike<number>, tick: number, label?: string): number {
    const existing = this.byKey.get(key);
    if (existing !== undefined) {
      const raw = this.writeVector(existing, vec);
      this.meta[existing].tick = tick;
      this.meta[existing].rawNorm = raw;
      if (label !== undefined) this.meta[existing].label = label;
      if (this.codebook) this.encodeOne(existing);
      return existing;
    }

    let id: number;
    if (this.meta.length < this.capacity) {
      id = this.meta.length;
      this.meta.push({ key, label, tick, hits: 0, rawNorm: 0, level: 0 });
    } else {
      // Evict the least-used, oldest concept and take its slot. Its links stay
      // valid as graph edges (same slot id), which keeps the graph connected;
      // the neighbourhood re-converges as the new vector is re-linked below.
      id = this.evictSlot();
      this.byKey.delete(this.meta[id].key);
      this.meta[id] = { key, label, tick, hits: 0, rawNorm: 0, level: this.meta[id].level };
      this.evictions++;
    }
    this.byKey.set(key, id);
    this.meta[id].rawNorm = this.writeVector(id, vec);

    const level = this.assignLevel();
    this.meta[id].level = level;
    this.ensureLevels(level);
    for (let l = 0; l <= level; l++) this.links[l][id] = this.links[l][id] ?? [];

    if (this.entry === -1) {
      this.entry = id;
      this.topLevel = level;
      if (this.codebook) this.encodeOne(id);
      return id;
    }

    // descend from the top level greedily, then link at every level ≤ level
    let cur = this.entry;
    for (let l = this.topLevel; l > level; l--) cur = this.greedy(cur, id, l);
    for (let l = Math.min(level, this.topLevel); l >= 0; l--) {
      const cand = this.searchLayer(this.vectorAt(id), cur, l, this.efConstruction, id);
      const chosen = this.selectNeighbours(id, cand, l === 0 ? this.M * 2 : this.M);
      this.links[l][id] = chosen.slice();
      for (const nb of chosen) this.connect(nb, id, l);
      cur = chosen.length ? chosen[0] : cur;
    }
    if (level > this.topLevel) {
      this.topLevel = level;
      this.entry = id;
    }

    if (this.codebook) this.encodeOne(id);
    else if (this.meta.length >= this.trainAt) this.trainPQ();
    return id;
  }

  /** kNN by cosine. Exact ordering; PQ only prunes the candidate set. */
  search(vec: ArrayLike<number>, k = 5, ef = this.efSearch): SearchTrace {
    if (this.entry === -1 || this.meta.length === 0) {
      return { hits: [], exactOps: 0, pqOps: 0, hops: 0 };
    }
    const q = this.normaliseInto(vec, this.qbuf);
    this.searches++;
    if (q === 0) return { hits: [], exactOps: 0, pqOps: 0, hops: 0 };

    this.opsExact = 0;
    this.opsPq = 0;
    this.opsHops = 0;
    if (this.codebook) this.buildTable(this.qbuf);

    let cur = this.entry;
    for (let l = this.topLevel; l > 0; l--) cur = this.greedyVec(cur, this.qbuf, l);
    const cand = this.searchLayer(this.qbuf, cur, 0, Math.max(ef, k), -1);

    // exact re-rank of the shortlist
    let errSum = 0;
    let errN = 0;
    const scored = cand.map((id) => {
      const exact = this.cosineAt(id, this.qbuf);
      if (this.codebook) {
        errSum += Math.abs(exact - cosFromD2(this.pqDistance(id)));
        errN++;
      }
      return { id, score: exact };
    });
    scored.sort((a, b) => b.score - a.score || a.id - b.id);
    this.pqErrorLast = errN ? errSum / errN : 0;

    const hits = scored.slice(0, k).map((h) => ({
      id: h.id,
      key: this.meta[h.id].key,
      score: h.score,
    }));
    if (hits.length) this.meta[hits[0].id].hits++;
    return { hits, exactOps: this.opsExact, pqOps: this.opsPq, hops: this.opsHops };
  }

  // ---- internals -------------------------------------------------------

  private opsExact = 0;
  private opsPq = 0;
  private opsHops = 0;

  private writeVector(id: number, vec: ArrayLike<number>): number {
    const off = id * this.dim;
    let sum = 0;
    for (let i = 0; i < this.dim; i++) {
      const v = i < vec.length ? vec[i] : 0;
      const x = Number.isFinite(v) ? v : 0;
      this.vecs[off + i] = x;
      sum += x * x;
    }
    const norm = Math.sqrt(sum);
    if (norm > 0) {
      const inv = 1 / norm;
      for (let i = 0; i < this.dim; i++) this.vecs[off + i] *= inv;
    }
    return norm;
  }

  private normaliseInto(vec: ArrayLike<number>, out: Float64Array): number {
    let sum = 0;
    for (let i = 0; i < this.dim; i++) {
      const v = i < vec.length ? vec[i] : 0;
      const x = Number.isFinite(v) ? v : 0;
      out[i] = x;
      sum += x * x;
    }
    const norm = Math.sqrt(sum);
    if (norm > 0) {
      const inv = 1 / norm;
      for (let i = 0; i < this.dim; i++) out[i] *= inv;
    }
    return norm;
  }

  private vectorAt(id: number): Float64Array {
    return this.vecs.subarray(id * this.dim, id * this.dim + this.dim);
  }

  private cosineAt(id: number, q: Float64Array): number {
    this.opsExact++;
    const off = id * this.dim;
    let s = 0;
    for (let i = 0; i < this.dim; i++) s += this.vecs[off + i] * q[i];
    return s;
  }

  private assignLevel(): number {
    const u = Math.max(1e-12, this.rand.next());
    return Math.floor(-dlog(u) * this.mL);
  }

  private ensureLevels(level: number): void {
    while (this.links.length <= level) this.links.push([]);
  }

  private evictSlot(): number {
    let worst = 0;
    let worstScore = Infinity;
    for (let i = 0; i < this.meta.length; i++) {
      if (i === this.entry) continue;
      const m = this.meta[i];
      const score = m.hits * 1e6 + m.tick;
      if (score < worstScore) {
        worstScore = score;
        worst = i;
      }
    }
    return worst;
  }

  private connect(node: number, other: number, level: number): void {
    const cap = level === 0 ? this.M * 2 : this.M;
    const list = (this.links[level][node] = this.links[level][node] ?? []);
    if (list.includes(other)) return;
    list.push(other);
    if (list.length <= cap) return;
    // prune: keep the closest `cap` neighbours by exact cosine
    const v = this.vectorAt(node);
    list.sort((a, b) => this.cosineAt(b, v) - this.cosineAt(a, v) || a - b);
    list.length = cap;
  }

  private greedy(from: number, target: number, level: number): number {
    return this.greedyVec(from, this.vectorAt(target), level);
  }

  private greedyVec(from: number, q: Float64Array, level: number): number {
    let cur = from;
    let best = this.cosineAt(cur, q);
    for (;;) {
      const list = this.links[level]?.[cur];
      if (!list || list.length === 0) return cur;
      let moved = false;
      for (const nb of list) {
        this.opsHops++;
        const s = this.codebook ? cosFromD2(this.pqDistance(nb)) : this.cosineAt(nb, q);
        if (s > best) {
          best = s;
          cur = nb;
          moved = true;
        }
      }
      if (!moved) return cur;
    }
  }

  /**
   * Best-first expansion at one level. Candidate scoring uses PQ when trained
   * (cheap, approximate) and exact cosine otherwise; the returned set is a
   * shortlist, never a final answer — `search` re-ranks it exactly.
   */
  private searchLayer(
    q: Float64Array,
    entry: number,
    level: number,
    ef: number,
    skip: number,
  ): number[] {
    this.visitMark++;
    const mark = this.visitMark;
    const score = (id: number) =>
      this.codebook && level === 0 ? cosFromD2(this.pqDistance(id)) : this.cosineAt(id, q);

    const candidates: { id: number; s: number }[] = [];
    const results: { id: number; s: number }[] = [];
    const s0 = score(entry);
    this.visited[entry] = mark;
    candidates.push({ id: entry, s: s0 });
    if (entry !== skip) results.push({ id: entry, s: s0 });

    while (candidates.length) {
      candidates.sort((a, b) => b.s - a.s);
      const cur = candidates.shift()!;
      const worst = results.length ? results[results.length - 1].s : -Infinity;
      if (results.length >= ef && cur.s < worst) break;
      const list = this.links[level]?.[cur.id];
      if (!list) continue;
      for (const nb of list) {
        if (this.visited[nb] === mark) continue;
        this.visited[nb] = mark;
        this.opsHops++;
        const s = score(nb);
        candidates.push({ id: nb, s });
        if (nb === skip) continue;
        results.push({ id: nb, s });
        results.sort((a, b) => b.s - a.s || a.id - b.id);
        if (results.length > ef) results.length = ef;
      }
    }
    return results.map((r) => r.id);
  }

  /**
   * Neighbour heuristic: keep a candidate only if it is closer to the new node
   * than to any already-kept neighbour. This is what preserves long-range
   * edges — plain top-M would collapse the graph into a cluster-local mesh.
   */
  private selectNeighbours(id: number, cand: readonly number[], cap: number): number[] {
    const v = this.vectorAt(id);
    const ranked = cand
      .filter((c) => c !== id)
      .map((c) => ({ c, s: this.cosineAt(c, v) }))
      .sort((a, b) => b.s - a.s || a.c - b.c);
    const kept: number[] = [];
    for (const { c, s } of ranked) {
      if (kept.length >= cap) break;
      let dominated = false;
      const cv = this.vectorAt(c);
      for (const k of kept) {
        if (this.cosineAt(k, cv) > s) {
          dominated = true;
          break;
        }
      }
      if (!dominated) kept.push(c);
    }
    // never return an empty set while candidates exist: connectivity first
    if (!kept.length && ranked.length) kept.push(ranked[0].c);
    return kept;
  }

  // ---- product quantisation -------------------------------------------

  /** Deterministic Lloyd per subspace, k-means++ seeded from the SeedStream. */
  private trainPQ(): void {
    const n = this.meta.length;
    if (n < this.centroids) return;
    const book = new Float64Array(this.sub * this.centroids * this.subDim);
    const assign = new Int32Array(n);

    for (let s = 0; s < this.sub; s++) {
      const base = s * this.centroids * this.subDim;
      const off = s * this.subDim;
      // k-means++ init
      let first = Math.min(n - 1, Math.floor(this.rand.next() * n));
      for (let d = 0; d < this.subDim; d++) {
        book[base + d] = this.vecs[first * this.dim + off + d];
      }
      const dist = new Float64Array(n).fill(Infinity);
      for (let c = 1; c < this.centroids; c++) {
        let total = 0;
        for (let i = 0; i < n; i++) {
          const d2 = this.subD2(i, off, book, base + (c - 1) * this.subDim);
          if (d2 < dist[i]) dist[i] = d2;
          total += dist[i];
        }
        let pick = this.rand.next() * (total || 1);
        let chosen = 0;
        for (let i = 0; i < n; i++) {
          pick -= dist[i];
          if (pick <= 0) {
            chosen = i;
            break;
          }
        }
        for (let d = 0; d < this.subDim; d++) {
          book[base + c * this.subDim + d] = this.vecs[chosen * this.dim + off + d];
        }
      }
      // Lloyd
      const sums = new Float64Array(this.centroids * this.subDim);
      const counts = new Int32Array(this.centroids);
      for (let it = 0; it < LLOYD_ITERATIONS; it++) {
        sums.fill(0);
        counts.fill(0);
        for (let i = 0; i < n; i++) {
          let bestC = 0;
          let bestD = Infinity;
          for (let c = 0; c < this.centroids; c++) {
            const d2 = this.subD2(i, off, book, base + c * this.subDim);
            if (d2 < bestD) {
              bestD = d2;
              bestC = c;
            }
          }
          assign[i] = bestC;
          counts[bestC]++;
          for (let d = 0; d < this.subDim; d++) {
            sums[bestC * this.subDim + d] += this.vecs[i * this.dim + off + d];
          }
        }
        for (let c = 0; c < this.centroids; c++) {
          if (counts[c] === 0) continue;
          const inv = 1 / counts[c];
          for (let d = 0; d < this.subDim; d++) {
            book[base + c * this.subDim + d] = sums[c * this.subDim + d] * inv;
          }
        }
      }
    }

    this.codebook = book;
    this.codes = new Uint8Array(this.capacity * this.sub);
    for (let i = 0; i < n; i++) this.encodeOne(i);
  }

  private subD2(i: number, off: number, book: Float64Array, base: number): number {
    let s = 0;
    const vo = i * this.dim + off;
    for (let d = 0; d < this.subDim; d++) {
      const x = this.vecs[vo + d] - book[base + d];
      s += x * x;
    }
    return s;
  }

  private encodeOne(id: number): void {
    const book = this.codebook!;
    const codes = this.codes!;
    for (let s = 0; s < this.sub; s++) {
      const base = s * this.centroids * this.subDim;
      const off = s * this.subDim;
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < this.centroids; c++) {
        const d2 = this.subD2(id, off, book, base + c * this.subDim);
        if (d2 < bestD) {
          bestD = d2;
          bestC = c;
        }
      }
      codes[id * this.sub + s] = bestC;
    }
  }

  /** Asymmetric table: per subspace, squared distance from the full-precision query. */
  private buildTable(q: Float64Array): void {
    const book = this.codebook!;
    for (let s = 0; s < this.sub; s++) {
      const base = s * this.centroids * this.subDim;
      const off = s * this.subDim;
      for (let c = 0; c < this.centroids; c++) {
        let d2 = 0;
        for (let d = 0; d < this.subDim; d++) {
          const x = q[off + d] - book[base + c * this.subDim + d];
          d2 += x * x;
        }
        this.table[s * this.centroids + c] = d2;
      }
    }
  }

  private pqDistance(id: number): number {
    this.opsPq++;
    const codes = this.codes!;
    let d2 = 0;
    for (let s = 0; s < this.sub; s++) {
      d2 += this.table[s * this.centroids + codes[id * this.sub + s]];
    }
    return d2;
  }
}
