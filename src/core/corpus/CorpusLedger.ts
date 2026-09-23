/**
 * Ω-CORPUS area 4 — the ledger index.
 *
 * A stored shard is only evidence if it can be tied to a published head. Every
 * sealed unit — WARM shard or COLD segment — becomes one canonical leaf in the
 * existing RFC-6962 log, and each seal republishes an Ed25519 signed tree head.
 * A reader can then verify inclusion without trusting the store, and a reload
 * can verify that the new log genuinely extends the old one.
 *
 * Discipline copied verbatim from `findingLedger`: canonical JSON leaves, no
 * clock read inside (timestamps are supplied), and non-finite numbers never
 * reach the leaf.
 */

import {
  MerkleLog, toHex, fromHex, verifyInclusion, verifyConsistency,
} from '@metatron/trnn-core/ledger/merkle';
import { canonicalJson, utf8 } from '@metatron/trnn-core/ledger/canonical';
import {
  keyPairFromSeed, signTreeHead, verifyTreeHead,
  type LogKeyPair, type SignedTreeHead,
} from '@metatron/trnn-core/ledger/sth';

export const CORPUS_LOG_ID = 'omega.corpus.v1';

export type SealKind = 'warm-shard' | 'cold-segment' | 'cold-recompact';

/** The canonical description of one sealed unit. This is what gets hashed. */
export interface SealRecord {
  readonly kind: SealKind;
  readonly tier: 'warm' | 'cold';
  readonly index: number;
  readonly key: string;
  readonly tickFrom: number;
  readonly tickTo: number;
  readonly count: number;
  readonly width: number;
  readonly bytes: number;
  readonly payloadHashHex: string;
  /**
   * Ω-UNBOUND P5: set only on `cold-recompact`, naming the payload hash this
   * segment carried before the retention ladder narrowed it. Omitted elsewhere,
   * so every pre-existing leaf hashes byte-identically to before.
   */
  readonly priorHashHex?: string;
}

export interface SealedEntry {
  readonly record: SealRecord;
  readonly leafIndex: number;
  readonly leafHex: string;
}

/** A read that carries its own proof — the store is not trusted. */
export interface ProofCarrying<T> {
  readonly data: T;
  readonly record: SealRecord;
  readonly leafIndex: number;
  readonly proofHex: readonly string[];
  readonly head: SignedTreeHead;
}

function leafBytes(r: SealRecord): Uint8Array {
  return utf8(canonicalJson({
    kind: r.kind,
    tier: r.tier,
    index: r.index,
    key: r.key,
    tickFrom: Number.isFinite(r.tickFrom) ? r.tickFrom : null,
    tickTo: Number.isFinite(r.tickTo) ? r.tickTo : null,
    count: r.count,
    width: r.width,
    bytes: r.bytes,
    payloadHashHex: r.payloadHashHex,
    ...(r.priorHashHex === undefined ? {} : { priorHashHex: r.priorHashHex }),
  }));
}

const DEFAULT_SEED = new Uint8Array(32).fill(7);

export class CorpusLedger {
  private readonly log = new MerkleLog();
  private readonly keys: LogKeyPair;
  private readonly records: SealRecord[] = [];
  private headHistory: SignedTreeHead[] = [];

  constructor(seed: Uint8Array = DEFAULT_SEED) {
    this.keys = keyPairFromSeed(seed);
  }

  get size(): number { return this.log.size; }
  get head(): SignedTreeHead | null {
    return this.headHistory.length > 0 ? this.headHistory[this.headHistory.length - 1] : null;
  }
  get rootHex(): string { return toHex(this.log.root()); }
  entries(): readonly SealRecord[] { return this.records; }

  /** Seal a unit into the log and publish a signed head at `timestamp`. */
  seal(record: SealRecord, timestamp: number): SealedEntry {
    const bytes = leafBytes(record);
    const leafIndex = this.log.append(bytes);
    this.records.push(record);
    const sth = signTreeHead(
      { logId: CORPUS_LOG_ID, size: this.log.size, rootHex: this.rootHex, timestamp },
      this.keys,
    );
    this.headHistory.push(sth);
    return { record, leafIndex, leafHex: toHex(this.log.leafHash(leafIndex)!) };
  }

  /** Inclusion proof for a sealed unit, against the current head. */
  proofFor(leafIndex: number): { proofHex: string[]; head: SignedTreeHead } | null {
    const head = this.head;
    if (!head || leafIndex < 0 || leafIndex >= this.log.size) return null;
    return {
      proofHex: this.log.inclusionProof(leafIndex).map(toHex),
      head,
    };
  }

  /** Verify a proof-carrying read without consulting the store at all. */
  static verify<T>(p: ProofCarrying<T>): boolean {
    if (!verifyTreeHead(p.head)) return false;
    const leaf = utf8(canonicalJson({
      kind: p.record.kind,
      tier: p.record.tier,
      index: p.record.index,
      key: p.record.key,
      tickFrom: Number.isFinite(p.record.tickFrom) ? p.record.tickFrom : null,
      tickTo: Number.isFinite(p.record.tickTo) ? p.record.tickTo : null,
      count: p.record.count,
      width: p.record.width,
      bytes: p.record.bytes,
      payloadHashHex: p.record.payloadHashHex,
    }));
    return verifyInclusion(
      hashOfLeaf(leaf),
      p.leafIndex,
      p.head.size,
      p.proofHex.map(fromHex),
      fromHex(p.head.rootHex),
    );
  }

  /** Is `next` an append-only extension of `prev`? Used across reloads. */
  consistentWith(prevSize: number, prevRootHex: string): boolean {
    if (prevSize === 0) return true;
    if (prevSize > this.log.size) return false;
    return verifyConsistency(
      prevSize,
      fromHex(prevRootHex),
      this.log.size,
      this.log.root(),
      this.log.consistencyProof(prevSize),
    );
  }

  /** Serialisable index — records plus every published head. */
  toJSON(): { records: SealRecord[]; heads: SignedTreeHead[] } {
    return { records: [...this.records], heads: [...this.headHistory] };
  }

  /** Rebuild from a persisted index. Leaves are recomputed, never trusted. */
  static fromJSON(
    data: { records: SealRecord[]; heads: SignedTreeHead[] },
    seed: Uint8Array = DEFAULT_SEED,
  ): CorpusLedger {
    const l = new CorpusLedger(seed);
    for (const r of data.records) {
      l.log.append(leafBytes(r));
      l.records.push(r);
    }
    l.headHistory = [...data.heads];
    return l;
  }
}

// The leaf hash function lives in merkle.ts behind `append`; re-derive it here
// so a verifier never needs the log object itself.
import { hashLeaf } from '@metatron/trnn-core/ledger/merkle';
function hashOfLeaf(data: Uint8Array) { return hashLeaf(data); }
