/**
 * Genome contract and measured health.
 *
 * A "genome" here is the vector identity of a chunk: the hashed feature
 * vector (VECTOR_DIM slots) plus its φ-plane barcode, optionally blended with
 * a measured non-text descriptor. Everything below is MEASURED over the live
 * corpus — no estimates, no constants standing in for observations.
 *
 * Determinism: the sample is taken in sorted-id order, so identical corpora
 * produce identical reports on every machine.
 */

import { VECTOR_DIM, cosine, tokenize, featureCounts, hashVector } from './tokenize';
import { encodeBitmap, weightedDistance } from '@/core/gematria/bitmap';
import type { KnowledgeBase } from './KnowledgeBase';
import type { KChunk } from './types';

/**
 * Encoder identity. Bump `version` whenever tokenizer, dimension or blending
 * changes — vectors are rebuilt from text on restore, so a bump invalidates
 * cached comparisons, never the corpus text itself.
 */
export const GENOME_CONTRACT = {
  version: 'omega-genome-1',
  dim: VECTOR_DIM,
  /** recall channels that read the genome, in fusion order */
  channels: [
    'lexical',
    'semantic',
    'latent',
    'barcode',
    'fieldSig',
    'spread',
    'resonance',
  ] as const,
  /** cross-modal descriptor blend weight (φ⁻¹) */
  descriptorWeight: 0.6180339887498949,
  encoding: 'fnv1a-hashed feature counts (unigram+bigram), L2-normalised',
  barcode: 'φ-plane bitmap over the vector, Fibonacci-stride LSH bands',
} as const;

export interface GenomeHealth {
  version: string;
  dim: number;
  /** chunks in the corpus */
  chunks: number;
  /** chunks actually measured */
  sampled: number;
  /** mean fraction of non-zero slots per vector */
  fill: number;
  /** mean L2 norm; the encoder normalises, so this must sit at 1 */
  norm: number;
  /** mean pairwise cosine over the sample — high means the space collapsed */
  anisotropy: number;
  /**
   * fraction of sampled pairs the barcode calls near-identical (≥0.95) while
   * the exact cosine disagrees (<0.5) — the LSH false-positive rate.
   */
  barcodeFalsePositive: number;
  /** re-encoding the stored text reproduces the stored vector bit-for-bit */
  reencodeExact: boolean;
  /** chunks whose stored vector differs from a fresh encode of their text */
  driftedChunks: number;
  modalities: Record<string, number>;
  /** chunks carrying a non-text modality tag */
  crossModal: number;
  /**
   * Fraction of the corpus carrying a MEASURED field signature. Chunks below
   * this line hold a semantic fingerprint only — the SELF deck and the chat
   * contract must say so rather than claim field memory for them.
   */
  fieldSignatureCoverage: number;
  /** Signature contract version, or null when the basis has never been built. */
  fieldSignatureTier: string | null;
  fieldSignatureWidth: number;
}

function sampleChunks(kb: KnowledgeBase, n: number): KChunk[] {
  const all = kb.chunkList();
  if (all.length <= n) return all;
  // Deterministic even stride over the sorted list — no RNG, full coverage.
  const step = all.length / n;
  const out: KChunk[] = [];
  for (let i = 0; i < n; i++) out.push(all[Math.floor(i * step)]);
  return out;
}

export function measureGenomeHealth(kb: KnowledgeBase, sampleSize = 160): GenomeHealth {
  const chunks = sampleChunks(kb, Math.max(2, sampleSize));
  const stats = kb.stats();
  const modalities: Record<string, number> = {};
  let fill = 0;
  let norm = 0;
  let drifted = 0;
  let crossModal = 0;

  for (const c of chunks) {
    let nz = 0;
    let sq = 0;
    for (let i = 0; i < c.vec.length; i++) {
      if (c.vec[i] !== 0) nz++;
      sq += c.vec[i] * c.vec[i];
    }
    fill += nz / Math.max(1, c.vec.length);
    norm += Math.sqrt(sq);
    const mod = c.modality ?? 'text';
    modalities[mod] = (modalities[mod] ?? 0) + 1;
    if (mod !== 'text') crossModal++;

    // Drift: a plain text chunk must re-encode to exactly what is stored.
    if (mod === 'text') {
      const fresh = hashVector(featureCounts(tokenize(c.text)), VECTOR_DIM);
      let same = fresh.length === c.vec.length;
      if (same) {
        for (let i = 0; i < fresh.length; i++) {
          if (fresh[i] !== c.vec[i]) {
            same = false;
            break;
          }
        }
      }
      if (!same) drifted++;
    }
  }

  // Pairwise pass over consecutive sample pairs — O(n), deterministic.
  let cosSum = 0;
  let pairs = 0;
  let falsePos = 0;
  for (let i = 0; i + 1 < chunks.length; i++) {
    const a = chunks[i];
    const b = chunks[i + 1];
    const cs = cosine(a.vec, b.vec);
    cosSum += cs;
    const bar = 1 - weightedDistance(a.barcode, b.barcode);
    if (bar >= 0.95 && cs < 0.5) falsePos++;
    pairs++;
  }

  const sig = kb.signatureState();
  const n = Math.max(1, chunks.length);
  return {
    version: GENOME_CONTRACT.version,
    dim: VECTOR_DIM,
    chunks: stats.chunks,
    sampled: chunks.length,
    fill: fill / n,
    norm: norm / n,
    anisotropy: pairs ? cosSum / pairs : 0,
    barcodeFalsePositive: pairs ? falsePos / pairs : 0,
    reencodeExact: drifted === 0,
    driftedChunks: drifted,
    modalities,
    crossModal,
    fieldSignatureCoverage: sig.total === 0 ? 0 : sig.covered / sig.total,
    fieldSignatureTier: sig.tier,
    fieldSignatureWidth: sig.width,
  };
}

