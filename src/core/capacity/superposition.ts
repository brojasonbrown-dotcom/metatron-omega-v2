/**
 * Ω-CAPACITY C2 — how many distinguishable states one carrier holds.
 *
 * Three independent carriers are measured, because they fail differently:
 *
 *   • the FHRR hypervector — capacity is a *statistical* limit: superposing m
 *     vectors leaves each component at ≈1/√m above a 1/√(2D) noise floor, so
 *     the ceiling is the largest m whose components still clear the abstention
 *     threshold. Measured by decoding, not by quoting the formula.
 *   • the 256-bit barcode — capacity is combinatorial but the *realised*
 *     capacity depends on the projection; measured by counting collisions over
 *     a real population.
 *   • the float64 signature — capacity is arithmetic, and the honest figure is
 *     the precision that survives a transform round trip, not the 15-16 digits
 *     the format nominally carries.
 */

import { randomHv, bundle, similarity, chanceSigma } from '@metatron/trnn-core/substrate/vsa';
import { fftUnitary } from '@metatron/trnn-core/spectral/fft';
import { encodeBitmap, bitmapToHex, MAX_DISTANCE } from '@/core/gematria/bitmap';
import { SeedStream } from '@metatron/trnn-core/core/determinism';
import type { SuperpositionCapacity } from './types';

/** Fibonacci fan-ins — the ladder the rest of the machine already uses. */
const FAN_INS = [2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377] as const;

/** Abstention strictness, in sigmas of the chance distribution. */
export const Z_FLOOR = 5;

export interface FanInPoint {
  readonly m: number;
  readonly minSimilarity: number;
  readonly z: number;
}

/** Bundle m random hypervectors and report the weakest component's z-score. */
export function probeFanIn(dim: number, m: number, seed = 'omega-capacity'): FanInPoint {
  const parts = Array.from({ length: m }, (_, i) => randomHv(dim, `${seed}:${i}`));
  const b = bundle(parts);
  const sigma = chanceSigma(dim);
  let min = Infinity;
  for (const p of parts) min = Math.min(min, similarity(b.hv, p));
  return { m, minSimilarity: min, z: sigma > 0 ? min / sigma : 0 };
}

/** Largest fan-in whose weakest component still clears the abstention floor. */
export function measureFanIn(dim: number, seed = 'omega-capacity'): FanInPoint {
  let best: FanInPoint = probeFanIn(dim, FAN_INS[0], seed);
  for (const m of FAN_INS) {
    const p = probeFanIn(dim, m, seed);
    if (p.z >= Z_FLOOR) best = p;
    else break;
  }
  return best;
}

/** Digits of a float64 slot that survive a unitary transform round trip. */
export function measureSignatureDigits(width = 233): number {
  const re = new Float64Array(width);
  const im = new Float64Array(width);
  for (let i = 0; i < width; i++) re[i] = Math.cos((6.283185307179586 * 1.618033988749895 * (i + 1)) / width);
  const f = fftUnitary(Float64Array.from(re), Float64Array.from(im));
  const g = fftUnitary(f.re, f.im, true);
  let num = 0, den = 0;
  for (let i = 0; i < width; i++) { const d = re[i] - g.re[i]; num += d * d; den += re[i] * re[i]; }
  const rel = den > 0 ? Math.sqrt(num / den) : 0;
  if (!(rel > 0)) return 16;
  return Math.max(0, -Math.log10(rel));
}

/** Distinct barcodes over a deterministic population — collisions measured. */
export function measureBarcodeDistinct(population = 1024, dim = 233): { distinct: number; probed: number } {
  const seen = new Set<string>();
  for (let p = 0; p < population; p++) {
    const rng = new SeedStream(`barcode:${p}`);
    const v = new Float64Array(dim);
    for (let i = 0; i < dim; i++) v[i] = rng.signed();
    seen.add(bitmapToHex(encodeBitmap(v)));
  }
  return { distinct: seen.size, probed: population };
}

export function measureSuperposition(dim = 1597, population = 512): SuperpositionCapacity {
  const fan = measureFanIn(dim);
  const bar = measureBarcodeDistinct(population);
  const digits = measureSignatureDigits();
  return {
    dim,
    chanceSigma: chanceSigma(dim),
    measuredFanIn: fan.m,
    fanInSimilarity: fan.minSimilarity,
    barcodeBits: MAX_DISTANCE,
    barcodeDistinct: bar.distinct,
    barcodeProbed: bar.probed,
    signatureDigits: digits,
    // 13 signature modes, each resolving 10^digits levels.
    signatureBitsLog2: 13 * digits * Math.log2(10),
  };
}
