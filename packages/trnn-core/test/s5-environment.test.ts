/**
 * S5 — environment binding gate.
 *
 * The window's τ/T/B must reach the cell, and must be *inert by default*:
 * an inert window has to reproduce the un-windowed digest bit-for-bit, or the
 * binding is a regression rather than a feature.
 */

import { describe, expect, it } from 'vitest';
import { SingleTorusEngine } from '../src/engine/SingleTorusEngine';
import { MultiTorusEngine } from '../src/engine/MultiTorusEngine';
import { buildWindow, isInertWindow } from '../src/core/window';
import { COHERENCE_DELAY, LAMBDA_MEMORY, thermalLambda } from '../src/core/constants';

const TICKS = 233;

function run(engine: MultiTorusEngine, ticks = TICKS) {
  return engine.run(ticks);
}

describe('S5 — window environment binding', () => {
  it('defaults are exactly the frozen kernel', () => {
    const e = new SingleTorusEngine({ nodes: 89, seed: 's5' });
    expect(e.lambda).toBe(LAMBDA_MEMORY);
    expect(e.modePhase).toBe(0);
  });

  it('refuses a λ above the frozen kernel (temperature may only shrink it)', () => {
    expect(() => new SingleTorusEngine({ nodes: 89, lambda: LAMBDA_MEMORY * 1.0000001 })).toThrow(/lambda/);
    expect(() => new SingleTorusEngine({ nodes: 89, lambda: 0 })).toThrow(/lambda/);
    expect(() => new SingleTorusEngine({ nodes: 89, modePhase: Number.NaN })).toThrow(/modePhase/);
  });

  it('an inert single rung is bit-identical to the unbound engine', () => {
    const a = new SingleTorusEngine({ nodes: 89, seed: 's5' });
    const b = new SingleTorusEngine({ nodes: 89, seed: 's5', lambda: LAMBDA_MEMORY, modePhase: 0 });
    a.run(TICKS);
    b.run(TICKS);
    expect(b.digest()).toBe(a.digest());
  });

  it('an inert window reproduces the un-windowed web digest', () => {
    const w = buildWindow(0, { count: 6 });
    expect(isInertWindow(w)).toBe(true);
    for (const r of w.rungs) {
      expect(r.lambda).toBe(LAMBDA_MEMORY);
      expect(r.magneticPhase).toBe(0);
      expect(r.coherenceDelay).toBe(COHERENCE_DELAY);
    }

    const bound = new MultiTorusEngine({
      rungs: w.rungs.map((r) => r.rung),
      window: w,
      seed: 's5-web',
      modes: 13,
    });
    const plain = new MultiTorusEngine({
      rungs: w.rungs.map((r) => r.rung),
      nodes: (_r, rank) => w.rungs[rank].nodes,
      seed: 's5-web',
      modes: 13,
    });

    const a = run(bound);
    const b = run(plain);
    expect(a.digest).toBe(b.digest);
    expect(a.fluxImbalance).toBe(0);
    expect(a.orderingViolations).toBe(0);
    expect(a.finite).toBe(true);
  });

  it('the window owns node counts and τ — conflicting options are refused', () => {
    const w = buildWindow(0, { count: 4 });
    const rungs = w.rungs.map((r) => r.rung);
    expect(() => new MultiTorusEngine({ rungs, window: w, nodes: 89 })).toThrow(/nodes/);
    expect(() => new MultiTorusEngine({ rungs, window: w, coherenceDelay: 8 })).toThrow(/τ/);
  });

  it('temperature shrinks λ on every rung and the run stays finite', () => {
    const w = buildWindow(0, { count: 6, baseTemperature: 0.25, temperatureRamp: 1.3 });
    expect(isInertWindow(w)).toBe(false);
    for (const r of w.rungs) {
      expect(r.lambda).toBeLessThan(LAMBDA_MEMORY);
      expect(r.lambda).toBeGreaterThan(0);
      expect(r.lambda).toBe(thermalLambda(r.temperature));
    }
    const e = new MultiTorusEngine({ rungs: w.rungs.map((r) => r.rung), window: w, seed: 's5-T', modes: 13 });
    e.engines.forEach((eng, i) => expect(eng.lambda).toBe(w.rungs[i].lambda));
    const rep = run(e);
    expect(rep.finite).toBe(true);
    expect(rep.fluxImbalance).toBe(0);
    for (const r of rep.rungs) expect(Number.isFinite(r.energy)).toBe(true);
  });

  it('magnetic bias rotates the modal phase without breaking the run', () => {
    const w = buildWindow(0, { count: 6, baseMagnetic: 0.15, magneticRamp: 1.1 });
    for (const r of w.rungs) expect(r.magneticPhase).not.toBe(0);
    const biased = new MultiTorusEngine({ rungs: w.rungs.map((r) => r.rung), window: w, seed: 's5-B', modes: 13 });
    const inert = new MultiTorusEngine({
      rungs: w.rungs.map((r) => r.rung),
      window: buildWindow(0, { count: 6 }),
      seed: 's5-B',
      modes: 13,
    });
    const a = run(biased);
    const b = run(inert);
    expect(a.digest).not.toBe(b.digest);
    expect(a.finite).toBe(true);
    expect(a.orderingViolations).toBe(0);
  });

  it('the fibonacci clock reaches each rung\u2019s coherence meter', () => {
    const w = buildWindow(0, { count: 6, coherenceClock: 'fibonacci' });
    const delays = w.rungs.map((r) => r.coherenceDelay);
    expect(new Set(delays).size).toBeGreaterThan(1);
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    const e = new MultiTorusEngine({ rungs: w.rungs.map((r) => r.rung), window: w, seed: 's5-tau', modes: 13 });
    expect(run(e).finite).toBe(true);
  });
});
