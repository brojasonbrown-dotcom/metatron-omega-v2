/**
 * Gate G2 — spectral set: shell/radial analysis-synthesis roundtrip < 1e-12,
 * Lucas spectral lines exact to 2.8e-15, determinism of every plane.
 */
import { describe, expect, it } from 'vitest';
import { SeedStream } from '../src/core/determinism';
import { lucasBig } from '../src/core/fibonacci';
import { lucasLine } from '../src/torus/eigenmodes';
import {
  buildSphericalBasis,
  fibonacciShell,
  legendreP,
  realSH,
  shtAnalyze,
  shtSynthesize,
  angularPower,
} from '../src/spectral/sphere';
import {
  buildRadialBasis,
  radialAnalyze,
  radialGrid,
  radialSynthesize,
  sphericalBesselJ,
} from '../src/spectral/radial';
import { SpectralSite } from '../src/spectral/site';

function noise(n: number, seed: string): Float64Array {
  const r = new SeedStream(seed);
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = r.signed();
  return f;
}

describe('G2 spherical shell', () => {
  const shell = fibonacciShell(233);

  it('is a unit shell with a complete 4*pi quadrature', () => {
    let w = 0;
    for (let j = 0; j < shell.n; j++) {
      expect(Math.hypot(shell.x[j], shell.y[j], shell.z[j])).toBeCloseTo(1, 14);
      w += shell.w[j];
    }
    expect(w).toBeCloseTo(4 * Math.PI, 12);
  });

  it('is deterministic — identical construction twice', () => {
    const b = fibonacciShell(233);
    expect(Array.from(b.theta)).toEqual(Array.from(shell.theta));
    expect(Array.from(b.phi)).toEqual(Array.from(shell.phi));
  });

  it('reports an honest (non-zero, small) quadrature Gram defect', () => {
    const basis = buildSphericalBasis(shell, 3);
    expect(basis.gramDefect).toBeGreaterThan(0);
    expect(basis.gramDefect).toBeLessThan(0.05);
    expect(basis.vectors.length).toBe(16);
  });

  it('roundtrips a band-limited field to better than 1e-12', () => {
    const basis = buildSphericalBasis(shell, 3);
    const c = noise(basis.vectors.length, 'sh-coeffs');
    const f = shtSynthesize(basis, c, new Float64Array(shell.n));
    const back = shtAnalyze(basis, f, new Float64Array(basis.vectors.length));
    const re = shtSynthesize(basis, back, new Float64Array(shell.n));
    let num = 0;
    let den = 0;
    for (let i = 0; i < f.length; i++) {
      num += (f[i] - re[i]) ** 2;
      den += f[i] ** 2;
    }
    expect(Math.sqrt(num / den)).toBeLessThan(1e-12);
    for (let k = 0; k < c.length; k++) expect(back[k]).toBeCloseTo(c[k], 12);
  });

  it('projects an arbitrary field idempotently (P^2 = P)', () => {
    const basis = buildSphericalBasis(shell, 3);
    const f = noise(shell.n, 'sh-field');
    const p1 = shtSynthesize(basis, shtAnalyze(basis, f, new Float64Array(16)), new Float64Array(shell.n));
    const p2 = shtSynthesize(basis, shtAnalyze(basis, p1, new Float64Array(16)), new Float64Array(shell.n));
    let m = 0;
    for (let i = 0; i < p1.length; i++) m = Math.max(m, Math.abs(p1[i] - p2[i]));
    expect(m).toBeLessThan(1e-12);
  });

  it('matches closed-form harmonics and Legendre values', () => {
    // P_2^0(x) = (3x^2-1)/2 ; Y_0^0 = 1/sqrt(4 pi)
    for (const x of [-0.9, -0.3, 0, 0.4, 0.87]) {
      expect(legendreP(2, 0, x)).toBeCloseTo((3 * x * x - 1) / 2, 14);
    }
    expect(realSH(0, 0, 1.1, 2.2)).toBeCloseTo(1 / Math.sqrt(4 * Math.PI), 15);
    // Y_1^0 = sqrt(3/(4 pi)) cos(theta)
    expect(realSH(1, 0, 0.7, 0)).toBeCloseTo(Math.sqrt(3 / (4 * Math.PI)) * Math.cos(0.7), 14);
  });

  it('angular power is rotation-flavoured: total equals the coefficient energy', () => {
    const basis = buildSphericalBasis(shell, 3);
    const c = noise(16, 'power');
    const p = angularPower(basis, c, 3);
    let tot = 0;
    for (const v of p) tot += v;
    let e = 0;
    for (const v of c) e += v * v;
    expect(tot).toBeCloseTo(e, 13);
  });
});

