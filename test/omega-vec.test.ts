/**
 * Ω-VEC — vector/recall layer contract.
 *
 * These are the properties the chat loop depends on: determinism, symbol
 * survival, morphological tolerance, and a memory pack that never tells the
 * model "no memories" while the corpus is non-empty.
 */
import { describe, it, expect } from 'vitest';
import {
  tokenize,
  termCounts,
  featureCounts,
  hashVector,
  cosine,
  embed,
  VECTOR_DIM,
} from '@/core/knowledge/tokenize';
import { KnowledgeBase } from '@/core/knowledge/KnowledgeBase';
import { buildEvidenceBlock, searchPack } from '@/lib/chat/memoryPack';

describe('tokenizer', () => {
  it('keeps numbers and mathematical symbols', () => {
    const t = tokenize('the golden ratio φ equals 1.618 at rung F13');
    expect(t).toContain('φ');
    expect(t).toContain('1.618');
    expect(t).toContain('f13');
    expect(t).not.toContain('the');
  });

  it('is deterministic and order-stable', () => {
    const a = tokenize('Lucas closure residue'),
      b = tokenize('Lucas closure residue');
    expect(a).toEqual(b);
  });
});

describe('hashed vector', () => {
  it('is unit-norm and deterministic at the declared width', () => {
    const v = embed('toroidal eigenmode superposition');
    expect(v.length).toBe(VECTOR_DIM);
    let n = 0;
    for (const x of v) n += x * x;
    expect(Math.sqrt(n)).toBeCloseTo(1, 12);
    expect([...embed('toroidal eigenmode superposition')]).toEqual([...v]);
  });

  it('ranks the related passage above the unrelated one', () => {
    const q = embed('eigenmode of the toroidal field');
    const near = embed('the toroidal field carries an eigenmode at every rung');
    const far = embed('banana bread recipe with cinnamon and butter');
    expect(cosine(q, near)).toBeGreaterThan(cosine(q, far));
  });

  it('tolerates morphology through character grams', () => {
    const q = embed('resonances');
    const doc = embed('resonance measured across the ladder');
    expect(cosine(q, doc)).toBeGreaterThan(0.05);
  });

  it('features are a superset of lexical terms', () => {
    const toks = tokenize('lucas closure residue ladder');
    const lex = termCounts(toks),
      feat = featureCounts(toks);
    for (const k of lex.keys()) expect(feat.has(k)).toBe(true);
    expect(feat.size).toBeGreaterThan(lex.size);
  });

  it('query-side idf changes weighting but not determinism', () => {
    const c = featureCounts(tokenize('rare zeckendorf term'));
    const a = hashVector(c, VECTOR_DIM, () => 2);
    const b = hashVector(c, VECTOR_DIM, () => 2);
    expect([...a]).toEqual([...b]);
  });
});

