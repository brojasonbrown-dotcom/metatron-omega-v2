/**
 * Gate S3 — Fibonacci windows and per-rung environment binding.
 */
import { describe, expect, it } from 'vitest';
import {
  FIB_SPINE,
  buildWindow,
  enumerateWindows,
  isInertWindow,
  windowByTopNodes,
  windowWork,
} from '../src/core/window';
import { COHERENCE_DELAY, LAMBDA_MEMORY } from '../src/core/constants';
import { DENSE_CORE_COUNT } from '../src/core/scaleLadder';
import { isFibonacci } from '../src/core/fibonacci';

describe('S3 — window construction', () => {
  it('every window rung carries a Fibonacci node count, strictly increasing', () => {
    for (const w of enumerateWindows()) {
      expect(w.rungs.length).toBe(DENSE_CORE_COUNT);
      for (let i = 0; i < w.rungs.length; i++) {
        expect(isFibonacci(w.rungs[i].nodes)).toBe(true);
        if (i > 0) expect(w.rungs[i].nodes).toBeGreaterThan(w.rungs[i - 1].nodes);
      }
      expect(w.totalNodes).toBe(w.rungs.reduce((a, r) => a + r.nodes, 0));
    }
  });

  it('the spine admits exactly one full-length window and names it by its top rung', () => {
    const all = enumerateWindows();
    expect(all.length).toBe(FIB_SPINE.length - DENSE_CORE_COUNT + 1);
    expect(all[0].id).toBe(`OMEGA-${FIB_SPINE[DENSE_CORE_COUNT - 1]}`);
    expect(windowByTopNodes(610, 8)?.maxNodes).toBe(610);
    expect(windowByTopNodes(610, 18)).toBeUndefined();
    expect(windowByTopNodes(1000, 8)).toBeUndefined();
  });

  it('a window that would run off the spine throws instead of silently narrowing', () => {
    expect(() => buildWindow(FIB_SPINE.length - 2, { count: 8 })).toThrow();
    expect(() => buildWindow(-1)).toThrow();
    expect(() => buildWindow(0, { count: DENSE_CORE_COUNT + 1 })).toThrow();
  });

  it('the default window is inert — τ uniform, T = 0, B = 0', () => {
    const w = buildWindow(0);
    expect(isInertWindow(w)).toBe(true);
    for (const r of w.rungs) {
      expect(r.coherenceDelay).toBe(COHERENCE_DELAY);
      expect(r.lambda).toBe(LAMBDA_MEMORY);
      expect(r.magneticPhase).toBe(0);
      expect(r.qrf).toBeGreaterThan(0);
      expect(r.qrf).toBeLessThanOrEqual(1);
    }
  });
});

describe('S3 — environment binding', () => {
  it('a thermal window only ever shrinks the memory kernel', () => {
    const w = buildWindow(0, { baseTemperature: 0.5, temperatureRamp: 1.2 });
    expect(isInertWindow(w)).toBe(false);
    let prev = Infinity;
    for (const r of w.rungs) {
      expect(r.lambda).toBeLessThan(LAMBDA_MEMORY);
      expect(r.lambda).toBeLessThan(prev);
      prev = r.lambda;
    }
  });

  it('a magnetic window biases phase linearly and stays finite', () => {
    const w = buildWindow(0, { baseMagnetic: 0.25, magneticRamp: 1.1 });
    for (const r of w.rungs) {
      expect(Number.isFinite(r.magneticPhase)).toBe(true);
      expect(r.magneticPhase).toBeGreaterThan(0);
    }
  });

  it('a fibonacci coherence clock lengthens the ring with rank', () => {
    const w = buildWindow(0, { coherenceClock: 'fibonacci' });
    for (let i = 1; i < w.rungs.length; i++) {
      expect(w.rungs[i].coherenceDelay).toBeGreaterThanOrEqual(w.rungs[i - 1].coherenceDelay);
    }
    expect(w.rungs[w.rungs.length - 1].coherenceDelay).toBeGreaterThan(COHERENCE_DELAY);
  });

  it('window work matches the S1 cost-model unit', () => {
    const w = buildWindow(0, { count: 3 });
    expect(windowWork(w, 8, 2)).toBe(w.totalNodes * (2 * 8 + 12 + 2));
  });
});
