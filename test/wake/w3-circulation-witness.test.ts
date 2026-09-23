/**
 * Ω-OPERATOR N2′ — certification of the live circulation witness.
 *
 * The claim being tested is narrow and falsifiable: `field.modeCirculation` is
 * a *driver-invariant* companion to drift. Drift rises whenever the input is
 * driven harder; circulation must not, because it is a ratio of two parts of
 * the same mode-space current. If that invariance fails, the channel is a
 * second amplitude meter wearing a different name and is worthless.
 */
import { describe, it, expect } from 'vitest';
import { spectralMetrics } from '@/ui/omega/cognitiveDriver';
import { CHANNEL_IDS } from '@/core/analysis/channelSampler';
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

describe('Ω-OPERATOR · circulation witness on the live spine', () => {
  it('abstains rather than guessing when there is no previous pass', () => {
    expect(Number.isNaN(spectralMetrics(null, view(9, A)).circulation)).toBe(true);
  });

  it('abstains across a rung change — different rungs are different instruments', () => {
    expect(Number.isNaN(spectralMetrics(view(9, A), view(10, B)).circulation)).toBe(true);
  });

  it('reports a fraction in [0,1] for a real transition', () => {
    const c = spectralMetrics(view(9, A), view(9, B)).circulation;
    expect(Number.isFinite(c)).toBe(true);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });

  it('is invariant to driving the field ten times harder, where drift is not', () => {
    const soft = spectralMetrics(view(9, A), view(9, B));
    const loud = spectralMetrics(view(9, scale(A, 10)), view(9, scale(B, 10)));
    expect(loud.circulation).toBeCloseTo(soft.circulation, 9);
    // The control: drift really does inflate, so the invariance above is a
    // property of circulation and not of the fixture being inert.
    expect(loud.drift / soft.drift).toBeCloseTo(10, 6);
  });

  it('abstains on a degenerate (zero) current instead of publishing 0 or 1', () => {
    const c = spectralMetrics(view(9, A), view(9, A)).circulation;
    expect(Number.isNaN(c)).toBe(true);
  });

  it('is registered as a first-class analysis channel', () => {
    expect(CHANNEL_IDS).toContain('field.modeCirculation');
  });
});
