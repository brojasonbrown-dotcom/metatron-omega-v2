/**
 * KnowledgeBase — the local-first corpus and the recall cascade.
 *
 * Layers (all on-device, all deterministic):
 *   C0 barcode prefilter   — Fibonacci-stride LSH over the φ-plane bitmap
 *   C1 lexical BM25        — exact term anchor
 *   C2 semantic cosine     — hashed feature vector, exact rescore
 *   C3 spreading activation— Hebbian concept graph, φ⁻ⁿ per hop
 *   C4 fusion              — φ-weighted channel sum + per-document diversity
 *
 * Fusion weights are φ-graded (1, φ⁻¹, φ⁻², φ⁻³) so no channel can dominate
 * by scale accident, and every hit reports its per-channel contributions —
 * the panel shows the evidence, never a black-box score.
 */

import { blendWithResonance } from '@metatron/trnn-core/substrate/resonanceBus';
import { PHI_INV } from '@/core/gematria/zphi';
import { encodeBitmap, weightedDistance } from '@/core/gematria/bitmap';
import { LexicalIndex } from './LexicalIndex';
import { BarcodeIndex } from './BarcodeIndex';
import { ConceptGraph } from './ConceptGraph';
import { LatentSpace, type LatentBuildReport, type LatentOptions } from './LatentSpace';
import { tokenize, termCounts, featureCounts, hashVector, cosine, embed, VECTOR_DIM } from './tokenize';
import { measureResonance, ageBand, type FieldContext } from '@/core/memory/Resonance';
import { fibonacciBandedSelect } from '@/core/memory/Banding';
import {
  consolidate as consolidatePass,
  type ConsolidationItem,
  type ConsolidationReport,
} from '@/core/memory/Consolidator';

import {
  FieldSignatureEncoder,
  FIELD_SIGNATURE_VERSION,
  recommendTier,
  multiScaleScores,
  tierById,
  type BasisReport,
} from './fieldSignature';

import type { KChunk, KDocument, RecallHit, KnowledgeStats } from './types';


const W_LEX = 1;
const W_SEM = PHI_INV;
const W_BAR = PHI_INV * PHI_INV;
const W_SPR = PHI_INV * PHI_INV * PHI_INV;
/** Latent (PPMI-SVD) sits between semantic and barcode: φ⁻¹·⁵. */
const W_LAT = Math.pow(PHI_INV, 1.5);
/**
 * Field signature (Ω-SHFN G) sits between barcode and spread: φ⁻²·⁵. It is a
 * rescore-only channel — it never introduces candidates, so a corpus with no
 * signatures returns exactly the same candidate set as before.
 */
const W_FLD = Math.pow(PHI_INV, 2.5);
const W_SUM = W_LEX + W_SEM + W_BAR + W_SPR;

/** Target chunk size in characters, split on sentence/paragraph boundaries. */
export const CHUNK_CHARS = 1200;
export const CHUNK_OVERLAP = 200;

export function chunkText(text: string, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length <= size) return clean ? [clean] : [];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(clean.length, i + size);
    if (end < clean.length) {
      const window = clean.slice(i, end);
      const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('? '));
      if (cut > size * 0.5) end = i + cut + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out;
}

/** Stable content hash id — identical text never enters the corpus twice. */
function contentId(prefix: string, s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i) + i, 0x85ebca6b) >>> 0;
  }
  return `${prefix}${h1.toString(36)}${h2.toString(36)}`;
}

export interface IngestInput {
  field: string;
  url: string;
  title?: string;
  source?: string;
  text: string;
  /** ladder rung dominant at capture (-1 when unknown) */
  rung?: number;
  /** provenance confidence in [0,1] */
  trust?: number;
  /**
   * Cross-modal binding (Ω-CAD phase 5): a measured, unit-norm descriptor from
   * a non-text modality (geometry, image). When present it is folded into every
   * chunk vector of this document at weight φ⁻¹, so a drawing and the words
   * that describe it land in one recall space. Text-only ingest is untouched.
   */
  descriptor?: Float64Array;
  /** modality tag for the panel; 'text' when omitted */
  modality?: 'text' | 'geometry' | 'image' | 'audio';
  /** injected clock — keeps ingest deterministic under test */
  now?: number;
}

