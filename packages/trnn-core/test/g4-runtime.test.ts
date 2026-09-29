/**
 * Gate G4 — runtime + governor.
 *
 * Everything here is measured or structural: profile cost monotonicity,
 * governor headroom arithmetic, host determinism (same profile+seed ⇒ same
 * digest chain), exact rollback, ledger divergence localisation, and the
 * adaptive bus staying inside [8, 64] Hz.
 */

import { describe, expect, it } from 'vitest';
import {
  EngineHost,
  MAX_HZ,
  MIN_HZ,
  PROFILES_BY_TIER,
  RunLedger,
  benchmarkThroughput,
  evaluateProfile,
  nodesForRank,
  profileById,
  profileCost,
  profileNodes,
  selectProfile,
  verifyFootprint,
  type HardwareProbe,
} from '../src/index';
import { NODE_LADDER } from '../src/runtime/profiles';

function probeWith(rate: number, memory: number | null): HardwareProbe {
  return {
    cores: 8,
    coresSource: 'navigator',
    memoryBudget: memory,
    memorySource: memory === null ? 'unavailable' : 'deviceMemory',
    webgpu: {
      available: false,
      vendor: null,
      architecture: null,
      maxBufferSize: null,
      maxComputeWorkgroupSizeX: null,
      maxStorageBufferBindingSize: null,
    },
    throughput: { nodeTicksPerSecond: rate, ticks: 1, elapsedMs: 1, jitter: 0 },
    userAgent: null,
    probedAt: 0,
  };
}

describe('G4.1 profiles', () => {
  it('every node count is Fibonacci', () => {
    for (const p of PROFILES_BY_TIER) {
      for (const n of profileNodes(p)) {
        expect(NODE_LADDER as readonly number[]).toContain(n);
      }
    }
  });

  it('node counts are non-decreasing across ranks', () => {
    for (const p of PROFILES_BY_TIER) {
      const ns = profileNodes(p);
      for (let i = 1; i < ns.length; i++) expect(ns[i]).toBeGreaterThanOrEqual(ns[i - 1]);
    }
  });

  it('cost is strictly monotone in tier', () => {
    for (let i = 1; i < PROFILES_BY_TIER.length; i++) {
      const a = profileCost(PROFILES_BY_TIER[i - 1]);
      const b = profileCost(PROFILES_BY_TIER[i]);
      expect(b.nodeTicks).toBeGreaterThan(a.nodeTicks);
      expect(b.bytes).toBeGreaterThan(a.bytes);
    }
  });

  it('nodesForRank is deterministic and clamped to the profile width', () => {
    const p = profileById('MESO');
    expect(nodesForRank(p, 999)).toBe(nodesForRank(p, p.rungs - 1));
    expect(nodesForRank(p, 0)).toBe(p.baseNodes);
  });
});

describe('G4.2 governor', () => {
  it('picks PICO on a starved machine and never reports it as fitting', () => {
    const v = selectProfile(probeWith(1e3, 64 * 1024 * 1024), { targetHz: 64 });
    expect(v.selected.id).toBe('PICO');
    expect(v.degraded).toBe(true);
  });

  it('climbs to GRAND on an unconstrained machine', () => {
    const v = selectProfile(probeWith(1e12, 64 * 1024 ** 3), { targetHz: 64 });
    expect(v.selected.id).toBe('GRAND');
    expect(v.degraded).toBe(false);
  });

  it('honours the 75% headroom exactly', () => {
    const p = profileById('MICRO');
    const cost = profileCost(p);
    const hz = 32;
    // rate that puts this profile exactly at the budget edge
    const rate = (cost.nodeTicks * hz) / 0.75;
    const vd = evaluateProfile(p, probeWith(rate, null), hz, 0.75);
    expect(vd.computeLoad).toBeCloseTo(1, 12);
    expect(vd.fits).toBe(true);
    const tight = evaluateProfile(p, probeWith(rate * 0.99, null), hz, 0.75);
    expect(tight.fits).toBe(false);
    expect(tight.reason).toBe('compute');
  });

  it('reports memory as unconstrained when the platform hides it', () => {
    const v = selectProfile(probeWith(1e12, null), { targetHz: 64 });
    expect(v.memoryConstrained).toBe(false);
    for (const row of v.table) expect(row.memoryLoad).toBeNull();
  });

  it('respects an operator ceiling', () => {
    const v = selectProfile(probeWith(1e12, 64 * 1024 ** 3), { maxProfile: 'NANO' });
    expect(v.selected.id).toBe('NANO');
  });

  it('maxHz is the rate the budget actually sustains', () => {
    const p = profileById('NANO');
    const cost = profileCost(p);
    const v = selectProfile(probeWith(cost.nodeTicks * 40, null), {
      targetHz: 8,
      maxProfile: 'NANO',
    });
    expect(v.maxHz).toBeCloseTo(40 * 0.75, 9);
  });

  it('footprint verification reports the ratio without asserting', () => {
    const p = profileById('PICO');
    const c = verifyFootprint(p, profileCost(p).bytes);
    expect(c.ratio).toBeCloseTo(1, 12);
  });
});

