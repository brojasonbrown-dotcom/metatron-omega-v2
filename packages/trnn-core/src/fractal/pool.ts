/**
 * Ω-DEPTH Section 2 — fixed child-field slot pool.
 *
 * Children are never allocated per tick. A pool of slots is sized once from the
 * governor's `fractalPoolBytes`, and slots are recycled by φ-scaled LRU on
 * *measured* utility (energy explained per use), so a child that resolves
 * nothing loses its slot to one that does.
 */

import { PHI } from '../core/constants';
import { createChildField, type ChildField, type ChildSize, MAX_DEPTH } from './nest';

/** Bytes a child of `size` nodes costs: state + work (2 × re/im f64) + coeffs. */
export function childBytes(size: ChildSize): number {
  return size * 8 * 4 + size * 2 * 8;
}

export interface PoolStats {
  readonly slots: number;
  readonly occupied: number;
  readonly size: ChildSize;
  readonly bytesUsed: number;
  readonly bytesBudget: number;
  readonly frozen: boolean;
  readonly depthHistogram: readonly number[];
  readonly evictions: number;
}

export class FractalPool {
  private readonly slots: ChildField[] = [];
  private readonly occupied: boolean[] = [];
  private clock = 0;
  private evictions = 0;
  private frozen = false;

  constructor(
    readonly bytesBudget: number,
    readonly size: ChildSize = 233,
    maxSlots = 4096,
  ) {
    const per = childBytes(size);
    const n = Math.max(0, Math.min(maxSlots, Math.floor(bytesBudget / per)));
    for (let i = 0; i < n; i++) {
      this.slots.push(createChildField(size, 1, -1));
      this.occupied.push(false);
    }
  }

  /** Pressure gate — while frozen, `acquire` returns null instead of evicting. */
  setFrozen(frozen: boolean): void {
    this.frozen = frozen;
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  capacity(): number {
    return this.slots.length;
  }

  /** φ-scaled LRU score: recent *and* productive children survive. */
  private score(c: ChildField): number {
    return c.lastUsed + c.explained * PHI;
  }

  /**
   * Take a slot for `site` at `depth`. Reuses an existing child for the same
   * site, then a free slot, then evicts the lowest-scoring occupant.
   * Returns null when frozen with nothing free, or when the pool is empty.
   */
  acquire(site: number, depth = 1): ChildField | null {
    if (depth < 1 || depth > MAX_DEPTH) return null;
    this.clock++;

    for (let i = 0; i < this.slots.length; i++) {
      if (this.occupied[i] && this.slots[i].site === site && this.slots[i].depth === depth) {
        this.slots[i].lastUsed = this.clock;
        return this.slots[i];
      }
    }
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.occupied[i]) {
        this.occupied[i] = true;
        return this.reset(i, site, depth);
      }
    }
    if (this.frozen || this.slots.length === 0) return null;

    let worst = 0;
    let worstScore = Infinity;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.score(this.slots[i]);
      if (s < worstScore) {
        worstScore = s;
        worst = i;
      }
    }
    this.evictions++;
    return this.reset(worst, site, depth);
  }

  private reset(i: number, site: number, depth: number): ChildField {
    const prev = this.slots[i];
    // Depth is immutable on a slot's geometry only through the basis, which is
    // shared across depths; rebuild only when the depth actually differs.
    const c = prev.depth === depth ? prev : createChildField(this.size, depth, site);
    this.slots[i] = c;
    c.site = site;
    c.state.re.fill(0);
    c.state.im.fill(0);
    c.explained = 0;
    c.lastUsed = this.clock;
    return c;
  }

  release(site: number): void {
    for (let i = 0; i < this.slots.length; i++) {
      if (this.occupied[i] && this.slots[i].site === site) {
        this.occupied[i] = false;
        this.slots[i].site = -1;
        this.slots[i].explained = 0;
      }
    }
  }

  active(): readonly ChildField[] {
    const out: ChildField[] = [];
    for (let i = 0; i < this.slots.length; i++) if (this.occupied[i]) out.push(this.slots[i]);
    return out;
  }

  stats(): PoolStats {
    let occ = 0;
    const hist = new Array<number>(MAX_DEPTH + 1).fill(0);
    for (let i = 0; i < this.slots.length; i++) {
      if (this.occupied[i]) {
        occ++;
        hist[this.slots[i].depth]++;
      }
    }
    return {
      slots: this.slots.length,
      occupied: occ,
      size: this.size,
      bytesUsed: occ * childBytes(this.size),
      bytesBudget: this.bytesBudget,
      frozen: this.frozen,
      depthHistogram: hist,
      evictions: this.evictions,
    };
  }
}
