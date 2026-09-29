/**
 * Gate G8 — learning tiers.
 *
 * The gate does NOT assert "the learnable cell is better". It asserts:
 *   • every parametrization is admissible for every real raw value,
 *   • the contraction certificate survives all of parameter space,
 *   • gate = 0 is bit-exact identity with the certified cell,
 *   • the verdict is honest: enabled ⟺ held-out margin ≥ φ⁻².
 */

import { describe, expect, it } from 'vitest';
import {
  BoundedEigenvalue,
  InputGain,
  SimplexGain,
  algSigmoid,
  algSigmoidPrime,
  rawVector,
  setRawVector,
} from '../src/learn/params';
import { LEARN_BUDGET, LearnableCell, DRIVE_SLOTS } from '../src/learn/cell';
import { SHIP_MARGIN, runBattery, sampleTrajectory } from '../src/learn/battery';
import { probeTier1, probeTier2, probeTier3, probeTiers, tier0 } from '../src/learn/tiers';
import { cellStep } from '../src/cell/update';
import { createField } from '../src/core/complex';
import { JURY_GAIN, phiPow } from '../src/core/constants';
import { SeedStream } from '../src/core/determinism';

const EXTREMES = [
  0,
  1,
  -1,
  1e-300,
  -1e-300,
  1e8,
  -1e8,
  1e300,
  -1e300,
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
];

describe('G8 — constrained parametrizations', () => {
  it('algebraic sigmoid stays in (-1,1) and is finite everywhere', () => {
    for (const x of [...EXTREMES, Infinity, -Infinity]) {
      const s = algSigmoid(x);
      expect(Math.abs(s)).toBeLessThanOrEqual(1);
      expect(Number.isNaN(s)).toBe(false);
    }
    expect(algSigmoidPrime(0)).toBe(1);
  });

  it('SimplexGain sums to its total and stays non-negative for extreme raws', () => {
    const g = new SimplexGain(5, LEARN_BUDGET);
    const s = new SeedStream('simplex-fuzz');
    for (let trial = 0; trial < 200; trial++) {
      for (let i = 0; i < 5; i++) {
        g.raw[i] = trial < EXTREMES.length ? EXTREMES[trial] : (s.next() - 0.5) * 1e6;
      }
      const v = g.values();
      let sum = 0;
      for (let i = 0; i < 5; i++) {
        expect(v[i]).toBeGreaterThanOrEqual(0);
        sum += v[i];
      }
      expect(Math.abs(sum - LEARN_BUDGET)).toBeLessThan(1e-15);
      expect(g.certificate().holds).toBe(true);
    }
  });

  it('SimplexGain at equal raws is the uniform point', () => {
    const g = new SimplexGain(5, 1);
    const v = g.values();
    for (let i = 0; i < 5; i++) expect(v[i]).toBeCloseTo(0.2, 15);
  });

  it('InputGain and BoundedEigenvalue never leave their sets', () => {
    const gain = new InputGain(phiPow(-1));
    const lam = new BoundedEigenvalue(0.9);
    for (const x of EXTREMES) {
      gain.raw[0] = x;
      lam.raw[0] = x;
      expect(Math.abs(gain.value())).toBeLessThanOrEqual(phiPow(-1));
      expect(Math.abs(lam.lambda())).toBeLessThan(1);
      expect(gain.certificate().holds).toBe(true);
      expect(lam.certificate().holds).toBe(true);
    }
    expect(() => new BoundedEigenvalue(1)).toThrow();
    expect(() => new BoundedEigenvalue(0)).toThrow();
  });

  it('raw vector round-trips through a parameter set', () => {
    const cell = new LearnableCell({ gate: 1 });
    const v = rawVector(cell.params());
    for (let i = 0; i < v.length; i++) v[i] = i + 0.5;
    setRawVector(cell.params(), v);
    expect(Array.from(rawVector(cell.params()))).toEqual(Array.from(v));
  });
});

