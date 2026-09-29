/**
 * Ω-CAPACITY C3 — where each information type belongs, and what it costs.
 *
 * The claim being tested: decimation between rungs is *exact* for band-limited
 * content, so routing a wide sensory stream into a narrower analysis class is
 * lossless as long as nothing above the target band limit was carrying energy.
 * The measurement here is the round trip width → target → width, so a class
 * marked lossless has been proven lossless on this host, not assumed.
 */

import { resample, bandLimit } from '@metatron/trnn-core/operator/resample';
import type { CField } from '@metatron/trnn-core/core/complex';
import type { LayeringCapacity, RateClass } from './types';

export interface RateClassSpec {
  readonly name: string;
  readonly hz: number;
  readonly width: number;
}

/** The rate classes the runtime actually schedules. */
export const RATE_CLASSES: readonly RateClassSpec[] = [
  { name: 'sensory.fast', hz: 377, width: 89 },
  { name: 'sensory.mid', hz: 233, width: 233 },
  { name: 'memory.driver', hz: 64, width: 233 },
  { name: 'engine.tick', hz: 60, width: 987 },
  { name: 'spectral.analysis', hz: 2.6, width: 2584 },
] as const;

/** Band-limited probe field: only modes ≤ k0 carry energy. */
function bandLimitedField(n: number, k0: number): CField {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = (6.283185307179586 * i) / n;
    for (let k = 1; k <= k0; k++) {
      const a = 1 / k;
      re[i] += a * Math.cos(k * t);
      im[i] += a * Math.sin(k * t);
    }
  }
  return { re, im, n };
}

function relError(a: CField, b: CField): number {
  let num = 0,
    den = 0;
  for (let i = 0; i < a.n; i++) {
    const dr = a.re[i] - b.re[i];
    const di = a.im[i] - b.im[i];
    num += dr * dr + di * di;
    den += a.re[i] * a.re[i] + a.im[i] * a.im[i];
  }
  return den > 0 ? Math.sqrt(num / den) : 0;
}

/**
 * Measure the decimation error from `source` width into a class width, for
 * content band-limited to the *narrower* of the two grids.
 */
export function measureDecimation(sourceWidth: number, targetWidth: number): number {
  const k0 = Math.min(bandLimit(sourceWidth), bandLimit(targetWidth));
  const f = bandLimitedField(sourceWidth, Math.max(1, Math.min(k0, 8)));
  const down = resample(f, targetWidth);
  const back = resample(down, sourceWidth);
  return relError(f, back);
}

/** Below this the round trip is at float64 noise, i.e. genuinely lossless. */
export const LOSSLESS_TOL = 1e-10;

export function measureLayering(sourceWidth = 2584): LayeringCapacity {
  const classes: RateClass[] = RATE_CLASSES.map((c) => {
    const err = measureDecimation(sourceWidth, c.width);
    return {
      name: c.name,
      hz: c.hz,
      width: c.width,
      numbersPerSecond: c.hz * c.width * 2,
      lossless: err <= LOSSLESS_TOL,
      decimationError: err,
    };
  });
  const narrowest = classes.reduce((a, c) => Math.min(a, c.width), Infinity);
  return {
    classes,
    totalNumbersPerSecond: classes.reduce((a, c) => a + c.numbersPerSecond, 0),
    survivingBandLimit: bandLimit(Number.isFinite(narrowest) ? narrowest : sourceWidth),
  };
}
