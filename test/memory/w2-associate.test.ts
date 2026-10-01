import { describe, expect, it } from 'vitest';
import { LexiconMemory, LEX_UTTER_CAP } from '@/core/knowledge/lexicon';
import { MemoryStore } from '@/core/memory/MemoryStore';

function corpus(): LexiconMemory {
  const lex = new LexiconMemory(64);
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

describe('Ω-UNDERSTAND W2 — related-pattern recall', () => {
  it('postings return every sentence containing the word, newest first', () => {
    const a = corpus().associate('cat');
    expect(a.occurrences).toBe(3);
    expect(a.sentences.map((s) => s.text)).toEqual([
      'a cat sleeps',
      'the cat chases the dog',
      'the cat drinks milk',
    ]);
    expect(a.sentences[0].tick).toBe(4);
  });

  it('succession counts and conditional probabilities are exact', () => {
    const a = corpus().associate('cat');
    expect(a.follows).toEqual([
      { word: 'chases', count: 1, p: 1 / 3 },
      { word: 'drinks', count: 1, p: 1 / 3 },
      { word: 'sleeps', count: 1, p: 1 / 3 },
    ]);
    expect(a.precedes).toEqual([
      { word: 'the', count: 2, p: 2 / 3 },
      { word: 'a', count: 1, p: 1 / 3 },
    ]);
  });

  it('co-occurrence is normalised and spreading reaches 2-hop words only via neighbours', () => {
    const a = corpus().associate('cat', 50);
    const w = a.together.find((t) => t.word === 'milk')!;
    // c(cat,milk)=1, f(cat)=3, f(milk)=1 → 1/√3
    expect(w.assoc).toBeCloseTo(1 / Math.sqrt(3), 12);
    const water = a.spread.find((x) => x.word === 'water')!;
    // water never co-occurs with cat but co-occurs with drinks/dog/the
    expect(a.together.some((t) => t.word === 'water')).toBe(false);
    expect(water.hop).toBe(2);
    expect(water.activation).toBeGreaterThan(0);
    expect(a.spread.every((x) => x.word !== 'cat')).toBe(true);
    const lex = new LexiconMemory(64);
    for (let i = 0; i < 20; i++) lex.learn(['x', 'y', 'z', 'q', 'r', 'w'], 0);
    lex.learn(['x', 'far'], 0);
    const sp = lex.associate('far', 50).spread;
    const hop2 = sp.filter((x) => x.hop === 2).map((x) => x.word);
    expect(hop2.length).toBeGreaterThan(0);
    expect(hop2).not.toContain('x');
  });

  it('spelling family is spelling-only and excludes the word itself', () => {
    const lex = new LexiconMemory(256);
    lex.learn(['cats', 'catalog', 'moon', 'dog'], 0);
    const a = lex.associate('cat');
    expect(a.spelling[0].word).toBe('cats');
    expect(a.spelling.some((x) => x.word === 'cat')).toBe(false);
  });

  it('ring eviction keeps postings consistent', () => {
    const lex = new LexiconMemory(16);
    lex.learn(['unique', 'start'], 0, 0);
    for (let i = 1; i <= LEX_UTTER_CAP; i++) lex.learn(['filler', 'start'], 0, i);
    expect(lex.associate('unique').occurrences).toBe(0);
    expect(lex.associate('unique').sentences).toHaveLength(0);
    const s = lex.associate('start');
    expect(s.occurrences).toBe(LEX_UTTER_CAP);
    expect(s.sentences[0].tick).toBe(LEX_UTTER_CAP);
    // Counts are lifetime observations and survive eviction.
    expect(lex.associate('unique').follows).toEqual([{ word: 'start', count: 1, p: 1 }]);
  });

  it('snapshot round-trips the association index; pre-W2 snapshots load empty', () => {
    const a = corpus();
    const b = LexiconMemory.restore(a.snapshot());
    expect(b.associate('cat')).toEqual(a.associate('cat'));
    b.learn(['cat', 'naps'], 1, 9);
    expect(b.associate('cat').sentences[0]).toEqual({ text: 'cat naps', tick: 9 });
    const old = a.snapshot();
    delete old.assoc;
    const c = LexiconMemory.restore(old);
    expect(c.count('cat')).toBe(3);
    expect(c.associate('cat').occurrences).toBe(0);
  });

  it('store join returns journal episodes and their pathway successors', () => {
    const st = new MemoryStore();
    st.lexicon.learn(['the', 'cat', 'drinks'], 1, 1);
    st.journal.append({ tick: 1, qualiaScalar: 0.5, signatureHash: 'h1', text: 'the cat drinks' });
    st.journal.append({ tick: 2, qualiaScalar: 0.4, signatureHash: 'h2', text: 'milk is white' });
    st.pathway.observe('h1', 'h2', 2);
    const a = st.associate('cat');
    expect(a.sentences).toHaveLength(1);
    expect(a.episodes).toHaveLength(1);
    expect(a.episodes[0].next).toEqual([{ hash: 'h2', count: 1, text: 'milk is white' }]);
    expect(st.associate('white').episodes[0].hash).toBe('h2');
  });

  it('is deterministic', () => {
    expect(corpus().associate('the')).toEqual(corpus().associate('the'));
  });
});

describe('Ω-UNDERSTAND W2 — capture labels are not sentences', () => {
  it('label records never match a word and successor labels show as null', () => {
    const st = new MemoryStore();
    st.journal.append({ tick: 1, qualiaScalar: 0.5, signatureHash: 'h1', text: 'the cat drinks' });
    st.journal.append({
      tick: 2,
      qualiaScalar: 0.4,
      signatureHash: 'h2',
      text: 'fibonacci · sal=0.59',
    });
    st.pathway.observe('h1', 'h2', 2);
    expect(st.associate('cat').episodes[0].next[0].text).toBeNull();
    expect(st.associate('fibonacci').episodes).toHaveLength(0);
  });

  it('spelling family drops words with no shared trigrams', () => {
    const lex = new LexiconMemory(1597);
    lex.learn(['cats', 'water', 'moon'], 0);
    expect(lex.associate('cat').spelling.map((x) => x.word)).toEqual(['cats']);
  });
});
