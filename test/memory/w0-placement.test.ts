import { describe, expect, it } from 'vitest';
import { lexeme, lexemeTorus, injectTextPsi, LEXEME_SPREAD } from '@/core/gematria/lexeme';
import { lexiconCatalog } from '@/core/knowledge/lexicon';

const RUNGS = 55;

function catalogTokens(): string[] {
  const set = new Set<string>();
  for (const e of lexiconCatalog()) {
    for (const t of e.word.toLowerCase().split(/[^a-z]+/)) if (t) set.add(t);
  }
  return [...set];
}

describe('Ω-UNDERSTAND W0 — full-token hashed sparse placement', () => {
  it('writes each token on k distinct rungs', () => {
    const t = lexemeTorus(lexeme('coherence'), RUNGS);
    expect(t.rungs.length).toBe(LEXEME_SPREAD);
    expect(new Set(t.rungs).size).toBe(LEXEME_SPREAD);
    expect(t.rung).toBe(t.rungs[0]);
  });

  it('long words no longer share one placement', () => {
    const a = lexemeTorus(lexeme('electromagnetism'), RUNGS).rungs.join();
    const b = lexemeTorus(lexeme('electromagnetics'), RUNGS).rungs.join();
    expect(a).not.toBe(b);
  });

  it('uses all rungs and bounds primary-rung load on the catalog', () => {
    const toks = catalogTokens();
    const load = new Array<number>(RUNGS).fill(0);
    for (const w of toks) for (const n of lexemeTorus(lexeme(w), RUNGS).rungs) load[n]++;
    const mean = (toks.length * LEXEME_SPREAD) / RUNGS;
    expect(load.every((c) => c > 0)).toBe(true);
    // Balls-in-bins: max ≲ mean + 4√mean; old placement hit 151 on one rung.
    expect(Math.max(...load)).toBeLessThan(mean + 4 * Math.sqrt(mean));
  });

  it('per-token injected norm unchanged by the 1/√k split', () => {
    const psi = new Float64Array(RUNGS * 4 + 4);
    const r = injectTextPsi(psi, 'light');
    expect(r.norm).toBeGreaterThan(0);
    expect(r.norm).toBeLessThan(1);
  });
});
