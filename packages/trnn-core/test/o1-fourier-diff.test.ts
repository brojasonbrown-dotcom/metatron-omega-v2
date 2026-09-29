import { describe, expect, it } from 'vitest';
import {
  derivative,
  dx,
  d2x,
  dPhiModes,
  wavenumber,
  meanSquare,
} from '../src/operator/fourierDiff';
import { modeLadder } from '../src/torus/eigenmodes';
import type { CField } from '../src/core/complex';

const TWO_PI = 2 * Math.PI;

function sample(n: number, f: (u: number) => { re: number; im: number }): CField {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const v = f((TWO_PI * j) / n);
    re[j] = v.re;
    im[j] = v.im;
  }
  return { re, im, n };
}

function maxErr(a: CField, b: CField): number {
  let m = 0;
  for (let i = 0; i < a.n; i++) {
    m = Math.max(m, Math.abs(a.re[i] - b.re[i]), Math.abs(a.im[i] - b.im[i]));
  }
  return m;
}

describe('O1 — exact spectral differentiation on the ring', () => {
  it('signed wavenumbers wrap at the half point', () => {
    expect(Array.from({ length: 8 }, (_, j) => wavenumber(j, 8))).toEqual([
      0, 1, 2, 3, 4, -3, -2, -1,
    ]);
    expect(Array.from({ length: 5 }, (_, j) => wavenumber(j, 5))).toEqual([0, 1, 2, -2, -1]);
  });

  it('d/du sin(3u) = 3 cos(3u) to 1e-12 on a Fibonacci rung', () => {
    const n = 233;
    const f = sample(n, (u) => ({ re: Math.sin(3 * u), im: 0 }));
    const want = sample(n, (u) => ({ re: 3 * Math.cos(3 * u), im: 0 }));
    expect(maxErr(dx(f), want)).toBeLessThan(1e-12);
  });

  it('d/du e^{i k u} = i k e^{i k u} for several k', () => {
    const n = 144;
    for (const k of [1, 5, 13]) {
      const f = sample(n, (u) => ({ re: Math.cos(k * u), im: Math.sin(k * u) }));
      const want = sample(n, (u) => ({ re: -k * Math.sin(k * u), im: k * Math.cos(k * u) }));
      expect(maxErr(dx(f), want)).toBeLessThan(1e-11);
    }
  });

  it('second derivative of a φ-mode superposition matches analytically', () => {
    const n = 233;
    const ks = [1, 2, 3, 5, 8];
    const f = sample(n, (u) => ({ re: ks.reduce((s, k) => s + Math.cos(k * u) / k, 0), im: 0 }));
    const want = sample(n, (u) => ({ re: ks.reduce((s, k) => s - k * Math.cos(k * u), 0), im: 0 }));
    expect(maxErr(d2x(f), want)).toBeLessThan(1e-10);
  });

  it('odd derivatives zero the Nyquist bin so a real field stays real', () => {
    const n = 144; // even → Nyquist bin exists
    const f = sample(n, (u) => ({ re: Math.cos((n / 2) * u) + Math.sin(2 * u), im: 0 }));
    const d = dx(f);
    let maxIm = 0;
    for (let i = 0; i < n; i++) maxIm = Math.max(maxIm, Math.abs(d.im[i]));
    expect(maxIm).toBeLessThan(1e-11);
  });

  it('order 0 is the identity and order composes', () => {
    const n = 89;
    const f = sample(n, (u) => ({ re: Math.sin(4 * u), im: Math.cos(u) }));
    expect(maxErr(derivative(f, 0), f)).toBe(0);
    expect(maxErr(derivative(f, 2), dx(dx(f)))).toBeLessThan(1e-10);
  });

  it('∂_v is diagonal on modes: coefficient k gains a factor i·q_k', () => {
    const specs = modeLadder(13);
    const re = Float64Array.from(specs, (_, i) => i + 1);
    const im = new Float64Array(13);
    const out = dPhiModes(re, im, specs);
    for (let i = 0; i < 13; i++) {
      expect(out.re[i]).toBeCloseTo(0, 15);
      expect(out.im[i]).toBeCloseTo((i + 1) * specs[i].q, 12);
    }
  });

  it('meanSquare is the quadrature-weighted energy density', () => {
    const n = 233;
    const f = sample(n, (u) => ({ re: Math.cos(u), im: 0 }));
    expect(meanSquare(f)).toBeCloseTo(0.5, 12);
  });
});
