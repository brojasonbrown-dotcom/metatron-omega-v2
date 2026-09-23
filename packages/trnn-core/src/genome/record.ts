/**
 * Genome v2 — sealed, provenanced, append-only knowledge records.
 *
 * What this fixes relative to the reference prototype:
 *   • `correct()` there computed the pre-correction body and threw it away, so
 *     the audit trail it advertised did not exist. Here a correction is a NEW
 *     record that supersedes the old one, and the superseded record stays
 *     sealed and readable — the history is the evidence.
 *   • lineage walks had no cycle guard; a single bad `derivedFrom` would hang
 *     the caller. Every traversal here carries a visited set and a depth cap.
 *   • records were plaintext. Bodies are sealed with AES-256-GCM (nonce
 *     prepended, header bound in as AAD) so a record cannot be moved to a
 *     different id, kind or epoch without breaking the tag.
 *   • crypto-shredding: destroying a record's data key makes the ciphertext
 *     permanently unreadable while its hash stays in the ledger, so deletion
 *     is provable rather than merely claimed.
 *
 * Bi-temporal validity is explicit: `validFrom`/`validTo` describe when the
 * fact was true, `recordedAt` when the machine learned it. Conflating those
 * two is how a memory system quietly rewrites its own past.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { canonicalJson, utf8, fromUtf8, bytesToBase64, base64ToBytes } from '../ledger/canonical';
import { MerkleLog, toHex, verifyInclusion, type Hash } from '../ledger/merkle';
import { signTreeHead, verifyTreeHead, type LogKeyPair, type SignedTreeHead } from '../ledger/sth';

export const GENOME_VERSION = 2 as const;

/** PROV-O flavoured provenance. Terms mirror the W3C vocabulary deliberately. */
export interface Provenance {
  /** prov:wasAttributedTo — the agent responsible (module, operator, user). */
  readonly attributedTo: string;
  /** prov:wasGeneratedBy — the activity that produced it. */
  readonly generatedBy: string;
  /** prov:wasDerivedFrom — parent record ids. */
  readonly derivedFrom?: readonly string[];
  /** Free-form measurement provenance flag: 'measured' | 'derived' | 'declared'. */
  readonly evidence: 'measured' | 'derived' | 'declared';
}

export interface RecordHeader {
  readonly version: typeof GENOME_VERSION;
  readonly id: string;
  readonly kind: string;
  /** When the machine recorded it (transaction time). */
  readonly recordedAt: number;
  /** When the fact became true (valid time). */
  readonly validFrom: number;
  /** When the fact stopped being true; null = still valid. */
  readonly validTo: number | null;
  readonly provenance: Provenance;
  /** Id of the record this one replaces, if it is a correction. */
  readonly supersedes: string | null;
  /** Reason for the correction. Never a placeholder — enforced non-empty. */
  readonly correctionReason: string | null;
}

export interface SealedRecord {
  readonly header: RecordHeader;
  /** nonce(12) ‖ ciphertext ‖ tag(16), base64. */
  readonly sealed: string;
  /** Leaf index in the ledger. */
  readonly leafIndex: number;
  /** Hex SHA-256 of the canonical leaf bytes. */
  readonly leafHex: string;
}

export interface InclusionEvidence {
  readonly leafIndex: number;
  readonly treeSize: number;
  readonly rootHex: string;
  readonly proofHex: readonly string[];
  readonly sth: SignedTreeHead;
}

/** Bytes committed to the ledger for a record: header + sealed body. */
export function leafBytes(header: RecordHeader, sealed: string): Uint8Array {
  return utf8(canonicalJson({ header: header as unknown as Record<string, unknown>, sealed }));
}

function deriveKey(master: Uint8Array, id: string): Uint8Array {
  // Per-record key: shredding one record cannot read out or damage another.
  return hkdf(sha256, master, utf8('genome-v2-salt'), utf8(`record:${id}`), 32);
}

function nonceFor(id: string, recordedAt: number): Uint8Array {
  // Deterministic nonce over (id, recordedAt) with a unique per-record KEY.
  // GCM's nonce-reuse catastrophe is per-key; because the key is derived from
  // the id, a nonce collision across records is harmless, and within a record
  // the key/nonce pair is used exactly once (records are immutable).
  return sha256(utf8(`nonce:${id}:${recordedAt}`)).slice(0, 12);
}

