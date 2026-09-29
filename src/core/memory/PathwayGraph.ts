/**
 * PathwayGraph — directed multigraph of pattern→pattern transitions.
 * Pure, deterministic, in-memory. Edges keyed by "fromHash→toHash".
 */

import { computeMemoryCaps } from './MemoryGovernor';

export interface PathwayEdge {
  from: string;
  to: string;
  count: number;
  lastTick: number;
}

export class PathwayGraph {
  private edges = new Map<string, PathwayEdge>();
  private cap: number;

  constructor(cap?: number) {
    this.cap = cap ?? computeMemoryCaps().maxPathwayEdges;
  }

  setCap(cap: number): void {
    this.cap = Math.max(32, Math.floor(cap));
    if (this.edges.size > this.cap) this.evict();
  }

  capacity(): number {
    return this.cap;
  }

  observe(from: string, to: string, tick: number): void {
    const k = `${from}→${to}`;
    const e = this.edges.get(k);
    if (e) {
      e.count += 1;
      e.lastTick = tick;
    } else this.edges.set(k, { from, to, count: 1, lastTick: tick });
    if (this.edges.size > this.cap) this.evict();
  }

  /** Top-N outgoing edges from a node, sorted by count desc. */
  successors(from: string, n = 5): PathwayEdge[] {
    const out: PathwayEdge[] = [];
    for (const e of this.edges.values()) if (e.from === from) out.push(e);
    out.sort((a, b) => b.count - a.count);
    return out.slice(0, n);
  }

  size(): number {
    return this.edges.size;
  }
  all(): readonly PathwayEdge[] {
    return Array.from(this.edges.values());
  }

  private evict(): void {
    // Drop least-used (lowest count, oldest tick).
    const arr = Array.from(this.edges.entries()).sort(
      (a, b) => a[1].count - b[1].count || a[1].lastTick - b[1].lastTick,
    );
    const drop = this.edges.size - this.cap;
    for (let i = 0; i < drop; i++) this.edges.delete(arr[i][0]);
  }

  snapshot(): PathwayEdge[] {
    return Array.from(this.edges.values())
      .map((e) => ({ ...e }))
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  }
  restore(snap: PathwayEdge[]): void {
    this.edges.clear();
    for (const e of snap) this.edges.set(`${e.from}→${e.to}`, { ...e });
  }
}