/**
 * Fold a modality descriptor into a hashed text vector. Deterministic: each
 * descriptor slot lands on a fixed stride-φ position, never a random one, and
 * the result is renormalised so no chunk gains score purely by having a
 * descriptor attached.
 */
export function blendDescriptor(vec: Float64Array, desc: Float64Array, weight = PHI_INV): Float64Array {
  if (!desc || desc.length === 0) return vec;
  const out = Float64Array.from(vec);
  let dn = 0;
  for (let i = 0; i < desc.length; i++) dn += desc[i] * desc[i];
  dn = Math.sqrt(dn);
  if (!(dn > 0)) return vec;
  // Stride chosen coprime-ish to the dimension so slots spread evenly.
  const stride = Math.max(1, Math.round(VECTOR_DIM / (desc.length * PHI_INV)) | 1);
  for (let i = 0; i < desc.length; i++) {
    const slot = (i * stride) % VECTOR_DIM;
    out[slot] += (weight * desc[i]) / dn;
  }
  let n = 0;
  for (let i = 0; i < out.length; i++) n += out[i] * out[i];
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}


export interface IngestResult {
  docId: string;
  duplicate: boolean;
  chunks: number;
  newChunks: number;
  chars: number;
}

export class KnowledgeBase {
  readonly lexical = new LexicalIndex();
  readonly barcodes = new BarcodeIndex();
  readonly concepts = new ConceptGraph();
  readonly latent = new LatentSpace();

  /** chunk id → latent embedding, present only after trainLatent() */
  private latentVecs = new Map<string, Float64Array>();

  /** chunk id → field signature, present only after buildSignatures() */
  private sigs = new Map<string, Float64Array>();
  private sigEncoder: FieldSignatureEncoder | null = null;

  private docs = new Map<string, KDocument>();
  private chunks = new Map<string, KChunk>();
  private byUrl = new Map<string, string>();
  private approxBytes = 0;

  // ── ingest ────────────────────────────────────────────────────────────
  ingest(input: IngestInput): IngestResult {
    const text = (input.text ?? '').trim();
    const docId = contentId('d', `${input.url}\u0000${text.slice(0, 4096)}`);
    const existing = this.docs.get(docId);
    if (existing) {
      return { docId, duplicate: true, chunks: existing.chunkIds.length, newChunks: 0, chars: existing.chars };
    }

    const pieces = chunkText(text);
    const chunkIds: string[] = [];
    const stamp = input.now ?? Date.now();
    const rung = Number.isFinite(input.rung as number) ? (input.rung as number) : -1;
    const trust = Number.isFinite(input.trust as number)
      ? Math.max(0, Math.min(1, input.trust as number))
      : 1;
    let fresh = 0;

    pieces.forEach((piece, ord) => {
      const cid = contentId('c', piece);
      chunkIds.push(cid);
      if (this.chunks.has(cid)) return;      // exact dedupe across documents
      const toks = tokenize(piece);
      const counts = termCounts(toks);
      // Document vectors carry NO idf: they must stay byte-identical for the
      // life of the corpus. Rarity weighting is applied query-side (ltc.lnc).
      const vec = input.descriptor && input.descriptor.length
        ? blendDescriptor(hashVector(featureCounts(toks), VECTOR_DIM), input.descriptor)
        : hashVector(featureCounts(toks), VECTOR_DIM);
      const barcode = encodeBitmap(vec);
      const chunk: KChunk = {
        id: cid, docId, field: input.field, ord, text: piece, vec, barcode, tokens: toks.length,
        createdAt: stamp, rung, trust, modality: input.modality ?? 'text',
        descriptor: input.descriptor && input.descriptor.length ? Array.from(input.descriptor) : undefined,
      };


      this.chunks.set(cid, chunk);
      this.lexical.add(cid, counts);
      this.barcodes.add(cid, barcode);
      this.concepts.observe(cid, salientTerms(counts));
      this.approxBytes += piece.length * 2 + VECTOR_DIM * 8 + 64;
      fresh++;
    });

    const doc: KDocument = {
      id: docId,
      field: input.field,
      url: input.url,
      title: (input.title || input.url).slice(0, 300),
      source: input.source || 'web_fetch',
      fetchedAt: Date.now(),
      chars: text.length,
      chunkIds,
    };
    this.docs.set(docId, doc);
    this.byUrl.set(input.url, docId);
    return { docId, duplicate: false, chunks: pieces.length, newChunks: fresh, chars: text.length };
  }

