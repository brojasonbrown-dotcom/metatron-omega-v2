/**
 * Ω-CONSISTENCY K2 — certification of the graded witnesses on the live spine.
 *
 * Three claims, each falsifiable:
 *   1. `field.roughness` (Sobolev h1/l2) separates "same shape, louder" from
 *      "different shape" — a pure rescale must not move it.
 *   2. `field.leakage` / continuity are measurements of the window seam, so a
 *      smooth periodic window must read lower leakage than a sawtooth one.
 *   3. `field.persistence` is a novelty ratio in [0,1] against a *stable*
 *      gated memory — the cell must certify contraction < 1.
 */
import { describe, it, expect } from 'vitest';
import { spectralMetrics } from '@/ui/omega/cognitiveDriver';
import { CHANNEL_IDS } from '@/core/analysis/channelSampler';
import { operator } from '@metatron/trnn-core';
import type { SpectralView } from '@/core/omega/omegaProtocol';

const view = (rank: number, sig: number[]): SpectralView =>
  ({
    rank,
    n: 13,
    source: 'test',
    shellPoints: 233,
    shell: { roundtrip: 1e-13, gramDefect: 0, width: 16 },
    radial: { roundtrip: 1e-14, gramDefect: 0, width: 8 },
    signature: sig,
  }) as unknown as SpectralView;

const A = [0.9, 0.31, 0.4, 0.12, 0.22, 0.05, 0.19, 0.03, 0.11, 0.02, 0.07, 0.01, 0.04];
const B = [0.7, 0.52, 0.2, 0.33, 0.09, 0.24, 0.06, 0.17, 0.02, 0.13, 0.01, 0.08, 0.01];
const scale = (v: number[], k: number) => v.map((x) => x * k);
const smooth = Array.from({ length: 13 }, (_, i) => Math.cos((2 * Math.PI * i) / 13));
const sawtooth = Array.from({ length: 13 }, (_, i) => i / 13);

describe('Ω-CONSISTENCY · graded witnesses', () => {
  it('roughness abstains with no comparable previous pass', () => {
    expect(Number.isNaN(spectralMetrics(null, view(9, A)).roughness)).toBe(true);
    expect(Number.isNaN(spectralMetrics(view(9, A), view(10, B)).roughness)).toBe(true);
  });

  it('roughness is scale-invariant, where drift is not', () => {
    const soft = spectralMetrics(view(9, A), view(9, B));
    const loud = spectralMetrics(view(9, scale(A, 7)), view(9, scale(B, 7)));
    expect(loud.roughness).toBeCloseTo(soft.roughness, 9);
    expect(loud.drift / soft.drift).toBeCloseTo(7, 6);
  });

  it('roughness is at least 1 — h1 can never be below l2', () => {
    const r = spectralMetrics(view(9, A), view(9, B)).roughness;
    expect(r).toBeGreaterThanOrEqual(1 - 1e-12);
  });

  it('leakage reads the seam: a sawtooth window leaks more than a pure mode', () => {
    const clean = spectralMetrics(null, view(9, smooth)).leakage;
    const torn = spectralMetrics(null, view(9, sawtooth)).leakage;
    expect(Number.isFinite(clean)).toBe(true);
    expect(torn).toBeGreaterThan(clean);
  });

  it('continuity is a measured gain, never an assumption', () => {
    const c = spectralMetrics(null, view(9, sawtooth)).continuity;
    expect(Number.isFinite(c)).toBe(true);
  });

  it('persistence is a [0,1] novelty against a certifiably stable cell', () => {
    const cell = new operator.RecurrentModeCell({ modes: 13 });
    expect(cell.certify().stable).toBe(true);
    expect(cell.certify().contraction).toBeLessThan(1);
    expect(Number.isNaN(spectralMetrics(null, view(9, A), cell).persistence)).toBe(true);
    const p = spectralMetrics(view(9, A), view(9, B), cell).persistence;
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it('all three are first-class analysis channels', () => {
    for (const id of ['field.roughness', 'field.leakage', 'field.persistence'] as const) {
      expect(CHANNEL_IDS).toContain(id);
    }
  });
});
