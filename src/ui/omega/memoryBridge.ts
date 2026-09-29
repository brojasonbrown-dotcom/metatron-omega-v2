/**
 * memoryBridge — builds the MemoryPack the chat turn ships to the server.
 *
 * This is the client half of the fix for "no memories are readable": the
 * corpus lives here, so recall happens here, and only the recalled working
 * set travels with the request.
 *
 * Usage feedback closes the loop: every chunk the model actually cites is
 * reinforced in the concept graph (see `reinforceCitations`), so recall
 * improves from outcomes instead of staying frozen at ingest time.
 */

import { getKnowledgeRuntime } from './knowledgeRuntime';
import { fieldContextFrom } from './fieldContext';
import { EVIDENCE_CHARS, type MemoryEvidence, type MemoryPack } from '@/lib/chat/memoryPack';
import type { RecallHit } from '@/core/knowledge/types';

const POOL_CHARS = 1400;

function toEvidence(h: RecallHit, chars: number): MemoryEvidence {
  return {
    id: h.chunk.id,
    docId: h.chunk.docId,
    title: h.doc?.title ?? h.chunk.field ?? 'untitled',
    url: h.doc?.url ?? '',
    source: h.doc?.source ?? 'local',
    field: h.chunk.field,
    band: h.band,
    score: h.score,
    channels: {
      lexical: h.lexical,
      semantic: h.semantic,
      latent: h.latent,
      fieldSig: h.fieldSig,
      barcode: h.barcode,
      spread: h.spread,
      resonance: h.resonance,
    },
    text: h.chunk.text.slice(0, chars),
  };
}

export interface PackOptions {
  /** extra queries (e.g. the previous user turns) widening the working set */
  context?: string[];
  /** chunks injected verbatim as EVIDENCE */
  topN?: number;
  /** chunks the memory tools may search within */
  poolN?: number;
  /** live engine snapshot, enabling the resonance channel */
  snapshot?: unknown;
}

/** Recall the working set for this turn. Never throws — chat must not break. */
export function buildMemoryPack(query: string, opts: PackOptions = {}): MemoryPack | null {
  try {
    const rt = getKnowledgeRuntime();
    const stats = rt.kb.stats();
    const topN = Math.max(1, opts.topN ?? 6);
    const poolN = Math.max(topN, opts.poolN ?? 32);
    const ctx = opts.snapshot
      ? fieldContextFrom(opts.snapshot as Parameters<typeof fieldContextFrom>[0])
      : undefined;

    const primary = rt.recall(query, poolN, undefined, ctx);
    const seen = new Set(primary.map((h) => h.chunk.id));
    const extra: RecallHit[] = [];
    for (const q of opts.context ?? []) {
      if (!q.trim()) continue;
      for (const h of rt.recall(q, 6, undefined, ctx)) {
        if (seen.has(h.chunk.id)) continue;
        seen.add(h.chunk.id);
        extra.push(h);
      }
    }

    const pool = [...primary, ...extra].map((h) => toEvidence(h, POOL_CHARS));
    const hits = primary.slice(0, topN).map((h) => toEvidence(h, EVIDENCE_CHARS));

    return {
      query,
      stats: {
        documents: stats.documents,
        chunks: stats.chunks,
        concepts: stats.concepts,
        terms: stats.terms,
        edges: stats.edges,
        fields: stats.fields,
        bytes: stats.bytes,
      },
      fields: rt.kb
        .fields()
        .map((f) => f.field)
        .slice(0, 24),
      hits,
      pool,
    };
  } catch {
    return null;
  }
}

/** chunk ids cited in an answer, from the `(mem:<id>)` citation form. */
export function extractCitations(answer: string): string[] {
  const out = new Set<string>();
  for (const m of answer.matchAll(/\(?mem:([a-z0-9]{4,32})\)?/gi)) out.add(m[1]);
  return [...out];
}

/**
 * Usage feedback: reinforce the concept graph for chunks the model actually
 * used. Ignored candidates are left alone — decay is the consolidator's job,
 * so a single turn can never bury material.
 */
export function reinforceCitations(query: string, answer: string): number {
  try {
    const ids = extractCitations(answer);
    if (ids.length === 0) return 0;
    const rt = getKnowledgeRuntime();
    let n = 0;
    for (const id of ids) {
      const chunk = rt.kb.chunk(id);
      if (!chunk) continue;
      const terms = (query.toLowerCase().match(/[a-z0-9][a-z0-9+.#_-]*/g) ?? [])
        .filter((t) => t.length >= 3)
        .slice(0, 12);
      if (terms.length) rt.kb.concepts.observe(id, terms);
      n++;
    }
    return n;
  } catch {
    return 0;
  }
}
