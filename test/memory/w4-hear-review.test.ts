import { describe, it, expect } from 'vitest';
import { MemoryStore, PendingTranscript } from '@/core/memory/MemoryStore';
import { lexeme } from '@/core/gematria/lexeme';
import { lexiconCatalog, SOUND_DIM } from '@/core/knowledge/lexicon';

describe('review window before memory', () => {
  it('holds words until expiry and commits exactly once', () => {
    const s = new MemoryStore();
    s.submit('the sun rises', 'typed', null, 0);
    expect(s.flushPending(1000)).toBe(0);
    expect(s.wordsEnqueued).toBe(0);
    expect(s.flushPending(8000)).toBe(1);
    expect(s.flushPending(20000)).toBe(0);
    expect(s.wordsEnqueued).toBe(3);
    expect(s.pending.history.map((h) => h.word)).toEqual(['the', 'sun', 'rises']);
  });

  it('corrections replace, empty removes, drop learns nothing, pause holds', () => {
    const p = new PendingTranscript();
    const u = p.push('I red a book', 'heard', null, null, 0)!;
    expect(p.edit(u.id, 1, 'read')).toBe(true);
    expect(p.edit(u.id, 2, '')).toBe(true);
    expect(u.words).toEqual(['i', 'read', 'book']);
    expect(p.corrections).toBe(1);
    p.paused = true;
    expect(p.expired(1e9)).toEqual([]);
    expect(p.drop(u.id)).toBe(true);
    expect(p.list().length).toBe(0);
  });

  it('a corrected label is what gets learned and scored', () => {
    const s = new MemoryStore();
    const d = new Float64Array(SOUND_DIM).map((_, i) => Math.sin(i + 1));
    s.submit('cat', 'heard', d, 0); s.flushPending(1e4);
    const u = s.submit('cap', 'heard', d, 2e4)!;
    s.pending.edit(u.id, 0, 'cat');
    s.flushPending(1e5);
    expect(s.lexicon.count('cap')).toBe(0);
    expect(s.pending.history.at(-1)).toMatchObject({ word: 'cat', corrected: true });
  });
});

describe('every word has a unique pattern', () => {
  it('exact addresses never collide across the catalog and a generated sample', () => {
    const words = new Set<string>();
    for (const e of lexiconCatalog()) { const t = lexeme(e.word).token; if (t && t.length <= 11) words.add(t); }
    const a = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < 20000; i++) {
      let w = ''; let x = i * 2654435761 >>> 0;
      const n = 1 + (i % 11);
      for (let k = 0; k < n; k++) { w += a[x % 26]; x = (x * 1103515245 + 12345) >>> 0; }
      words.add(w);
    }
    const seen = new Map<string, string>();
    for (const w of words) {
      const addr = lexeme(w).address;
      expect(seen.get(addr) ?? w).toBe(w);
      seen.set(addr, w);
    }
  });

  it('inspect reports code, address, torus and grounding', () => {
    const s = new MemoryStore();
    const info = s.lexicon.inspect('rise', 9);
    expect(info.exact).toBe(true);
    expect(info.address).toBe(lexeme('rise').address);
    expect(info.torus.rung).toBeLessThan(9);
    expect(info.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });
});
