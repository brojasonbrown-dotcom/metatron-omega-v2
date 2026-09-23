/**
 * Gate S2 — Ω-MAX constants: ISS envelope, per-rung coherence clock,
 * environment operators. Every default must be inert.
 */
import { describe, expect, it } from 'vitest';
import {
  CLAMP_MAX,
  COHERENCE_DELAY,
  COHERENCE_DELAY_LADDER,
  ENV,
  ISS_ENVELOPE,
  ISS_GAIN,
  ISS_INPUT_SUM,
  JURY_GAIN,
  LAMBDA_MEMORY,
  coherenceDelayForRank,
  magneticPhase,
  qrfAttenuation,
  thermalLambda,
} from '../src/core/constants';

describe('S2 — ISS envelope', () => {
  it('the ISS gain is finite and the homogeneous part is a contraction', () => {
    expect(JURY_GAIN).toBeLessThan(1);
    expect(ISS_INPUT_SUM).toBeGreaterThan(0);
    expect(Number.isFinite(ISS_GAIN)).toBe(true);
    expect(ISS_GAIN).toBe(ISS_INPUT_SUM / (1 - JURY_GAIN));
  });

  it('unit-bounded drives stay strictly inside the clamp — the clamp is a fault detector', () => {
    expect(ISS_ENVELOPE).toBeLessThan(CLAMP_MAX);
  });
});

describe('S2 — per-rung coherence clock', () => {
  it('uniform is exactly the historical constant at every rank', () => {
    for (let r = 0; r < 24; r++) expect(coherenceDelayForRank(r)).toBe(COHERENCE_DELAY);
    for (let r = 0; r < 24; r++) expect(coherenceDelayForRank(r, 'uniform')).toBe(COHERENCE_DELAY);
  });

  it('the fibonacci ladder is non-decreasing and clamped at both ends', () => {
    for (let i = 1; i < COHERENCE_DELAY_LADDER.length; i++) {
      expect(COHERENCE_DELAY_LADDER[i]).toBeGreaterThanOrEqual(COHERENCE_DELAY_LADDER[i - 1]);
    }
    expect(coherenceDelayForRank(-5, 'fibonacci')).toBe(COHERENCE_DELAY_LADDER[0]);
    expect(coherenceDelayForRank(999, 'fibonacci')).toBe(
      COHERENCE_DELAY_LADDER[COHERENCE_DELAY_LADDER.length - 1],
    );
  });
});

describe('S2 — environment operators are inert at their defaults', () => {
  it('T = 0 leaves the memory kernel untouched, T > 0 only shrinks it', () => {
    expect(thermalLambda(0)).toBe(LAMBDA_MEMORY);
    for (const t of [0.1, 1, 10, 1000]) {
      const l = thermalLambda(t);
      expect(l).toBeLessThan(LAMBDA_MEMORY);
      expect(l).toBeGreaterThan(0);
    }
    expect(thermalLambda(2)).toBeLessThan(thermalLambda(1));
  });

  it('B = 0 is exactly zero phase, and the bias is linear', () => {
    expect(magneticPhase(0)).toBe(0);
    expect(magneticPhase(2)).toBe(2 * ENV.magneticScale);
  });

  it('QRF attenuation is 1 at the origin and monotone decreasing', () => {
    expect(qrfAttenuation(0)).toBe(1);
    let prev = 1;
    for (let n = 1; n <= 300; n += 7) {
      const a = qrfAttenuation(n);
      expect(a).toBeLessThan(prev);
      expect(a).toBeGreaterThan(0);
      prev = a;
    }
  });
});
