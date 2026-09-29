/**
 * Gate 3 — Ω-DEPTH Section 3 · multi-scale field signatures.
 *
 * Contract under test:
 *   • the coarse split is φ⁻¹ of the retained modes, in whole modes
 *   • coarse similarity agrees with full similarity on identical signatures
 *   • coarse-first ranking refines exactly the survivors and abstains honestly
 *   • fine-band structure separates chunks that are identical at coarse
 *     resolution — the whole point of depth
 *   • determinism: same inputs, byte-identical scores
 */

import { describe, expect, it } from 'vitest';
import {
  COARSE_SPLIT,
  REFINE_KEEP,
  coarseWidth,
  multiScaleScores,
  signatureSimilarity,
  signatureSimilarityCoarse,
} from '@/core/knowledge/fieldSignature';

/** Deterministic unit-norm signature: modes-many complex coefficients. */
function sig(modes: number, fn: (k: number) => [number, number]): Float64Array {
  const out = new Float64Array(2 * modes);
  let sq = 0;
  for (let k = 0; k < modes; k++) {
    const [re, im] = fn(k);
    out[2 * k] = re;
    out[2 * k + 1] = im;
    sq += re * re + im * im;
  }
  const n = Math.sqrt(sq);
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

describe('Ω-DEPTH Gate 3 — multi-scale signatures', () => {
  it('coarse head is φ⁻¹ of the modes, in whole modes', () => {
    expect(COARSE_SPLIT).toBeCloseTo(0.6180339887498949, 15);
    expect(coarseWidth(2 * 89)).toBe(2 * Math.round(89 * COARSE_SPLIT));
    expect(coarseWidth(2)).toBe(2);
  });

  it('identical signatures score 1 at both scales', () => {
    const a = sig(89, (k) => [Math.cos(k), Math.sin(k)]);
    expect(signatureSimilarity(a, a)).toBeCloseTo(1, 12);
    expect(signatureSimilarityCoarse(a, a)).toBeCloseTo(1, 12);
  });

  it('fine band separates signatures that match at coarse resolution', () => {
    const modes = 89;
    const head = Math.round(modes * COARSE_SPLIT);
    const a = sig(modes, (k) => (k < head ? [Math.cos(k), Math.sin(k)] : [1, 0]));
    const b = sig(modes, (k) => (k < head ? [Math.cos(k), Math.sin(k)] : [-1, 0]));
    const coarse = signatureSimilarityCoarse(a, b);
    const full = signatureSimilarity(a, b);
    expect(coarse).toBeCloseTo(1, 10); // indistinguishable coarse
    expect(full).toBeLessThan(coarse); // distinguishable once the fine band is read
  });

  it('coarse-first ranking refines the survivors and abstains honestly', () => {
    const q = sig(89, (k) => [Math.cos(k), Math.sin(k)]);
    const cands = new Map<string, Float64Array | null>();
    for (let i = 0; i < 50; i++) {
      cands.set(
        `c${i}`,
        sig(89, (k) => [Math.cos(k + i * 0.01), Math.sin(k + i * 0.01)]),
      );
    }
    cands.set('absent', null);
    const scores = multiScaleScores(q, cands, REFINE_KEEP);
    expect(scores.size).toBe(51);
    expect(Number.isNaN(scores.get('absent')!)).toBe(true);
    // The best candidate is the exact copy and is refined at full resolution.
    expect(scores.get('c0')).toBeCloseTo(signatureSimilarity(q, cands.get('c0')!), 15);
    const finite = [...scores.values()].filter(Number.isFinite);
    expect(finite.length).toBe(50);
    expect(Math.max(...finite)).toBeCloseTo(1, 10);
  });

  it('scores are byte-identical across repeats', () => {
    const q = sig(89, (k) => [Math.cos(k), Math.sin(2 * k)]);
    const cands = new Map<string, Float64Array | null>([
      ['a', sig(89, (k) => [Math.sin(k), Math.cos(k)])],
      ['b', sig(89, (k) => [Math.cos(k), Math.sin(2 * k)])],
    ]);
    const s1 = multiScaleScores(q, cands);
    const s2 = multiScaleScores(q, cands);
    for (const [id, v] of s1) expect(s2.get(id)).toBe(v);
  });

  it('empty query yields no scores rather than fabricated zeros', () => {
    expect(multiScaleScores(null, new Map([['a', null]])).size).toBe(0);
  });
});
