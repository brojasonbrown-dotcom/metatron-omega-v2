/**
 * Gate B — the fast transform must reproduce the dense reference on every rung
 * size this machine uses, prime lengths included, and must be deterministic.
 */

import { describe, expect, it } from 'vitest';
import { crossCorrelate, dft, fft, fftUnitary } from '../src/spectral/fft';

function probe(n: number): { re: Float64Array; im: Float64Array } {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = Math.cos(0.37 * i) + 0.25 * Math.cos(2.11 * i);
    im[i] = Math.sin(0.19 * i) - 0.5;
  }
  return { re, im };
}

function relErr(
  a: { re: Float64Array; im: Float64Array },
  b: { re: Float64Array; im: Float64Array },
): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < a.re.length; i++) {
    const dr = a.re[i] - b.re[i];
    const di = a.im[i] - b.im[i];
    num += dr * dr + di * di;
    den += b.re[i] * b.re[i] + b.im[i] * b.im[i];
  }
  return Math.sqrt(num / Math.max(den, 1e-300));
}

describe('Gate B · FFT parity with the dense DFT', () => {
  // Fibonacci rung sizes (233 and 1597 are prime; 610 and 4181 are composite)
  // plus a power of two to cover the direct radix-2 path.
  for (const n of [13, 64, 89, 144, 233, 377, 610, 987]) {
    it(`matches the dense DFT at n=${n}`, () => {
      const p = probe(n);
      expect(relErr(fft(p.re, p.im, false), dft(p.re, p.im, false))).toBeLessThan(1e-13);
      expect(relErr(fft(p.re, p.im, true), dft(p.re, p.im, true))).toBeLessThan(1e-13);
    });
  }

  it('round-trips to itself', () => {
    const p = probe(233);
    const f = fft(p.re, p.im, false);
    const g = fft(f.re, f.im, true);
    for (let i = 0; i < 233; i++) {
      expect(g.re[i] / 233).toBeCloseTo(p.re[i], 11);
      expect(g.im[i] / 233).toBeCloseTo(p.im[i], 11);
    }
  });

  it('is unitary in the normalised form (Parseval)', () => {
    const p = probe(610);
    const f = fftUnitary(p.re, p.im, false);
    let e0 = 0;
    let e1 = 0;
    for (let i = 0; i < 610; i++) {
      e0 += p.re[i] * p.re[i] + p.im[i] * p.im[i];
      e1 += f.re[i] * f.re[i] + f.im[i] * f.im[i];
    }
    expect(Math.abs(e1 - e0) / e0).toBeLessThan(1e-12);
  });

  it('is bit-deterministic', () => {
    const p = probe(1597);
    const a = fft(p.re, p.im, false);
    const b = fft(p.re, p.im, false);
    for (let i = 0; i < 1597; i++) {
      expect(a.re[i]).toBe(b.re[i]);
      expect(a.im[i]).toBe(b.im[i]);
    }
  });

  it('cross-correlation peaks at the true circular shift', () => {
    const n = 233;
    const shift = 55;
    const a = probe(n);
    const b = { re: new Float64Array(n), im: new Float64Array(n) };
    for (let i = 0; i < n; i++) {
      b.re[i] = a.re[(i + shift) % n];
      b.im[i] = a.im[(i + shift) % n];
    }
    const c = crossCorrelate(a, b);
    let best = 0;
    let bestMag = -1;
    for (let i = 0; i < n; i++) {
      const m = Math.hypot(c.re[i], c.im[i]);
      if (m > bestMag) {
        bestMag = m;
        best = i;
      }
    }
    expect(best).toBe(shift);
  });
});
