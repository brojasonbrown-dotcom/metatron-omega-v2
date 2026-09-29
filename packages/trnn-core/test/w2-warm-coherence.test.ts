/**
 * W2 — warm-coherence honesty.
 *
 * A rung whose coherence ring has not filled reports coherence 0. That is
 * "not measured yet", not a measurement, and it must never be averaged into
 * the reading a dashboard shows. These tests pin the distinction.
 */
import { describe, it, expect } from 'vitest';
import { MultiTorusEngine } from '../src/engine/MultiTorusEngine';
import { LADDER } from '../src/core/scaleLadder';
import { EngineHost } from '../src/runtime/host';

describe('W2 — warm vs cold coherence', () => {
  it('cold rungs are excluded from the warm mean and reported as not warm', () => {
    const web = new MultiTorusEngine({
      rungs: LADDER.slice(0, 4),
      nodes: 89,
      clock: 'fibonacci',
      seed: 'w2',
      coherenceDelay: 8,
    });
    const first = web.step();
    // Nothing can be warm on tick 1: every ring is still empty.
    expect(first.warmRungs).toBe(0);
    expect(Number.isNaN(first.coherenceWarm)).toBe(true);
    expect(first.rungs.every((r) => r.coherenceWarm === false)).toBe(true);

    const late = web.run(400);
    expect(late.warmRungsTotal).toBeGreaterThan(0);
    expect(Number.isFinite(late.coherenceWarm)).toBe(true);

    // The warm mean only ever averages warm rungs.
    const warm = late.stepped.filter((i) => late.rungs[i]?.coherenceWarm);
    if (warm.length > 0) {
      const mean = warm.reduce((s, i) => s + late.rungs[i].coherence, 0) / warm.length;
      expect(late.coherenceWarm).toBeCloseTo(mean, 12);
      expect(late.warmRungs).toBe(warm.length);
    }
  });

  it('the plain mean is never above the warm mean (cold zeros only drag down)', () => {
    const web = new MultiTorusEngine({
      rungs: LADDER.slice(0, 5),
      nodes: 89,
      clock: 'fibonacci',
      seed: 'w2b',
      coherenceDelay: 8,
    });
    const rep = web.run(200);
    if (Number.isFinite(rep.coherenceWarm)) {
      expect(rep.coherence).toBeLessThanOrEqual(rep.coherenceWarm + 1e-12);
    }
  });

  it('the host snapshot carries warm state per rung and in aggregate', () => {
    const host = new EngineHost({ profile: 'PICO', seed: 'w2c' });
    const cold = host.snapshot();
    expect(Number.isNaN(cold.coherenceWarm)).toBe(true);
    expect(cold.warmRungs).toBe(0);
    expect(cold.rungs.every((r) => r.warm === false)).toBe(true);

    host.start();
    let now = 0;
    for (let i = 0; i < 400; i++) {
      now += 16;
      host.pump(now, 16);
    }
    host.stop();
    const snap = host.snapshot();
    expect(snap.rungs.length).toBeGreaterThan(0);
    expect(snap.warmRungs).toBe(snap.rungs.filter((r) => r.warm).length);
    for (const r of snap.rungs) {
      if (!r.warm) expect(r.coherence).toBe(0);
    }
  });
});