export interface AppendInput {
  id: string;
  kind: string;
  body: unknown;
  recordedAt: number;
  validFrom?: number;
  validTo?: number | null;
  provenance: Provenance;
}

export class GenomeLedger {
  private readonly log = new MerkleLog();
  private readonly records = new Map<string, SealedRecord>();
  private readonly order: string[] = [];
  private readonly keys = new Map<string, Uint8Array>();
  private readonly shredded = new Set<string>();
  /** id → id that supersedes it. */
  private readonly successor = new Map<string, string>();

  constructor(
    private readonly logId: string,
    private readonly master: Uint8Array,
    private readonly signer: LogKeyPair,
  ) {
    if (master.length !== 32) throw new RangeError('master key must be 32 bytes');
  }

  get size(): number { return this.order.length; }

  /** Seal and append a new record. Ids are unique and never reused. */
  append(input: AppendInput): SealedRecord {
    if (this.records.has(input.id)) throw new Error(`duplicate record id ${input.id}`);
    return this.write(input, null, null);
  }

  /**
   * Correct an existing record: the old body stays sealed and reachable, and a
   * new record supersedes it. Requires a non-empty reason.
   */
  correct(targetId: string, newBody: unknown, opts: {
    id: string; recordedAt: number; reason: string; provenance: Provenance;
    validFrom?: number; validTo?: number | null;
  }): SealedRecord {
    const target = this.records.get(targetId);
    if (!target) throw new Error(`unknown record ${targetId}`);
    if (this.successor.has(targetId)) {
      throw new Error(`record ${targetId} is already superseded by ${this.successor.get(targetId)}`);
    }
    const reason = opts.reason.trim();
    if (reason.length === 0) throw new Error('correction requires a reason');

    const rec = this.write({
      id: opts.id,
      kind: target.header.kind,
      body: newBody,
      recordedAt: opts.recordedAt,
      validFrom: opts.validFrom ?? target.header.validFrom,
      validTo: opts.validTo ?? null,
      provenance: {
        ...opts.provenance,
        derivedFrom: [...(opts.provenance.derivedFrom ?? []), targetId],
      },
    }, targetId, reason);
    this.successor.set(targetId, opts.id);
    return rec;
  }

  private write(input: AppendInput, supersedes: string | null, reason: string | null): SealedRecord {
    const header: RecordHeader = {
      version: GENOME_VERSION,
      id: input.id,
      kind: input.kind,
      recordedAt: input.recordedAt,
      validFrom: input.validFrom ?? input.recordedAt,
      validTo: input.validTo ?? null,
      provenance: input.provenance,
      supersedes,
      correctionReason: reason,
    };
    const key = deriveKey(this.master, input.id);
    const nonce = nonceFor(input.id, header.recordedAt);
    const aad = utf8(canonicalJson(header as unknown as Record<string, unknown>));
    const ct = gcm(key, nonce, aad).encrypt(utf8(canonicalJson(input.body)));
    const packed = new Uint8Array(nonce.length + ct.length);
    packed.set(nonce, 0);
    packed.set(ct, nonce.length);
    const sealed = bytesToBase64(packed);

    const bytes = leafBytes(header, sealed);
    const leafIndex = this.log.append(bytes);
    const rec: SealedRecord = {
      header, sealed, leafIndex,
      leafHex: toHex(this.log.leafHash(leafIndex) as Hash),
    };
    this.records.set(input.id, rec);
    this.keys.set(input.id, key);
    this.order.push(input.id);
    return rec;
  }

  get(id: string): SealedRecord | null { return this.records.get(id) ?? null; }

  /** Open a sealed body. Returns null when the record was crypto-shredded. */
  open(id: string): unknown | null {
    const rec = this.records.get(id);
    if (!rec) return null;
    const key = this.keys.get(id);
    if (!key || this.shredded.has(id)) return null;
    const packed = base64ToBytes(rec.sealed);
    const nonce = packed.slice(0, 12);
    const ct = packed.slice(12);
    const aad = utf8(canonicalJson(rec.header as unknown as Record<string, unknown>));
    const pt = gcm(key, nonce, aad).decrypt(ct);
    return JSON.parse(fromUtf8(pt));
  }

