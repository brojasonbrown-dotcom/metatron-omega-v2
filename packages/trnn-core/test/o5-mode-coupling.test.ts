import { describe, expect, it } from 'vitest';
import { COUPLING_RHO_MAX, ModeCoupling } from '../src/operator/modeCoupling';
import { FILTER_RHO_MAX, SpectralFilter } from '../src/learn/spectralFilter';
import { PHI_INV } from '../src/core/constants';

/** Deterministic Weyl sequence — no RNG anywhere in the certificate sweep. */
function weyl(i: number, seed = 0.5): number {
  const x = (seed + i * PHI_INV) % 1;
  return (x - 0.5) * 40; // wide raw range: the sigmoid must clamp it anyway
}

function fill(m: ModeCoupling, offset: number): void {
  for (let i = 0; i < m.raw.length; i++) m.raw[i] = weyl(i + offset);
}

describe('O5 — banded mode coupling', () => {
  it('the band matches the Fibonacci stencil', () => {
    const m = new ModeCoupling(13);
    // offsets {1,2} over 13 modes → 12 + 11 = 23 pairs, 2 params each.
    expect(m.pairCount).toBe(23);
    expect(m.size).toBe(46);
  });

  it('gate 0 is a true no-op — the default path cannot regress', () => {
    const m = new ModeCoupling(13);
    fill(m, 7);
    const cRe = Float64Array.from({ length: 13 }, (_, i) => i + 1);
    const cIm = Float64Array.from({ length: 13 }, (_, i) => -i);
    const outRe = Float64Array.from(cRe);
    const outIm = Float64Array.from(cIm);
    m.apply(cRe, cIm, outRe, outIm, 0);
    expect(Array.from(outRe)).toEqual(Array.from(cRe));
    expect(Array.from(outIm)).toEqual(Array.from(cIm));
  });

  it('composed with the filter at gate 0, output is bit-identical to the filter alone', () => {
    const f = new SpectralFilter(13);
    for (let i = 0; i < f.raw.length; i++) f.raw[i] = weyl(i, 0.31);
    const m = new ModeCoupling(13);
    fill(m, 3);

    const cRe = Float64Array.from({ length: 13 }, (_, i) => Math.cos(i));
    const cIm = Float64Array.from({ length: 13 }, (_, i) => Math.sin(i));

    const base = { re: new Float64Array(13), im: new Float64Array(13) };
    for (let k = 0; k < 13; k++) {
      const rho = f.magnitude(k);
      const ps = f.phase(k);
      const wr = rho * Math.cos(ps);
      const wi = rho * Math.sin(ps);
      base.re[k] = wr * cRe[k] - wi * cIm[k];
      base.im[k] = wr * cIm[k] + wi * cRe[k];
    }
    const withCoupling = { re: Float64Array.from(base.re), im: Float64Array.from(base.im) };
    m.apply(cRe, cIm, withCoupling.re, withCoupling.im, 0);
    expect(Array.from(withCoupling.re)).toEqual(Array.from(base.re));
    expect(Array.from(withCoupling.im)).toEqual(Array.from(base.im));
  });

  it('the row bound never exceeds ρ_C for any reachable parameter value', () => {
    const m = new ModeCoupling(13);
    for (let trial = 0; trial < 4000; trial++) {
      fill(m, trial * 97);
      expect(m.rowBound()).toBeLessThanOrEqual(COUPLING_RHO_MAX + 1e-15);
    }
  });

  it('the measured ℓ² gain stays under the constructed bound', () => {
    const m = new ModeCoupling(13);
    const n = 13;
    for (let trial = 0; trial < 200; trial++) {
      fill(m, trial * 31 + 5);
      const bound = m.rowBound();
      // Power iteration on C (Hermitian ⇒ converges to ‖C‖₂), deterministic start.
      let vr = Float64Array.from({ length: n }, (_, i) => 1 + 0.01 * i);
      let vi = new Float64Array(n);
      let lam = 0;
      for (let it = 0; it < 60; it++) {
        const or_ = new Float64Array(n);
        const oi = new Float64Array(n);
        m.apply(vr, vi, or_, oi, 1);
        let nrm = 0;
        for (let i = 0; i < n; i++) nrm += or_[i] * or_[i] + oi[i] * oi[i];
        nrm = Math.sqrt(nrm);
        if (nrm < 1e-300) break;
        lam = nrm;
        for (let i = 0; i < n; i++) {
          or_[i] /= nrm;
          oi[i] /= nrm;
        }
        vr = or_;
        vi = oi;
      }
      // v was normalised each step, so lam converges to ‖C‖₂ directly.
      expect(lam).toBeLessThanOrEqual(bound + 1e-12);
    }
  });

  it('the Jury contribution stays admissible beside the filter clamp', () => {
    const m = new ModeCoupling(13);
    fill(m, 11);
    const cert = m.certificate(PHI_INV, FILTER_RHO_MAX);
    expect(cert.rho).toBeLessThanOrEqual(COUPLING_RHO_MAX + 1e-15);
    expect(cert.gated).toBeLessThanOrEqual(PHI_INV * COUPLING_RHO_MAX + 1e-15);
    expect(FILTER_RHO_MAX + cert.gated).toBeLessThan(1);
    expect(cert.admissible).toBe(true);
  });

  it('the operator is Hermitian: ⟨Cx, y⟩ = ⟨x, Cy⟩', () => {
    const m = new ModeCoupling(13);
    fill(m, 21);
    const n = 13;
    const xr = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 0.7));
    const xi = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.3));
    const yr = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 1.1));
    const yi = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 1.9));
    const cx = { re: new Float64Array(n), im: new Float64Array(n) };
    const cy = { re: new Float64Array(n), im: new Float64Array(n) };
    m.apply(xr, xi, cx.re, cx.im, 1);
    m.apply(yr, yi, cy.re, cy.im, 1);
    // ⟨a,b⟩ = Σ conj(a)·b
    let lr = 0;
    let li = 0;
    let rr = 0;
    let ri = 0;
    for (let i = 0; i < n; i++) {
      lr += cx.re[i] * yr[i] + cx.im[i] * yi[i];
      li += cx.re[i] * yi[i] - cx.im[i] * yr[i];
      rr += xr[i] * cy.re[i] + xi[i] * cy.im[i];
      ri += xr[i] * cy.im[i] - xi[i] * cy.re[i];
    }
    expect(lr).toBeCloseTo(rr, 12);
    expect(li).toBeCloseTo(ri, 12);
  });

  it('rejects invalid geometry rather than degrading silently', () => {
    expect(() => new ModeCoupling(0)).toThrow();
    expect(() => new ModeCoupling(13, 1.5)).toThrow();
    const m = new ModeCoupling(13);
    fill(m, 1);
    expect(() => m.apply(new Float64Array(13), new Float64Array(13), new Float64Array(4), new Float64Array(4), 1)).toThrow();
  });
});
