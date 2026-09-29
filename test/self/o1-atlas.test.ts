/**
 * Ω-MAP battery — keeps the self-map honest.
 *
 * The atlas is a claim about the codebase. These tests make the claim
 * falsifiable: cited paths must exist, ids must match the live registry's
 * vocabulary, potential must stay labelled as potential, and the cross-map
 * must be deterministic.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { CAPABILITY_ATLAS, ATLAS_BY_ID } from '@/core/self/atlas';
import { crossMap } from '@/core/self/crossMap';
import type { SelfRegistry } from '@/core/self/types';

/** Registry ids are declared in the probe file; read them rather than duplicate. */
function registryIds(): string[] {
  const src = readFileSync('src/ui/omega/selfRegistry.ts', 'utf8');
  const ids = new Set<string>();
  const re = /^\s*id:\s*'([a-z]+\.[a-z]+)',/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) ids.add(m[1]);
  // self-test assertions reuse module ids; they are a subset, so no filtering needed
  return [...ids].sort();
}

function fakeRegistry(
  states: Record<string, SelfRegistry['modules'][number]['state']>,
): SelfRegistry {
  const modules = CAPABILITY_ATLAS.map((e) => ({
    id: e.id,
    title: e.id,
    purpose: e.does,
    contract: 'n/a',
    state: states[e.id] ?? ('dormant' as const),
    detail: 'test',
    source: e.source,
    metrics: [],
    testable: false,
    cost: 'cheap' as const,
  }));
  const counts = { live: 0, dormant: 0, absent: 0, stale: 0 };
  for (const m of modules) counts[m.state]++;
  return { builtAt: 0, modules, counts };
}

describe('Ω-MAP · capability atlas integrity', () => {
  it('every cited source path exists on disk', () => {
    for (const e of CAPABILITY_ATLAS) {
      expect(existsSync(e.source), `${e.id} source ${e.source}`).toBe(true);
      if (e.evidence) expect(existsSync(e.evidence), `${e.id} evidence ${e.evidence}`).toBe(true);
    }
  });

  it('atlas ids exactly match the live registry vocabulary', () => {
    const reg = registryIds();
    const atlas = CAPABILITY_ATLAS.map((e) => e.id).sort();
    expect(atlas).toEqual(reg);
  });

  it('ids are unique and the index covers them all', () => {
    const ids = CAPABILITY_ATLAS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ATLAS_BY_ID.size).toBe(ids.length);
  });

  it('every affordance is SPEC and states a prerequisite', () => {
    for (const e of CAPABILITY_ATLAS) {
      for (const a of e.affordances) {
        expect(a.label).toBe('SPEC');
        expect(a.requires.length).toBeGreaterThan(10);
        // potential must never be restated as present behaviour
        expect(e.does.includes(a.what)).toBe(false);
      }
    }
  });

  it('carries no mock or simulated content', () => {
    const banned = /\b(mock|simulated|placeholder|lorem|dummy|fake data|TODO)\b/i;
    for (const e of CAPABILITY_ATLAS) {
      const blob = JSON.stringify(e);
      expect(banned.test(blob), `${e.id}`).toBe(false);
    }
  });

  it('ports are well formed: real rates or null, never a guess', () => {
    for (const e of CAPABILITY_ATLAS) {
      for (const p of [...e.inputs, ...e.outputs]) {
        expect(p.name.length).toBeGreaterThan(0);
        expect(p.what.length).toBeGreaterThan(10);
        if (p.hz !== null) {
          expect(Number.isFinite(p.hz)).toBe(true);
          expect(p.hz).toBeGreaterThan(0);
        }
      }
    }
  });

  it('declared feeds and dependencies point at known modules, never at self', () => {
    for (const e of CAPABILITY_ATLAS) {
      for (const f of [...e.feeds, ...e.dependsOn]) {
        expect(ATLAS_BY_ID.has(f), `${e.id} → ${f}`).toBe(true);
        expect(f).not.toBe(e.id);
      }
    }
  });
});

describe('Ω-MAP · cross-map', () => {
  const reg = fakeRegistry({
    'engine.host': 'live',
    'engine.field': 'live',
    'engine.mind': 'absent',
  });

  it('is deterministic for the same inputs', () => {
    const a = JSON.stringify(crossMap(reg));
    const b = JSON.stringify(
      crossMap(
        fakeRegistry({ 'engine.host': 'live', 'engine.field': 'live', 'engine.mind': 'absent' }),
      ),
    );
    expect(a).toBe(b);
  });

  it('classifies edges by the liveness of both ends', () => {
    const m = crossMap(reg);
    const wired = m.edges.find((e) => e.from === 'engine.host' && e.to === 'engine.field');
    expect(wired?.status).toBe('wired');
    const broken = m.edges.find((e) => e.from === 'engine.host' && e.to === 'engine.mind');
    expect(broken?.status).toBe('broken');
    const cold = m.edges.find((e) => e.from === 'engine.field' && e.to === 'knowledge.field');
    expect(cold?.status).toBe('cold');
  });

  it('reports no orphans against a registry built from the atlas', () => {
    const m = crossMap(reg);
    expect(m.orphans.atlasOnly).toEqual([]);
    expect(m.orphans.registryOnly).toEqual([]);
  });

  it('marks a missing registry entry unknown rather than inventing a state', () => {
    const m = crossMap({
      builtAt: 0,
      modules: [],
      counts: { live: 0, dormant: 0, absent: 0, stale: 0 },
    });
    expect(new Set(Object.values(m.states))).toEqual(new Set(['unknown']));
    expect(m.edges.every((e) => e.status === 'unknown')).toBe(true);
  });

  it('opportunities exclude declared edges and self-loops, and are all SPEC', () => {
    const m = crossMap(reg);
    const declared = new Set(m.edges.map((e) => `${e.from}→${e.to}`));
    for (const o of m.opportunities) {
      expect(o.from).not.toBe(o.to);
      expect(declared.has(`${o.from}→${o.to}`)).toBe(false);
      expect(o.label).toBe('SPEC');
      expect(o.because.length).toBeGreaterThan(20);
    }
    expect(m.opportunities.length).toBeGreaterThan(0);
  });

  it('ranks live-to-live pairings above dormant ones', () => {
    const m = crossMap(reg);
    const scores = m.opportunities.map((o) => o.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('counts agree with the arrays they summarise', () => {
    const m = crossMap(reg);
    expect(m.counts.wired + m.counts.cold + m.counts.broken + m.counts.unknown).toBe(
      m.edges.length,
    );
    expect(m.counts.gaps).toBe(m.gaps.length);
    expect(m.counts.opportunities).toBe(m.opportunities.length);
  });
});
