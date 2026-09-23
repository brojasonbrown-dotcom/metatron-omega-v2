/**
 * Ω-COG — certification of the three cold-edge primitives.
 *
 * The driver's side effects (worker pulls, idle training) are integration
 * concerns; what must be proven here is that every number it publishes is a
 * measurement: drift abstains without a predecessor, the salience band is
 * refused until it has samples, and the sampler never repeats a pass.
 */
import { describe, it, expect } from 'vitest';
import {
  spectralMetrics,
  signatureEntropy,
  warmestRank,
  DriftBand,
  SALIENCE_WARMUP,
} from '@/ui/omega/cognitiveDriver';
import { sampleFrame, freshCursors, frameHasData } from '@/core/analysis/channelSampler';
import type { SpectralView } from '@/core/omega/omegaProtocol';

const view = (rank: number, sig: number[], roundtrip = 1e-12): SpectralView =>
  ({
    rank,
    n: 13,
    source: 'test',
    shellPoints: 233,
    shell: { roundtrip, gramDefect: 0, width: 16 },
    radial: { roundtrip: roundtrip / 2, gramDefect: 0, width: 8 },
    signature: sig,
  }) as unknown as SpectralView;

describe('Ω-COG · spectral measurement', () => {
  it('abstains on the first pass rather than reporting zero drift', () => {
    const m = spectralMetrics(null, view(3, [1, 0, 0]));
    expect(Number.isNaN(m.drift)).toBe(true);
    expect(m.residual).toBeCloseTo(1e-12, 18);
  });

  it('measures the exact L2 signature distance between passes', () => {
    const m = spectralMetrics(view(3, [0, 0, 0]), view(3, [3, 4, 0]));
    expect(m.drift).toBeCloseTo(5, 12);
  });

  it('abstains when the rung changed (different basis, not drift)', () => {
    const m = spectralMetrics(view(3, [0, 0, 0]), view(4, [3, 4, 0]));
    expect(Number.isNaN(m.drift)).toBe(true);
  });

  it('entropy is 0 for a single active slot and 1 for a flat spectrum', () => {
    expect(signatureEntropy([1, 0, 0, 0])).toBe(0);
    expect(signatureEntropy([1, 1, 1, 1])).toBeCloseTo(1, 12);
    expect(signatureEntropy([0, 0, 0])).toBe(0);
  });
});

describe('Ω-COG · salience band', () => {
  it('refuses to call anything salient before it has samples', () => {
    const b = new DriftBand();
    for (let i = 0; i < SALIENCE_WARMUP - 1; i++) b.push(1);
    expect(b.salient(1000)).toBe(false);
  });

  it('flags an outlier once the band is measured', () => {
    const b = new DriftBand();
    for (let i = 0; i < 32; i++) b.push(1 + (i % 2) * 0.01);
    expect(b.count).toBe(32);
    expect(b.salient(1.005)).toBe(false);
    expect(b.salient(2)).toBe(true);
  });

  it('ignores non-finite readings', () => {
    const b = new DriftBand();
    b.push(NaN);
    expect(b.count).toBe(0);
    expect(Number.isNaN(b.average)).toBe(true);
  });
});

describe('Ω-COG · rung selection', () => {
  const rungs = [
    { warm: false, coherence: 0.99 },
    { warm: true, coherence: 0.41 },
    { warm: true, coherence: 0.77 },
  ];

  it('picks the warmest stepped rung, never a cold one', () => {
    expect(warmestRank(rungs, [0, 1, 2])).toBe(2);
  });

  it('falls back to the first stepped rung when none is warm', () => {
    expect(warmestRank([{ warm: false, coherence: 1 }], [0])).toBe(0);
  });

  it('returns null when nothing is stepping', () => {
    expect(warmestRank(rungs, [])).toBeNull();
  });
});

describe('Ω-COG · sampler integration', () => {
  it('records a spectral pass once and then reports gaps', () => {
    const cur = freshCursors();
    const input = {
      engine: null,
      memory: null,
      sense: null,
      spectral: { passes: 1, drift: 0.5, residual: 1e-12, entropy: 0.8 },
    };
    const a = sampleFrame(input, cur);
    expect(a['spectral.drift']).toBe(0.5);
    expect(frameHasData(a)).toBe(true);
    const b = sampleFrame(input, cur);
    expect(Number.isNaN(b['spectral.drift'])).toBe(true);
    expect(frameHasData(b)).toBe(false);
  });
});
