/**
 * Ω-READY R4–R8 certification battery.
 *
 * Each test pins one host-facing law: RUMF Absolute Zero ids, evidence chain
 * integrity, the single tier law (fail-closed), the host recall scorer, and the
 * facade's abstention behaviour.
 */

import { describe, it, expect } from 'vitest';
import { sha3_256 } from '@noble/hashes/sha3.js';
import {
  toHex,
  encodeCbor,
  decodeCbor,
  hashHex,
  hlcZero,
  hlcTick,
  type CborValue,
} from '../../src/core/interop/contract';
import { BN_ONE, bnFromNumber, trustScoreMultiplier } from '../../src/core/interop/bn128';
import {
  wingId,
  roomId,
  drawerId,
  prefixedId,
  isValidDrawerId,
  sealDrawer,
  makeEntry,
  readEntry,
  exportMemory,
  drawerToWire,
  retrievalScore,
  stageIndex,
  stageNext,
  stageExpectedDurationSeconds,
  FIBONACCI_STAGES,
  OMEGA_ROOMS,
} from '../../src/core/interop/rumf';
import {
  EvidenceChain,
  seal,
  verifyChain,
  recomputeContentHash,
  EvidenceError,
  type FactDraft,
  type EvidenceEnvelope,
} from '../../src/core/interop/evidence';
import { decideTier, admits, explain } from '../../src/core/interop/tierGate';
import {
  recallScore,
  baseScore,
  flooredRecency,
  rank,
  SCORE_WEIGHTS,
  RECENCY_FLOOR,
  PINNED_MULTIPLIER,
} from '../../src/core/interop/recall';
import { abstain, answer, health } from '../../src/core/interop/facade';

const TE = new TextEncoder();

// ── R6 RUMF ────────────────────────────────────────────────────────────────

describe('R6 · RUMF transport honours Absolute Zero', () => {
  it('derives wing and room ids as prefix_hex(SHA3-256(prefix ‖ label))', () => {
    const label = 'omega.metatron';
    const expected = `wing_${toHex(sha3_256(new Uint8Array([...TE.encode('wing'), ...TE.encode(label)])))}`;
    expect(wingId(label)).toBe(expected);
    expect(wingId(label)).toBe(prefixedId('wing', label));
    expect(roomId(label).startsWith('room_')).toBe(true);
    expect(wingId(label)).not.toBe(roomId(label));
  });

  it('derives drawer ids over decoded hash BYTES, not hash strings', () => {
    const c = hashHex(TE.encode('content'));
    const x = hashHex(TE.encode('context'));
    const w = wingId('w');
    const r = roomId('r');
    const expected = toHex(
      sha3_256(
        new Uint8Array([
          ...Uint8Array.from(c.match(/../g)!.map((h) => parseInt(h, 16))),
          ...Uint8Array.from(x.match(/../g)!.map((h) => parseInt(h, 16))),
          ...TE.encode(w),
          ...TE.encode(r),
        ]),
      ),
    );
    expect(drawerId(c, x, w, r)).toBe(expected);
    expect(isValidDrawerId(drawerId(c, x, w, r))).toBe(true);
    expect(isValidDrawerId('NOTHEX')).toBe(false);
  });

  it('is content-addressed: identical memories in one room collapse to one drawer', () => {
    const hlc = hlcZero('omega');
    const mk = () =>
      sealDrawer({
        content: { psi: [1, 2, 3], tick: 7 },
        context: { rung: 5 },
        wing: wingId('omega.metatron'),
        room: roomId(OMEGA_ROOMS.L3),
        trust: 'T2',
        stage: 'F1',
        hlc,
      });
    expect(mk().id).toBe(mk().id);
    // and different content must not collide
    const other = sealDrawer({
      content: { psi: [1, 2, 4], tick: 7 },
      context: { rung: 5 },
      wing: wingId('omega.metatron'),
      room: roomId(OMEGA_ROOMS.L3),
      trust: 'T2',
      stage: 'F1',
      hlc,
    });
    expect(other.id).not.toBe(mk().id);
  });

  it('carries entry payloads as canonical CBOR that round-trips', () => {
    const e = makeEntry({ b: 2, a: 1 }, 'T3', hlcZero('omega'));
    expect(readEntry(e)).toEqual({ a: 1, b: 2 });
    expect(toHex(e.payload_cbor)).toBe(toHex(encodeCbor({ a: 1, b: 2 })));
  });

  it('exports an Ω memory item deterministically and to CBOR wire bytes', () => {
    let hlc = hlcZero('omega');
    hlc = hlcTick(hlc, 1_700_000_000_000);
    const args = {
      layer: 'L2' as const,
      item: { episode: 'first-light', frames: 89 } as CborValue,
      context: { tick: 3200, rung: 12 } as CborValue,
      trust: 'T2' as const,
      hlc,
    };
    const a = exportMemory(args);
    const b = exportMemory(args);
    expect(a.id).toBe(b.id);
    expect(a.stage).toBe('F1');
    const wire = drawerToWire(a);
    const back = decodeCbor(wire) as Record<string, CborValue>;
    expect(back.id).toBe(a.id);
    expect(back.trust).toBe('T2');
    expect(toHex(drawerToWire(b))).toBe(toHex(wire));
  });

  it('reproduces the host Fibonacci maturation ladder', () => {
    expect(FIBONACCI_STAGES).toHaveLength(12);
    expect(stageIndex('F1')).toBe(1);
    expect(stageIndex('F12')).toBe(12);
    expect(stageNext('F1')).toBe('F2');
    expect(stageNext('F12')).toBeNull();
    // Host vectors, verbatim from rumf/mod.rs `fibonacci_stage_durations`.
    expect(stageExpectedDurationSeconds('F1')).toBe(60);
    expect(stageExpectedDurationSeconds('F2')).toBe(60);
    expect(stageExpectedDurationSeconds('F3')).toBe(120);
    expect(stageExpectedDurationSeconds('F5')).toBe(300);
    expect(stageExpectedDurationSeconds('F8')).toBe(1260);
    expect(stageExpectedDurationSeconds('F12')).toBe(8640);
  });

  it('scores retrieval in BigNum128 with the trust multiplier and no floats', () => {
    const base = bnFromNumber(0.5);
    expect(retrievalScore(base, trustScoreMultiplier('T5'))).toBe(base * 4n);
    expect(retrievalScore(base, trustScoreMultiplier('T0'))).toBe(base / 2n);
    expect(retrievalScore(BN_ONE * 3n, trustScoreMultiplier('T3'))).toBe(BN_ONE);
  });
});