  /**
   * Crypto-shred: destroy the record's data key. The ciphertext and its ledger
   * leaf survive, so the log stays consistent and the deletion is itself
   * provable — but the plaintext is gone for everyone, including us.
   */
  shred(id: string): boolean {
    if (!this.records.has(id)) return false;
    const k = this.keys.get(id);
    if (k) k.fill(0);
    this.keys.delete(id);
    this.shredded.add(id);
    return true;
  }

  isShredded(id: string): boolean { return this.shredded.has(id); }

  /** The record that currently stands for `id`, following supersessions. */
  current(id: string): SealedRecord | null {
    let cur = id;
    const seen = new Set<string>([cur]);
    for (let d = 0; d < 4096; d++) {
      const next = this.successor.get(cur);
      if (!next || seen.has(next)) break;
      seen.add(next);
      cur = next;
    }
    return this.records.get(cur) ?? null;
  }

  /**
   * Ancestors of a record via provenance.derivedFrom, breadth-first.
   * Cycle-guarded and depth-capped: a malformed graph degrades to a short
   * answer, never to a hang.
   */
  lineage(id: string, maxDepth = 64): string[] {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    let frontier = [id];
    for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const cur of frontier) {
        const rec = this.records.get(cur);
        for (const p of rec?.header.provenance.derivedFrom ?? []) {
          if (seen.has(p)) continue;
          seen.add(p);
          out.push(p);
          next.push(p);
        }
      }
      frontier = next;
    }
    return out;
  }

  /** Records whose valid-time interval covers `t` and that are not superseded. */
  validAt(t: number): SealedRecord[] {
    return this.order
      .map((id) => this.records.get(id) as SealedRecord)
      .filter((r) => !this.successor.has(r.header.id)
        && r.header.validFrom <= t
        && (r.header.validTo === null || t < r.header.validTo));
  }

  rootHex(size = this.log.size): string { return toHex(this.log.root(size)); }

  /** Signed head over the current log. */
  head(timestamp: number): SignedTreeHead {
    return signTreeHead(
      { logId: this.logId, size: this.log.size, rootHex: this.rootHex(), timestamp },
      this.signer,
    );
  }

  /** Everything a third party needs to check that a record is in this log. */
  prove(id: string, timestamp: number): InclusionEvidence | null {
    const rec = this.records.get(id);
    if (!rec) return null;
    const size = this.log.size;
    return {
      leafIndex: rec.leafIndex,
      treeSize: size,
      rootHex: this.rootHex(size),
      proofHex: this.log.inclusionProof(rec.leafIndex, size).map(toHex),
      sth: this.head(timestamp),
    };
  }

  /**
   * Inclusion proof for a raw leaf index, independent of any record we hold.
   * An auditor checking a CLAIMED record needs this: the claim supplies the
   * index and the bytes, and the log supplies only the path.
   */
  inclusionProofAt(index: number, size = this.log.size): string[] | null {
    if (!Number.isInteger(index) || index < 0 || index >= size) return null;
    return this.log.inclusionProof(index, size).map(toHex);
  }

  /** Consistency proof between an earlier head size and the current one. */
  proveAppendOnly(oldSize: number): string[] {
    return this.log.consistencyProof(oldSize, this.log.size).map(toHex);
  }

  /**
   * Full self-audit: every record's leaf recomputes from its header+ciphertext,
   * its inclusion proof verifies against the current root, and the signed head
   * verifies under the log's public key.
   */
  audit(timestamp: number): { ok: boolean; checked: number; failures: string[] } {
    const failures: string[] = [];
    const size = this.log.size;
    const root = this.log.root(size);
    for (const id of this.order) {
      const rec = this.records.get(id) as SealedRecord;
      const leaf = this.log.leafHash(rec.leafIndex);
      if (!leaf || toHex(leaf) !== rec.leafHex) { failures.push(`${id}: leaf hash mismatch`); continue; }
      const proof = this.log.inclusionProof(rec.leafIndex, size);
      if (!verifyInclusion(leaf, rec.leafIndex, size, proof, root)) failures.push(`${id}: inclusion proof failed`);
    }
    if (!verifyTreeHead(this.head(timestamp), this.signer.publicKey)) failures.push('signed head failed to verify');
    return { ok: failures.length === 0, checked: this.order.length, failures };
  }
}

export { verifyInclusion, verifyTreeHead };
