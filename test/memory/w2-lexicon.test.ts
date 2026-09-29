import { describe, it, expect } from 'vitest';
import {
  spellingSignature,
  similarity,
  encodeSentence,
  decodeSentence,
  LexiconMemory,
  compileCondition,
  evaluatePredicate,
  groundingStats,
  describeField,
  lexiconCatalog,
} from '@/core/knowledge/lexicon';
import { calibratedBeta, hopfieldBeta } from '@/core/gematria/resonanceKernel';
import { lexemeValue, unzeckendorf, lexeme } from '@/core/gematria';
import { MemoryStore } from '@/core/memory/MemoryStore';

describe('Ω-LEXICON signatures', () => {
  it('similar spellings sit closer than unrelated words', () => {
    const run = spellingSignature('running');
    expect(similarity(run, spellingSignature('runner'))).toBeGreaterThan(
      similarity(run, spellingSignature('galaxy')) + 0.1,
    );
    expect(similarity(run, run)).toBeCloseTo(1, 12);
  });
  it('base-27 key stays exactly recoverable through Zeckendorf', () => {
    const lx = lexeme('resonance');
    expect(unzeckendorf(lx.zeck)).toBe(lexemeValue('resonance'));
  });
});

describe('calibrated recall', () => {
  it('β = 2 ln N / Δ, never below φ, and far hotter than φ/√d', () => {
    expect(calibratedBeta(20000, 0.5)).toBeCloseTo((2 * Math.log(20000)) / 0.5, 12);
    expect(calibratedBeta(1, 0.5)).toBeCloseTo(1.618033988749895, 12);
    expect(calibratedBeta(20000, 0.5)).toBeGreaterThan(900 * hopfieldBeta(1597));
  });
  it('recalls a known word crisply from its own signature', () => {
    const lex = new LexiconMemory();
    lex.learn('the field rises and the wave falls while light returns'.split(' '), 1);
    const r = lex.recall(lex.signature('wave'));
    expect(r.hits[0].word).toBe('wave');
    expect(r.crisp).toBe(true);
  });
  it('context learning pulls co-occurring words together', () => {
    const lex = new LexiconMemory();
    const before = similarity(lex.signature('photon'), lex.signature('light'));
    for (let i = 0; i < 8; i++) lex.learn(['photon', 'light'], 1);
    expect(similarity(lex.signature('photon'), lex.signature('light'))).toBeGreaterThan(
      before + 0.05,
    );
  });
});

describe('sentence binding', () => {
  it('roles decode back to their fillers', () => {
    const words = ['field', 'rise', 'wave', 'torus', 'now', 'slowly', 'cat', 'fall'];
    const v = encodeSentence({ agent: 'field', action: 'rise', object: 'wave', place: 'torus' });
    const dec = Object.fromEntries(decodeSentence(v, words).map((d) => [d.role, d.word]));
    expect(dec).toMatchObject({
      agent: 'field',
      action: 'rise',
      object: 'wave',
      place: 'torus',
      time: null,
      manner: null,
    });
  });
});

describe('grounding', () => {
  it('compiles catalog conditions into predicates', () => {
    expect(compileCondition('ż > 0')).toBe('rising');
    expect(compileCondition('z̈ = −g')).toBe('decelerating');
    expect(compileCondition('x(t+T) = x(t)')).toBe('periodic');
    expect(compileCondition('ρ_obj = ρ_fluid')).toBeNull();
    const s = groundingStats();
    expect(s.entries).toBe(lexiconCatalog().length);
    expect(s.grounded).toBeGreaterThan(10);
    expect(s.grounded + s.ungrounded).toBe(s.entries);
  });
  it('predicates fire on synthetic paths that satisfy them', () => {
    expect(evaluatePredicate('rising', { x: [0, 1, 2, 3] })).toBe(true);
    expect(evaluatePredicate('falling', { x: [3, 2, 1, 0] })).toBe(true);
    expect(evaluatePredicate('rising', { x: [3, 2, 1, 0] })).toBe(false);
    expect(evaluatePredicate('periodic', { x: [0, 1, 0, 1, 0, 1, 0, 1] })).toBe(true);
    expect(describeField({ x: [0, 1, 2, 3] })?.frame.action).toBeDefined();
    expect(describeField({ x: [1, 1, 1] })?.frame.action).toBe('hold');
  });
});

describe('word-rate capture', () => {
  it('queues every token losslessly until drained', () => {
    const s = new MemoryStore();
    for (let i = 0; i < 20; i++) s.hear(`word${i} again`);
    expect(s.wordsEnqueued).toBe(40);
    expect(s.drainWords().length).toBe(20);
    expect(s.drainWords().length).toBe(0);
  });
});