export interface MeaningRow {
  term: string;
  /** chunks the cascade returned for this term */
  returned: number;
  /** fraction of them that literally contain the term */
  precision: number;
  /** fraction sharing the single most common field among the hits */
  fieldAgreement: number;
}

export interface MeaningReport {
  terms: number;
  meanPrecision: number;
  meanFieldAgreement: number;
  rows: MeaningRow[];
}

/**
 * Does a genome mean what its concept says it means? For each top concept the
 * cascade is queried and the returned chunks are checked for the term itself.
 * This is a measured precision, not an assumption about the encoder.
 */
export function measureMeaning(kb: KnowledgeBase, terms = 12, k = 6): MeaningReport {
  const rows: MeaningRow[] = [];
  for (const row of kb.concepts.top(terms)) {
    const hits = kb.recall(row.term, k);
    if (hits.length === 0) {
      rows.push({ term: row.term, returned: 0, precision: 0, fieldAgreement: 0 });
      continue;
    }
    const needle = row.term.toLowerCase();
    let contains = 0;
    const fields = new Map<string, number>();
    for (const h of hits) {
      if (h.chunk.text.toLowerCase().includes(needle)) contains++;
      fields.set(h.chunk.field, (fields.get(h.chunk.field) ?? 0) + 1);
    }
    const top = Math.max(...fields.values());
    rows.push({
      term: row.term,
      returned: hits.length,
      precision: contains / hits.length,
      fieldAgreement: top / hits.length,
    });
  }
  const withHits = rows.filter((r) => r.returned > 0);
  const n = Math.max(1, withHits.length);
  return {
    terms: rows.length,
    meanPrecision: withHits.reduce((s, r) => s + r.precision, 0) / n,
    meanFieldAgreement: withHits.reduce((s, r) => s + r.fieldAgreement, 0) / n,
    rows,
  };
}

/**
 * Held-out self-retrieval: query the cascade with a chunk's own opening text
 * and check whether that chunk comes back. Measures the recall floor honestly
 * (a corpus that cannot find itself cannot find anything).
 */
export interface RetrievalReport {
  probes: number;
  top1: number;
  top5: number;
}

export function measureSelfRetrieval(kb: KnowledgeBase, probes = 12): RetrievalReport {
  const chunks = sampleChunks(kb, Math.max(1, probes));
  if (chunks.length === 0) return { probes: 0, top1: 0, top5: 0 };
  let t1 = 0;
  let t5 = 0;
  for (const c of chunks) {
    const query = c.text.split(/\s+/).slice(0, 18).join(' ');
    const hits = kb.recall(query, 5);
    if (hits[0]?.chunk.id === c.id) t1++;
    if (hits.some((h) => h.chunk.id === c.id)) t5++;
  }
  return { probes: chunks.length, top1: t1 / chunks.length, top5: t5 / chunks.length };
}

/** Encoder determinism: the same text must encode identically, twice. */
export function encoderIsDeterministic(
  sample = 'metatron omega φ ladder toroidal closure test',
): boolean {
  const a = hashVector(featureCounts(tokenize(sample)), VECTOR_DIM);
  const b = hashVector(featureCounts(tokenize(sample)), VECTOR_DIM);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  const ba = encodeBitmap(a);
  const bb = encodeBitmap(b);
  if (ba.length !== bb.length) return false;
  for (let i = 0; i < ba.length; i++) if (ba[i] !== bb[i]) return false;
  return true;
}
