import { describe, it, expect } from 'vitest';
import { MemoryStore } from '@/core/memory/MemoryStore';
import { MemoryPersistence, _internal } from '@/core/memory/MemoryPersistence';
import { SoundWordMap, soundDescriptor, LexiconMemory, similarity, SOUND_DIM } from '@/core/knowledge/lexicon';

function tone(hz: number, sr = 16000, sec = 0.5) {
  const x = new Float64Array(Math.floor(sr * sec));
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(2 * Math.PI * hz * i / sr) + 0.3 * Math.sin(2 * Math.PI * hz * 2.7 * i / sr);
  return x;
}

describe('lexicon persistence', () => {
  it('learned meanings survive save → restore bit-identically', async () => {
    const a = new MemoryStore();
    a.lexicon.learn(['the', 'wave', 'rises', 'over', 'the', 'field']);
    const p = new MemoryPersistence(new _internal.InMemoryAdapter());
    await p.save(a);
    const b = new MemoryStore();
    expect(await p.restore(b)).toBe(true);
    expect(b.lexicon.size).toBe(a.lexicon.size);
    expect(b.lexicon.tokens).toBe(a.lexicon.tokens);
    expect(similarity(b.lexicon.signature('wave'), a.lexicon.signature('wave'))).toBe(1);
  });
  it('mismatched width is rejected, not half-loaded', () => {
    const m = new LexiconMemory(64);
    m.load({ d: 32, total: 5, words: [['x', 5, null, null]] });
    expect(m.size).toBe(0);
  });
});

describe('sound → word', () => {
  it('descriptor is level-invariant and null on silence', () => {
    const d1 = soundDescriptor(tone(300), 16000)!;
    const loud = tone(300).map((v) => v * 10);
    const d2 = soundDescriptor(loud, 16000)!;
    expect(d1.length).toBe(SOUND_DIM);
    for (let i = 0; i < d1.length; i++) expect(Math.abs(d1[i] - d2[i])).toBeLessThan(1e-9);
    expect(soundDescriptor(new Float64Array(4000), 16000)).toBeNull();
  });
  it('learns to name distinct sounds; score is prequential', () => {
    const lex = new LexiconMemory(128);
    const map = new SoundWordMap(128);
    const sounds: Record<string, Float64Array> = { low: soundDescriptor(tone(200), 16000)!, high: soundDescriptor(tone(2500), 16000)! };
    lex.learn(['low']); lex.learn(['high']);
    for (let r = 0; r < 12; r++) for (const w of ['low', 'high']) map.observe(sounds[w], w, lex);
    expect(map.guess(sounds.low, lex)!.hits[0].word).toBe('low');
    expect(map.guess(sounds.high, lex)!.hits[0].word).toBe('high');
    const s = map.stats();
    expect(s.scored).toBe(23); // first trial had nothing to guess from
    expect(s.recent).toBeGreaterThan(0.6);
    const m2 = new SoundWordMap(128); m2.load(map.snapshot());
    expect(m2.guess(sounds.high, lex)!.hits[0].word).toBe('high');
    expect(m2.stats().scored).toBe(23);
  });
});
