/**
 * Ω-P6 — multi-modal fusion.
 *
 * k channels are summed with a 1/√k weight. That factor is not cosmetic: for
 * channels whose phases are mutually incoherent (the generic case for distinct
 * modalities) the expected max-norm of the sum grows like √k, so dividing by
 * √k keeps the fused peak on the order of a single channel's peak. Coherent
 * channels — the same signal arriving twice — still reinforce, they just do so
 * inside the bound rather than through it.
 *
 * After summation the fused field is pushed through `boundField`, so the hard
 * law ‖v‖_inf ≤ φ holds for every fusion regardless of channel count or gain.
 */

import { maxNorm, zeroField, type CField } from '../core/complex';
import { boundField, SENSE_BOUND } from './encode';

export interface FusionInput {
  readonly id: string;
  readonly field: CField;
  /** Per-channel gain, clamped to [0, 1]. */
  readonly gain?: number;
}

export interface ChannelReport {
  readonly id: string;
  readonly gain: number;
  readonly peak: number;
  readonly energy: number;
  /** Cosine alignment with the fused result, in [-1, 1]. */
  readonly alignment: number;
}

export interface FusionReport {
  readonly channels: readonly ChannelReport[];
  readonly count: number;
  /** 1/√k actually applied. */
  readonly weight: number;
  readonly rawPeak: number;
  readonly peak: number;
  readonly scale: number;
  readonly energy: number;
  /** True when the fused field respects ‖v‖_inf ≤ φ (must always be true). */
  readonly withinBound: boolean;
}

function alignmentOf(a: CField, b: CField): number {
  const n = Math.min(a.n, b.n);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a.re[i] * b.re[i] + a.im[i] * b.im[i];
    na += a.re[i] * a.re[i] + a.im[i] * a.im[i];
    nb += b.re[i] * b.re[i] + b.im[i] * b.im[i];
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * Fuse `inputs` into `out` (must already be sized; channels of a different
 * node count are truncated to the overlap — callers transport first).
 */
export function fuseChannels(inputs: readonly FusionInput[], out: CField, bound = SENSE_BOUND): FusionReport {
  zeroField(out);
  const live = inputs.filter((c) => c.field.n > 0 && (c.gain ?? 1) > 0);
  const k = live.length;
  if (k === 0) {
    return {
      channels: [],
      count: 0,
      weight: 0,
      rawPeak: 0,
      peak: 0,
      scale: 1,
      energy: 0,
      withinBound: true,
    };
  }
  const w = 1 / Math.sqrt(k);
  for (const c of live) {
    const g = Math.min(1, Math.max(0, c.gain ?? 1)) * w;
    const n = Math.min(out.n, c.field.n);
    for (let i = 0; i < n; i++) {
      out.re[i] += g * c.field.re[i];
      out.im[i] += g * c.field.im[i];
    }
  }
  const b = boundField(out, bound);
  let energy = 0;
  for (let i = 0; i < out.n; i++) energy += out.re[i] * out.re[i] + out.im[i] * out.im[i];

  const channels: ChannelReport[] = live.map((c) => {
    let e = 0;
    for (let i = 0; i < c.field.n; i++) e += c.field.re[i] * c.field.re[i] + c.field.im[i] * c.field.im[i];
    return {
      id: c.id,
      gain: Math.min(1, Math.max(0, c.gain ?? 1)),
      peak: maxNorm(c.field),
      energy: e,
      alignment: alignmentOf(c.field, out),
    };
  });

  return {
    channels,
    count: k,
    weight: w,
    rawPeak: b.rawPeak,
    peak: b.peak,
    scale: b.scale,
    energy,
    withinBound: maxNorm(out) <= bound + 1e-12,
  };
}
