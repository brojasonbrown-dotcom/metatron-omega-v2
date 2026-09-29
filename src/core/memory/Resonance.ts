/**
 * Resonance — how strongly a stored memory answers the LIVE field.
 *
 * A recall score built only from text channels answers the question "does
 * this text look like the query". It cannot answer "is this memory resonant
 * with what the machine is doing right now". This module supplies the second
 * half, from telemetry the engine already publishes.
 *
 * LAW (same law the Ω fusion uses):
 *   R = geometric mean over the MEASURED channels.
 *   - a measured-dead channel (0) vetoes the whole score;
 *   - an UNMEASURABLE channel abstains (is excluded from the mean) instead of
 *     scoring as either pass or fail — abstention is not a zero.
 *
 * Channels (all bounded to [0,1] before entering the mean):
 *   fieldCos   — cosine between the memory's vector and the live Ψ projection
 *   coherence  — live field coherence C
 *   closure    — live closure γ of the operating rung (shift autocorrelation)
 *   recency    — φ^(-ageBands): one φ-octave of forgetting per age band
 *   affinity   — cross-scale φ-ratio affinity between capture rung and live rung
 *
 * Pure, allocation-light, no engine imports — the caller passes telemetry in.
 */

import { fuseResonance } from '@metatron/trnn-core/substrate/resonanceBus';

export const PHI = 1.618033988749895;
export const PHI_INV = 1 / PHI;

/**
 * Wolfram-locked irreducible open-system loss (geometric mean of the Nernst,
 * Gibbs, EM and toroidal channels). Below this a memory is structurally
 * silent: it is decayed faster and never blocks a fresher hit.
 */
export const EMERGENT_FLOOR = 0.05625982094858675;
export const RESONANCE_FLOOR = EMERGENT_FLOOR;

/** Live telemetry snapshot the resonance is measured against. */
export interface FieldContext {
  /** Live field coherence C ∈ [0,1]; NaN when not streaming. */
  readonly coherence: number;
  /** Live closure γ ∈ [0,1]; NaN when unmeasured. */
  readonly closure: number;
  /** Rung the engine is operating on, or -1 when unknown. */
  readonly rung: number;
  /** Optional live semantic/field projection to compare memories against. */
  readonly vector?: Float64Array | null;
  /** Wall-clock now (ms) — injected so scoring stays deterministic in tests. */
  readonly now: number;
  /**
   * Circular phase deviation (radians) of the operating rung. Finite → the
   * phase-closure factor γ joins the fusion; absent → γ abstains and the score
   * is identical to the pre-P4 cascade.
   */
  readonly phaseDev?: number;
  /**
   * Opt-in coherence gate: when true and the live C sits under φ⁻², resonance
   * ABSTAINS instead of reporting a confident small number. Off by default —
   * turning it on changes rankings, so it must be a deliberate choice.
   */
  readonly gate?: boolean;
}

export interface ResonanceChannel {
  readonly id: string;
  /** value in [0,1], or NaN to abstain */
  readonly value: number;
}

export interface ResonanceReport {
  /** Geometric mean over measured channels; NaN when everything abstained. */
  readonly value: number;
  readonly channels: readonly ResonanceChannel[];
  readonly counted: number;
  readonly abstained: number;
  /** Lowest measured channel — what is holding this memory back. */
  readonly vetoId: string | null;
  readonly vetoValue: number;
  /** True when the score sits under the emergent floor. */
  readonly subFloor: boolean;
  /** Phase-closure factor actually used, or NaN when it abstained. */
  readonly gamma: number;
  /** True when the coherence gate silenced the fusion. */
  readonly gated: boolean;
}

const BLANK: ResonanceReport = {
  value: NaN,
  channels: [],
  counted: 0,
  abstained: 0,
  vetoId: null,
  vetoValue: NaN,
  subFloor: false,
  gamma: NaN,
  gated: false,
};

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Cosine of two equal-length dense vectors; NaN when either is degenerate. */
export function cosineDense(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return NaN;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na <= 1e-300 || nb <= 1e-300) return NaN;
  return dot / Math.sqrt(na * nb);
}