describe('recall + evidence', () => {
  const kb = new KnowledgeBase();
  kb.ingest({
    url: 'mem://test/ladder',
    title: 'Ladder',
    field: 'core',
    text: 'The Lucas closure residue governs the toroidal ladder. Each rung binds an eigenmode to a radial Fourier organ. '.repeat(
      6,
    ),
  });
  kb.ingest({
    url: 'mem://test/cooking',
    title: 'Cooking',
    field: 'core',
    text: 'Banana bread needs cinnamon, butter, flour and a warm oven. '.repeat(6),
  });

  it('returns the topical chunk first', () => {
    const hits = kb.recall('what governs the toroidal ladder?', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].chunk.text.toLowerCase()).toContain('ladder');
  });

  const stats = {
    documents: 2,
    chunks: 12,
    concepts: 40,
    terms: 300,
    edges: 900,
    fields: 1,
    bytes: 4096,
  };
  const ev = (h: { id: string; text: string; score: number }) => ({
    id: h.id,
    docId: 'd1',
    title: 'Ladder',
    url: 'mem://test/ladder',
    source: 'test',
    field: 'core',
    band: 0,
    score: h.score,
    channels: { lexical: 1, semantic: 1, barcode: 1, spread: 0, resonance: NaN },
    text: h.text,
  });

  it('evidence block quotes recalled chunks with citable ids', () => {
    const hits = kb
      .recall('toroidal ladder', 3)
      .map((h) => ev({ id: h.chunk.id, text: h.chunk.text, score: h.score }));
    const block = buildEvidenceBlock({
      query: 'toroidal ladder',
      stats,
      fields: ['core'],
      hits,
      pool: hits,
    });
    expect(block).toContain('LOCAL MEMORY');
    expect(block).toContain(hits[0].id);
    expect(block).toMatch(/mem:/);
  });

  it('empty recall still states the corpus is non-empty', () => {
    const block = buildEvidenceBlock({
      query: 'quantum ferret',
      stats,
      fields: ['core'],
      hits: [],
      pool: [],
    });
    expect(block).toContain('12 chunks');
    expect(block).toContain('corpus itself is NOT empty');
  });

  it('in-pack search re-ranks for a reworded follow-up', () => {
    const pool = kb
      .recall('ladder eigenmode cinnamon', 8)
      .map((h) => ev({ id: h.chunk.id, text: h.chunk.text, score: h.score }));
    const got = searchPack(
      { query: 'q', stats, fields: ['core'], hits: pool.slice(0, 2), pool },
      'cinnamon butter',
      1,
    );
    expect(got[0].text.toLowerCase()).toContain('cinnamon');
  });
});

// ── Phase 3: PPMI-SVD latent space ───────────────────────────────────────
import { LatentSpace } from '@/core/knowledge/LatentSpace';

const LAT_DOCS = [
  ['phi', 'golden', 'ratio', 'spiral'],
  ['phi', 'golden', 'ladder', 'rung'],
  ['golden', 'ratio', 'fibonacci', 'spiral'],
  ['fibonacci', 'lucas', 'sequence', 'rung'],
  ['lucas', 'closure', 'residue', 'ladder'],
  ['torus', 'field', 'node', 'closure'],
  ['torus', 'field', 'eigenmode', 'node'],
  ['eigenmode', 'spectral', 'field', 'node'],
];

describe('LatentSpace', () => {
  it('abstains until built', () => {
    const L = new LatentSpace();
    expect(L.trained).toBe(false);
    expect(L.embed(['phi'])).toBeNull();
    expect(Number.isNaN(L.similarity(null, null))).toBe(true);
  });

  it('is deterministic across builds', () => {
    const a = new LatentSpace();
    a.build(LAT_DOCS, { dims: 8, iters: 12 });
    const b = new LatentSpace();
    b.build(LAT_DOCS, { dims: 8, iters: 12 });
    expect(a.trained).toBe(true);
    const va = a.embed(['phi', 'golden'])!;
    const vb = b.embed(['phi', 'golden'])!;
    expect(Array.from(va)).toEqual(Array.from(vb));
  });

  it('places co-occurring terms nearer than unrelated ones', () => {
    const L = new LatentSpace();
    L.build(LAT_DOCS, { dims: 8, iters: 24 });
    const phi = L.embed(['phi'])!;
    const golden = L.embed(['golden'])!;
    const eigen = L.embed(['eigenmode'])!;
    expect(L.similarity(phi, golden)).toBeGreaterThan(L.similarity(phi, eigen));
  });
});

describe('KnowledgeBase latent channel', () => {
  it('abstains before training and reports after', () => {
    const kb = new KnowledgeBase();
    for (let i = 0; i < 6; i++) {
      kb.ingest({
        field: 'test',
        url: `u${i}`,
        now: 1000 + i,
        text: `${LAT_DOCS[i].join(' ')} — the golden ratio phi appears with fibonacci and lucas rungs in the torus field.`,
      });
    }
    const before = kb.recall('phi golden ratio', 4);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((h) => Number.isNaN(h.latent))).toBe(true);

    const report = kb.trainLatent({ dims: 8, iters: 16 });
    expect(report.vocab).toBeGreaterThan(3);
    const after = kb.recall('phi golden ratio', 4);
    expect(after.some((h) => Number.isFinite(h.latent))).toBe(true);
    expect(kb.latentCoverage()).toBeGreaterThan(0);
  });
});
