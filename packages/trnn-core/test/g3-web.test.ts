/**
 * Gate G3 — the web (Ω-P3).
 *
 * Every assertion below is a measurement of the running engine, not a restated
 * constant: row stochasticity, flux conservation, ordering discipline, octave
 * morphism defects, multi-rate clocks and web-level determinism.
 */

import { describe, expect, it } from 'vitest';
import { DENSE_CORE, LADDER } from '../src/core/scaleLadder';
import { createField } from '../src/core/complex';
import { buildCoupling, couplingWeight, emittedMass } from '../src/web/coupling';
import { octaveTransport } from '../src/web/octave';
import { FluxLedger, FLUX_SINK } from '../src/web/fluxLedger';
import { OrderingMonitor, fibonacciStrides } from '../src/web/ordering';
import { checkMorphism } from '../src/web/morphism';
import { MultiTorusEngine } from '../src/engine/MultiTorusEngine';
import { SingleTorusEngine } from '../src/engine/SingleTorusEngine';

describe('G3.1 coupling matrix', () => {
  const m = buildCoupling(DENSE_CORE);

  it('is square over the dense core', () => {
    expect(m.size).toBe(18);
    expect(m.w.length).toBe(18 * 18);
  });

  it('has row sums 1 to the last ulp', () => {
    expect(m.rowSumDefect).toBeLessThanOrEqual(4 * Number.EPSILON);
    for (let i = 0; i < m.size; i++) {
      let s = 0;
      for (let j = 0; j < m.size; j++) s += couplingWeight(m, i, j);
      expect(Math.abs(s - 1)).toBeLessThan(1e-15);
    }
  });

  it('is banded and non-negative', () => {
    for (let i = 0; i < m.size; i++) {
      for (let j = 0; j < m.size; j++) {
        const w = couplingWeight(m, i, j);
        expect(w).toBeGreaterThanOrEqual(0);
        if (Math.abs(i - j) > 3) expect(w).toBe(0);
      }
    }
  });

  it('decays with rank distance', () => {
    const i = 8;
    expect(couplingWeight(m, i, i - 1)).toBeGreaterThan(couplingWeight(m, i, i - 2));
    expect(couplingWeight(m, i, i - 2)).toBeGreaterThan(couplingWeight(m, i, i - 3));
  });

  it('emits finite positive mass from every rung', () => {
    for (let j = 0; j < m.size; j++) expect(emittedMass(m, j)).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const b = buildCoupling(DENSE_CORE);
    expect([...b.w]).toEqual([...m.w]);
  });
});

describe('G3.2 octave transport', () => {
  function ramp(n: number) {
    const f = createField(n);
    for (let i = 0; i < n; i++) {
      f.re[i] = Math.cos((2 * Math.PI * i) / n);
      f.im[i] = Math.sin((2 * Math.PI * i) / n);
    }
    return f;
  }

  it('is the identity at equal node counts', () => {
    const a = ramp(144);
    const b = createField(144);
    const r = octaveTransport(a, b);
    expect(r.identity).toBe(true);
    expect(r.energyRatio).toBe(1);
    expect([...b.re]).toEqual([...a.re]);
  });

  it('down- and up-samples without blowing up energy', () => {
    const a = ramp(233);
    const down = createField(89);
    const up = createField(377);
    const rd = octaveTransport(a, down);
    const ru = octaveTransport(a, up);
    expect(rd.energyRatio).toBeGreaterThan(0);
    expect(rd.energyRatio).toBeLessThan(2);
    expect(Math.abs(ru.energyRatio - 377 / 233)).toBeLessThan(0.05);
  });

  it('preserves a constant field exactly in both directions', () => {
    const a = createField(233);
    a.re.fill(0.25);
    a.im.fill(-0.5);
    for (const n of [89, 233, 610]) {
      const b = createField(n);
      octaveTransport(a, b);
      for (let i = 0; i < n; i++) {
        expect(Math.abs(b.re[i] - 0.25)).toBeLessThan(1e-15);
        expect(Math.abs(b.im[i] + 0.5)).toBeLessThan(1e-15);
      }
    }
  });
});

describe('G3.3 morphism laws', () => {
  it('commutes with a global phase and preserves the mean', () => {
    const z = createField(233);
    for (let i = 0; i < 233; i++) {
      z.re[i] = Math.cos(i * 0.37) * 0.4;
      z.im[i] = Math.sin(i * 0.11) * 0.4;
    }
    for (const n of [89, 233, 610]) {
      const r = checkMorphism(z, n);
      expect(r.phaseCommutationDefect).toBeLessThan(1e-14);
      expect(r.meanDefect).toBeLessThan(1e-2);
    }
  });
});

