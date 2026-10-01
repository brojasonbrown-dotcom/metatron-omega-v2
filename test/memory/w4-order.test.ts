import { describe, expect, it } from 'vitest';
import {
  injectTextPsi,
  lexemePattern,
  LEXEME_POS_ANGLE,
  LEXEME_MAX_POS,
} from '@/core/gematria/lexeme';
import { LexiconMemory, lexiconCatalog } from '@/core/knowledge/lexicon';
import { PHI_INV } from '@/core/constants/WolframVerified';

const R = 55;
const PSI_LEN = R * 4 + 4;

function cos(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    x += a[i] * a[i];
    y += b[i] * b[i];
  }
  return d / Math.sqrt(x * y);
}

function psiOf(text: string, len = PSI_LEN): Float64Array {
  const p = new Float64Array(len);
  injectTextPsi(p, text);
  return p;
}

/** Pre-W4 injection (no rotation) — the measured baseline, rebuilt from pos-0 patterns. */
function psiNoOrder(text: string, rungs = R): Float64Array {
  const toks = text.split(' ');
  const p = new Float64Array(rungs * 4);
  toks.forEach((t, r) => {
    const pat = lexemePattern(t, rungs, 0)!;
    for (let i = 0; i < pat.length; i++) pat[i] && (p[i] += pat[i] * PHI_INV ** r);
  });
  return p;
}

const SWAPS: [string, string][] = [
  ['dog chases cat', 'cat chases dog'],
  ['man bites dog', 'dog bites man'],
  ['the light enters the field', 'the field enters the light'],
  ['memory shapes thought', 'thought shapes memory'],
];

describe('Ω-UNDERSTAND W4 — word order (rotary phase)', () => {
  it('position 0 is the unrotated pattern; rotation preserves norm', () => {
    const a = lexemePattern('light', R)!;
    const b = lexemePattern('light', R, 0)!;
    expect([...a]).toEqual([...b]);
    const n = (v: Float64Array) => Math.hypot(...v);
    for (let p = 1; p <= LEXEME_MAX_POS + 2; p++)
      expect(n(lexemePattern('light', R, p)!)).toBeCloseTo(n(a), 12);
    expect(LEXEME_POS_ANGLE).toBeCloseTo(2 * Math.PI * (1 - PHI_INV), 15);
  });

  it('role-swapped sentences separate in Ψ (baseline vs W4, stated bound)', () => {
    for (const [a, b] of SWAPS) {
      const before = cos(psiNoOrder(a), psiNoOrder(b));
      const after = cos(psiOf(a).subarray(0, R * 4), psiOf(b).subarray(0, R * 4));
      expect(after).toBeLessThan(before);
      expect(after).toBeLessThan(0.6);
    }
    // identical sentences stay identical
    expect(cos(psiOf('dog chases cat'), psiOf('dog chases cat'))).toBeCloseTo(1, 14);
  });

  it('readout recovers the exact word order', () => {
    const lex = new LexiconMemory(64);
    const vocab = new Set<string>();
    for (const e of lexiconCatalog())
      for (const t of e.word.toLowerCase().split(/[^a-z]+/)) if (t) vocab.add(t);
    for (const [a, b] of SWAPS) for (const t of [...a.split(' '), ...b.split(' ')]) vocab.add(t);
    lex.learn([...vocab], 0);
    for (const [a, b] of SWAPS) {
      for (const s of [a, b]) {
        const want = [...new Set(s.split(' '))];
        if (want.length !== s.split(' ').length) continue; // repeated words: order of first use only
        expect(lex.readPsi(psiOf(s), 8).sequence).toEqual(want);
      }
    }
  });

  it('readout order accuracy over held-out catalog sentences (stated floor)', () => {
    const V: string[] = [];
    for (const e of lexiconCatalog())
      for (const t of e.word.toLowerCase().split(/[^a-z]+/)) if (t && !V.includes(t)) V.push(t);
    V.sort();
    const lex = new LexiconMemory(64);
    lex.learn(V, 0);
    let exact = 0;
    const N = 100;
    for (let k = 0; k < N; k++) {
      const ws: string[] = [];
      for (let i = 0; i < 3; i++) {
        const w = V[(k * 131 + i * 977 + 51) % V.length];
        if (!ws.includes(w)) ws.push(w);
      }
      if (JSON.stringify(lex.readPsi(psiOf(ws.join(' ')), 8).sequence) === JSON.stringify(ws))
        exact++;
    }
    expect(exact / N).toBeGreaterThanOrEqual(0.9);
  });

  it('is deterministic', () => {
    expect([...psiOf('dog chases cat')]).toEqual([...psiOf('dog chases cat')]);
  });
});