  hasUrl(url: string): boolean { return this.byUrl.has(url); }

  // ── recall cascade ────────────────────────────────────────────────────
  /**
   * C0..C4 text cascade, then two structural passes:
   *   C5 resonance — geometric mean against the live field (abstains offline)
   *   C6 banding   — Fibonacci age quotas so old material is never silenced
   *
   * With no FieldContext the resonance channel abstains entirely and the
   * ranking is byte-identical to the pre-resonance cascade — the engine being
   * offline must never change what recall returns.
   */
  recall(query: string, topN = 8, field?: string, ctx?: FieldContext): RecallHit[] {
    const toks = tokenize(query);
    if (toks.length === 0 || this.chunks.size === 0) return [];
    const counts = termCounts(toks);
    const qvec = hashVector(featureCounts(toks), VECTOR_DIM, (t) => this.lexical.idf(t));
    const qbar = encodeBitmap(qvec);
    const qlat = this.latent.trained
      ? this.latent.embed(salientTerms(counts, 24), (t) => this.lexical.idf(t))
      : null;
    // Field signature for the cue — computed once per recall, and only when
    // the basis is live AND at least one chunk carries a signature. Otherwise
    // the channel abstains and the ranking is bit-identical to the five-channel
    // cascade.
    const qsig = this.sigEncoder?.ready() && this.sigs.size > 0
      ? this.sigEncoder.encode(query)
      : null;

    const bar = new Map(this.barcodes.query(qbar, 256).map((r) => [r.id, r.score]));
    const lex = new Map(this.lexical.search([...counts.keys()], 128).map((r) => [r.id, r.score]));
    const spr = this.concepts.spread(salientTerms(counts, 12), 2);

    const now = ctx?.now ?? Date.now();
    const candidates = new Set<string>([...bar.keys(), ...lex.keys(), ...spr.keys()]);
    // Ω-DEPTH Section 3 — multi-scale FLD: coarse band ranks everyone, only the
    // survivors pay for the full-resolution phase-aligned rescore.
    const fldScores = qsig
      ? multiScaleScores(
          qsig,
          new Map([...candidates].map((id) => [id, this.sigs.get(id) ?? null])),
        )
      : null;
    const hits: RecallHit[] = [];
    for (const id of candidates) {
      const chunk = this.chunks.get(id);
      if (!chunk) continue;
      if (field && chunk.field !== field) continue;
      const semantic = Math.max(0, cosine(qvec, chunk.vec));   // exact rescore
      // Candidates that arrived via another channel still get an exact
      // bitmap reading — the barcode column is never a blank by omission.
      const cached = bar.get(id);
      const barcode = cached ?? (1 - weightedDistance(qbar, chunk.barcode));
      const lexical = lex.get(id) ?? 0;
      const spread = spr.get(id) ?? 0;
      // Latent channel abstains (NaN) whenever the space is untrained or the
      // text has no vocabulary overlap — the cascade then renormalises, so an
      // absent channel can never dilute a score toward zero.
      const latRaw = qlat ? this.latent.similarity(qlat, this.latentVecs.get(id) ?? null) : NaN;
      const latent = Number.isFinite(latRaw) ? Math.max(0, latRaw) : NaN;
      const useLat = Number.isFinite(latent);
      const fldRaw = fldScores ? (fldScores.get(id) ?? NaN) : NaN;
      const fieldSig = Number.isFinite(fldRaw) ? Math.max(0, fldRaw) : NaN;
      const useFld = Number.isFinite(fieldSig);
      const wsum = W_SUM + (useLat ? W_LAT : 0) + (useFld ? W_FLD : 0);
      const textScore =
        (W_LEX * lexical + W_SEM * semantic + W_BAR * barcode + W_SPR * spread +
          (useLat ? W_LAT * latent : 0) + (useFld ? W_FLD * fieldSig : 0)) / wsum;

      const res = ctx
        ? measureResonance({ vector: chunk.vec, capturedAt: chunk.createdAt, rung: chunk.rung }, ctx)
        : null;
      // Resonance MODULATES the text score, it never replaces it: a measured
      // resonance folds in as a φ-weighted geometric blend, an unmeasurable
      // one leaves the text score untouched.
      // Ω-REAL P4: the blend is the substrate law (`blendWithResonance`), not
      // local arithmetic — prior weight 1, resonance weight φ⁻¹, abstention
      // returns the prior untouched.
      const score = res ? blendWithResonance(textScore, res.value) : textScore;

      hits.push({
        chunk,
        doc: this.docs.get(chunk.docId),
        barcode, lexical, semantic, spread, latent, fieldSig,
        resonance: res ? res.value : NaN,
        resonanceVeto: res ? res.vetoId : null,
        band: ageBand(chunk.createdAt, now),
        contradicts: chunk.contradicts ? [...chunk.contradicts] : [],
        score,
      });
    }

    hits.sort((a, b) => b.score - a.score || (a.chunk.id < b.chunk.id ? -1 : 1));

    // Diversify: at most 2 chunks per document before others get a turn.
    const perDoc = new Map<string, number>();
    const pool: RecallHit[] = [];
    for (const h of hits) {
      const n = perDoc.get(h.chunk.docId) ?? 0;
      if (n >= 2) continue;
      perDoc.set(h.chunk.docId, n + 1);
      pool.push(h);
      if (pool.length >= topN * 4) break;   // banding needs a pool to draw from
    }

    // Fibonacci age quotas over the diversified pool.
    const banded = fibonacciBandedSelect(
      pool.map((h) => ({ band: h.band, score: h.score, id: h.chunk.id, hit: h })),
      topN,
    );
    return banded.map((b) => b.hit);
  }