// ── R5 evidence ────────────────────────────────────────────────────────────

const draft = (predicate: string, value: number): FactDraft => ({
  subject_type: 'kpi',
  subject_id: 'kpi-coherence',
  predicate,
  object_json: { value, unit: 'ratio' },
  confidence: 0.9,
  source: 'system',
  tags: ['omega', 'measured'],
});

describe('R5 · evidence envelopes chain and verify', () => {
  it('seals a host-shaped fact with derived id and content hash', () => {
    const hlc = hlcTick(hlcZero('omega'), 1000);
    const e = seal(draft('value', 0.97), hlc, null);
    expect(e.subject_type).toBe('kpi');
    expect(e.hlc_node).toBe('omega');
    expect(e.content_hash).toBe(recomputeContentHash(e));
    expect(e.id.startsWith('fact_')).toBe(true);
    expect(e.prev_hash).toBeNull();
    // tags are sorted, so tag order cannot change the hash
    expect(
      seal({ ...draft('value', 0.97), tags: ['measured', 'omega'] }, hlc, null).content_hash,
    ).toBe(e.content_hash);
  });

  it('refuses malformed drafts instead of sealing them', () => {
    const hlc = hlcZero('omega');
    expect(() => seal({ ...draft('v', 1), confidence: 1.4 }, hlc, null)).toThrow(EvidenceError);
    expect(() => seal({ ...draft('v', 1), confidence: Number.NaN }, hlc, null)).toThrow(/\[0,1\]/);
    expect(() => seal({ ...draft('v', 1), predicate: '' }, hlc, null)).toThrow(/predicate/);
    expect(() => seal({ ...draft('v', 1), subject_id: '' }, hlc, null)).toThrow(/subject_id/);
    expect(() => seal({ ...draft('v', 1), subject_type: 'ghost' as never }, hlc, null)).toThrow(
      /unknown subject type/,
    );
  });

  it('chains appends and verifies the whole chain', () => {
    const chain = new EvidenceChain('omega', 1_700_000_000_000);
    const a = chain.append(draft('value', 0.5), 1_700_000_000_000);
    const b = chain.append(draft('value', 0.6), 1_700_000_000_001);
    expect(b.prev_hash).toBe(a.content_hash);
    expect(chain.tip()).toBe(b.content_hash);
    expect(chain.length()).toBe(2);
    expect(verifyChain(chain.all())).toEqual({ ok: true, brokenAt: -1, reason: null });
  });

  it('detects a tampered body, a spliced link, and a forged id', () => {
    const chain = new EvidenceChain('omega');
    chain.append(draft('value', 0.5), 10);
    chain.append(draft('value', 0.6), 11);
    const items = [...chain.all()] as EvidenceEnvelope[];

    const tampered = [...items];
    tampered[1] = { ...items[1], object_json: { value: 0.99, unit: 'ratio' } };
    expect(verifyChain(tampered)).toMatchObject({ ok: false, brokenAt: 1 });

    const spliced = [items[1], items[0]];
    expect(verifyChain(spliced).ok).toBe(false);

    const forged = [...items];
    forged[0] = { ...items[0], id: 'fact_deadbeef' };
    expect(verifyChain(forged)).toMatchObject({
      ok: false,
      brokenAt: 0,
      reason: expect.stringContaining('id'),
    });
  });

  it('replays identically from injected time — no wall clock is read', () => {
    const run = () => {
      const c = new EvidenceChain('omega', 500);
      c.append(draft('value', 0.5), 1000);
      c.append(draft('value', 0.6), 1000); // same ms — counter must advance
      return c;
    };
    const a = run(),
      b = run();
    expect(a.tip()).toBe(b.tip());
    expect(a.all()[1].hlc_logical).toBe(a.all()[0].hlc_logical + 1);
    expect(toHex(a.export())).toBe(toHex(b.export()));
  });

  it('supersession leaves exactly one current fact per subject/predicate', () => {
    const c = new EvidenceChain('omega');
    const first = c.append(draft('value', 0.5), 10);
    c.append({ ...draft('value', 0.7), supersedes_id: first.id }, 11);
    const cur = c.current();
    expect(cur).toHaveLength(1);
    expect((cur[0].object_json as { value: number }).value).toBe(0.7);
  });
});