describe('G4.3 hardware probe', () => {
  it('benchmarks the real engine and returns a positive rate', () => {
    const t = benchmarkThroughput({ nodes: 89, ticks: 8, repeats: 2 });
    expect(t.nodeTicksPerSecond).toBeGreaterThan(0);
    expect(Number.isFinite(t.nodeTicksPerSecond)).toBe(true);
    expect(t.jitter).toBeGreaterThanOrEqual(0);
  });
});

describe('G4.4 host', () => {
  it('same profile + seed reproduces the digest chain bit-for-bit', () => {
    const a = new EngineHost({ profile: 'PICO', seed: 'g4' });
    const b = new EngineHost({ profile: 'PICO', seed: 'g4' });
    for (let i = 0; i < 40; i++) {
      expect(a.stepOnce().digest).toBe(b.stepOnce().digest);
    }
    expect(a.snapshot().digest).toBe(b.snapshot().digest);
  });

  it('a different seed diverges, and the ledger localises the tick', () => {
    const a = new EngineHost({ profile: 'PICO', seed: 'g4', ledgerStride: 1 });
    const b = new EngineHost({ profile: 'PICO', seed: 'g4-other', ledgerStride: 1 });
    for (let i = 0; i < 20; i++) {
      a.stepOnce();
      b.stepOnce();
    }
    const d = RunLedger.compare(a.ledger, b.ledger);
    expect(d.diverged).toBe(true);
    expect(d.tick).toBe(0);
  });

  it('rollback is exact', () => {
    const h = new EngineHost({ profile: 'PICO', seed: 'g4-rollback' });
    for (let i = 0; i < 20; i++) h.stepOnce();
    const cp = h.checkpoint();
    const after = [h.stepOnce().digest, h.stepOnce().digest, h.stepOnce().digest];
    h.restore(cp);
    expect([h.stepOnce().digest, h.stepOnce().digest, h.stepOnce().digest]).toEqual(after);
  });

  it('stays finite, conserves flux and never violates ordering', () => {
    const h = new EngineHost({ profile: 'NANO', seed: 'g4-soak' });
    let rep = h.stepOnce();
    for (let i = 0; i < 200; i++) rep = h.stepOnce();
    expect(rep.finite).toBe(true);
    expect(Math.abs(rep.fluxImbalance)).toBeLessThan(1e-9);
    expect(rep.orderingViolations).toBe(0);
    expect(rep.rowSumDefect).toBeLessThan(1e-15);
  });

  it('the adaptive bus stays inside [8, 64] Hz under an impossible budget', () => {
    const h = new EngineHost({ profile: 'PICO', seed: 'g4-bus', sliceBudgetMs: 0.01 });
    h.start();
    let t = 0;
    for (let i = 0; i < 30; i++) {
      t += 1000;
      h.pump(t, 1000);
      const s = h.snapshot();
      expect(s.busHz).toBeGreaterThanOrEqual(MIN_HZ);
      expect(s.busHz).toBeLessThanOrEqual(MAX_HZ);
    }
    expect(h.overrunCount()).toBeGreaterThan(0);
  });

  it('a stopped host does no work', () => {
    const h = new EngineHost({ profile: 'PICO', seed: 'g4-stop' });
    expect(h.pump(0, 16)).toBe(0);
    h.start();
    expect(h.pump(16, 16)).toBeGreaterThan(0);
    h.stop();
    const before = h.snapshot().tick;
    h.pump(32, 16);
    expect(h.snapshot().tick).toBe(before);
  });

  it('snapshot reports one row per rung with real node counts', () => {
    const h = new EngineHost({ profile: 'MICRO', seed: 'g4-shape' });
    h.stepOnce();
    const s = h.snapshot();
    expect(s.rungs.length).toBe(profileById('MICRO').rungs);
    expect(s.nodes).toEqual(profileNodes(profileById('MICRO')));
    expect(s.totalNodes).toBe(profileCost(profileById('MICRO')).nodes);
  });
});
