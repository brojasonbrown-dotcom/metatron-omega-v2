import { describe, expect, it } from 'vitest';
import { bandLimit, resample, spectralEnergy } from '../src/operator/resample';
import type { CField } from '../src/core/complex';

const TWO_PI = 2 * Math.PI;

function bandLimited(n: number, ks: number[]): CField {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const u = (TWO_PI * j) / n;
    for (const k of ks) {
      re[j] += Math.cos(k * u) / (k + 1);
      im[j] += Math.sin(k * u) / (k + 1);
    }
  }
  return { re, im, n };
}

function maxErr(a: CField, b: CField): number {
  let m = 0;
  for (let i = 0; i < a.n; i++) m = Math.max(m, Math.abs(a.re[i] - b.re[i]), Math.abs(a.im[i] - b.im[i]));
  return m;
}

describe('O3 — spectral resampling and discretisation invariance', () => {
  it('band limit excludes Nyquist', () => {
    expect(bandLimit(13)).toBe(6);
    expect(bandLimit(144)).toBe(71);
  });

  it('13 → 233 → 13 returns the original field to 1e-12', () => {
    const f = bandLimited(13, [1, 2, 3]);
    const round = resample(resample(f, 233), 13);
    expect(round.n).toBe(13);
    expect(maxErr(round, f)).toBeLessThan(1e-12);
  });

  it('233 → 1597 → 233 round-trips on a Fibonacci prime pair', () => {
    const f = bandLimited(233, [1, 5, 13, 34]);
    const round = resample(resample(f, 1597), 233);
    expect(maxErr(round, f)).toBeLessThan(1e-11);
  });

  it('a pure mode keeps its amplitude when upsampled', () => {
    const f = bandLimited(89, [3]);
    const up = resample(f, 610);
    let peakA = 0;
    let peakB = 0;
    for (let i = 0; i < f.n; i++) peakA = Math.max(peakA, Math.hypot(f.re[i], f.im[i]));
    for (let i = 0; i < up.n; i++) peakB = Math.max(peakB, Math.hypot(up.re[i], up.im[i]));
    expect(peakB).toBeCloseTo(peakA, 9);
  });

  it('spectral energy is conserved up to the resampling measure', () => {
    const f = bandLimited(89, [1, 2, 4]);
    const up = resample(f, 233);
    // unitary transform + √(m/n) amplitude scaling ⇒ energy scales by m/n
    expect(spectralEnergy(up)).toBeCloseTo((spectralEnergy(f) * 233) / 89, 9);
  });

  it('identity width is a copy, not an aliased buffer', () => {
    const f = bandLimited(13, [1]);
    const g = resample(f, 13);
    expect(g.re).not.toBe(f.re);
    expect(maxErr(g, f)).toBe(0);
  });

  it('downsampling truncates only the out-of-band content', () => {
    const low = bandLimited(233, [1, 2]);
    const mixed = bandLimited(233, [1, 2, 60]);
    const dl = resample(low, 13);
    const dm = resample(mixed, 13);
    expect(maxErr(dl, dm)).toBeLessThan(1e-11);
  });
});
