import { describe, expect, it } from 'vitest';
import {
  abDerivative,
  abMetric,
  abTransfer,
  finiteDifference,
  indexResample,
  runABSuite,
} from '../src/operator/abHarness';
import type { CField } from '../src/core/complex';

const TWO_PI = 2 * Math.PI;

function build(n: number, f: (u: number) => number): CField {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let j = 0; j < n; j++) re[j] = f((TWO_PI * j) / n);
  return { re, im, n };
}

const N = 233;
const field = build(N, (u) => Math.sin(3 * u) + 0.5 * Math.cos(8 * u));
const truth = build(N, (u) => 3 * Math.cos(3 * u) - 4 * Math.sin(8 * u));
/** Band-limited inside rung 89's band, so the transfer test measures method, not content. */
const narrowSafe = build(N, (u) => Math.sin(3 * u) + 0.5 * Math.cos(8 * u));

describe('O6 — A/B harness: legacy vs operator path', () => {
  it('A1 derivative — the spectral path beats the finite-difference stencil by orders of magnitude', () => {
    const v = abDerivative(field, truth);
    expect(v.wins).toBe(true);
    expect(v.operator).toBeLessThan(1e-12);
    expect(v.improvement).toBeGreaterThan(1e6);
  });

  it('A2 transfer — spectral round-trip is exact where index resampling aliases', () => {
    const v = abTransfer(narrowSafe, 89);
    expect(v.wins).toBe(true);
    expect(v.operator).toBeLessThan(1e-11);
    expect(v.legacy).toBeGreaterThan(v.operator);
  });

  it('A3 metric — H¹ separates roughness that L² cannot see', () => {
    const zero = build(N, () => 0);
    const smooth = build(N, (u) => 0.1 * Math.cos(u));
    const rough = build(N, (u) => 0.1 * Math.cos(21 * u));
    const v = abMetric(zero, smooth, rough);
    // L² cannot tell them apart at all: separation ≈ 1.
    expect(Math.abs(v.legacy - 1)).toBeLessThan(1e-9);
    expect(v.operator).toBeGreaterThan(10);
    expect(v.wins).toBe(true);
  });

  it('the legacy references are honest implementations, not straw men', () => {
    // Central difference really is second-order accurate; it just is not exact.
    const err = finiteDifference(field);
    let worst = 0;
    for (let i = 0; i < N; i++) worst = Math.max(worst, Math.abs(err.re[i] - truth.re[i]));
    expect(worst).toBeLessThan(0.05);
    expect(worst).toBeGreaterThan(1e-6);
    // Index resampling really does reproduce the field on a matched grid.
    expect(indexResample(field, N).re[7]).toBeCloseTo(field.re[7], 15);
  });

  it('the suite reports a verdict per phase and a combined ruling', () => {
    const zero = build(N, () => 0);
    const smooth = build(N, (u) => 0.1 * Math.cos(u));
    const rough = build(N, (u) => 0.1 * Math.cos(21 * u));
    const r = runABSuite(field, truth, 89, smooth, rough);
    expect(r.verdicts.map((v) => v.name)).toEqual(['derivative', 'transfer', 'metric']);
    // metric compares `field` against the two candidates here, so only assert
    // the two phases whose claim is unconditional.
    expect(r.verdicts[0].wins).toBe(true);
    expect(r.verdicts[1].wins).toBe(true);
    expect(typeof r.allWin).toBe('boolean');
  });
});
