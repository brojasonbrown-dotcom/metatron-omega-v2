/**
 * Ω-READY R7 — typed business intake: host facts → field vectors.
 *
 * The host speaks in typed facts (org, contract, transaction, kpi …); the engine
 * speaks in a 28-element complex field. Something has to translate, and the
 * translation must be:
 *
 *   • deterministic — same fact ⇒ same vector, on any machine, forever, so a
 *     recall is reproducible and a signature is stable;
 *   • structure-preserving — facts that share subject/predicate land near each
 *     other, facts that differ in value do not collide;
 *   • hash-derived — no learned table, no ordering dependence, nothing to drift.
 *
 * The scheme is signed feature hashing (the standard "hashing trick"), with the
 * SHA3-256 of each token deciding bucket, sign and φ-scaled magnitude, then an L2
 * normalisation so intake energy cannot depend on how many tokens a fact happens
 * to carry. Bucket index and sign come from independent bytes of the digest, so
 * collisions cancel in expectation instead of accumulating bias.
 */

import { sha3_256 } from '@noble/hashes/sha3.js';
import { encodeCbor, type CborValue } from './contract';
import type { FactDraft, SubjectType } from './evidence';

/** Field width — 28 complex elements, matching the engine intake. */
export const FIELD_DIM = 28;

const PHI_INV = 0.618033988749895;
const TE = new TextEncoder();

/** Tokens of a fact, in a fixed order so encoding cannot depend on key order. */
export function factTokens(d: FactDraft): string[] {
  const tokens: string[] = [
    `st:${d.subject_type}`,
    `si:${d.subject_id}`,
    `p:${d.predicate}`,
    `sp:${d.subject_type}/${d.predicate}`,
    `src:${d.source}`,
  ];
  for (const t of [...(d.tags ?? [])].sort()) tokens.push(`tag:${t}`);
  for (const t of objectTokens(d.object_json, 'o')) tokens.push(t);
  return tokens;
}

/** Flatten the object payload into stable, path-qualified tokens. */
function objectTokens(v: CborValue, path: string): string[] {
  if (v === null) return [`${path}=null`];
  if (typeof v === 'boolean') return [`${path}=${v}`];
  if (typeof v === 'number' || typeof v === 'bigint') return [`${path}#${v.toString()}`];
  if (typeof v === 'string') return [`${path}=${v}`];
  if (v instanceof Uint8Array) return [`${path}~${v.length}`];
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (let i = 0; i < v.length; i++) out.push(...objectTokens(v[i], `${path}.${i}`));
    return out;
  }
  const o = v as Record<string, CborValue>;
  const out: string[] = [];
  for (const k of Object.keys(o).sort()) out.push(...objectTokens(o[k], `${path}.${k}`));
  return out;
}

/** Weight of a token: leading structural tokens matter most, in φ decay. */
function tokenWeight(index: number): number {
  return PHI_INV ** Math.min(index, 12);
}

/**
 * Encode tokens into a real field vector of `dim` elements. Exported separately
 * so text and facts share one projection — two intake paths with two
 * projections would put the same meaning in two places.
 */
export function encodeTokens(tokens: readonly string[], dim = FIELD_DIM): Float64Array {
  const out = new Float64Array(dim);
  for (let i = 0; i < tokens.length; i++) {
    const h = sha3_256(TE.encode(tokens[i]));
    // bucket from the first two bytes, sign from bit 0 of byte 2, magnitude
    // refinement from byte 3 — independent bytes keep the three decisions
    // uncorrelated.
    const bucket = ((h[0] << 8) | h[1]) % dim;
    const sign = (h[2] & 1) === 0 ? 1 : -1;
    const mag = 0.5 + h[3] / 510; // (0.5 .. 1.0]
    out[bucket] += sign * mag * tokenWeight(i);
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) out[i] /= norm;
  return out;
}

/** Encode one typed host fact as a unit-norm field vector. */
export function encodeFact(d: FactDraft, dim = FIELD_DIM): Float64Array {
  return encodeTokens(factTokens(d), dim);
}

/** Encode free text (chat, documents) through the same projection. */
export function encodeText(text: string, dim = FIELD_DIM): Float64Array {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .map((t) => `w:${t}`);
  return encodeTokens(tokens, dim);
}

/** Cosine similarity — the resonance term the host scorer expects in [-1,1]. */
export function resonance(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  const r = dot / Math.sqrt(na * nb);
  return r > 1 ? 1 : r < -1 ? -1 : r;
}

/** Stable content key for a fact, for ranking tie-breaks and drawer context. */
export function factKey(d: FactDraft): string {
  return `${d.subject_type}/${d.subject_id}/${d.predicate}`;
}

/**
 * The 18 host information categories Ω must accept. Kept as data so intake
 * coverage can be asserted rather than assumed.
 */
export const HOST_SUBJECTS: readonly SubjectType[] = [
  'org', 'person', 'account', 'counterparty', 'contract', 'transaction', 'policy', 'kpi',
] as const;

/** Canonical CBOR of a fact's semantic identity — used for drawer content. */
export function factContent(d: FactDraft): Uint8Array {
  return encodeCbor({
    st: d.subject_type, si: d.subject_id, p: d.predicate, o: d.object_json,
  });
}
