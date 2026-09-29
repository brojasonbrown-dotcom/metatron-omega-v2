/**
 * Gate G — memory ↔ field bridge (Ω-SHFN Section G).
 *
 * Every assertion here is a measurement of the real path: no mocks, no stubs,
 * no tolerance chosen to make a number pass.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  FieldSignatureEncoder,
  SIGNATURE_TIERS,
  FIELD_SIGNATURE_VERSION,
  signatureSimilarity,
  signatureEquals,
  recommendTier,
  tierById,
} from '@/core/knowledge/fieldSignature';
import { KnowledgeBase } from '@/core/knowledge/KnowledgeBase';
import { measureGenomeHealth } from '@/core/knowledge/genome';

const TIER = SIGNATURE_TIERS[0]; // F13 — 233 nodes / 89 modes, sub-second basis
const enc = new FieldSignatureEncoder(TIER);

const A = 'the toroidal field propagates through eighteen closed layers of golden ratio nodes';
const B = 'eighteen toroidal layers propagate a closed golden field through its nodes';
const C = 'quarterly revenue increased on strong retail demand in the fourth quarter';

describe('G0 — measured eigenbasis', () => {
  beforeAll(() => {
    enc.prepare();
  });

  it('reports a real residual, not an assumption', () => {
    const r = enc.report()!;
    expect(r.version).toBe(FIELD_SIGNATURE_VERSION);
    expect(r.nodes).toBe(TIER.nodes);
    expect(r.modes).toBe(TIER.modes);
    expect(r.maxResidual).toBeLessThan(1e-10);
    expect(r.buildMs).toBeGreaterThan(0);
    expect(r.digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('spans a normalised Laplacian spectrum in [0, 2]', () => {
    const r = enc.report()!;
    expect(r.lambdaMin).toBeGreaterThan(-1e-9);
    expect(r.lambdaMax).toBeGreaterThan(0);
    expect(r.lambdaMax).toBeLessThanOrEqual(2);
  });

  it('tier lookup and hardware recommendation stay inside the ladder', () => {
    expect(tierById('F15').modes).toBe(233);
    expect(tierById('nope').id).toBe('F15');
    expect(SIGNATURE_TIERS.map((t) => t.id)).toContain(recommendTier().id);
  });
});

describe('G1 — signature determinism', () => {
  beforeAll(() => {
    enc.prepare();
  });

  it('the same text produces bit-identical coefficients', () => {
    const a = enc.encode(A)!;
    const b = enc.encode(A)!;
    expect(a).not.toBeNull();
    expect(a.length).toBe(2 * TIER.modes);
    expect(signatureEquals(a, b)).toBe(true);
  });

  it('a second encoder on the same tier reproduces the signature exactly', () => {
    const other = new FieldSignatureEncoder(TIER);
    other.prepare();
    expect(signatureEquals(enc.encode(A), other.encode(A))).toBe(true);
  });

  it('abstains rather than emitting a zero vector', () => {
    expect(enc.encode('')).toBeNull();
    expect(enc.encode('   ')).toBeNull();
  });

  it('is unit norm', () => {
    const a = enc.encode(A)!;
    let sq = 0;
    for (let i = 0; i < a.length; i++) sq += a[i] * a[i];
    expect(Math.sqrt(sq)).toBeCloseTo(1, 12);
  });
});

describe('G2 — phase-aligned similarity', () => {
  beforeAll(() => {
    enc.prepare();
  });

  it('is 1 against itself, symmetric, and bounded', () => {
    const a = enc.encode(A)!;
    const b = enc.encode(B)!;
    expect(signatureSimilarity(a, a)).toBeCloseTo(1, 12);
    expect(signatureSimilarity(a, b)).toBeCloseTo(signatureSimilarity(b, a), 15);
    expect(signatureSimilarity(a, b)).toBeGreaterThanOrEqual(0);
    expect(signatureSimilarity(a, b)).toBeLessThanOrEqual(1);
  });

  it('is invariant under a global phase rotation (gauge)', () => {
    const a = enc.encode(A)!;
    const rot = new Float64Array(a.length);
    const c = Math.cos(0.7),
      s = Math.sin(0.7);
    for (let i = 0; i < a.length; i += 2) {
      rot[i] = a[i] * c - a[i + 1] * s;
      rot[i + 1] = a[i] * s + a[i + 1] * c;
    }
    expect(signatureSimilarity(a, rot)).toBeCloseTo(1, 12);
  });

  it('ranks related text above unrelated text', () => {
    const a = enc.encode(A)!;
    const near = signatureSimilarity(a, enc.encode(B));
    const far = signatureSimilarity(a, enc.encode(C));
    expect(near).toBeGreaterThan(far);
  });

  it('abstains (NaN) on width mismatch or a missing side', () => {
    const a = enc.encode(A)!;
    expect(Number.isNaN(signatureSimilarity(a, null))).toBe(true);
    expect(Number.isNaN(signatureSimilarity(a, new Float64Array(4)))).toBe(true);
  });
});

describe('G3 — corpus bridge', () => {
  const kb = new KnowledgeBase();
  const docs = [
    [
      'torus',
      'Each toroidal rung closes on itself; the field circulates through Fibonacci chords and returns in phase.',
    ],
    [
      'torus',
      'Eighteen closed layers stack on the golden ladder, each carrying its own eigenmode band.',
    ],
    [
      'finance',
      'Quarterly revenue rose on retail demand while operating margin narrowed slightly.',
    ],
    ['finance', 'The board approved a dividend after the fourth quarter earnings release.'],
    ['optics', 'Refraction bends the wavefront as the medium changes its propagation velocity.'],
  ];

  beforeAll(() => {
    docs.forEach(([field, text], i) => {
      kb.ingest({ field, url: `local://doc-${i}`, text, now: 1_700_000_000_000 + i });
    });
  });

  it('abstains cleanly before any basis is built', () => {
    const st = kb.signatureState();
    expect(st.ready).toBe(false);
    expect(st.covered).toBe(0);
    const hits = kb.recall('toroidal rung field');
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(Number.isNaN(h.fieldSig)).toBe(true);
  });

  it('rescoring with signatures never drops candidates', () => {
    const before = kb
      .recall('toroidal rung field', 8)
      .map((h) => h.chunk.id)
      .sort();
    kb.prepareSignatures(TIER.id);
    const sweep = kb.buildSignatures(1000);
    expect(sweep.covered).toBe(sweep.total);
    expect(kb.signatureCoverage()).toBe(1);
    const after = kb
      .recall('toroidal rung field', 8)
      .map((h) => h.chunk.id)
      .sort();
    // Field signatures are a rescore-only channel: the candidate SET is
    // identical, only the ordering may move.
    expect(after).toEqual(before);
  });

  it('reports the channel on every hit once covered', () => {
    const hits = kb.recall('toroidal rung field', 8);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(Number.isFinite(h.fieldSig)).toBe(true);
      expect(h.fieldSig).toBeGreaterThanOrEqual(0);
      expect(h.fieldSig).toBeLessThanOrEqual(1);
    }
  });

  it('keeps self-retrieval at the floor with the channel live', () => {
    for (const c of kb.chunkList()) {
      const query = c.text.split(/\s+/).slice(0, 12).join(' ');
      expect(kb.recall(query, 5).some((h) => h.chunk.id === c.id)).toBe(true);
    }
  });

  it('the genome audit reports real coverage, not a claim', () => {
    const h = measureGenomeHealth(kb, 32);
    expect(h.fieldSignatureCoverage).toBe(1);
    expect(h.fieldSignatureTier).toBe(TIER.id);
    expect(h.fieldSignatureWidth).toBe(2 * TIER.modes);
  });

  it('signatures survive a corpus reload by recomputation, bit-identical', () => {
    const sample = kb.chunkList()[0];
    const before = kb.signatureFor(sample.id)!;
    const snap = kb.snapshot();
    const kb2 = new KnowledgeBase();
    kb2.restore(snap);
    kb2.prepareSignatures(TIER.id);
    kb2.buildSignatures(1000);
    expect(signatureEquals(before, kb2.signatureFor(sample.id))).toBe(true);
  });

  it('dropping a document drops its signatures', () => {
    const kb3 = new KnowledgeBase();
    kb3.ingest({ field: 'x', url: 'local://x', text: docs[0][1], now: 1 });
    kb3.prepareSignatures(TIER.id);
    kb3.buildSignatures(50);
    expect(kb3.signatureCoverage()).toBe(1);
    kb3.removeDocument(kb3.documents()[0].id);
    expect(kb3.signatureState().covered).toBe(0);
  });
});