  /**
   * Train the latent space (Phase 3). Deterministic and offline: it reads the
   * corpus once, factorises the PPMI matrix, and caches one embedding per
   * chunk. Until this runs the latent channel abstains entirely.
   */
  trainLatent(opts: LatentOptions = {}): LatentBuildReport {
    const perChunk: string[][] = [];
    const ids: string[] = [];
    for (const c of this.chunks.values()) {
      ids.push(c.id);
      perChunk.push(salientTerms(termCounts(tokenize(c.text)), opts.perDoc ?? 24));
    }
    const report = this.latent.build(perChunk, opts);
    this.latentVecs.clear();
    if (this.latent.trained) {
      for (let i = 0; i < ids.length; i++) {
        const v = this.latent.embed(perChunk[i], (t) => this.lexical.idf(t));
        if (v) this.latentVecs.set(ids[i], v);
      }
    }
    return report;
  }

  /**
   * Prepare the field-signature eigenbasis (Ω-SHFN G). Synchronous and
   * expensive exactly once per tier per session; every later call reuses the
   * cached basis. Returns the MEASURED basis report — residual, λ range,
   * digest, and the real build timing.
   */
  prepareSignatures(tierId?: string): BasisReport {
    const tier = tierId ? tierById(tierId) : recommendTier();
    if (!this.sigEncoder || this.sigEncoder.tier.id !== tier.id) {
      this.sigEncoder = new FieldSignatureEncoder(tier);
      this.sigs.clear();      // widths differ across tiers — never mix them
    }
    return this.sigEncoder.prepare();
  }

  /**
   * Encode up to `budget` chunks that do not yet carry a signature. Incremental
   * by design: a large corpus is covered over several calls instead of blocking
   * the tab once. Order is the stable sorted-id order, so two machines cover the
   * corpus in the same sequence.
   */
  buildSignatures(budget = 256): { built: number; covered: number; total: number; ms: number } {
    const enc = this.sigEncoder;
    if (!enc || !enc.ready()) throw new Error('prepareSignatures() must run first');
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    let built = 0;
    for (const c of this.chunkList()) {
      if (built >= budget) break;
      if (this.sigs.has(c.id)) continue;
      const sig = enc.encode(c.text);
      if (sig) this.sigs.set(c.id, sig);
      built++;                              // an abstention still consumes budget
    }
    const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
    return { built, covered: this.sigs.size, total: this.chunks.size, ms: t1 - t0 };
  }

