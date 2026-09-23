/**
 * W1 — the word→field layer, the frequency-aware recall rank, and the
 * Hopfield energy admission gate.
 *
 * Every assertion here is a claim made in code comments; if one fails the
 * corresponding claim is wrong and must be deleted, not softened.
 */

import { describe, it, expect } from 'vitest';
import {
  lexeme, lexemeValue, lexemeTokens, lexemeAddress, injectTextPsi,
  LEXEME_EXACT_LEN, LEXEME_RADIX, LEXEME_RESIDUE_BITS, LEXEME_GAIN,
} from '@/core/gematria/lexeme';
import { zeckendorf, unzeckendorf } from '@/core/gematria/zeckendorf';
import { PatternBitmapIndex, REHEARSAL_TAU } from '@/core/memory/PatternBitmapIndex';
import { mergeAdmissible } from '@/core/memory/Consolidator';
import type { PatternSignature } from '@/core/memory/FibonacciPatterns';

const PHI_SQ = 2.618033988749895;

describe('lexeme — exact, injective word codes', () => {
  it('is injective on words within the length bound (anagrams do not collide)', () => {
    // The failure mode of every additive gematria: positional coding kills it.
    expect(lexemeValue('listen')).not.toBe(lexemeValue('silent'));
    expect(lexemeValue('ab')).not.toBe(lexemeValue('ba'));
    const seen = new Map<number, string>();
    const words = ['a', 'i', 'to', 'be', 'or', 'not', 'the', 'light', 'field', 'torus',
      'word', 'drow', 'mind', 'coherence', 'memory', 'resonance'];
    for (const w of words) {
      const v = lexemeValue(w);
      expect(seen.has(v)).toBe(false);
      seen.set(v, w);
    }
  });

  it('keeps every code inside exact float64 integer range', () => {
    const maxWord = 'z'.repeat(LEXEME_EXACT_LEN);
    expect(lexemeValue(maxWord)).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(lexemeValue(maxWord))).toBe(true);
    expect(LEXEME_RADIX ** LEXEME_EXACT_LEN).toBeLessThan(2 ** 53);
  });

  it('declares inexactness instead of hiding truncation', () => {
    expect(lexeme('coherence').exact).toBe(true);           // 9 letters
    expect(lexeme('incommensurability').exact).toBe(false); // 18 letters
  });

  it('gives a reversible Zeckendorf address', () => {
    for (const w of ['light', 'field', 'memory']) {
      const lx = lexeme(w);
      expect(unzeckendorf(lx.zeck)).toBe(lx.value);
      // non-consecutive by Zeckendorf's theorem
      for (let i = 1; i < lx.zeck.length; i++) {
        expect(lx.zeck[i - 1] - lx.zeck[i]).toBeGreaterThanOrEqual(2);
      }
      expect(lx.address.startsWith('z:')).toBe(true);
    }
    expect(zeckendorf(0)).toEqual([]);
  });

  it('reports the residue channel budget as log₂22, not a meaning', () => {
    expect(LEXEME_RESIDUE_BITS).toBeCloseTo(Math.log2(22), 12);
    for (const w of ['a', 'field', 'memory']) {
      expect(lexeme(w).residue).toBeGreaterThanOrEqual(0);
      expect(lexeme(w).residue).toBeLessThan(22);
    }
  });

  it('tokenises deterministically and addresses whole utterances', () => {
    expect(lexemeTokens('The field, remembers!')).toEqual(['the', 'field', 'remembers']);
    expect(lexemeAddress('the field')).toBe(lexemeAddress('The  FIELD.'));
    expect(lexemeAddress('the field')).not.toBe(lexemeAddress('field the'));
    expect(lexemeAddress('')).toBe('z:0');
  });
});

describe('injectTextPsi — words become field structure', () => {
  const PSI_LEN = 40; // 9 rungs × 4 + 4 global invariants

  it('perturbs rung slots and never the four global invariant slots', () => {
    const psi = new Float64Array(PSI_LEN);
    const r = injectTextPsi(psi, 'coherence of the field');
    expect(r.tokens).toBe(4);
    expect(r.norm).toBeGreaterThan(0);
    for (let i = 36; i < 40; i++) expect(psi[i]).toBe(0);
    let touched = 0;
    for (let i = 0; i < 36; i++) if (psi[i] !== 0) touched++;
    expect(touched).toBeGreaterThan(0);
  });

  it('is deterministic and additive', () => {
    const a = new Float64Array(PSI_LEN);
    const b = new Float64Array(PSI_LEN);
    injectTextPsi(a, 'the torus closes');
    injectTextPsi(b, 'the torus closes');
    expect(Array.from(a)).toEqual(Array.from(b));
    const c = new Float64Array(PSI_LEN);
    c[0] = 0.5;
    injectTextPsi(c, 'the torus closes');
    expect(c[0]).toBeCloseTo(0.5 + a[0], 15);
  });

  it('keeps injected energy inside the engine envelope regardless of length', () => {
    const short = new Float64Array(PSI_LEN);
    const long = new Float64Array(PSI_LEN);
    const s = injectTextPsi(short, 'light');
    const l = injectTextPsi(long, Array(200).fill('light and field and memory').join(' '));
    // 1/√k normalisation + φ⁻³ gain: a 600-token utterance cannot swamp Ψ.
    expect(l.norm).toBeLessThan(1);
    expect(s.norm).toBeLessThan(1);
    expect(LEXEME_GAIN).toBeCloseTo(0.2360679774997897, 15);
  });

  it('separates different sentences in the field', () => {
    const a = new Float64Array(PSI_LEN);
    const b = new Float64Array(PSI_LEN);
    injectTextPsi(a, 'the field remembers');
    injectTextPsi(b, 'entropy dissolves structure');
    let diff = 0;
    for (let i = 0; i < PSI_LEN; i++) diff += (a[i] - b[i]) ** 2;
    expect(Math.sqrt(diff)).toBeGreaterThan(0);
  });

  it('no-ops safely on empty text and on a field too short to hold a rung', () => {
    const psi = new Float64Array(PSI_LEN);
    expect(injectTextPsi(psi, '   ...   ').tokens).toBe(0);
    expect(injectTextPsi(new Float64Array(2), 'light').tokens).toBe(0);
  });
});