// ── R4 tier gate ───────────────────────────────────────────────────────────

describe('R4 · one tier law, fail-closed', () => {
  const full = {
    coherenceWarm: 0.97,
    warmRungs: 18,
    totalRungs: 18,
    tapeFrames: 512,
    patterns: 144,
    sealedFindings: 34,
    chainVerified: true,
  };

  it('withholds trust from a dormant engine and names every reason', () => {
    const d = decideTier({});
    expect(d.trust).toBe('T0');
    expect(d.measured).toBe(false);
    expect(d.merged).toBe(0n);
    expect(d.refusals.join(' ')).toMatch(/not measured/);
    expect(d.refusals.join(' ')).toMatch(/no tape frames/);
    expect(explain(d)).toMatch(/withheld/);
  });

  it('does not report coherence for a cold ladder', () => {
    const d = decideTier({
      coherenceWarm: Number.NaN,
      warmRungs: 0,
      totalRungs: 18,
      tapeFrames: 0,
    });
    expect(d.trust).toBe('T0');
    expect(d.merged).toBe(0n);
  });

  it('admits the full tier only when every input is measured', () => {
    const d = decideTier(full);
    expect(d.measured).toBe(true);
    expect(d.trust).toBe('T5');
    expect(d.multiplier).toBe(BN_ONE * 4n);
    expect(d.merged > 0n).toBe(true);
    expect(explain(d)).toMatch(/all inputs measured/);
  });

  it('caps at the weakest input rather than averaging over inputs', () => {
    expect(decideTier({ ...full, chainVerified: false }).trust).toBe('T2');
    expect(decideTier({ ...full, patterns: 3 }).trust).toBe('T1');
    expect(decideTier({ ...full, tapeFrames: 0 }).trust).toBe('T0');
    expect(decideTier({ ...full, warmRungs: 9 }).trust).toBe('T3');
    expect(decideTier({ ...full, coherenceWarm: 0.55 }).trust).toBe('T4');
  });

  it('is monotone: improving a reading never lowers the decision', () => {
    const tiers = [0, 21, 89, 200, 512].map((tapeFrames) =>
      Number(decideTier({ ...full, tapeFrames }).trust.slice(1)),
    );
    for (let i = 1; i < tiers.length; i++) expect(tiers[i]).toBeGreaterThanOrEqual(tiers[i - 1]);
  });

  it('admits/refuses against a required level', () => {
    expect(admits(full, 'T4')).toBe(true);
    expect(admits({}, 'T1')).toBe(false);
    expect(admits({ ...full, chainVerified: false }, 'T3')).toBe(false);
  });
});