describe('G8 — learnable cell certificate', () => {
  it('certified gain < 1 at full gate for every parameter value', () => {
    const cell = new LearnableCell({ gate: 1 });
    const s = new SeedStream('gain-fuzz');
    for (let trial = 0; trial < 500; trial++) {
      const v = rawVector(cell.params());
      for (let i = 0; i < v.length; i++) v[i] = (s.next() - 0.5) * 1e9;
      setRawVector(cell.params(), v);
      expect(cell.certifiedGain()).toBeLessThan(1);
      for (const c of cell.certificates()) expect(c.holds).toBe(true);
    }
    expect(cell.certifiedGain()).toBeCloseTo(JURY_GAIN + 3 * LEARN_BUDGET, 15);
  });

  it('gate 0 is bit-exact identity with the certified cell', () => {
    const n = 89;
    const z = createField(n);
    const G = createField(n);
    const P = createField(n);
    const s = new SeedStream('identity');
    for (let i = 0; i < n; i++) {
      z.re[i] = s.next() - 0.5;
      z.im[i] = s.next() - 0.5;
      G.re[i] = s.next() - 0.5;
      G.im[i] = s.next() - 0.5;
      P.re[i] = s.next() - 0.5;
      P.im[i] = s.next() - 0.5;
    }
    const a = createField(n);
    const b = createField(n);
    const ref = cellStep(z, a, { G, P });
    const cell = new LearnableCell({ gate: 0, lambdaRaw: 7 });
    const got = cell.step(z, b, { G, P });
    for (let i = 0; i < n; i++) {
      expect(b.re[i]).toBe(a.re[i]);
      expect(b.im[i]).toBe(a.im[i]);
    }
    expect(got.delta).toBe(ref.delta);
    expect(got.peak).toBe(ref.peak);
  });

  it('an open gate actually changes the step (the term is wired, not decorative)', () => {
    const n = 55;
    const z = createField(n);
    const G = createField(n);
    for (let i = 0; i < n; i++) {
      z.re[i] = Math.cos(i);
      G.re[i] = Math.sin(i);
    }
    const a = createField(n);
    const b = createField(n);
    new LearnableCell({ gate: 0 }).step(z, a, { G });
    new LearnableCell({ gate: 1, lambdaRaw: 2 }).step(z, b, { G });
    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs(b.re[i] - a.re[i]);
    expect(diff).toBeGreaterThan(0);
    expect(DRIVE_SLOTS.length).toBe(5);
  });

  it('gate is clamped to [0,1] and rejects non-finite input', () => {
    const cell = new LearnableCell();
    cell.setGate(5);
    expect(cell.gate).toBe(1);
    cell.setGate(-3);
    expect(cell.gate).toBe(0);
    cell.setGate(NaN);
    expect(cell.gate).toBe(0);
  });
});

describe('G8 — held-out battery', () => {
  const traj = sampleTrajectory({ nodes: 55, trainTicks: 120, holdTicks: 60, warmup: 89 });
  const { cell, report } = runBattery(traj, { iterations: 40, seed: 'g8' });

  it('the trajectory split is strictly temporal and non-degenerate', () => {
    expect(traj.frames.length).toBe(traj.trainPairs + traj.holdPairs + 1);
    expect(traj.ticks[1] - traj.ticks[0]).toBe(1);
    expect(report.baselineHold).toBeGreaterThan(0);
  });

  it('training never worsens the training loss below the recorded best', () => {
    expect(report.learnedTrain).toBeLessThanOrEqual(report.baselineTrain + 1e-12);
  });

  it('the verdict is enforced, not advisory', () => {
    expect(report.required).toBeCloseTo(SHIP_MARGIN, 15);
    expect(report.enabled).toBe(report.margin >= SHIP_MARGIN);
    if (!report.enabled) {
      expect(cell.gate).toBe(0);
      expect(report.verdict.startsWith('KILL')).toBe(true);
    } else {
      expect(cell.gate).toBeGreaterThan(0);
      expect(report.verdict.startsWith('SHIP')).toBe(true);
    }
    expect(report.certifiedGain).toBeLessThan(1);
  });

  it('the battery is deterministic — same seed, same numbers', () => {
    const again = runBattery(traj, { iterations: 40, seed: 'g8' });
    expect(again.report.learnedHold).toBe(report.learnedHold);
    expect(again.report.margin).toBe(report.margin);
  });
});

describe('G8 — tiers', () => {
  it('T0 is always available', () => {
    expect(tier0().available).toBe(true);
  });

  it('T1 reports honestly when there is no adapter and when limits are short', async () => {
    expect((await probeTier1({ navigatorRef: {} })).available).toBe(false);
    const weak = await probeTier1({
      navigatorRef: {
        gpu: {
          requestAdapter: async () => ({
            limits: { maxStorageBufferBindingSize: 1024, maxComputeWorkgroupSizeX: 4 },
          }),
        },
      },
    });
    expect(weak.available).toBe(false);
    const strong = await probeTier1({
      navigatorRef: {
        gpu: {
          requestAdapter: async () => ({
            limits: { maxStorageBufferBindingSize: 1 << 28, maxComputeWorkgroupSizeX: 256 },
            info: { vendor: 'test', architecture: 'sim' },
          }),
        },
      },
    });
    expect(strong.available).toBe(true);
    expect(strong.evidence?.['vendor']).toBe('test');
  });

  it('T2 and T3 are unavailable without a configured endpoint, available on a live answer', async () => {
    expect((await probeTier2({})).available).toBe(false);
    expect((await probeTier3({})).available).toBe(false);
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ engine: 'trnn', version: '1' }),
    });
    expect((await probeTier2({ sidecarUrl: 'http://127.0.0.1:8765', fetchImpl })).available).toBe(
      true,
    );
    expect((await probeTier3({ hostedUrl: '/api/x', fetchImpl })).available).toBe(true);
  });

  it('tier selection falls back to T0 and never invents a tier', async () => {
    const map = await probeTiers({ navigatorRef: {} });
    expect(map.selected).toBe('T0');
    expect(map.tiers.map((t) => t.id)).toEqual(['T0', 'T1', 'T2', 'T3']);
    const hosted = await probeTiers({
      navigatorRef: {},
      hostedUrl: '/api/x',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ version: '1' }) }),
    });
    expect(hosted.selected).toBe('T3');
  });
});
