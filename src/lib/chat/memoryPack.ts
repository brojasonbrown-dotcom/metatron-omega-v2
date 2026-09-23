/**
 * Memory pack — the bridge that makes the on-device corpus readable by the
 * model.
 *
 * The corpus (KnowledgeBase + OPFS archive) lives ONLY in the browser tab.
 * The chat loops run on the server and previously saw nothing but counters,
 * which is exactly why the model reported "no memories are readable" while
 * the panel showed thousands of concepts.
 *
 * The client now recalls a working set before the turn and ships it with the
 * request. The server injects it as an EVIDENCE block and exposes three
 * memory tools that operate over that working set — no corpus ever leaves the
 * device beyond the chunks the model is entitled to read this turn.
 *
 * Everything here is pure and deterministic: identical pack + identical query
 * ⇒ identical ranking.
 */

export interface MemoryEvidence {
  /** chunk id — the citation handle the model must use */
  id: string;
  docId: string;
  title: string;
  url: string;
  source: string;
  field: string;
  /** Fibonacci age band, 0 = freshest */
  band: number;
  score: number;
  channels: {
    lexical: number;
    semantic: number;
    barcode: number;
    latent: number;
    /** measured field-signature cosine; NaN when the chunk has no signature */
    fieldSig: number;
    spread: number;
    /** NaN when the engine was not streaming at recall time */
    resonance: number;
  };
  text: string;
}

export interface MemoryPack {
  /** query the working set was recalled for */
  query: string;
  stats: {
    documents: number;
    chunks: number;
    concepts: number;
    terms: number;
    edges: number;
    fields: number;
    bytes: number;
  };
  fields: string[];
  /** top hits for this turn — injected verbatim as EVIDENCE */
  hits: MemoryEvidence[];
  /** wider working set the memory tools may search within */
  pool: MemoryEvidence[];
}

export const EVIDENCE_CHARS = 900;
const POOL_CHARS = 1400;

/** Tokens used by the in-pack search — mirrors the corpus tokenizer's shape. */
function toks(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9][a-z0-9+.#_-]*/g) ?? []).filter((t) => t.length >= 2);
}

/**
 * Deterministic BM25-lite ranking inside the working set. The corpus cascade
 * already chose the pool; this only re-orders it for a differently-worded
 * follow-up question, so a light exact scorer is the honest tool here.
 */
export function searchPack(pack: MemoryPack, query: string, limit = 6): MemoryEvidence[] {
  const q = toks(query);
  if (q.length === 0) return pack.hits.slice(0, limit);
  const pool = pack.pool.length ? pack.pool : pack.hits;
  const df = new Map<string, number>();
  for (const e of pool) {
    const seen = new Set(toks(e.text));
    for (const t of q) if (seen.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = Math.max(1, pool.length);
  const scored = pool.map((e) => {
    const counts = new Map<string, number>();
    const et = toks(e.text);
    for (const t of et) counts.set(t, (counts.get(t) ?? 0) + 1);
    const len = Math.max(1, et.length);
    let s = 0;
    for (const t of q) {
      const tf = counts.get(t) ?? 0;
      if (tf === 0) continue;
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      s += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (len / 220))));
    }
    // Corpus score stays a bounded prior so cascade evidence is never erased.
    return { e, s: s + 0.5 * e.score };
  });
  scored.sort((a, b) => b.s - a.s || (a.e.id < b.e.id ? -1 : 1));
  return scored.slice(0, Math.max(1, Math.min(limit, 12))).map((x) => x.e);
}

