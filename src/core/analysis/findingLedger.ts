/**
 * Ω-P9.3 — the evidence ledger for live findings.
 *
 * A measurement that can be silently rewritten is not evidence. Every analysis
 * pass is reduced to a canonical record, hashed into an RFC-6962 append-only
 * Merkle log, and published under an Ed25519 signed tree head. Anyone holding
 * a record can later prove it belongs to a given head (inclusion), and anyone
 * holding two heads can prove one extends the other (consistency) — so a pass
 * cannot be edited, reordered, or quietly dropped after the fact.
 *
 * Determinism rules kept from P6/P7:
 *   • Timestamps are supplied by the caller, never read inside — replays reproduce.
 *   • Non-finite statistics never reach canonical JSON; they serialise as null,
 *     which is the ledger's spelling of "not measured".
 */

import {
  MerkleLog, toHex, fromHex, verifyInclusion, verifyConsistency,
} from '@metatron/trnn-core/ledger/merkle';
import { canonicalJson, utf8 } from '@metatron/trnn-core/ledger/canonical';
import {
  keyPairFromSeed, signTreeHead, verifyTreeHead,
  type LogKeyPair, type SignedTreeHead,
} from '@metatron/trnn-core/ledger/sth';
import type { PairFinding, SpineReport } from './analysisSpine';

export const LOG_ID = 'omega.analysis.v1';

/** Finite numbers survive; everything else becomes an explicit null. */
function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The sealed form of one pair finding — only what a verifier needs. */
export interface SealedFinding {
  readonly a: string;
  readonly b: string;
  readonly n: number;
  readonly verdict: PairFinding['verdict'];
  readonly reason: string | null;
  readonly association: number | null;
  readonly pearson: number | null;
  readonly spearman: number | null;
  readonly dcor: number | null;
  readonly mi: number | null;
  readonly direction: number | null;
  readonly directionVerdict: string | null;
}

export interface SealedPass {
  /** Monotone pass counter, and the Merkle leaf index — they coincide. */
  readonly index: number;
  readonly timestamp: number;
  readonly reported: number;
  readonly abstained: number;
  readonly skipped: number;
  readonly findings: readonly SealedFinding[];
  /** Canonical JSON actually hashed — the byte-exact preimage of the leaf. */
  readonly canonical: string;
  readonly leafHex: string;
}

export interface LedgerEntry {
  readonly pass: SealedPass;
  readonly sth: SignedTreeHead;
}

export function sealFinding(f: PairFinding): SealedFinding {
  return {
    a: f.a,
    b: f.b,
    n: f.n,
    verdict: f.verdict,
    reason: f.reason ?? null,
    association: num(f.association),
    pearson: num(f.correlation?.pearson.value),
    spearman: num(f.correlation?.spearman.value),
    dcor: num(f.correlation?.dcor.value),
    mi: num(f.correlation?.mi.value),
    direction: num(f.direction),
    directionVerdict: f.directionVerdict ?? null,
  };
}

/**
 * Append-only log of analysis passes with signed heads.
 *
 * `capacity` bounds only the retained *record* bodies for display; the Merkle
 * log keeps every leaf hash, so old passes stay provable after their bodies
 * are evicted from memory.
 */
export class FindingLedger {
  private readonly log = new MerkleLog();
  private readonly keys: LogKeyPair;
  private readonly entries: LedgerEntry[] = [];
  private readonly capacity: number;
  private heads: SignedTreeHead[] = [];
  private sealed = 0;

  constructor(seed: Uint8Array, capacity = 89) {
    this.keys = keyPairFromSeed(seed);
    this.capacity = Math.max(1, capacity);
  }

  get size(): number { return this.log.size; }
  get publicKey(): string { return this.heads[0]?.publicKey ?? ''; }
  get rootHex(): string { return toHex(this.log.root()); }
  /** Newest first — that is the order a reader wants. */
  recent(limit = 21): readonly LedgerEntry[] {
    return this.entries.slice(-limit).reverse();
  }
  latest(): LedgerEntry | null {
    return this.entries.length ? this.entries[this.entries.length - 1] : null;
  }
  head(): SignedTreeHead | null {
    return this.heads.length ? this.heads[this.heads.length - 1] : null;
  }

  /** Seal one pass. Returns the entry, including its signed head. */
  seal(report: SpineReport, timestamp: number): LedgerEntry {
    const index = this.sealed++;
    const body = {
      logId: LOG_ID,
      index,
      timestamp,
      reported: report.reported,
      abstained: report.abstained,
      skipped: report.skipped,
      findings: report.findings.map(sealFinding),
    };
    const canonical = canonicalJson(body);
    const leafIndex = this.log.append(utf8(canonical));
    /* istanbul ignore next — the counters are one construct; guard the drift. */
    if (leafIndex !== index) throw new Error('ledger index drift');

    const pass: SealedPass = {
      index,
      timestamp,
      reported: report.reported,
      abstained: report.abstained,
      skipped: report.skipped,
      findings: body.findings,
      canonical,
      leafHex: toHex(this.log.leafHash(leafIndex)!),
    };
    const sth = signTreeHead(
      { logId: LOG_ID, size: this.log.size, rootHex: this.rootHex, timestamp },
      this.keys,
    );
    this.heads.push(sth);
    if (this.heads.length > this.capacity * 2) this.heads = this.heads.slice(-this.capacity);

    const entry: LedgerEntry = { pass, sth };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
    return entry;
  }

  /** Audit path for a leaf against the current head. */
  proofAt(index: number): string[] {
    return this.log.inclusionProof(index).map(toHex);
  }

  /**
   * Full independent check of one entry: the signature over the head, the
   * canonical bytes hashing to the recorded leaf, and the audit path landing
   * on the current root.
   */
  verifyEntry(entry: LedgerEntry): { ok: boolean; reason: string | null } {
    if (!verifyTreeHead(entry.sth)) return { ok: false, reason: 'bad head signature' };
    const leaf = this.log.leafHash(entry.pass.index);
    if (!leaf) return { ok: false, reason: 'leaf evicted' };
    if (toHex(leaf) !== entry.pass.leafHex) return { ok: false, reason: 'leaf hash mismatch' };
    const size = this.log.size;
    const proof = this.log.inclusionProof(entry.pass.index, size);
    const ok = verifyInclusion(leaf, entry.pass.index, size, proof, this.log.root(size));
    return ok ? { ok: true, reason: null } : { ok: false, reason: 'inclusion failed' };
  }

  /** Does the current head extend the head published at `size`? */
  verifyExtends(oldSth: SignedTreeHead): boolean {
    if (oldSth.logId !== LOG_ID) return false;
    if (!verifyTreeHead(oldSth)) return false;
    const proof = this.log.consistencyProof(oldSth.size, this.log.size);
    return verifyConsistency(
      oldSth.size, fromHex(oldSth.rootHex),
      this.log.size, this.log.root(), proof,
    );
  }
}

/** A per-session signing seed. Random in the browser, fixed under test. */
export function sessionSeed(): Uint8Array {
  const s = new Uint8Array(32);
  const g = globalThis.crypto;
  if (g && typeof g.getRandomValues === 'function') g.getRandomValues(s);
  else for (let i = 0; i < 32; i++) s[i] = (i * 37 + 11) & 0xff;
  return s;
}
