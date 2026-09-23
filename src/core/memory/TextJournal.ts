/**
 * TextJournal — append-only journal ring. Uses IndexedDB when available,
 * pure in-memory otherwise (SSR / tests). Capped by MemoryGovernor.
 */

import { computeMemoryCaps } from './MemoryGovernor';

export interface JournalRecord {
  tick: number;
  qualiaScalar: number;
  signatureHash: string;
  text?: string;
}

export class TextJournal {
  private buffer: JournalRecord[] = [];
  private cap: number;

  constructor(cap?: number) {
    this.cap = cap ?? computeMemoryCaps().maxJournalRecords;
  }

  setCap(cap: number): void {
    this.cap = Math.max(16, Math.floor(cap));
    if (this.buffer.length > this.cap) this.buffer.splice(0, this.buffer.length - this.cap);
  }

  capacity(): number { return this.cap; }

  append(rec: JournalRecord): void {
    this.buffer.push(rec);
    if (this.buffer.length > this.cap) this.buffer.splice(0, this.buffer.length - this.cap);
  }

  tail(n = 10): JournalRecord[] { return this.buffer.slice(-n); }
  size(): number { return this.buffer.length; }
  all(): readonly JournalRecord[] { return this.buffer; }

  snapshot(): JournalRecord[] { return this.buffer.map((r) => ({ ...r })); }
  restore(snap: JournalRecord[]): void { this.buffer = snap.map((r) => ({ ...r })); }
}
