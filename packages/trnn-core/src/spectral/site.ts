/**
 * O-P2 — CGS2 spectral site: one place where the torus, shell, and radial
 * planes are analysed together into a single deterministic descriptor.
 *
 * A "site" is one location on the ladder that owns:
 *   - the toroidal mode basis (from torus/superposition),
 *   - a Fibonacci spherical shell + real SHT,
 *   - a radial Bessel ladder,
 * and produces a fixed-width, phi-weighted spectral signature per call, with
 * the measured roundtrip error of each plane attached. No plane is allowed to
 * report a number it did not compute.
 */

import { PHI, SIGNATURE_MODES } from '../core/constants';
import { isFibonacci } from '../core/fibonacci';
import {
  buildSphericalBasis,
  fibonacciShell,
  shtAnalyze,
  shtSynthesize,
  type SphericalBasis,
} from './sphere';
import {
  buildRadialBasis,
  radialAnalyze,
  radialGrid,
  radialSynthesize,
  type RadialBasis,
} from './radial';
import { dpow } from '../core/dmath';

export interface SpectralSiteOptions {
  /** Shell point count — must be Fibonacci (Law 2.2). Default 233. */
  readonly shellPoints?: number;
  /** Max spherical degree. Default 3 (16 harmonics). */
  readonly lmax?: number;
  /** Radial quadrature nodes. Default 144. */
  readonly radialNodes?: number;
  /** Radial phi-ladder width. Default 8. */
  readonly radialRungs?: number;
  /** Degree used for the radial ladder. Default 0. */
  readonly radialDegree?: number;
}

export interface PlaneReport {
  /** ||f - synth(analyze(f))|| / ||f|| on the plane's own quadrature. */
  readonly roundtrip: number;
  /** Raw (pre-orthonormalization) Gram defect of the sampled family. */
  readonly gramDefect: number;
  readonly width: number;
}

export class SpectralSite {
  readonly sphere: SphericalBasis;
  readonly radial: RadialBasis;
  readonly lmax: number;

  private readonly shCoeffs: Float64Array;
  private readonly radCoeffs: Float64Array;
  private readonly shScratch: Float64Array;
  private readonly radScratch: Float64Array;

  constructor(opts: SpectralSiteOptions = {}) {
    const points = opts.shellPoints ?? 233;
    if (!isFibonacci(points)) {
      throw new RangeError(`SpectralSite: shellPoints ${points} is not Fibonacci (Law 2.2)`);
    }
    this.lmax = opts.lmax ?? 3;
    this.sphere = buildSphericalBasis(fibonacciShell(points), this.lmax);
    this.radial = buildRadialBasis(
      radialGrid(opts.radialNodes ?? 144),
      opts.radialDegree ?? 0,
      opts.radialRungs ?? 8,
    );
    this.shCoeffs = new Float64Array(this.sphere.vectors.length);
    this.radCoeffs = new Float64Array(this.radial.vectors.length);
    this.shScratch = new Float64Array(this.sphere.shell.n);
    this.radScratch = new Float64Array(this.radial.grid.n);
  }

  /** Analyse a field sampled on the shell. Returns the coefficient view. */
  analyzeShell(f: Float64Array): Float64Array {
    return shtAnalyze(this.sphere, f, this.shCoeffs);
  }

  /** Analyse a radial profile sampled on the radial grid. */
  analyzeRadial(f: Float64Array): Float64Array {
    return radialAnalyze(this.radial, f, this.radCoeffs);
  }

  /** Measured (not assumed) roundtrip fidelity of the shell plane. */
  shellReport(f: Float64Array): PlaneReport {
    const c = shtAnalyze(this.sphere, f, this.shCoeffs);
    shtSynthesize(this.sphere, c, this.shScratch);
    return {
      roundtrip: relError(f, this.shScratch, this.sphere.shell.w),
      gramDefect: this.sphere.gramDefect,
      width: this.sphere.vectors.length,
    };
  }

  /** Measured roundtrip fidelity of the radial plane. */
  radialReport(f: Float64Array): PlaneReport {
    const c = radialAnalyze(this.radial, f, this.radCoeffs);
    radialSynthesize(this.radial, c, this.radScratch);
    return {
      roundtrip: relError(f, this.radScratch, this.radial.grid.w),
      gramDefect: this.radial.gramDefect,
      width: this.radial.vectors.length,
    };
  }

  /**
   * phi-weighted spectral signature of the shell coefficients, folded to
   * SIGNATURE_MODES entries so it lines up with the transcription tape width.
   */
  signature(f: Float64Array, out = new Float64Array(SIGNATURE_MODES)): Float64Array {
    const c = shtAnalyze(this.sphere, f, this.shCoeffs);
    out.fill(0);
    let norm = 0;
    for (let k = 0; k < c.length; k++) {
      const slot = k % out.length;
      const w = dpow(PHI, -this.sphere.specs[k].l);
      const e = w * c[k] * c[k];
      out[slot] += e;
      norm += e;
    }
    if (norm > 0) for (let i = 0; i < out.length; i++) out[i] /= norm;
    return out;
  }
}

function relError(a: Float64Array, b: Float64Array, w: Float64Array): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    num += w[i] * d * d;
    den += w[i] * a[i] * a[i];
  }
  if (den === 0) return Math.sqrt(num);
  return Math.sqrt(num / den);
}
