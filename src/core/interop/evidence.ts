/**
 * Ω-READY R5 — evidence envelopes in the host's fact shape.
 *
 * The host ledger stores typed facts: (subject_type, subject_id, predicate,
 * object_json) with a confidence, a source, an HLC stamp, and a hash chain
 * (prev_hash → content_hash). Ω has to emit facts the host can accept and chain
 * without translation, and — critically — every field that decides the chain
 * must be derived, never invented:
 *
 *   content_hash = SHA3-256(canonical CBOR of the chained core)
 *   id           = deterministic, from (kind, hlc, core)
 *
 * `verifyChain` is the property that makes the envelope evidence rather than
 * decoration: it recomputes every hash and every link, so an edited, reordered
 * or spliced fact is detected instead of trusted.
 */

import {
  encodeCbor,
  hashHex,
  deterministicId,
  hlcEncode,
  hlcTick,
  INTEROP_VERSION,
  type CborValue,
  type Hlc,
} from './contract';

/** Host subject vocabulary (`src/brain/ontology.ts`). */
export type SubjectType =
  | 'org'
  | 'person'
  | 'account'
  | 'counterparty'
  | 'contract'
  | 'transaction'
  | 'policy'
  | 'kpi';

export const SUBJECT_TYPES: readonly SubjectType[] = [
  'org',
  'person',
  'account',
  'counterparty',
  'contract',
  'transaction',
  'policy',
  'kpi',
] as const;

export type FactSource = 'user' | 'chat' | 'import' | 'system';
export type Verdict = 'confirmed' | 'refuted' | 'inconclusive';

/** What Ω knows about one subject, before it becomes an envelope. */
export interface FactDraft {
  readonly subject_type: SubjectType;
  readonly subject_id: string;
  readonly predicate: string;
  readonly object_json: CborValue;
  /** [0,1]. Non-finite or out-of-range confidence is refused, not clamped. */
  readonly confidence: number;
  readonly source: FactSource;
  readonly source_ref?: string | null;
  readonly tags?: readonly string[];
  /** The fact this one replaces, if any. */
  readonly supersedes_id?: string | null;
}

/** A sealed, chainable envelope. */
export interface EvidenceEnvelope {
  readonly version: typeof INTEROP_VERSION;
  readonly id: string;
  readonly subject_type: SubjectType;
  readonly subject_id: string;
  readonly predicate: string;
  readonly object_json: CborValue;
  readonly confidence: number;
  readonly source: FactSource;
  readonly source_ref: string | null;
  readonly tags: readonly string[];
  readonly supersedes_id: string | null;
  readonly hlc_wall_ms: number;
  readonly hlc_logical: number;
  readonly hlc_node: string;
  readonly prev_hash: string | null;
  readonly content_hash: string;
}

/** Exactly the fields the content hash covers — the chained core. */
function core(d: FactDraft, hlc: Hlc, prev: string | null): CborValue {
  return {
    v: INTEROP_VERSION,
    st: d.subject_type,
    si: d.subject_id,
    p: d.predicate,
    o: d.object_json,
    c: d.confidence,
    s: d.source,
    sr: d.source_ref ?? null,
    tg: [...(d.tags ?? [])].sort(),
    sup: d.supersedes_id ?? null,
    t: hlcEncode(hlc),
    prev: prev ?? null,
  };
}

export class EvidenceError extends Error {}

function checkDraft(d: FactDraft): void {
  if (!SUBJECT_TYPES.includes(d.subject_type)) {
    throw new EvidenceError(`unknown subject type: ${d.subject_type}`);
  }
  if (!d.subject_id) throw new EvidenceError('subject_id is required');
  if (!d.predicate) throw new EvidenceError('predicate is required');
  if (!Number.isFinite(d.confidence) || d.confidence < 0 || d.confidence > 1) {
    throw new EvidenceError(`confidence must lie in [0,1], got ${d.confidence}`);
  }
}

