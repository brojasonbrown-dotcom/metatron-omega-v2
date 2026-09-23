/**
 * LexicalIndex — Okapi BM25 over an in-memory inverted index.
 *
 * Exact term match is the one channel that never hallucinates a neighbour:
 * it is the anchor of the recall cascade. Postings are plain arrays so the
 * whole index serialises to JSON with no loss.
 */

const K1 = 1.2;
const B = 0.75;

interface Posting { id: string; tf: number; }

export class LexicalIndex {
  private postings = new Map<string, Posting[]>();
  private lengths = new Map<string, number>();
  private totalLen = 0;

  add(id: string, counts: Map<string, number>): void {
    if (this.lengths.has(id)) this.remove(id);
    let len = 0;
    for (const [term, tf] of counts) {
      len += tf;
      let p = this.postings.get(term);
      if (!p) { p = []; this.postings.set(term, p); }
      p.push({ id, tf });
    }
    this.lengths.set(id, len);
    this.totalLen += len;
  }

  remove(id: string): void {
    const len = this.lengths.get(id);
    if (len === undefined) return;
    this.lengths.delete(id);
    this.totalLen -= len;
    for (const [term, p] of this.postings) {
      const next = p.filter((x) => x.id !== id);
      if (next.length === 0) this.postings.delete(term);
      else if (next.length !== p.length) this.postings.set(term, next);
    }
  }

  /** BM25 scores for the query terms, normalised to [0,1] by the top score. */
  search(queryTerms: readonly string[], topN = 64): Array<{ id: string; score: number }> {
    const N = this.lengths.size;
    if (N === 0) return [];
    const avg = this.totalLen / N;
    const acc = new Map<string, number>();
    for (const term of new Set(queryTerms)) {
      const p = this.postings.get(term);
      if (!p) continue;
      const idf = Math.log(1 + (N - p.length + 0.5) / (p.length + 0.5));
      for (const { id, tf } of p) {
        const dl = this.lengths.get(id) ?? avg;
        const denom = tf + K1 * (1 - B + (B * dl) / (avg || 1));
        acc.set(id, (acc.get(id) ?? 0) + idf * ((tf * (K1 + 1)) / (denom || 1)));
      }
    }
    const out = [...acc.entries()].map(([id, score]) => ({ id, score }));
    out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    const top = out[0]?.score ?? 0;
    return out.slice(0, topN).map((r) => ({ id: r.id, score: top > 0 ? r.score / top : 0 }));
  }

  /**
   * Smoothed inverse document frequency, floored at 1 so an unseen feature
   * (character grams never enter this index) is neutral rather than silenced.
   */
  idf(term: string): number {
    const N = this.lengths.size;
    if (N === 0) return 1;
    const df = this.postings.get(term)?.length ?? 0;
    if (df === 0) return 1;
    return Math.max(0.25, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
  }

  termCount(): number { return this.postings.size; }
  docCount(): number { return this.lengths.size; }

  snapshot(): { postings: Array<[string, Posting[]]>; lengths: Array<[string, number]> } {
    return { postings: [...this.postings.entries()], lengths: [...this.lengths.entries()] };
  }

  restore(s: { postings: Array<[string, Posting[]]>; lengths: Array<[string, number]> }): void {
    this.postings = new Map(s.postings.map(([t, p]) => [t, p.map((x) => ({ ...x }))]));
    this.lengths = new Map(s.lengths);
    this.totalLen = 0;
    for (const l of this.lengths.values()) this.totalLen += l;
  }

  clear(): void { this.postings.clear(); this.lengths.clear(); this.totalLen = 0; }
}