/**
 * φ-ratio affinity between two ladder rungs.
 *
 * Rungs are φ-spaced by construction, so two structures separated by a whole
 * number of rungs sit at an exact φ^k ratio. Affinity decays one φ-octave per
 * rung of separation: adjacent rungs 1/φ, two rungs 1/φ², identical rungs 1.
 * Unknown rungs abstain (NaN) rather than pretending to be far apart.
 */
export function crossScaleAffinity(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return NaN;
  const d = Math.abs(Math.round(a) - Math.round(b));
  return Math.pow(PHI_INV, d);
}

/** Fibonacci age bands: 1, 2, 3, 5, 8, 13… minutes since capture. */
export const AGE_BAND_MINUTES = [
  1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987,
] as const;

/** Index of the age band a timestamp falls into (0 = freshest). */
export function ageBand(capturedAt: number, now: number): number {
  const mins = Math.max(0, (now - capturedAt) / 60000);
  for (let i = 0; i < AGE_BAND_MINUTES.length; i++) {
    if (mins < AGE_BAND_MINUTES[i]) return i;
  }
  return AGE_BAND_MINUTES.length;
}

/** φ^(-band) recency — never reaches zero, so age alone can never veto. */
export function recencyScore(capturedAt: number, now: number): number {
  if (!Number.isFinite(capturedAt) || capturedAt <= 0) return NaN;
  return Math.pow(PHI_INV, ageBand(capturedAt, now));
}

export interface ResonanceInput {
  /** Memory's own semantic/field vector, when it has one. */
  readonly vector?: Float64Array | null;
  readonly capturedAt?: number;
  /** Rung dominant at capture, or -1/undefined when untagged. */
  readonly rung?: number;
}

/** Measure one memory against the live field.
 *
 * Ω-REAL P4: the arithmetic now lives in the substrate resonance bus, which is
 * the single normative statement of the fusion law. This function only decides
 * WHICH channels exist; it no longer owns HOW they combine. With `phaseDev`
 * unset and `gate` off the bus reduces exactly to the previous geometric mean
 * (certified to 1e-12 with identical ranking in r4-resonance-bus).
 */
export function measureResonance(mem: ResonanceInput, ctx: FieldContext): ResonanceReport {
  const channels: ResonanceChannel[] = [
    {
      id: 'fieldCos',
      value: mem.vector && ctx.vector ? clamp01(cosineDense(mem.vector, ctx.vector)) : NaN,
    },
    { id: 'coherence', value: clamp01(ctx.coherence) },
    { id: 'closure', value: clamp01(ctx.closure) },
    { id: 'recency', value: clamp01(recencyScore(mem.capturedAt ?? NaN, ctx.now)) },
    { id: 'affinity', value: clamp01(crossScaleAffinity(mem.rung ?? -1, ctx.rung)) },
  ];

  const fused = fuseResonance(channels, {
    phaseDev: ctx.phaseDev ?? NaN,
    // The coherence gate is opt-in: switching it on changes what recall
    // returns, so it stays a deliberate caller decision, never a default.
    coherence: ctx.gate ? ctx.coherence : NaN,
  });

  if (fused.counted === 0) {
    return { ...BLANK, channels: fused.channels, abstained: fused.abstained, gated: fused.gated };
  }
  return {
    value: fused.value,
    channels: fused.channels,
    counted: fused.counted,
    abstained: fused.abstained,
    vetoId: fused.vetoId,
    vetoValue: fused.vetoValue,
    subFloor: fused.subFloor,
    gamma: fused.gamma,
    gated: fused.gated,
  };
}

/**
 * Decay multiplier driven by resonance.
 *
 * Sub-floor memories decay φ× faster; strongly resonant memories decay φ⁻¹×
 * slower. An unmeasurable resonance leaves decay exactly at baseline — the
 * substrate never punishes a memory for the engine being offline.
 */
export function resonanceDecayFactor(resonance: number): number {
  if (!Number.isFinite(resonance)) return 1;
  if (resonance < RESONANCE_FLOOR) return PHI;
  if (resonance >= PHI_INV) return PHI_INV;
  return 1;
}
