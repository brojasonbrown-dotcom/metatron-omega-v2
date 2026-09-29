/**
 * Ω-REAL P7 certification — the Ten-Sweep Consolidation Protocol.
 *
 * The protocol's whole claim is that consolidation is auditable: every sweep
 * measures something, can fail, and leaves sealed evidence. These tests attack
 * each of those three claims individually.
 */

import { describe, it, expect } from 'vitest';
import {
  Corpus,
  TenSweepProtocol,
  sweepSchedule,
  SWEEP_NAMES,
  LONG_GAP_SWEEPS,
  SHORT_GAP_SWEEPS,
  sweep1IntakeReplay,
  sweep2HdcBinding,
  sweep3TemporalStamping,
  sweep4ContradictionPass,
  sweep5PrototypeConsolidation,
  sweep6CausalAttribution,
  sweep7CrossLevelRescoring,
  sweep8RedTeam,
  sweep9GovernorCompression,
  sweep10Reflection,
  type CorpusItem,
  type Forgery,
  type SweepReport,
} from '../src/sweeps/tenSweep';
import { GenomeLedger, leafBytes, type Provenance } from '../src/genome/record';
import { keyPairFromSeed } from '../src/ledger/sth';
import { hashLeaf, toHex } from '../src/ledger/merkle';
import { canonicalJson } from '../src/ledger/canonical';
import { randomHv, similarity, wrapPhase, type Hypervector } from '../src/substrate/vsa';
import { CONSOLIDATION_COS, MIN_PAIRED, isStableRung } from '../src/substrate/phiSubstrate';

const PROV: Provenance = { attributedTo: 'test', generatedBy: 'r7', evidence: 'measured' };
const DIM = 512;

function newLedger(): GenomeLedger {
  return new GenomeLedger(
    'r7-log',
    new Uint8Array(32).fill(9),
    keyPairFromSeed(new Uint8Array(32).fill(3)),
  );
}

function item(id: string, over: Partial<CorpusItem> = {}): CorpusItem {
  return {
    id,
    kind: 'Episode',
    vector: randomHv(DIM, id),
    trust: 0.9,
    contradicts: [],
    recordedAt: 100,
    validFrom: 100,
    validTo: null,
    supersededBy: null,
    ...over,
  };
}

/** Corpus whose every item is also a sealed ledger record. */
function seeded(n: number, kind = 'Episode'): { corpus: Corpus; ledger: GenomeLedger } {
  const ledger = newLedger();
  const corpus = new Corpus();
  for (let i = 0; i < n; i++) {
    const id = `e${i}`;
    ledger.append({ id, kind, body: { i }, recordedAt: 100, provenance: PROV });
    corpus.add(item(id, { kind }));
  }
  return { corpus, ledger };
}

/** A vector at a controlled cosine from `base` (rotate a fraction of components). */
function nudged(base: Hypervector, fraction: number, seed: string): Hypervector {
  const noise = randomHv(base.length, seed);
  const out = new Float64Array(base.length);
  const k = Math.round(base.length * fraction);
  for (let i = 0; i < base.length; i++) out[i] = i < k ? noise[i] : wrapPhase(base[i]);
  return out;
}

