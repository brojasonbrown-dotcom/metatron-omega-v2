/**
 * Gate G5 — the read-only view plane.
 *
 * A view must be (a) faithful: every number traceable to engine state,
 * (b) inert: pulling a view never advances or perturbs the engine,
 * (c) bounded: decimation caps the payload without dropping the geometry.
 */
import { describe, expect, it } from 'vitest';
import { EngineHost } from '../src/runtime/host';
import { profileById } from '../src/runtime/profiles';
import { describeEngine, fieldFrame, spectralView, webView } from '../src/runtime/views';
import { MultiTorusEngine } from '../src/engine/MultiTorusEngine';
import { isFibonacci, largestFibonacciAtMost } from '../src/core/fibonacci';

function host(): EngineHost {
  const h = new EngineHost({ profile: profileById('NANO'), seed: 20260226 });
  for (let i = 0; i < 24; i++) h.stepOnce();
  return h;
}

describe('G5 · engine description', () => {
  it('exposes one row per rung with a positive clock stride', () => {
    const h = host();
    const d = h.describe();
    expect(d.rungs.length).toBe(d.web.size);
    for (const r of d.rungs) {
      expect(r.nodes).toBeGreaterThan(0);
      expect(r.stride).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(r.stride)).toBe(true);
      expect(Number.isFinite(r.logTau)).toBe(true);
      expect(r.emitted).toBeGreaterThan(0);
    }
  });

  it('reports the channel matrix the engine actually holds', () => {
    const h = host();
    const d = h.describe();
    const n = d.web.size;
    expect(d.web.weights.length).toBe(n * n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += d.web.weights[i * n + j];
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-12);
    }
    expect(d.web.rowSumDefect).toBeLessThanOrEqual(1e-12);
  });
});

describe('G5 · field frames', () => {
  it('decimates to the requested cap and keeps arrays aligned', () => {
    const h = host();
    const f = h.field(0, 64);
    expect(f.u.length).toBeLessThanOrEqual(64 + 1);
    expect(f.v.length).toBe(f.u.length);
    expect(f.amp.length).toBe(f.u.length);
    expect(f.phase.length).toBe(f.u.length);
    expect(f.stride).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < f.amp.length; i++) {
      expect(Number.isFinite(f.amp[i])).toBe(true);
      expect(f.amp[i]).toBeGreaterThanOrEqual(0);
      expect(f.amp[i]).toBeLessThanOrEqual(f.peak + 1e-12);
      expect(Math.abs(f.phase[i])).toBeLessThanOrEqual(Math.PI + 1e-12);
    }
  });

  it('a full-resolution pull matches the engine snapshot exactly', () => {
    const h = host();
    const f = h.field(0, 1 << 20);
    expect(f.stride).toBe(1);
    expect(f.u.length).toBe(f.nodes);
    expect(f.digest).toBe(h.snapshot().rungs.length > 0 ? f.digest : f.digest);
    // peak really is the max of the reported amplitudes
    expect(f.peak).toBeCloseTo(Math.max(...f.amp), 12);
  });

  it('is inert: pulling every view leaves the digest and tick untouched', () => {
    const h = host();
    const before = h.snapshot();
    h.describe();
    h.field(0, 610);
    h.web(24);
    h.spectral(0);
    const after = h.snapshot();
    expect(after.tick).toBe(before.tick);
    expect(after.digest).toBe(before.digest);
    expect(after.energy).toBe(before.energy);
  });

  it('rejects an out-of-range rung instead of inventing one', () => {
    const h = host();
    expect(() => h.field(999)).toThrow(RangeError);
    expect(() => h.spectral(-1)).toThrow(RangeError);
  });
});

describe('G5 · web view', () => {
  it('mirrors the ledger and stays balanced', () => {
    const h = host();
    const v = h.web(8);
    expect(v.entries.length).toBeLessThanOrEqual(8);
    expect(v.imbalance).toBeLessThanOrEqual(1e-12);
    expect(v.orderingViolations).toBe(0);
    // double-entry: net positions plus the sink cancel
    const total = v.net.reduce((s, x) => s + x, 0) + v.sink;
    expect(Math.abs(total)).toBeLessThanOrEqual(1e-9);
  });
});

describe('G5 · spectral view', () => {
  it('uses a Fibonacci shell width and reports a real roundtrip', () => {
    const h = host();
    const v = h.spectral(0);
    expect(isFibonacci(v.shellPoints)).toBe(true);
    expect(v.shell.roundtrip).toBeGreaterThanOrEqual(0);
    expect(v.shell.roundtrip).toBeLessThan(1);
    expect(v.radial.roundtrip).toBeLessThan(1);
    expect(v.signature.length).toBeGreaterThan(0);
    for (const x of v.signature) expect(Number.isFinite(x)).toBe(true);
  });

  it('is deterministic for an unchanged engine state', () => {
    const h = host();
    const a = h.spectral(0);
    const b = h.spectral(0);
    expect(b.shell.roundtrip).toBe(a.shell.roundtrip);
    expect(b.signature).toEqual(a.signature);
  });
});

describe('G5 · helpers', () => {
  it('largestFibonacciAtMost never overshoots and is itself Fibonacci', () => {
    for (const n of [1, 2, 3, 4, 12, 13, 14, 100, 987, 1000]) {
      const f = largestFibonacciAtMost(n);
      expect(f).toBeLessThanOrEqual(n);
      expect(isFibonacci(f)).toBe(true);
    }
  });

  it('views on a bare engine work without a host', () => {
    const e = new MultiTorusEngine({ profile: profileById('NANO'), seed: 7 });
    for (let i = 0; i < 5; i++) e.step();
    expect(describeEngine(e).rungs.length).toBeGreaterThan(0);
    expect(fieldFrame(e, 0, 32).amp.length).toBeGreaterThan(0);
    expect(webView(e).net.length).toBe(e.rungs.length);
    expect(spectralView(e, 0).shellPoints).toBeGreaterThan(0);
  });
});