/** The EVIDENCE block injected into the system prompt. */
export function buildEvidenceBlock(pack: MemoryPack | null | undefined): string {
  if (!pack) {
    return `LOCAL MEMORY: unavailable this turn (no pack shipped by the client).
Say so plainly if asked about stored memories; do not guess at their contents.`;
  }
  const s = pack.stats;
  const head = `LOCAL MEMORY (on-device corpus, never leaves the user's machine)
corpus: ${s.documents} documents / ${s.chunks} chunks / ${s.concepts} concepts / ${s.terms} terms / ${s.edges} graph edges across ${s.fields} field(s)
recalled for: ${JSON.stringify(pack.query)}
tools: memory_recall (search the working set), memory_read (full chunk by id), memory_stats (counters)`;

  if (pack.hits.length === 0) {
    return `${head}

EVIDENCE: empty — the recall cascade returned no chunk for this query.
Only in this case may you say there is no local evidence; the corpus itself is NOT empty unless chunks = 0.`;
  }

  const body = pack.hits
    .map((h, i) => {
      const ch = h.channels;
      const res = Number.isFinite(ch.resonance) ? ch.resonance.toFixed(3) : 'n/a';
      return `[${i + 1}] id=${h.id} field=${h.field} band=${h.band} score=${h.score.toFixed(3)} (lex ${ch.lexical.toFixed(2)} / sem ${ch.semantic.toFixed(2)} / lat ${Number.isFinite(ch.latent) ? ch.latent.toFixed(2) : 'n/a'} / fld ${Number.isFinite(ch.fieldSig) ? ch.fieldSig.toFixed(2) : 'n/a'} / bar ${ch.barcode.toFixed(2)} / spr ${ch.spread.toFixed(2)} / res ${res})
source: ${h.title} — ${h.url}
${h.text}`;
    })
    .join('\n\n');

  return `${head}

EVIDENCE (${pack.hits.length} chunk(s), verbatim from the corpus):
${body}

Cite any memory you use by its chunk id, e.g. (mem:${pack.hits[0].id}).`;
}

export interface MemoryToolResult {
  ok: boolean;
  [k: string]: unknown;
}

/** Server-side execution of the three memory tools against the shipped pack. */
export function runMemoryTool(
  name: string,
  args: Record<string, unknown>,
  pack: MemoryPack | null | undefined,
): MemoryToolResult {
  if (!pack) return { ok: false, error: 'local memory pack not available this turn' };

  if (name === 'memory_stats') {
    return { ok: true, ...pack.stats, fields: pack.fields, workingSet: pack.pool.length };
  }

  if (name === 'memory_recall') {
    const query = String(args.query ?? pack.query ?? '');
    const limit = Math.max(1, Math.min(Number(args.limit ?? 6) || 6, 12));
    const hits = searchPack(pack, query, limit);
    return {
      ok: true,
      query,
      returned: hits.length,
      workingSet: pack.pool.length,
      hits: hits.map((h) => ({
        id: h.id, title: h.title, url: h.url, field: h.field,
        band: h.band, score: Number(h.score.toFixed(4)),
        text: h.text.slice(0, EVIDENCE_CHARS),
      })),
    };
  }

  if (name === 'memory_read') {
    const id = String(args.id ?? '');
    const found = pack.pool.find((e) => e.id === id) ?? pack.hits.find((e) => e.id === id);
    if (!found) {
      return {
        ok: false,
        error: `chunk ${id} is not in this turn's working set`,
        available: pack.pool.slice(0, 20).map((e) => e.id),
      };
    }
    return { ok: true, ...found };
  }

  return { ok: false, error: `unknown memory tool ${name}` };
}

/** OpenAI-format specs for the three memory tools. */
export const MEMORY_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'memory_recall',
      description:
        "Search the user's on-device memory corpus (this turn's working set) and return matching chunks with their ids, sources and text. Use this before saying you cannot access stored memories.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'what to look for in local memory' },
          limit: { type: 'number', description: 'max chunks to return (1-12, default 6)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'memory_read',
      description: 'Read one memory chunk in full by its chunk id (as returned by memory_recall or the EVIDENCE block).',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'chunk id, e.g. c1a2b3c4' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'memory_stats',
      description: 'Counters for the on-device memory corpus: documents, chunks, concepts, terms, graph edges, fields.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export const MEMORY_TOOL_NAMES = new Set(MEMORY_TOOLS.map((t) => t.function.name));