describe('P7 — schedule derives from the stable-rung heartbeat', () => {
  it('fires sweeps 1–7 in long gaps and 8–10 in short gaps', () => {
    const slots = sweepSchedule(2);
    expect(slots.length).toBe(8); // 4 stable rungs × 2 cycles
    for (const s of slots) {
      expect(isStableRung(s.tick)).toBe(true);
      expect(s.sweeps).toEqual(s.opens === 'long' ? LONG_GAP_SWEEPS : SHORT_GAP_SWEEPS);
    }
    expect(slots.filter((s) => s.opens === 'long').length).toBe(4);
    expect(slots.filter((s) => s.opens === 'short').length).toBe(4);
  });

  it('every rung is covered exactly once and all ten sweeps fire per cycle', () => {
    const slots = sweepSchedule(1);
    expect(new Set(slots.map((s) => s.tick)).size).toBe(slots.length);
    const fired = new Set(slots.flatMap((s) => [...s.sweeps]));
    expect([...fired].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('is translation invariant across cycle offsets', () => {
    const a = sweepSchedule(1, 0).map((s) => s.opens);
    const b = sweepSchedule(1, 28).map((s) => s.opens);
    expect(a).toEqual(b);
    expect(sweepSchedule(1, 28).map((s) => s.tick)).toEqual(
      sweepSchedule(1, 0).map((s) => s.tick + 28),
    );
  });

  it('names all ten operators', () => {
    expect(Object.keys(SWEEP_NAMES).length).toBe(10);
    expect(new Set(Object.values(SWEEP_NAMES)).size).toBe(10);
  });
});

describe('P7/S1 — intake replay', () => {
  it('replays a healthy corpus and separates shredded from failed', () => {
    const { corpus, ledger } = seeded(5);
    expect(sweep1IntakeReplay(corpus, ledger)).toMatchObject({
      total: 5,
      replayed: 5,
      shredded: 0,
    });

    ledger.shred('e2');
    const m = sweep1IntakeReplay(corpus, ledger);
    // A shredded body is SUPPOSED to be unreadable: it is not an envelope failure.
    expect(m).toMatchObject({ total: 5, replayed: 4, shredded: 1 });
    expect(m.failures).toEqual([]);
  });

  it('fails, names and damps trust for a record missing from the ledger', () => {
    const { corpus, ledger } = seeded(3);
    corpus.add(item('ghost'));
    const m = sweep1IntakeReplay(corpus, ledger);
    expect(m.failures).toEqual(['ghost: not in ledger']);
    expect(m.replayed + m.shredded).not.toBe(m.total);
    expect(corpus.byId().get('ghost')!.trust).toBeLessThan(0.9);
  });
});

describe('P7/S2 — HDC binding is scored by measured recall', () => {
  it('recalls every member of fan-in-capped bundles', () => {
    const { corpus } = seeded(30);
    const m = sweep2HdcBinding(corpus, { fanIn: 10 });
    expect(m.bundles).toBe(3);
    expect(m.recalled).toBe(m.probed);
    expect(m.abstained).toBe(0);
  });

  it('abstains rather than guessing when the fan-in is pushed past the ceiling', () => {
    const { corpus } = seeded(40);
    const m = sweep2HdcBinding(corpus, { fanIn: 40 });
    // One bundle: cleanup has no runner-up, so recall is trivially satisfied —
    // the metric must still report the true member count, not the bundle count.
    expect(m.members).toBe(40);
    expect(m.recalled + m.abstained).toBe(40);
  });

  it('reports an empty corpus as empty, never as a perfect score', () => {
    const m = sweep2HdcBinding(new Corpus());
    expect(m).toMatchObject({ members: 0, bundles: 0, probed: 0, recalled: 0 });
  });
});

describe('P7/S3 — bi-temporal stamping uses the injected clock only', () => {
  it('backfills validFrom, closes superseded records, and flags inversions', () => {
    const c = new Corpus();
    c.add(item('a', { validFrom: null, recordedAt: 42 }));
    c.add(item('b', { supersededBy: 'a' }));
    c.add(item('c', { validFrom: 900, validTo: 800 }));
    const m = sweep3TemporalStamping(c, 500);
    expect(m.backfilled).toBe(1);
    expect(c.byId().get('a')!.validFrom).toBe(42);
    expect(m.closed).toBe(1);
    expect(c.byId().get('b')!.validTo).toBe(500);
    expect(m.inverted).toEqual(['c']);
  });

  it('is idempotent: a second pass backfills and closes nothing', () => {
    const c = new Corpus();
    c.add(item('a', { validFrom: null }));
    c.add(item('b', { supersededBy: 'a' }));
    sweep3TemporalStamping(c, 500);
    expect(sweep3TemporalStamping(c, 777)).toMatchObject({ backfilled: 0, closed: 0 });
    expect(c.byId().get('b')!.validTo).toBe(500); // not re-stamped with the new clock
  });
});

describe('P7/S4 — contradictions resolve by trust × recency, ties escalate', () => {
  it('damps the weaker side and counts each pair once', () => {
    const c = new Corpus();
    c.add(item('a', { trust: 0.9, contradicts: ['b'] }));
    c.add(item('b', { trust: 0.4, contradicts: ['a'] }));
    const m = sweep4ContradictionPass(c);
    expect(m).toMatchObject({ pairs: 1, resolved: 1 });
    expect(m.escalated).toEqual([]);
    expect(c.byId().get('b')!.trust).toBeLessThan(0.4);
    expect(c.byId().get('a')!.trust).toBe(0.9);
  });

  it('escalates an exact tie instead of picking whichever came first', () => {
    const c = new Corpus();
    c.add(item('a', { trust: 0.5, contradicts: ['b'] }));
    c.add(item('b', { trust: 0.5, contradicts: ['a'] }));
    const m = sweep4ContradictionPass(c);
    expect(m.resolved).toBe(0);
    expect(m.escalated).toEqual([['a', 'b']]);
    expect(c.items.every((i) => i.trust === 0.5)).toBe(true);
  });

  it('breaks a trust tie by recency: a closed record is discounted by φ⁻¹', () => {
    const c = new Corpus();
    c.add(item('a', { trust: 0.5, contradicts: ['b'] }));
    c.add(item('b', { trust: 0.5, contradicts: ['a'], validTo: 200 }));
    const m = sweep4ContradictionPass(c);
    expect(m.resolved).toBe(1);
    expect(c.byId().get('b')!.trust).toBeLessThan(0.5);
  });

  it('reports dangling contradiction edges rather than ignoring them', () => {
    const c = new Corpus();
    c.add(item('a', { contradicts: ['nope'] }));
    expect(sweep4ContradictionPass(c).dangling).toEqual(['a→nope']);
  });
});

describe('P7/S5 — prototype consolidation', () => {
  it('merges near-duplicates, seals the prototype, and preserves lineage', () => {
    const ledger = newLedger();
    const c = new Corpus();
    const base = randomHv(DIM, 'base');
    const near = nudged(base, 0.05, 'near');
    expect(similarity(base, near)).toBeGreaterThanOrEqual(CONSOLIDATION_COS);
    c.add(item('a', { kind: 'FactChunk', vector: base }));
    c.add(item('b', { kind: 'FactChunk', vector: near }));
    c.add(item('c', { kind: 'FactChunk', vector: randomHv(DIM, 'far') }));

    const m = sweep5PrototypeConsolidation(c, ledger, { now: 500, attributedTo: 'test' });
    expect(m.merged).toBe(1);
    expect(m.survivors).toBe(2);
    const protoId = m.prototypeIds[0];
    expect(ledger.open(protoId)).toEqual({ members: ['a', 'b'] });
    expect(ledger.get(protoId)!.header.provenance.derivedFrom).toEqual(['a', 'b']);
    // Members are closed, not deleted — the lineage stays walkable.
    expect(c.byId().get('a')!.validTo).toBe(500);
    expect(c.byId().get('b')!.supersededBy).toBe(protoId);
  });

  it('is idempotent: a second pass merges nothing and leaves residual below threshold', () => {
    const ledger = newLedger();
    const c = new Corpus();
    const base = randomHv(DIM, 'base');
    c.add(item('a', { kind: 'FactChunk', vector: base }));
    c.add(item('b', { kind: 'FactChunk', vector: nudged(base, 0.05, 'n1') }));
    c.add(item('d', { kind: 'FactChunk', vector: nudged(base, 0.05, 'n2') }));
    sweep5PrototypeConsolidation(c, ledger, { now: 500, attributedTo: 'test' });
    const second = sweep5PrototypeConsolidation(c, ledger, { now: 600, attributedTo: 'test' });
    expect(second.merged).toBe(0);
    // Either nothing near-duplicate survived (null: statistic undefined for a
    // single survivor) or the survivors are genuinely below threshold.
    expect(second.residualCos === null || second.residualCos < CONSOLIDATION_COS).toBe(true);
  });

  it('leaves an orthogonal corpus completely untouched', () => {
    const ledger = newLedger();
    const { corpus } = seeded(0);
    for (let i = 0; i < 8; i++) corpus.add(item(`f${i}`, { kind: 'FactChunk' }));
    const m = sweep5PrototypeConsolidation(corpus, ledger, { now: 1, attributedTo: 't' });
    expect(m).toMatchObject({ merged: 0, survivors: 8 });
    expect(ledger.size).toBe(0);
  });
});

describe('P7/S6 — causal attribution abstains below the paired-sample floor', () => {
  it('speaks only for estimates with enough paired samples', () => {
    const m = sweep6CausalAttribution({
      strong: { theta: 0.42, se: 0.01, n: MIN_PAIRED },
      thin: { theta: 9.9, se: 0.01, n: MIN_PAIRED - 1 },
    });
    expect(m.spoke).toBe(1);
    expect(m.thetas).toEqual({ strong: 0.42 });
    expect(m.abstained).toEqual(['thin']);
    expect(m.malformed).toEqual([]);
  });

  it('flags malformed estimates instead of rounding them into the report', () => {
    const m = sweep6CausalAttribution({
      nan: { theta: NaN, se: 0.1, n: 100 },
      negSe: { theta: 1, se: -1, n: 100 },
    });
    expect(m.malformed.sort()).toEqual(['nan', 'negSe']);
    expect(m.spoke).toBe(0);
  });
});

describe('P7/S7 — cross-level re-scoring reports null, not zero, when unmeasured', () => {
  it('summarises measured resonance only', () => {
    const m = sweep7CrossLevelRescoring([
      {
        id: 'a',
        channels: [
          { id: 'x', value: 0.8 },
          { id: 'y', value: 0.5 },
        ],
      },
      { id: 'b', channels: [{ id: 'x', value: NaN }] },
    ]);
    expect(m.measured).toBe(1);
    expect(m.abstained).toBe(1);
    expect(m.rMean).toBeCloseTo(Math.sqrt(0.8 * 0.5), 12);
    expect(m.rMin).toBe(m.rMax);
  });

  it('returns null means for an empty or fully abstaining input', () => {
    expect(sweep7CrossLevelRescoring([]).rMean).toBeNull();
    const all = sweep7CrossLevelRescoring([{ id: 'a', channels: [{ id: 'x', value: NaN }] }]);
    expect(all.rMean).toBeNull();
    expect(all.rMax).toBeNull();
  });

  it('counts gated and dead items separately from plain abstention', () => {
    const gated = sweep7CrossLevelRescoring([
      { id: 'a', channels: [{ id: 'x', value: 0.9 }], coherence: 0.01 },
    ]);
    expect(gated.gated).toBe(1);
    expect(gated.rMean).toBeNull();
    const dead = sweep7CrossLevelRescoring([
      {
        id: 'b',
        channels: [
          { id: 'x', value: 0.9 },
          { id: 'y', value: 0 },
        ],
      },
    ]);
    expect(dead.dead).toBe(1);
    expect(dead.rMean).toBe(0);
  });
});

describe('P7/S8 — red team verifies the way an outside auditor would', () => {
  function forge(
    ledger: GenomeLedger,
    id: string,
    label: string,
    mutate: (h: any, s: string) => { header: any; sealed: string },
  ): Forgery {
    const rec = ledger.get(id)!;
    const m = mutate({ ...rec.header }, rec.sealed);
    return { label, header: m.header, sealed: m.sealed, leafIndex: rec.leafIndex };
  }

  it('accepts every genuine record and rejects every forgery', () => {
    const { corpus, ledger } = seeded(9);
    const rec = ledger.get('e3')!;
    const flipped = (() => {
      const s = rec.sealed;
      const i = s.length - 4;
      return s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
    })();

    const forgeries: Forgery[] = [
      forge(ledger, 'e3', 'body-swap', (h) => ({ header: h, sealed: ledger.get('e4')!.sealed })),
      forge(ledger, 'e3', 'relabelled-kind', (h, s) => ({
        header: { ...h, kind: 'Belief' },
        sealed: s,
      })),
      forge(ledger, 'e3', 're-dated', (h, s) => ({
        header: { ...h, recordedAt: h.recordedAt + 1 },
        sealed: s,
      })),
      forge(ledger, 'e3', 're-identified', (h, s) => ({ header: { ...h, id: 'e9' }, sealed: s })),
      forge(ledger, 'e3', 'ciphertext-bitflip', (h) => ({ header: h, sealed: flipped })),
      forge(ledger, 'e3', 'wrong-index', (h, s) => ({ header: h, sealed: s })),
    ];
    // The wrong-index forgery claims a different slot in the same log.
    const wrong = forgeries[5] as { -readonly [K in keyof Forgery]: Forgery[K] };
    wrong.leafIndex = 0;

    const m = sweep8RedTeam(corpus, ledger, forgeries, 1000);
    expect(m.genuine).toBe(9);
    expect(m.genuineVerified).toBe(9); // a verifier that rejects all proves nothing
    expect(m.attempted).toBe(6);
    expect(m.accepted).toEqual([]);
  });

  it('a genuine record replayed as its own "forgery" is correctly accepted', () => {
    // Control: proves the red team is not passing by rejecting unconditionally.
    const { corpus, ledger } = seeded(4);
    const rec = ledger.get('e1')!;
    const honest: Forgery = {
      label: 'honest',
      header: rec.header,
      sealed: rec.sealed,
      leafIndex: rec.leafIndex,
    };
    expect(sweep8RedTeam(corpus, ledger, [honest], 1).accepted).toEqual(['honest']);
    // …and the leaf it recomputes is exactly the ledger's leaf.
    expect(toHex(hashLeaf(leafBytes(rec.header, rec.sealed)))).toBe(rec.leafHex);
  });
});

describe('P7/S9 — compression emits a plan that actually reaches budget', () => {
  it('is a no-op under budget', () => {
    const { corpus } = seeded(4);
    const m = sweep9GovernorCompression(corpus, { atoms: 40 }, 100);
    expect(m.budget).toBe(100);
    expect(m.overBudget).toBe(false);
    expect(m.evictionPlan).toEqual([]);
    expect(m.projected).toBe(40);
  });

  it('evicts lowest trust first, oldest as the tiebreak, until under budget', () => {
    const c = new Corpus();
    c.add(item('keep', { trust: 0.99 }));
    c.add(item('old', { trust: 0.1, recordedAt: 1 }));
    c.add(item('new', { trust: 0.1, recordedAt: 9 }));
    c.add(item('mid', { trust: 0.5 }));
    const m = sweep9GovernorCompression(c, { atoms: 400 }, 250);
    expect(m.overBudget).toBe(true);
    expect(m.evictionPlan).toEqual(['old', 'new']);
    expect(m.projected).toBeLessThanOrEqual(m.budget!);
  });

  it('treats never-scored trust as the weakest, not the strongest', () => {
    const c = new Corpus();
    c.add(item('scored', { trust: 0.01 }));
    c.add(item('unscored', { trust: NaN }));
    const m = sweep9GovernorCompression(c, { atoms: 100 }, 50);
    expect(m.evictionPlan[0]).toBe('unscored');
  });
});

describe('P7/S10 — reflection', () => {
  it('names the failures instead of only counting them', () => {
    const reports = [
      { n: 1, name: 'a', metric: {}, ok: true, reason: null, sealId: 's1', leafIndex: 0 },
      {
        n: 4,
        name: 'contradiction_pass',
        metric: {},
        ok: false,
        reason: 'tie',
        sealId: 's4',
        leafIndex: 1,
      },
    ] as SweepReport[];
    const m = sweep10Reflection(reports, 7);
    expect(m).toMatchObject({ sweepsOk: 1, sweepsTotal: 2, ts: 7 });
    expect(m.failed).toEqual(['4:contradiction_pass']);
  });
});

describe('P7 — full protocol', () => {
  function scenario() {
    const { corpus, ledger } = seeded(12);
    const protocol = new TenSweepProtocol(ledger, 'test/sweeps');
    return { corpus, ledger, protocol };
  }

  it('runs ten sweeps, seals each one, and passes on a healthy corpus', () => {
    const { corpus, ledger, protocol } = scenario();
    const before = ledger.size;
    const res = protocol.run(corpus, {
      now: 1000,
      rescore: [{ id: 'e0', channels: [{ id: 'x', value: 0.7 }] }],
      usage: { atoms: 12 },
      budget: 1000,
    });
    expect(res.reports.length).toBe(10);
    expect(res.reports.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(res.ok).toBe(true);
    expect(res.sealedFrom).toBe(before);
    expect(ledger.size).toBe(before + 10);
    for (const r of res.reports) {
      const body = ledger.open(r.sealId) as { sweep: number; ok: boolean; metric: unknown };
      expect(body.sweep).toBe(r.n);
      expect(body.ok).toBe(true);
      expect(ledger.get(r.sealId)!.header.provenance.evidence).toBe('measured');
    }
    expect(ledger.audit(1000).ok).toBe(true);
  });

  it('seals a FAILING sweep as failed rather than dropping it', () => {
    const { corpus, ledger, protocol } = scenario();
    corpus.add(item('ghost')); // breaks sweep 1
    corpus.byId().get('e0')!.contradicts.push('nope'); // breaks sweep 4
    const res = protocol.run(corpus, { now: 2000 });
    expect(res.ok).toBe(false);
    const failed = res.reports.filter((r) => !r.ok).map((r) => r.n);
    expect(failed).toContain(1);
    expect(failed).toContain(4);
    expect(failed).toContain(10); // reflection inherits the failure
    for (const n of failed) {
      const r = res.reports.find((x) => x.n === n)!;
      expect(r.reason).toBeTruthy();
      expect((ledger.open(r.sealId) as { ok: boolean }).ok).toBe(false);
    }
    // Every sweep still ran and sealed: a failure never truncates the cycle.
    expect(res.reports.length).toBe(10);
  });

  it('rejects planted forgeries inside a live cycle', () => {
    const { corpus, ledger, protocol } = scenario();
    const rec = ledger.get('e5')!;
    const res = protocol.run(corpus, {
      now: 3000,
      forgeries: [
        {
          label: 'tampered',
          leafIndex: rec.leafIndex,
          header: { ...rec.header, kind: 'Belief' },
          sealed: rec.sealed,
        },
      ],
    });
    const s8 = res.reports.find((r) => r.n === 8)!;
    expect(s8.ok).toBe(true);
    expect(s8.metric).toMatchObject({ attempted: 1, accepted: [] });
  });

  it('is bit-deterministic: two replays of the same corpus seal identical bodies', () => {
    const digest = (): string[] => {
      const { corpus, ledger, protocol } = scenario();
      const res = protocol.run(corpus, {
        now: 4000,
        rescore: [{ id: 'e0', channels: [{ id: 'x', value: 0.61 }] }],
        effectEstimates: { d: { theta: 0.3, se: 0.05, n: 100 } },
        usage: { atoms: 12 },
        budget: 1000,
      });
      return res.reports.map((r) =>
        canonicalJson(ledger.open(r.sealId) as Record<string, unknown>),
      );
    };
    expect(digest()).toEqual(digest());
  });

  it('successive cycles use fresh seal ids and keep the ledger append-only', () => {
    const { corpus, ledger, protocol } = scenario();
    const oldSize = ledger.size;
    protocol.run(corpus, { now: 5000 });
    protocol.run(corpus, { now: 6000 });
    expect(ledger.size).toBe(oldSize + 20);
    expect(ledger.get('sweep:0:1')).not.toBeNull();
    expect(ledger.get('sweep:1:1')).not.toBeNull();
    expect(ledger.proveAppendOnly(oldSize).length).toBeGreaterThan(0);
    expect(ledger.audit(6000).ok).toBe(true);
  });

  it('consolidation inside a cycle stays idempotent across cycles', () => {
    const ledger = newLedger();
    const corpus = new Corpus();
    const base = randomHv(DIM, 'shared');
    for (const [id, frac] of [
      ['a', 0],
      ['b', 0.05],
      ['c', 0.05],
    ] as const) {
      ledger.append({ id, kind: 'FactChunk', body: { id }, recordedAt: 10, provenance: PROV });
      corpus.add(
        item(id, { kind: 'FactChunk', vector: frac === 0 ? base : nudged(base, frac, id) }),
      );
    }
    const protocol = new TenSweepProtocol(ledger);
    const first = protocol.run(corpus, { now: 100 });
    const second = protocol.run(corpus, { now: 200 });
    expect((first.reports[4].metric as { merged: number }).merged).toBeGreaterThan(0);
    expect((second.reports[4].metric as { merged: number }).merged).toBe(0);
    expect(second.reports[4].ok).toBe(true);
  });
});