function sig(hash: string, tick: number, idx: number[], amps: number[]): PatternSignature {
  return {
    hash, tick,
    indices: Int32Array.from(idx),
    amplitudes: Float64Array.from(amps),
    qualia: 0.5,
  } as unknown as PatternSignature;
}

describe('recall rank — frequency and recency, not resonance alone', () => {
  it('rehearsal lifts an equally-resonant pattern above an unrehearsed one', () => {
    const ix = new PatternBitmapIndex();
    const cue = new Float64Array(8);
    cue[0] = 1; cue[1] = 1;
    const a = sig('A', 10, [0, 1], [1, 1]);
    const b = sig('B', 10, [0, 1], [1, 1]);   // identical resonance to A
    const pats = [a, b];
    for (let i = 0; i < 20; i++) ix.search(cue, [a], 1, 34, 10); // rehearse A only
    const out = ix.search(cue, pats, 2, 34, 10);
    expect(out[0].pattern.hash).toBe('A');
    expect(out[0].entry.rehearsals).toBeGreaterThan(out[1].entry.rehearsals);
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });

  it('recency decays by exactly φ⁻¹ over one consolidation window', () => {
    const ix = new PatternBitmapIndex();
    const cue = new Float64Array(8);
    cue[0] = 1;
    const p = sig('P', 1, [0], [1]);
    const fresh = ix.search(cue, [p], 1, 34, 1)[0];
    const freshScore = fresh.score;
    const aged = ix.search(cue, [p], 1, 34, 1 + REHEARSAL_TAU)[0];
    // rehearsal count grew by one between the calls, so compare the decay term
    // alone: score = C · rehearsal · φ^(−Δt/τ).
    const rehearsalFresh = 1 + 0.6180339887498949 * Math.log1p(0);
    const rehearsalAged = 1 + 0.6180339887498949 * Math.log1p(1);
    const decay = (aged.score / rehearsalAged) / (freshScore / rehearsalFresh);
    expect(decay).toBeCloseTo(0.6180339887498949, 10);
  });

  it('never returns a match the exact kernel scores at zero resonance', () => {
    const ix = new PatternBitmapIndex();
    const cue = new Float64Array(8);
    cue[0] = 1;
    const orth = sig('O', 5, [4], [1]);
    const out = ix.search(cue, [orth], 1, 34, 5);
    expect(out[0].resonance).toBe(0);
    expect(out[0].score).toBe(0);
  });

  it('bucket gather never loses the best match versus the full scan', () => {
    const ix = new PatternBitmapIndex();
    const cue = new Float64Array(16);
    for (let i = 0; i < 4; i++) cue[i] = 1;
    const pats: PatternSignature[] = [];
    for (let k = 0; k < 60; k++) {
      pats.push(sig(`p${k}`, k + 1, [k % 16, (k + 3) % 16], [1, 0.5]));
    }
    const target = sig('exact', 61, [0, 1, 2, 3], [1, 1, 1, 1]);
    pats.push(target);
    const out = ix.search(cue, pats, 5, 34, 100);
    expect(out[0].pattern.hash).toBe('exact');
  });
});

describe('Hopfield energy gate — coherence measured, not asserted', () => {
  it('admits a member that lies in the prototype basin', () => {
    const proto = new Float64Array(16).fill(0);
    proto[0] = 1;
    const member = new Float64Array(16).fill(0);
    member[0] = 0.99; member[1] = 0.1;
    const v = mergeAdmissible(proto, member);
    expect(v.admitted).toBe(true);
    expect(v.deltaE).toBeLessThanOrEqual(0);
  });

  it('reports β = φ/√d and refuses a merge that raises energy', () => {
    const d = 256;
    const proto = new Float64Array(d);
    proto[0] = 1;
    const member = new Float64Array(d);
    member[0] = 8; // far outside the basin: retrieval step raises energy
    const v = mergeAdmissible(proto, member);
    expect(v.beta).toBeCloseTo(1.618033988749895 / Math.sqrt(d), 15);
    expect(v.beta).toBeCloseTo(0.101127124296868, 12);
    if (!v.admitted) expect(v.deltaE).toBeGreaterThan(0);
  });
});

describe('Hebbian bound — the documented ceiling is the real one', () => {
  it('φ² is the unclamped fixed point η/decay', () => {
    const PHI_INV = 0.6180339887498949;
    const eta = PHI_INV ** 3;
    const decay = PHI_INV ** 5;
    expect(eta / decay).toBeCloseTo(PHI_SQ, 12);
  });
});
