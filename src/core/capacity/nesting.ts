/**
 * Ω-UNBOUND C7 — nesting capacity.
 *
 * The other capacity probes measure walls. This one measures the absence of
 * one: how deep the residual torus can descend before float64 stops closing it,
 * and what a nest costs against what it buys.
 *
 * Method, all real:
 *  - Build a field at the widest rung containing content ABOVE every narrower
 *    rung's band limit, so a flat representation provably cannot hold it.
 *  - Descend through the Fibonacci ladder, one residual level per rung.
 *  - Reconstruct and measure the closure defect against the float64 floor.
 *  - Compare against the flat single-rung round trip, which loses the content.
 *
 * Nothing is estimated and nothing is written outside this function.
 */

import { resample, bandLimit } from '@metatron/trnn-core/operator/resample';
import {
  descendTo,
  ascendAll,
  closureDefect,
  levelEnergies,
  nestFootprint,
} from '@metatron/trnn-core/operator/nestedField';

/** Rungs the probe nests through, coarse→fine. */
export const NEST_LADDER = [13, 34, 89, 233] as const;

export interface NestingLevel {
  readonly width: number;
  readonly bandLimit: number;
  readonly energy: number;
  readonly energyShare: number;
}

export interface NestingCapacity {
  readonly widths: readonly number[];
  readonly depth: number;
  readonly levels: readonly NestingLevel[];
  /** Relative reconstruction error of the whole nest. */
  readonly defect: number;
  /** The float64 floor the defect is judged against. */
  readonly floor: number;
  /** True only when the defect sits at or below the floor. */
  readonly closed: boolean;
  /** Error a FLAT single-rung representation incurs on the same field. */
  readonly flatError: number;
  /** Band limit a flat coarse rung could reach. */
  readonly flatBandLimit: number;
  /** Band limit the nest answers at. */
  readonly nestBandLimit: number;
  /** Bytes the nest occupies. */
  readonly bytes: number;
  /** Bytes a dense field at the finest width would occupy. */
  readonly flatBytes: number;
  /** Nest bytes ÷ flat bytes — the price of unbounded resolution. */
  readonly overhead: number;
  /** Wall-clock of one full descend+ascend cycle. */
  readonly cycleMs: number;
}

function field(n: number, ks: readonly number[]) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let m = 0;
    for (let j = 0; j < ks.length; j++) {
      const a = 1 / (1 + j);
      const t = (2 * Math.PI * ks[j] * i) / n;
      r += a * Math.cos(t);
      m += a * Math.sin(t);
    }
    re[i] = r;
    im[i] = m;
  }
  return { re, im, n };
}

function relErr(
  a: { re: Float64Array; im: Float64Array },
  b: { re: Float64Array; im: Float64Array; n: number },
) {
  let num = 0;
  let den = 0;
  for (let i = 0; i < b.n; i++) {
    const dr = a.re[i] - b.re[i];
    const di = a.im[i] - b.im[i];
    num += dr * dr + di * di;
    den += b.re[i] * b.re[i] + b.im[i] * b.im[i];
  }
  return den > 0 ? Math.sqrt(num / den) : Math.sqrt(num);
}

export function measureNesting(ladder: readonly number[] = NEST_LADDER): NestingCapacity {
  const widths = [...ladder].sort((a, b) => a - b);
  const top = widths[widths.length - 1];
  const coarsest = widths[0];

  // Content deliberately spread across every annulus, including above the
  // coarse rung's Nyquist — a flat coarse representation cannot hold this.
  const ks = widths.map((w) => bandLimit(w) - 1).filter((k) => k > 0);
  const f = field(top, [1, ...ks]);

  const t0 = performance.now();
  const nest = descendTo(f, widths.slice(0, -1));
  const rebuilt = ascendAll(nest);
  const cycleMs = performance.now() - t0;

  const w = closureDefect(nest, f);
  const energies = levelEnergies(nest);
  const total = energies.reduce((a, b) => a + b, 0) || 1;

  const flat = resample(resample(f, coarsest), top);

  return {
    widths: nest.widths,
    depth: nest.widths.length,
    levels: nest.widths.map((width, i) => ({
      width,
      bandLimit: bandLimit(width),
      energy: energies[i],
      energyShare: energies[i] / total,
    })),
    defect: relErr(rebuilt, f),
    floor: w.floor,
    closed: w.closed,
    flatError: relErr(flat, f),
    flatBandLimit: bandLimit(coarsest),
    nestBandLimit: bandLimit(top),
    bytes: nestFootprint(nest),
    flatBytes: top * 16,
    overhead: nestFootprint(nest) / (top * 16),
    cycleMs,
  };
}