  /** Fraction of the corpus carrying a field signature. */
  signatureCoverage(): number {
    return this.chunks.size === 0 ? 0 : this.sigs.size / this.chunks.size;
  }

  /** Does this chunk carry a measured field signature, or only a fingerprint? */
  hasSignature(id: string): boolean { return this.sigs.has(id); }

  signatureFor(id: string): Float64Array | null { return this.sigs.get(id) ?? null; }

  signatureState(): {
    version: string;
    tier: string | null;
    ready: boolean;
    width: number;
    covered: number;
    total: number;
    basis: BasisReport | null;
  } {
    return {
      version: FIELD_SIGNATURE_VERSION,
      tier: this.sigEncoder?.tier.id ?? null,
      ready: this.sigEncoder?.ready() ?? false,
      width: this.sigEncoder?.width() ?? 0,
      covered: this.sigs.size,
      total: this.chunks.size,
      basis: this.sigEncoder?.report() ?? null,
    };
  }

  /** Encode arbitrary text in the live basis — used by probes and the deck. */
  signatureOf(text: string): Float64Array | null {
    return this.sigEncoder?.ready() ? this.sigEncoder.encode(text) : null;
  }

  latentCoverage(): number {
    return this.chunks.size === 0 ? 0 : this.latentVecs.size / this.chunks.size;
  }

  /** Vector for arbitrary text — used to bridge recall into the field engine. */
  vectorFor(text: string): Float64Array { return embed(text); }

  // ── views ─────────────────────────────────────────────────────────────
  documents(field?: string): KDocument[] {
    const all = [...this.docs.values()];
    const f = field ? all.filter((d) => d.field === field) : all;
    return f.sort((a, b) => b.fetchedAt - a.fetchedAt);
  }
  fields(): Array<{ field: string; docs: number; chunks: number }> {
    const m = new Map<string, { docs: number; chunks: number }>();
    for (const d of this.docs.values()) {
      const e = m.get(d.field) ?? { docs: 0, chunks: 0 };
      e.docs++; e.chunks += d.chunkIds.length;
      m.set(d.field, e);
    }
    return [...m.entries()].map(([field, v]) => ({ field, ...v })).sort((a, b) => b.chunks - a.chunks);
  }
  chunk(id: string): KChunk | undefined { return this.chunks.get(id); }

