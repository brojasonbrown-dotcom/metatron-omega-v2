/**
 * ConceptGraph — Hebbian co-occurrence graph over salient terms with
 * φ⁻ⁿ spreading activation.
 *
 * Edges are strengthened when two concepts co-occur inside one chunk
 * (w += 1/√(rank_i·rank_j)) and never fabricated. Recall spreads activation
 * outward from the cue concepts, damped by φ⁻¹ per hop, which is how the
 * machine reaches related material it was never asked about directly.
 */

import { PHI_INV } from '@/core/gematria/zphi';

export interface ConceptRow { term: string; strength: number; chunks: string[]; }

const MAX_CHUNKS_PER_CONCEPT = 64;

export class ConceptGraph {
  private nodes = new Map<string, { strength: number; chunks: string[] }>();
  private edges = new Map<string, Map<string, number>>();
  private cap: number;

  constructor(cap = 20000) { this.cap = cap; }

  setCap(cap: number): void { this.cap = Math.max(256, Math.floor(cap)); this.prune(); }

  /** Observe one chunk: `terms` must already be salience-ordered (best first). */
  observe(chunkId: string, terms: readonly string[]): void {
    const k = Math.min(terms.length, 16);
    for (let i = 0; i < k; i++) {
      const a = terms[i];
      const na = this.nodes.get(a) ?? { strength: 0, chunks: [] };
      na.strength += 1 / Math.sqrt(i + 1);
      if (!na.chunks.includes(chunkId)) {
        na.chunks.push(chunkId);
        if (na.chunks.length > MAX_CHUNKS_PER_CONCEPT) na.chunks.shift();
      }
      this.nodes.set(a, na);
      for (let j = i + 1; j < k; j++) {
        const b = terms[j];
        const w = 1 / Math.sqrt((i + 1) * (j + 1));
        this.bump(a, b, w);
        this.bump(b, a, w);
      }
    }
    this.prune();
  }

  private bump(a: string, b: string, w: number): void {
    let m = this.edges.get(a);
    if (!m) { m = new Map(); this.edges.set(a, m); }
    m.set(b, (m.get(b) ?? 0) + w);
  }

  /** Spread activation from cue terms; returns chunkId → activation in [0,1]. */
  spread(cueTerms: readonly string[], hops = 2): Map<string, number> {
    let front = new Map<string, number>();
    for (const t of cueTerms) if (this.nodes.has(t)) front.set(t, 1);
    const activation = new Map<string, number>(front);
    let damp = PHI_INV;
    for (let h = 0; h < hops; h++) {
      const next = new Map<string, number>();
      for (const [term, a] of front) {
        const m = this.edges.get(term);
        if (!m) continue;
        let norm = 0;
        for (const w of m.values()) norm += w;
        if (norm <= 0) continue;
        for (const [nb, w] of m) {
          const contrib = a * damp * (w / norm);
          if (contrib < 1e-4) continue;
          next.set(nb, (next.get(nb) ?? 0) + contrib);
          activation.set(nb, (activation.get(nb) ?? 0) + contrib);
        }
      }
      front = next;
      damp *= PHI_INV;
      if (front.size === 0) break;
    }

    const chunks = new Map<string, number>();
    let peak = 0;
    for (const [term, a] of activation) {
      const node = this.nodes.get(term);
      if (!node) continue;
      for (const c of node.chunks) {
        const v = (chunks.get(c) ?? 0) + a;
        chunks.set(c, v);
        if (v > peak) peak = v;
      }
    }
    if (peak > 0) for (const [c, v] of chunks) chunks.set(c, v / peak);
    return chunks;
  }

  top(n = 32): ConceptRow[] {
    return [...this.nodes.entries()]
      .map(([term, v]) => ({ term, strength: v.strength, chunks: v.chunks }))
      .sort((a, b) => b.strength - a.strength || (a.term < b.term ? -1 : 1))
      .slice(0, n);
  }

  neighbours(term: string, n = 8): Array<{ term: string; w: number }> {
    const m = this.edges.get(term);
    if (!m) return [];
    return [...m.entries()].map(([t, w]) => ({ term: t, w }))
      .sort((a, b) => b.w - a.w).slice(0, n);
  }

  private prune(): void {
    if (this.nodes.size <= this.cap) return;
    const ordered = [...this.nodes.entries()].sort((a, b) => a[1].strength - b[1].strength);
    const drop = this.nodes.size - this.cap;
    for (let i = 0; i < drop; i++) {
      const [t] = ordered[i];
      this.nodes.delete(t);
      this.edges.delete(t);
    }
    for (const m of this.edges.values()) {
      for (const t of [...m.keys()]) if (!this.nodes.has(t)) m.delete(t);
    }
  }

  /** Drop every reference to a chunk that no longer exists. */
  forgetChunk(chunkId: string): void {
    for (const v of this.nodes.values()) {
      const i = v.chunks.indexOf(chunkId);
      if (i >= 0) v.chunks.splice(i, 1);
    }
  }

  size(): number { return this.nodes.size; }
  edgeCount(): number { let n = 0; for (const m of this.edges.values()) n += m.size; return n; }

  snapshot() {
    return {
      nodes: [...this.nodes.entries()].map(([t, v]) => [t, v.strength, v.chunks] as [string, number, string[]]),
      edges: [...this.edges.entries()].map(([t, m]) => [t, [...m.entries()]] as [string, Array<[string, number]>]),
    };
  }

  restore(s: { nodes: Array<[string, number, string[]]>; edges: Array<[string, Array<[string, number]>]> }): void {
    this.nodes = new Map(s.nodes.map(([t, strength, chunks]) => [t, { strength, chunks: [...chunks] }]));
    this.edges = new Map(s.edges.map(([t, m]) => [t, new Map(m)]));
  }

  clear(): void { this.nodes.clear(); this.edges.clear(); }
}