describe('G2 radial plane', () => {
  it('spherical Bessel matches closed forms across regimes', () => {
    for (const x of [0.05, 0.5, 1.3, 4.7, 19.4, 71.2]) {
      expect(sphericalBesselJ(0, x)).toBeCloseTo(Math.sin(x) / x, 12);
      expect(sphericalBesselJ(1, x)).toBeCloseTo(Math.sin(x) / (x * x) - Math.cos(x) / x, 11);
      const j2 = (3 / (x * x) - 1) * (Math.sin(x) / x) - (3 * Math.cos(x)) / (x * x);
      expect(sphericalBesselJ(2, x)).toBeCloseTo(j2, 10);
    }
    expect(sphericalBesselJ(0, 0)).toBe(1);
    expect(sphericalBesselJ(3, 0)).toBe(0);
  });

  it('satisfies the recurrence j_{l-1} + j_{l+1} = (2l+1)/x * j_l', () => {
    for (const x of [0.9, 3.1, 12.5]) {
      for (let l = 1; l <= 5; l++) {
        const lhs = sphericalBesselJ(l - 1, x) + sphericalBesselJ(l + 1, x);
        const rhs = ((2 * l + 1) / x) * sphericalBesselJ(l, x);
        expect(lhs).toBeCloseTo(rhs, 9);
      }
    }
  });

  it('roundtrips a profile in the phi Bessel ladder to better than 1e-12', () => {
    const grid = radialGrid(144);
    const basis = buildRadialBasis(grid, 0, 8);
    expect(basis.vectors.length).toBe(8);
    const c = noise(basis.vectors.length, 'rad');
    const f = radialSynthesize(basis, c, new Float64Array(grid.n));
    const back = radialAnalyze(basis, f, new Float64Array(basis.vectors.length));
    for (let k = 0; k < c.length; k++) expect(back[k]).toBeCloseTo(c[k], 12);
    const re = radialSynthesize(basis, back, new Float64Array(grid.n));
    let num = 0;
    let den = 0;
    for (let i = 0; i < grid.n; i++) {
      num += grid.w[i] * (f[i] - re[i]) ** 2;
      den += grid.w[i] * f[i] ** 2;
    }
    expect(Math.sqrt(num / den)).toBeLessThan(1e-12);
  });

  it('the raw Bessel ladder is measurably non-orthogonal before CGS2', () => {
    const basis = buildRadialBasis(radialGrid(144), 0, 8);
    expect(basis.gramDefect).toBeGreaterThan(0);
  });
});

describe('G2 Lucas spectral lines', () => {
  it('mode lines equal exact Lucas numbers to 2.8e-15 relative', () => {
    for (let k = 0; k <= 13; k++) {
      const exact = Number(lucasBig(k));
      const got = lucasLine(k);
      const rel = Math.abs(got - exact) / Math.max(1, Math.abs(exact));
      expect(rel).toBeLessThanOrEqual(2.8e-15);
    }
  });
});

describe('G2 spectral site', () => {
  it('rejects a non-Fibonacci shell', () => {
    expect(() => new SpectralSite({ shellPoints: 200 })).toThrow(/Fibonacci/);
  });

  it('reports measured roundtrips below the gate bound on both planes', () => {
    const site = new SpectralSite();
    const shellField = shtSynthesize(
      site.sphere,
      noise(site.sphere.vectors.length, 'site-sh'),
      new Float64Array(site.sphere.shell.n),
    );
    const radField = radialSynthesize(
      site.radial,
      noise(site.radial.vectors.length, 'site-rad'),
      new Float64Array(site.radial.grid.n),
    );
    const sr = site.shellReport(shellField);
    const rr = site.radialReport(radField);
    expect(sr.roundtrip).toBeLessThan(1e-12);
    expect(rr.roundtrip).toBeLessThan(1e-12);
    expect(sr.width).toBe(16);
    expect(rr.width).toBe(8);
  });

  it('signature is a normalized 13-wide simplex point and deterministic', () => {
    const site = new SpectralSite();
    const f = noise(site.sphere.shell.n, 'sig');
    const a = site.signature(f, new Float64Array(13));
    const b = site.signature(f, new Float64Array(13));
    expect(Array.from(a)).toEqual(Array.from(b));
    let s = 0;
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      s += v;
    }
    expect(s).toBeCloseTo(1, 13);
  });
});
