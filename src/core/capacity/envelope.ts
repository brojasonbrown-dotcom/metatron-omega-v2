/**
 * Ω-CAPACITY C1 — the real ceiling of one tick.
 *
 * The measurement is deliberately the *whole* operation the engine performs:
 * a unitary forward transform and its inverse. Timing a forward-only FFT would
 * flatter the substrate by a factor of two and would not prove the transform
 * was correct. Here the round-trip error is measured in the same loop, so a
 * fast number that is wrong cannot be reported as capacity.
 */

import { fftUnitary } from '@metatron/trnn-core/spectral/fft';
import { bandLimit } from '@metatron/trnn-core/operator/resample';
import { computeMemoryCaps } from '@/core/memory/MemoryGovernor';
import type { EnvelopeCapacity, RungCapacity } from './types';

/** φ-ladder rungs worth measuring: signature, sensory, corpus, field, deep. */
export const PROBE_RUNGS = [13, 89, 233, 987, 2584] as const;

function now(): number {
  const p = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof p?.now === 'function' ? p.now() : Date.now();
}

/** Deterministic, non-degenerate test field — no RNG, so runs compare. */
function probeField(n: number): { re: Float64Array; im: Float64Array } {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / n;
    re[i] = Math.cos(6.283185307179586 * 1.618033988749895 * t) + 0.5 * Math.cos(6.283185307179586 * 3 * t);
    im[i] = Math.sin(6.283185307179586 * 2 * t) * 0.25;
  }
  return { re, im };
}

function relError(a: Float64Array, b: Float64Array): number {
  let num = 0, den = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    num += d * d;
    den += a[i] * a[i];
  }
  return den > 0 ? Math.sqrt(num / den) : 0;
}

/**
 * Measure one rung. `budgetMs` bounds the loop rather than a fixed iteration
 * count, so the probe costs the same on a fast and a slow host.
 */
export function measureRung(width: number, budgetMs = 12): RungCapacity {
  const { re, im } = probeField(width);
  const re0 = Float64Array.from(re);
  const im0 = Float64Array.from(im);

  // Warm-up: the first call pays for Bluestein table construction at this
  // width, and charging that to steady-state throughput would understate it.
  {
    const f = fftUnitary(Float64Array.from(re0), Float64Array.from(im0));
    fftUnitary(f.re, f.im, true);
  }

  let iters = 0;
  let err = 0;
  const t0 = now();
  do {
    const f = fftUnitary(Float64Array.from(re0), Float64Array.from(im0));
    const g = fftUnitary(f.re, f.im, true);
    if (iters === 0) err = relError(re0, g.re);
    iters++;
  } while (now() - t0 < budgetMs);
  const elapsed = Math.max(now() - t0, 1e-3);

  const perSecond = (iters * 1000) / elapsed;
  return {
    width,
    bandLimit: bandLimit(width),
    bytesPerTick: width * 2 * 8,
    // One round trip is two transforms.
    fftPerSecond: perSecond * 2,
    numbersPerSecond: perSecond * width * 2 * 2,
    ticksPerSecond: perSecond,
    roundTripError: err,
  };
}

export function measureEnvelope(budgetMsPerRung = 12): EnvelopeCapacity {
  const t0 = now();
  const caps = computeMemoryCaps();
  const rungs = PROBE_RUNGS.map((w) => measureRung(w, budgetMsPerRung));

  // Resident numbers: the tape holds 40-mode top-K frames, episodes ~2 KB of
  // float64. Both figures come from the governor's own byte accounting, so the
  // total cannot drift away from what the layers actually allocate.
  const residentNumbers = caps.maxTapeFrames * 40 + caps.maxEpisodes * 256;

  return {
    workingBytes: caps.ramBytes,
    ceilingBytes: caps.ceilingBytes,
    provenance: caps.provenance,
    maxTapeFrames: caps.maxTapeFrames,
    maxEpisodes: caps.maxEpisodes,
    maxSensoryAtoms: caps.maxSensoryAtoms,
    residentNumbers,
    rungs,
    probeMs: now() - t0,
  };
}
