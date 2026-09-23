/**
 * Double-entry flux ledger (BRAINMAP 3.3).
 *
 * Every quantum of receipt mass that leaves a rung must arrive somewhere — at
 * another rung, or in the named sink for the closure obstruction that no rung
 * can absorb. Nothing evaporates silently: the ledger's imbalance is a measured
 * number the gate battery asserts against, not a comment.
 *
 * Sums are Neumaier-compensated so the imbalance reflects the physics rather
 * than the accumulation order.
 */

export const FLUX_SINK = -1;

export interface FluxEntry {
  readonly tick: number;
  /** Emitting rung rank, or FLUX_SINK. */
  readonly from: number;
  /** Receiving rung rank, or FLUX_SINK. */
  readonly to: number;
  readonly amount: number;
}

class Neumaier {
  private s = 0;
  private c = 0;
  add(x: number): void {
    const t = this.s + x;
    this.c += Math.abs(this.s) >= Math.abs(x) ? this.s - t + x : x - t + this.s;
    this.s = t;
  }
  value(): number {
    return this.s + this.c;
  }
  reset(): void {
    this.s = 0;
    this.c = 0;
  }
}

export class FluxLedger {
  private readonly entries: FluxEntry[] = [];
  private readonly debits = new Neumaier();
  private readonly credits = new Neumaier();
  private readonly perRung = new Map<number, number>();
  private cap: number;

  constructor(cap = 4096) {
    this.cap = cap;
  }

  /** Record a transfer. Negative amounts are rejected — reverse the direction. */
  post(tick: number, from: number, to: number, amount: number): void {
    if (!(amount >= 0) || !Number.isFinite(amount)) {
      throw new Error(`FluxLedger.post: amount must be finite and >= 0, got ${amount}`);
    }
    if (amount === 0) return;
    this.debits.add(amount);
    this.credits.add(amount);
    this.perRung.set(from, (this.perRung.get(from) ?? 0) - amount);
    this.perRung.set(to, (this.perRung.get(to) ?? 0) + amount);
    this.entries.push({ tick, from, to, amount });
    if (this.entries.length > this.cap) this.entries.splice(0, this.entries.length - this.cap);
  }

  /** Route unabsorbed closure residue into the sink (still double-entry). */
  postToSink(tick: number, from: number, amount: number): void {
    this.post(tick, from, FLUX_SINK, amount);
  }

  /** Total debit minus total credit — structurally 0, measured anyway. */
  imbalance(): number {
    return this.debits.value() - this.credits.value();
  }

  /** Net position of a rung rank (positive = net receiver). */
  net(rank: number): number {
    return this.perRung.get(rank) ?? 0;
  }

  /** Sum of every net position; 0 by construction, reported for the gate. */
  netImbalance(): number {
    const acc = new Neumaier();
    for (const v of this.perRung.values()) acc.add(v);
    return acc.value();
  }

  turnover(): number {
    return this.credits.value();
  }

  tail(k = 32): FluxEntry[] {
    return this.entries.slice(Math.max(0, this.entries.length - k));
  }

  size(): number {
    return this.entries.length;
  }

  setCap(cap: number): void {
    this.cap = Math.max(1, cap | 0);
    if (this.entries.length > this.cap) this.entries.splice(0, this.entries.length - this.cap);
  }

  reset(): void {
    this.entries.length = 0;
    this.debits.reset();
    this.credits.reset();
    this.perRung.clear();
  }
}
