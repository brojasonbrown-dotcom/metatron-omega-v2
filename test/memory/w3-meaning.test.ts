import { describe, expect, it } from 'vitest';
import { LexiconMemory, LEX_PPMI_ALPHA } from '@/core/knowledge/lexicon';
import { PHI } from '@/core/constants/WolframVerified';

function corpus(): LexiconMemory {
  const lex = new LexiconMemory(256);
  const s = [
    'the cat drinks milk',
    'the cat chases the dog',
    'the dog drinks water',
    'a cat sleeps',
    'the moon rises',
  ];
  s.forEach((x, i) => lex.learn(x.split(' '), 1, i + 1));
  return lex;
}

const ANIMALS = ['cat', 'dog', 'horse', 'cow', 'goat', 'sheep'];
const OBJECTS = ['cup', 'box', 'chair', 'table', 'lamp', 'shelf'];
const A_T = ['the X eats grass', 'a X runs fast', 'the hungry X sleeps', 'my X drinks water'];
const O_T = ['put the X down', 'the X is on the floor', 'a heavy X breaks', 'clean my X today'];
const SHARED = ['i see the X', 'look at that X'];

/** Deterministic two-category corpus; every word appears in every template once. */
function categories(): LexiconMemory {
  const lex = new LexiconMemory(256);
  let tick = 0;
  for (const [words, own] of [
    [ANIMALS, A_T],
    [OBJECTS, O_T],
  ] as const)
    for (const w of words)
      for (const t of [...own, ...SHARED]) lex.learn(t.replace('X', w).split(' '), 1, ++tick);
  return lex;
}

function precisionAt(rank: (w: string) => string[], k: number): number {
  let hit = 0;
  for (const set of [ANIMALS, OBJECTS])
    for (const w of set)
      hit += rank(w)
        .slice(0, k)
        .filter((x) => set.includes(x)).length;
  return hit / ((ANIMALS.length + OBJECTS.length) * k);
}

describe('Ω-UNDERSTAND W3 — second-order meaning (PPMI)', () => {
  it('matches the hand-computed PPMI cosine on a two-word toy corpus', () => {
    const lex = new LexiconMemory(64);
    lex.learn(['a', 'x'], 1);
    lex.learn(['b', 'x'], 1);
    lex.learn(['a', 'y'], 1);
    // cooc: a{x:1,y:1} b{x:1} x{a:1,b:1} y{a:1}; S: a2 b1 x2 y1; D=6
    const Z = 2 * 2 ** LEX_PPMI_ALPHA + 2;
    const pmi = (n: number, sw: number, sc: number) =>
      Math.max(0, Math.log((n * 6) / (sw * 6 * (sc ** LEX_PPMI_ALPHA / Z))));
    const ax = pmi(1, 2, 2);
    const ay = pmi(1, 2, 1);
    const bx = pmi(1, 1, 2);
    const want = (ax * bx) / (Math.hypot(ax, ay) * bx);
    expect(lex.meaning('a', 'b')).toBeCloseTo(want, 12);
  });

  it('cat is closer to dog than to moon by at least a factor φ', () => {
    const lex = corpus();
    const dog = lex.meaning('cat', 'dog');
    const moon = lex.meaning('cat', 'moon');
    expect(dog).toBeGreaterThan(PHI * moon);
    // Measured: on five sentences 'a' outranks 'dog' (it shares cat's
    // contexts 'sleeps'/'cat'-neighbours); the stated claim is dog above moon.
    const order = lex.similar('cat', 50).map((x) => x.word);
    expect(order.indexOf('dog')).toBeLessThan(order.indexOf('moon'));
  });

  it('is symmetric, bounded, self = 1, unknown = 0', () => {
    const lex = corpus();
    for (const [a, b] of [
      ['cat', 'dog'],
      ['the', 'milk'],
      ['moon', 'water'],
    ]) {
      const m = lex.meaning(a, b);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
      expect(m).toBeCloseTo(lex.meaning(b, a), 14);
    }
    expect(lex.meaning('cat', 'cat')).toBeCloseTo(1, 12);
    expect(lex.meaning('cat', 'zebra')).toBe(0);
    expect(lex.similar('zebra')).toEqual([]);
  });

  it('similar() scores equal meaning() and carry shared-context evidence', () => {
    const lex = corpus();
    for (const h of lex.similar('cat', 50)) {
      expect(h.score).toBeCloseTo(lex.meaning('cat', h.word), 12);
      expect(h.shared).toBeGreaterThan(0);
    }
  });

  it('separates categories: precision@3 = 1 and beats the existing context channel', () => {
    const lex = categories();
    const ppmi = precisionAt((w) => lex.similar(w, 3).map((x) => x.word), 3);
    const ctx = precisionAt((w) => lex.associate(w, 3).context.map((x) => x.word), 3);
    expect(ppmi).toBe(1);
    expect(ppmi).toBeGreaterThan(ctx);
    // within-category meaning exceeds cross-category meaning for every pair
    const minIn = Math.min(
      ...[ANIMALS, OBJECTS].flatMap((s) =>
        s.flatMap((a) => s.filter((b) => b !== a).map((b) => lex.meaning(a, b))),
      ),
    );
    const maxOut = Math.max(...ANIMALS.flatMap((a) => OBJECTS.map((o) => lex.meaning(a, o))));
    expect(minIn).toBeGreaterThan(maxOut);
  });

  it('cache follows learning and survives restore', () => {
    const lex = corpus();
    const before = lex.meaning('cat', 'moon');
    lex.learn(['the', 'moon', 'drinks', 'milk'], 1);
    expect(lex.meaning('cat', 'moon')).toBeGreaterThan(before);
    const b = LexiconMemory.restore(lex.snapshot());
    expect(b.similar('cat', 20)).toEqual(lex.similar('cat', 20));
    expect(b.associate('cat').meaning).toEqual(lex.associate('cat').meaning);
  });

  it('is deterministic', () => {
    expect(categories().similar('horse', 10)).toEqual(categories().similar('horse', 10));
  });
});