  /**
   * Every chunk in stable id order. Sorted, not insertion-ordered, so any
   * audit that samples the corpus is reproducible across machines.
   */
  chunkList(): KChunk[] {
    return [...this.chunks.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }


  /**
   * Consolidation pass (plane D). Clusters near-duplicate chunks into
   * prototypes and RECORDS contradictions on both sides of each conflicting
   * pair. Nothing is deleted here: consolidation annotates structure, the
   * governor is the only thing allowed to reclaim bytes.
   */
  consolidate(budget = 20000): ConsolidationReport {
    const items: ConsolidationItem[] = [...this.chunks.values()].map((c) => ({
      id: c.id,
      vec: c.vec,
      terms: new Set(salientTerms(termCounts(tokenize(c.text)), 24)),
    }));
    const report = consolidatePass(items, budget);

    // Reset then re-apply, so a resolved conflict does not linger forever.
    for (const c of this.chunks.values()) if (c.contradicts) delete c.contradicts;
    for (const x of report.contradictions) {
      const a = this.chunks.get(x.a);
      const b = this.chunks.get(x.b);
      if (a) (a.contradicts ??= []).push(x.b);
      if (b) (b.contradicts ??= []).push(x.a);
    }
    for (const cl of report.clusters) {
      if (cl.support <= 1) continue;
      for (const id of cl.memberIds) {
        const c = this.chunks.get(id);
        if (c && id !== cl.prototypeId) c.prototypeOf = cl.prototypeId;
      }
    }
    return report;
  }


  stats(): KnowledgeStats {
    return {
      fields: this.fields().length,
      documents: this.docs.size,
      chunks: this.chunks.size,
      terms: this.lexical.termCount(),
      concepts: this.concepts.size(),
      edges: this.concepts.edgeCount(),
      bytes: this.approxBytes,
      bands: this.barcodes.bandCount(),
    };
  }

  // ── persistence payload ───────────────────────────────────────────────
  snapshot() {
    return {
      docs: [...this.docs.values()],
      chunks: [...this.chunks.values()].map((c) => ({
        id: c.id, docId: c.docId, field: c.field, ord: c.ord, text: c.text, tokens: c.tokens,
        createdAt: c.createdAt, rung: c.rung, trust: c.trust,
        modality: c.modality,
        descriptor: c.descriptor ? [...c.descriptor] : undefined,
        contradicts: c.contradicts ? [...c.contradicts] : undefined,
      })),

      concepts: this.concepts.snapshot(),
    };
  }

  /** Rebuild every index from text — indices are derived, never trusted from disk. */
  restore(snap: ReturnType<KnowledgeBase['snapshot']>): void {
    this.clear();
    for (const d of snap.docs) {
      this.docs.set(d.id, { ...d, chunkIds: [...d.chunkIds] });
      this.byUrl.set(d.url, d.id);
    }
    for (const c of snap.chunks) {
      const counts = termCounts(tokenize(c.text));
      // Cross-modal chunks must rebuild the SAME vector they were ingested
      // with: text-only re-encoding would silently drop the descriptor
      // binding and move the chunk in recall space after every reload.
      const base = hashVector(featureCounts(tokenize(c.text)), VECTOR_DIM);
      const vec = c.descriptor && c.descriptor.length
        ? blendDescriptor(base, Float64Array.from(c.descriptor))
        : base;
      const barcode = encodeBitmap(vec);

      // Saves written before scale/age tagging carry no stamps. They fall back
      // to the owning document's fetch time and an untagged rung rather than
      // to `now`, which would make every legacy memory look brand new.

      const createdAt = Number.isFinite(c.createdAt as number)
        ? (c.createdAt as number)
        : (this.docs.get(c.docId)?.fetchedAt ?? Date.now());
      this.chunks.set(c.id, {
        ...c,
        vec,
        barcode,
        createdAt,
        rung: Number.isFinite(c.rung as number) ? (c.rung as number) : -1,
        trust: Number.isFinite(c.trust as number) ? (c.trust as number) : 1,
      });

      this.lexical.add(c.id, counts);
      this.barcodes.add(c.id, barcode);
      this.approxBytes += c.text.length * 2 + VECTOR_DIM * 8 + 64;
    }
    if (snap.concepts) this.concepts.restore(snap.concepts);
  }

  removeDocument(docId: string): void {
    const doc = this.docs.get(docId);
    if (!doc) return;
    for (const cid of doc.chunkIds) {
      const c = this.chunks.get(cid);
      if (!c) continue;
      this.approxBytes -= c.text.length * 2 + VECTOR_DIM * 8 + 64;
      this.chunks.delete(cid);
      this.latentVecs.delete(cid);
      this.sigs.delete(cid);
      this.lexical.remove(cid);
      this.barcodes.remove(cid);
      this.concepts.forgetChunk(cid);
    }
    this.byUrl.delete(doc.url);
    this.docs.delete(docId);
    if (this.approxBytes < 0) this.approxBytes = 0;
  }

  clear(): void {
    this.docs.clear(); this.chunks.clear(); this.byUrl.clear();
    this.lexical.clear(); this.barcodes.clear(); this.concepts.clear();
    this.latent.clear(); this.latentVecs.clear(); this.sigs.clear();
    this.approxBytes = 0;
  }
}

/** Salience-ordered unigrams (bigrams excluded) for the concept graph. */
export function salientTerms(counts: Map<string, number>, n = 16): string[] {
  return [...counts.entries()]
    .filter(([t]) => !t.includes('_'))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([t]) => t);
}