// ── R7 recall scorer ───────────────────────────────────────────────────────

describe('R7 · the host recall scorer, mirrored', () => {
  const terms = { keyword: 1, validity: 1, recency: 1, importance: 1 };

  it('reproduces the host weights and sums to one without bonuses', () => {
    expect(baseScore(terms)).toBeCloseTo(1, 12);
    expect(
      SCORE_WEIGHTS.keyword +
        SCORE_WEIGHTS.validity +
        SCORE_WEIGHTS.recency +
        SCORE_WEIGHTS.importance,
    ).toBeCloseTo(1, 12);
  });

  it('keeps resonance strictly additive — zero regression for callers without it', () => {
    expect(recallScore(terms)).toBe(baseScore(terms));
    expect(recallScore({ ...terms, resonance: 1 })).toBeCloseTo(baseScore(terms) + 0.5, 12);
    expect(recallScore({ ...terms, resonance: -1 })).toBeCloseTo(baseScore(terms) - 0.5, 12);
    expect(recallScore({ ...terms, clusterPrior: 1 })).toBeCloseTo(baseScore(terms) + 0.25, 12);
  });

  it('never lets recency fall below the floor', () => {
    expect(flooredRecency(0)).toBe(RECENCY_FLOOR);
    expect(flooredRecency(1)).toBe(1);
    expect(baseScore({ ...terms, keyword: 0, validity: 0, importance: 0, recency: 0 })).toBeCloseTo(
      SCORE_WEIGHTS.recency * RECENCY_FLOOR,
      12,
    );
  });

  it('applies the pinned multiplier to the base only', () => {
    expect(baseScore({ ...terms, pinned: true })).toBeCloseTo(PINNED_MULTIPLIER, 12);
  });

  it('rejects out-of-range terms instead of clamping them', () => {
    expect(() => recallScore({ ...terms, keyword: 1.2 })).toThrow(/keyword/);
    expect(() => recallScore({ ...terms, resonance: 2 })).toThrow(/resonance/);
    expect(() => recallScore({ ...terms, recency: Number.NaN })).toThrow(/recency/);
  });

  it('ranks deterministically, breaking ties on a stable key', () => {
    const cands = [
      { key: 'b', terms },
      { key: 'a', terms },
      { key: 'c', terms: { ...terms, resonance: 1 } },
    ];
    const order = rank(cands).map((c) => c.key);
    expect(order).toEqual(['c', 'a', 'b']);
    expect(rank([...cands].reverse()).map((c) => c.key)).toEqual(order);
  });
});

// ── R8 facade ──────────────────────────────────────────────────────────────

describe('R8 · the facade abstains instead of fabricating', () => {
  const full = {
    coherenceWarm: 0.97,
    warmRungs: 18,
    totalRungs: 18,
    tapeFrames: 512,
    patterns: 144,
    sealedFindings: 34,
    chainVerified: true,
  };
  const items = [{ key: 'k', score: 1, resonance: 0.5, payload: { a: 1 } as CborValue }];

  it('returns an explicit abstention with reasons for a dormant engine', () => {
    const a = abstain({});
    expect(a.abstained).toBe(true);
    expect(a.items).toHaveLength(0);
    expect(a.trust).toBe('T0');
    expect(a.reason).toMatch(/withheld/);
  });

  it('withholds items when the gate is below the required trust', () => {
    const a = answer(items, { tapeFrames: 0 }, 'T2');
    expect(a.abstained).toBe(true);
    expect(a.items).toHaveLength(0);
    expect(a.reason).toMatch(/below required T2/);
  });

  it('reports items once trust clears', () => {
    const a = answer(items, full, 'T2');
    expect(a.abstained).toBe(false);
    expect(a.items).toEqual(items);
    expect(a.trust).toBe('T5');
    expect(a.reason).toBeNull();
  });

  it('publishes health with the decision and a human explanation', () => {
    const h = health(full, 3200);
    expect(h.ticks).toBe(3200);
    expect(h.decision.trust).toBe('T5');
    expect(h.explanation).toMatch(/all inputs measured/);
  });
});
