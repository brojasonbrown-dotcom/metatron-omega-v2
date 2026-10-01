import { describe, expect, it } from 'vitest';
import { injectTextPsi, lexemePattern } from '@/core/gematria/lexeme';
import { LexiconMemory, lexiconCatalog } from '@/core/knowledge/lexicon';

const PSI_LEN = 55 * 4 + 4;

function catalogVocab(): string[] {
  const s = new Set<string>();
  for (const e of lexiconCatalog())
    for (const t of e.word.toLowerCase().split(/[^a-z]+/)) if (t) s.add(t);
  return [...s].sort();
}

function lexWith(words: readonly string[]): LexiconMemory {
  const lex = new LexiconMemory(64);
  lex.learn(words, 0);
  return lex;
}

function read(lex: LexiconMemory, text: string) {
  const psi = new Float64Array(PSI_LEN);
  injectTextPsi(psi, text);
  return lex.readPsi(psi, 8);
}

describe('Ω-UNDERSTAND W1 — Ψ → word readout', () => {
  const V = catalogVocab();
  const extra = 'the cat drinks milk moon dog chases sleeps'.split(' ');
  const lex = lexWith([...V, ...extra]);

  it('explain-away removes the measured crosstalk (moon no longer beats drinks)', () => {
    const r = read(lex, 'the cat drinks milk');
    const got = r.words.map((w) => w.word);
    expect(got).toEqual(['the', 'cat', 'drinks', 'milk']);
    expect(got).not.toContain('moon');
    expect(r.explained).toBeGreaterThan(0.99);
    expect(r.crisp).toBe(true);
  });

  it('pattern is the single injection definition', () => {
    const psi = new Float64Array(PSI_LEN);
    injectTextPsi(psi, 'light');
    const p = lexemePattern('light', 55)!;
    let dot = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i < p.length; i++) {
      dot += psi[i] * p[i];
      a += psi[i] * psi[i];
      b += p[i] * p[i];
    }
    expect(dot / Math.sqrt(a * b)).toBeCloseTo(1, 12);
  });

  // Measured 2026-10-01 over 200 deterministic sentences per length, 1,092-word
  // catalog vocabulary: P ≥ .990 all lengths; R 1.000/.998/.988/.960/.896/.799
  // for L = 1..6. Recall falls with length because injection weights rank r by
  // φ⁻ʳ: a 6th word carries φ⁻¹⁰ ≈ 0.8% of the first word's energy.
  it('held-out precision/recall over the catalog vocabulary', () => {
    const floor: Record<number, [number, number]> = {
      1: [0.98, 0.99],
      3: [0.98, 0.97],
      6: [0.98, 0.75],
    };
    for (const L of [1, 3, 6]) {
      let tp = 0;
      let fp = 0;
      let fn = 0;
      for (let k = 0; k < 200; k++) {
        const ws: string[] = [];
        for (let i = 0; i < L; i++) {
          const w = V[(k * 131 + i * 977 + L * 17) % V.length];
          if (!ws.includes(w)) ws.push(w);
        }
        const got = read(lex, ws.join(' ')).words.map((w) => w.word);
        for (const g of got)
          if (ws.includes(g)) tp++;
          else fp++;
        for (const t of ws) if (!got.includes(t)) fn++;
      }
      expect(tp / (tp + fp)).toBeGreaterThanOrEqual(floor[L][0]);
      expect(tp / (tp + fn)).toBeGreaterThanOrEqual(floor[L][1]);
    }
  });

  it('empty field, empty lexicon and short Ψ read nothing', () => {
    expect(lex.readPsi(new Float64Array(PSI_LEN)).words).toHaveLength(0);
    const psi = new Float64Array(PSI_LEN);
    injectTextPsi(psi, 'light');
    expect(new LexiconMemory(64).readPsi(psi).words).toHaveLength(0);
    expect(lex.readPsi(new Float64Array(3)).words).toHaveLength(0);
  });

  it('is deterministic', () => {
    expect(read(lex, 'dog chases cat')).toEqual(read(lex, 'dog chases cat'));
  });
});