/** Seal one draft onto the tip of a chain. */
export function seal(d: FactDraft, hlc: Hlc, prevHash: string | null): EvidenceEnvelope {
  checkDraft(d);
  const body = core(d, hlc, prevHash);
  return {
    version: INTEROP_VERSION,
    id: deterministicId('fact', hlc, body),
    subject_type: d.subject_type,
    subject_id: d.subject_id,
    predicate: d.predicate,
    object_json: d.object_json,
    confidence: d.confidence,
    source: d.source,
    source_ref: d.source_ref ?? null,
    tags: [...(d.tags ?? [])].sort(),
    supersedes_id: d.supersedes_id ?? null,
    hlc_wall_ms: hlc.wall,
    hlc_logical: hlc.counter,
    hlc_node: hlc.node,
    prev_hash: prevHash,
    content_hash: hashHex(encodeCbor(body)),
  };
}

/** The hash the envelope should carry, recomputed from its own fields. */
export function recomputeContentHash(e: EvidenceEnvelope): string {
  const hlc: Hlc = { wall: e.hlc_wall_ms, counter: e.hlc_logical, node: e.hlc_node };
  return hashHex(
    encodeCbor(
      core(
        {
          subject_type: e.subject_type,
          subject_id: e.subject_id,
          predicate: e.predicate,
          object_json: e.object_json,
          confidence: e.confidence,
          source: e.source,
          source_ref: e.source_ref,
          tags: e.tags,
          supersedes_id: e.supersedes_id,
        },
        hlc,
        e.prev_hash,
      ),
    ),
  );
}

/** An append-only chain of envelopes with a live HLC and a tip hash. */
export class EvidenceChain {
  private items: EvidenceEnvelope[] = [];
  private clock: Hlc;

  constructor(node: string, startWall = 0) {
    if (!node) throw new EvidenceError('chain requires a node id');
    this.clock = { wall: startWall, counter: 0, node };
  }

  /** `now` is injected, never read — replays must be reproducible. */
  append(d: FactDraft, now: number): EvidenceEnvelope {
    this.clock = hlcTick(this.clock, now);
    const env = seal(d, this.clock, this.tip());
    this.items.push(env);
    return env;
  }

  tip(): string | null {
    return this.items.length === 0 ? null : this.items[this.items.length - 1].content_hash;
  }

  length(): number {
    return this.items.length;
  }
  all(): readonly EvidenceEnvelope[] {
    return this.items;
  }
  hlc(): Hlc {
    return this.clock;
  }

  /** Latest non-superseded fact per (subject_type, subject_id, predicate). */
  current(): readonly EvidenceEnvelope[] {
    const superseded = new Set<string>();
    for (const e of this.items) if (e.supersedes_id) superseded.add(e.supersedes_id);
    const byKey = new Map<string, EvidenceEnvelope>();
    for (const e of this.items) {
      if (superseded.has(e.id)) continue;
      byKey.set(`${e.subject_type}\u0000${e.subject_id}\u0000${e.predicate}`, e);
    }
    return [...byKey.values()];
  }

  export(): Uint8Array {
    return encodeCbor({ log: 'omega.evidence.v1', items: this.items as unknown as CborValue });
  }
}

export interface ChainVerdict {
  readonly ok: boolean;
  /** Index of the first broken link, or -1. */
  readonly brokenAt: number;
  readonly reason: string | null;
}

/** Recompute every hash and link. Nothing is trusted as given. */
export function verifyChain(items: readonly EvidenceEnvelope[]): ChainVerdict {
  let prev: string | null = null;
  for (let i = 0; i < items.length; i++) {
    const e = items[i];
    if (e.prev_hash !== prev) {
      return {
        ok: false,
        brokenAt: i,
        reason: 'prev_hash does not match the previous content_hash',
      };
    }
    if (recomputeContentHash(e) !== e.content_hash) {
      return { ok: false, brokenAt: i, reason: 'content_hash does not match the record body' };
    }
    const hlc: Hlc = { wall: e.hlc_wall_ms, counter: e.hlc_logical, node: e.hlc_node };
    const expectedId = deterministicId(
      'fact',
      hlc,
      core(
        {
          subject_type: e.subject_type,
          subject_id: e.subject_id,
          predicate: e.predicate,
          object_json: e.object_json,
          confidence: e.confidence,
          source: e.source,
          source_ref: e.source_ref,
          tags: e.tags,
          supersedes_id: e.supersedes_id,
        },
        hlc,
        e.prev_hash,
      ),
    );
    if (expectedId !== e.id) {
      return { ok: false, brokenAt: i, reason: 'id is not derived from the record content' };
    }
    prev = e.content_hash;
  }
  return { ok: true, brokenAt: -1, reason: null };
}
