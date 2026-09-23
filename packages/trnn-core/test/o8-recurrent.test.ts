/**
 * Ω-SCALE P3 — recurrent cell and Fourier continuation.
 *
 * These tests check the two properties that decide whether the modules may be
 * enabled at all: the cell must be provably bounded and contracting, and the
 * continuation must actually reduce spectral leakage rather than merely claim
 * to. Both are measured, not asserted.
 */
import { describe, it, expect } from 'vitest';
import {
  RecurrentModeCell,
  rollRecurrent,
  DEFAULT_DECAY,
  fourierContinuation,
  truncateContinuation,
  highFrequencyFraction,
  assessContinuation,
  extensionLength,
} from '../src/operator';

describe('Ω-SCALE P3 · recurrent mode cell', () => {
  it('r1 · state stays bounded under an adversarial unbounded drive', () => {
    const cell = new RecurrentModeCell({ modes: 8, decay: DEFAULT_DECAY });
    let worst = 0;
    for (let t = 0; t < 5000; t++) {
      const x = new Float64Array(8);
      // Alternating huge drive — the classic way to blow up an ungated filter.
      for (let k = 0; k < 8; k++) x[k] = (t % 2 === 0 ? 1 : -1) * 1e6 * (k + 1);
      const h = cell.step(x);
      for (const v of h) worst = Math.max(worst, Math.abs(v));
    }
    expect(Number.isFinite(worst)).toBe(true);
    expect(worst).toBeLessThanOrEqual(1 + 1e-12);
  });

  it('r2 · certificate reports a strict contraction and finite bound', () => {
    const cell = new RecurrentModeCell({ modes: 13 });
    const cert = cell.certify();
    expect(cert.stable).toBe(true);
    expect(cert.contraction).toBeLessThan(1);
    expect(cert.stateBound).toBe(1);
    expect(cert.tauSlow).toBeGreaterThan(cert.tauFast);
  });

  it('r3 · low modes retain longer than high modes', () => {
    const cell = new RecurrentModeCell({ modes: 8, decay: 1 });
    // Charge every mode with the same constant drive.
    for (let t = 0; t < 200; t++) cell.step(new Float64Array(8).fill(0.8));
    const charged = Float64Array.from(cell.state);
    // Then cut the drive and let it relax for a few frames.
    for (let t = 0; t < 5; t++) cell.step(new Float64Array(8));
    const relaxed = cell.state;
    const retainLow = Math.abs(relaxed[0]) / Math.abs(charged[0]);
    const retainHigh = Math.abs(relaxed[7]) / Math.abs(charged[7]);
    expect(retainLow).toBeGreaterThan(retainHigh);
  });

  it('r4 · a gap (NaN) leaves that mode untouched instead of zeroing it', () => {
    const cell = new RecurrentModeCell({ modes: 4 });
    for (let t = 0; t < 50; t++) cell.step([0.5, 0.5, 0.5, 0.5]);
    const before = Float64Array.from(cell.state);
    cell.step([NaN, NaN, NaN, NaN]);
    expect(Array.from(cell.state)).toEqual(Array.from(before));
  });

  it('r5 · deterministic: identical sequences give identical states', () => {
    const seq = Array.from({ length: 100 }, (_, t) =>
      Float64Array.from({ length: 6 }, (_, k) => Math.sin(0.1 * t + k)),
    );
    const a = rollRecurrent(seq, { modes: 6 });
    const b = rollRecurrent(seq, { modes: 6 });
    expect(a.map((v) => Array.from(v))).toEqual(b.map((v) => Array.from(v)));
  });

  it('r6 · rejects a width mismatch instead of silently truncating', () => {
    const cell = new RecurrentModeCell({ modes: 5 });
    expect(() => cell.step([1, 2, 3])).toThrow(RangeError);
  });

  it('r7 · reset returns the cell to its initial state exactly', () => {
    const cell = new RecurrentModeCell({ modes: 5 });
    for (let t = 0; t < 30; t++) cell.step(new Float64Array(5).fill(0.4));
    cell.reset();
    expect(cell.frames).toBe(0);
    expect(Array.from(cell.state)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('Ω-SCALE P3 · Fourier continuation', () => {
  /** A deliberately non-periodic window: a linear ramp plus a smooth tone. */
  const ramp = (n: number) =>
    Float64Array.from({ length: n }, (_, i) => i / n + 0.1 * Math.sin((2 * Math.PI * 3 * i) / n));

  it('c1 · leaves the original samples bit-identical', () => {
    const x = ramp(233);
    const r = fourierContinuation(x);
    const back = truncateContinuation(r);
    expect(Array.from(back)).toEqual(Array.from(x));
  });

  it('c2 · reduces the high-frequency tail of a discontinuous window', () => {
    const x = ramp(256);
    const v = assessContinuation(x, undefined, 8);
    expect(v.seam).toBeGreaterThan(0.5);
    expect(v.continuedTail).toBeLessThan(v.rawTail);
    expect(v.worthwhile).toBe(true);
  });

  it('c3 · closes the endpoint seam it was built to close', () => {
    const x = ramp(128);
    const r = fourierContinuation(x);
    const last = r.extended[r.extended.length - 1];
    const seamAfter = Math.abs(last - r.extended[0]);
    expect(seamAfter).toBeLessThan(r.seam);
  });

  it('c4 · an already-periodic window is not made worse', () => {
    const n = 256;
    const x = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 4 * i) / n));
    const v = assessContinuation(x, undefined, 8);
    expect(v.seam).toBeLessThan(0.2);
    // Tail stays negligible either way — the continuation must not inject one.
    expect(v.continuedTail).toBeLessThan(0.05);
  });

  it('c5 · extension length is bounded and at least four samples', () => {
    expect(extensionLength(1000, 0.236)).toBe(236);
    expect(extensionLength(5, 0.001)).toBe(4);
    expect(extensionLength(100, 5)).toBe(100);
  });

  it('c6 · rejects windows too short to bend', () => {
    expect(() => fourierContinuation([1, 2])).toThrow(RangeError);
  });

  it('c7 · high-frequency fraction is a real fraction on any input', () => {
    const x = ramp(64);
    const f = highFrequencyFraction(x, 4);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThanOrEqual(1);
  });
});
