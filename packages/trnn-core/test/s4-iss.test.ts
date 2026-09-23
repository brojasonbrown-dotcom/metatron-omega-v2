/**
 * Gate S4 — the driven cell is certified, not merely clamped.
 *
 * The Jury gain covers the homogeneous map. Here the cell is driven hard on
 * every input port for 10,000 steps and must satisfy the ISS bound at every
 * single step, with the φ⁴ clamp never firing — i.e. the clamp is a fault
 * detector, not the thing keeping the run bounded.
 */
import { describe, expect, it } from 'vitest';
import { cellStep } from '../src/cell/update';
import { createField, type CField } from '../src/core/complex';
import { CLAMP_MAX, ISS_ENVELOPE, JURY_GAIN, SeedStream } from '../src/index';

function fill(f: CField, rng: SeedStream, scale: number): CField {
  for (let i = 0; i < f.n; i++) {
    f.re[i] = rng.signed() * scale;
    f.im[i] = rng.signed() * scale;
  }
  return f;
}

describe('S4 — ISS certificate on the driven cell', () => {
  it('10,000 driven steps: bound holds every step, clamp never fires', () => {
    const n = 55;
    const rng = new SeedStream('s4-iss');
    let z = createField(n);
    let out = createField(n);
    const G = createField(n);
    const P = createField(n);
    const R = createField(n);
    const Pi = createField(n);
    const zhat = createField(n);
    const U = createField(n);
    const V = createField(n);
    const S = createField(n);

    let clampEvents = 0;
    let violations = 0;
    let worstPeak = 0;

    for (let t = 0; t < 10_000; t++) {
      // drive every port at unit scale — the ISS envelope's reference case
      for (const f of [G, P, R, Pi, zhat, U, V, S]) fill(f, rng, 1);
      const rep = cellStep(z, out, { G, P, R, Pi, zhat, U, V, S });
      clampEvents += rep.clamped;
      if (!rep.issSatisfied) violations++;
      if (rep.peak > worstPeak) worstPeak = rep.peak;
      const tmp = z;
      z = out;
      out = tmp;
    }

    expect(violations).toBe(0);
    expect(clampEvents).toBe(0);
    // unit-bounded drive ⇒ the state never leaves the ISS envelope, and the
    // envelope sits far inside the clamp
    expect(worstPeak).toBeLessThanOrEqual(ISS_ENVELOPE * Math.SQRT2);
    expect(worstPeak).toBeLessThan(CLAMP_MAX);
  }, 60_000);

  it('the reported bound is the real ISS inequality, not a restatement of the peak', () => {
    const n = 34;
    const rng = new SeedStream('s4-bound');
    const z = fill(createField(n), rng, 0.5);
    const out = createField(n);
    const U = fill(createField(n), rng, 2);
    const rep = cellStep(z, out, { U });
    let inMax = 0;
    let uMax = 0;
    for (let i = 0; i < n; i++) {
      inMax = Math.max(inMax, Math.hypot(z.re[i], z.im[i]));
      uMax = Math.max(uMax, Math.hypot(U.re[i], U.im[i]));
    }
    expect(rep.driveNorm).toBeCloseTo(Math.abs(0.09016994374947422) * uMax, 12);
    expect(rep.issBound).toBeCloseTo(JURY_GAIN * inMax + rep.driveNorm, 12);
    expect(rep.peak).toBeLessThanOrEqual(rep.issBound);
  });

  it('a width mismatch throws instead of silently truncating the drive', () => {
    const z = createField(21);
    const out = createField(21);
    expect(() => cellStep(z, out, { U: createField(13) })).toThrow(/does not match/);
    expect(() => cellStep(z, createField(13), {})).toThrow(/does not match/);
    expect(() => cellStep(z, z, {})).toThrow(/Jacobi/);
  });

  it('an unforced run contracts at the certified rate', () => {
    const n = 55;
    const rng = new SeedStream('s4-free');
    let z = fill(createField(n), rng, 1);
    let out = createField(n);
    let prev = Infinity;
    for (let t = 0; t < 64; t++) {
      const rep = cellStep(z, out, {});
      expect(rep.realizedGain).toBeLessThanOrEqual(JURY_GAIN + 1e-12);
      expect(rep.peak).toBeLessThan(prev);
      prev = rep.peak;
      const tmp = z;
      z = out;
      out = tmp;
    }
  });
});