describe('G3.4 flux ledger', () => {
  it('is double-entry balanced and rejects negatives', () => {
    const l = new FluxLedger(16);
    l.post(0, 1, 2, 0.5);
    l.post(0, 2, 3, 0.25);
    l.postToSink(0, 3, 0.125);
    expect(Math.abs(l.imbalance())).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(l.netImbalance())).toBeLessThanOrEqual(1e-12);
    expect(l.net(1)).toBeCloseTo(-0.5, 15);
    expect(l.net(FLUX_SINK)).toBeCloseTo(0.125, 15);
    expect(() => l.post(0, 1, 2, -1)).toThrow();
  });

  it('respects its cap without corrupting the totals', () => {
    const l = new FluxLedger(8);
    for (let i = 0; i < 100; i++) l.post(i, 0, 1, 0.01);
    expect(l.size()).toBe(8);
    expect(Math.abs(l.imbalance())).toBeLessThanOrEqual(1e-12);
    expect(l.turnover()).toBeCloseTo(1, 12);
  });
});

describe('G3.5 ordering discipline', () => {
  it('flags read-after-write and out-of-order phases', () => {
    const o = new OrderingMonitor();
    o.beginTick(0);
    o.enterPhase('stage');
    o.read(0);
    expect(o.count()).toBe(0);
    o.enterPhase('update');
    o.write(0);
    o.read(0);
    expect(o.count()).toBe(1);
    o.enterPhase('stage');
    expect(o.count()).toBe(2);
  });

  it('builds Fibonacci strides capped at 13', () => {
    const u = fibonacciStrides(6, 'uniform');
    expect([...u]).toEqual([1, 1, 1, 1, 1, 1]);
    const f = fibonacciStrides(8, 'fibonacci');
    expect([...f]).toEqual([1, 1, 2, 3, 5, 8, 13, 13]);
  });
});

describe('G3.6 MultiTorusEngine', () => {
  it('runs the dense core with conserved flux and zero ordering violations', () => {
    const e = new MultiTorusEngine({ nodes: 144, seed: 'g3', coherenceDelay: 8 });
    expect(e.engines.length).toBe(18);
    const r = e.run(50);
    expect(r.finite).toBe(true);
    expect(Math.abs(r.fluxImbalance)).toBeLessThanOrEqual(1e-12);
    expect(r.orderingViolations).toBe(0);
    expect(r.rowSumDefect).toBeLessThanOrEqual(4 * Number.EPSILON);
    expect(r.fluxMoved).toBeGreaterThan(0);
    expect(r.rungs.every((x) => x && Number.isFinite(x.energy))).toBe(true);
  });

  it('stays bounded under the phi^4 clamp across mixed node counts', () => {
    const e = new MultiTorusEngine({
      rungs: LADDER.slice(0, 6),
      nodes: (_r, rank) => [89, 144, 233, 144, 89, 233][rank],
      seed: 'g3-mixed',
      coherenceDelay: 8,
    });
    const r = e.run(100);
    expect(r.finite).toBe(true);
    for (const x of r.rungs) expect(x.peak).toBeLessThanOrEqual(Math.pow((1 + Math.sqrt(5)) / 2, 4) + 1e-9);
    expect(Math.abs(r.fluxImbalance)).toBeLessThanOrEqual(1e-12);
  });

  it('is bit-reproducible from its seed', () => {
    const a = new MultiTorusEngine({ nodes: 144, seed: 'repro', coherenceDelay: 8 }).run(37);
    const b = new MultiTorusEngine({ nodes: 144, seed: 'repro', coherenceDelay: 8 }).run(37);
    expect(a.digest).toBe(b.digest);
    expect(a.coherence).toBe(b.coherence);
    const c = new MultiTorusEngine({ nodes: 144, seed: 'other', coherenceDelay: 8 }).run(37);
    expect(c.digest).not.toBe(a.digest);
  });

  it('honours multi-rate clocks', () => {
    const e = new MultiTorusEngine({ rungs: LADDER.slice(0, 5), nodes: 89, seed: 'clk', clock: 'fibonacci', coherenceDelay: 8 });
    const r0 = e.step();
    expect([...r0.stepped]).toEqual([0, 1, 2, 3, 4]);
    const r1 = e.step();
    expect([...r1.stepped]).toEqual([0, 1]);
    const r2 = e.step();
    expect([...r2.stepped]).toEqual([0, 1, 2]);
  });

  it('leaves the single-torus path untouched when no receipt is staged', () => {
    // zero-gated V term: a lone engine must reproduce its pre-web digest
    const a = new SingleTorusEngine({ nodes: 144, seed: 'solo', coherenceDelay: 8 });
    const b = new SingleTorusEngine({ nodes: 144, seed: 'solo', coherenceDelay: 8 });
    b.setWebReceipt(null);
    expect(a.run(20).digest).toBe(b.run(20).digest);
  });
});
