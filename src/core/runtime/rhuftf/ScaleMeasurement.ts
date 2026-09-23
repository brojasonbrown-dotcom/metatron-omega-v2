/**
 * RHUFT-F per-scale measurement interface.  Phase 4 · Step 1 infrastructure.
 *
 * Each scale n ∈ [0..8] gets a `ScaleMeasurement` implementation that:
 *   1. Reads live amplitudes from ShadowStateTape (never mutates ψ).
 *   2. Compares against Phase-3 stability targets in
 *      `docs/v13_rebuild/scales/n<k>_stability.md`.
 *   3. Writes only to `m` (memory manifestation) and `gamma` (diagnostics)
 *      channels of the FieldStateN. `psi`, `psiHat`, `u`, `y` are read-only
 *      to this module.
 *
 * The registry lets the metric bank + panels iterate a stable enumeration.
 * Registration is opt-in per scale via `FLAG_RHUFTF_FRAMEWORK_<n>`; when
 * off, the scale simply doesn't appear in the registry.
 */

import type { FieldStateN } from '@metatron/field-kernel-core';

export interface ScaleMeasurementResult {
  readonly scale: number;
  /** Closure vector deviation ‖y − target‖². NaN when target not injected. */
  readonly closureResidual: number;
  /** Scalar closure score in [candidate 0..1] — spec-defined per scale. */
  readonly closureScore: number;
  /** Symmetry witness: 1 = candidate invariant holds, 0 = broken. */
  readonly invariantScore: number;
  /** Free-form per-scale diagnostics (written into γ). */
  readonly gamma: Float64Array;
}

export interface ScaleMeasurementContext {
  readonly tSeconds: number;
  readonly carrierHz: number;
  readonly tick: number;
}

export interface ScaleMeasurement {
  readonly scale: number;
  readonly name: string;
  readonly nodes: number;
  /**
   * Compute measurement result for the given state. MUST NOT mutate
   * `state.psi`, `state.psiHat`, `state.u`, or `state.y`. MAY write to
   * `state.m` and `state.gamma`. Returns the result for the metric bank.
   */
  measure(state: FieldStateN, ctx: ScaleMeasurementContext): ScaleMeasurementResult;
}

// ───────────────────────── scale ↔ sensor binding ─────────────────────────
//
// A rung is a SCALE of spacetime only if something actually reads that scale.
// Naming a rung "Galactic" does not sample a band; a microphone does. So every
// rung declares either a physical passband [fLo, fHi] in Hz or `null`, and the
// binding step marks it `measured` only when a real frontend covers that band
// AND satisfies Nyquist on it. Everything else is `inferred` and MUST NOT be
// scored as if it had been observed.

/** Physical passband of a rung, in Hz. */
export interface ScaleBand {
  readonly fLo: number;
  readonly fHi: number;
}

/**
 * A real sensory frontend's passband. `sampleRateHz` is omitted for
 * integrating (non-sampled) detectors such as the retina, where the Nyquist
 * criterion does not apply to the carrier frequency.
 */
export interface SensorPassband {
  readonly sensor: string;
  readonly fLo: number;
  readonly fHi: number;
  readonly sampleRateHz?: number;
}

export type ScaleProvenance = 'measured' | 'inferred';

export interface ScaleBinding {
  readonly scale: number;
  readonly nodes: number;
  readonly band: ScaleBand | null;
  readonly sensor: string | null;
  readonly provenance: ScaleProvenance;
  /** log₂(fHi/fLo) — band width in octaves. NaN when no band is declared. */
  readonly octaves: number;
  /** log_φ(fHi/fLo) — band width in φ-rungs. NaN when no band is declared. */
  readonly phiRungs: number;
  /** True when the bound sensor samples fast enough for the band's top edge. */
  readonly nyquistOk: boolean;
}

const LN_PHI_BAND = Math.log(1.6180339887498948482045868343656381);

/** Band width in octaves. NaN for a null/degenerate band. */
export function bandOctaves(band: ScaleBand | null): number {
  if (!band || !(band.fLo > 0) || !(band.fHi > 0)) return NaN;
  return Math.log2(band.fHi / band.fLo);
}

/** Band width in φ-rungs — the ladder's own unit. */
export function bandPhiRungs(band: ScaleBand | null): number {
  if (!band || !(band.fLo > 0) || !(band.fHi > 0)) return NaN;
  return Math.log(band.fHi / band.fLo) / LN_PHI_BAND;
}

/** Sensor covers the band edge-to-edge. */
export function sensorCovers(s: SensorPassband, band: ScaleBand): boolean {
  return s.fLo <= band.fLo && s.fHi >= band.fHi;
}

/** Nyquist holds: a sampled channel needs fs ≥ 2·fHi. Unsampled → true. */
export function sensorNyquistOk(s: SensorPassband, band: ScaleBand): boolean {
  if (s.sampleRateHz === undefined) return true;
  return Number.isFinite(s.sampleRateHz) && s.sampleRateHz >= 2 * band.fHi;
}

/**
 * Bind rungs to frontends. Deterministic: the first sensor in `sensors` that
 * both covers the band and satisfies Nyquist wins, so the result is stable
 * under repeated calls with the same inputs.
 */
export function bindScaleSensors(
  shapes: readonly { scale: number; nodes: number }[],
  bands: readonly (ScaleBand | null)[],
  sensors: readonly SensorPassband[],
): readonly ScaleBinding[] {
  return shapes.map((sh) => {
    const band = bands[sh.scale] ?? null;
    const octaves = bandOctaves(band);
    const phiRungs = bandPhiRungs(band);
    if (!band) {
      return {
        scale: sh.scale, nodes: sh.nodes, band: null, sensor: null,
        provenance: 'inferred' as const, octaves, phiRungs, nyquistOk: false,
      };
    }
    const hit = sensors.find((s) => sensorCovers(s, band) && sensorNyquistOk(s, band));
    return {
      scale: sh.scale,
      nodes: sh.nodes,
      band,
      sensor: hit ? hit.sensor : null,
      provenance: hit ? ('measured' as const) : ('inferred' as const),
      octaves,
      phiRungs,
      nyquistOk: hit ? sensorNyquistOk(hit, band) : false,
    };
  });
}

class ScaleMeasurementRegistry {
  private readonly byScale = new Map<number, ScaleMeasurement>();

  register(m: ScaleMeasurement): void {
    if (this.byScale.has(m.scale)) {
      throw new Error(`ScaleMeasurement already registered for scale ${m.scale}`);
    }
    this.byScale.set(m.scale, m);
  }

  get(scale: number): ScaleMeasurement | undefined {
    return this.byScale.get(scale);
  }

  list(): readonly ScaleMeasurement[] {
    return Array.from(this.byScale.values()).sort((a, b) => a.scale - b.scale);
  }

  clear(): void { this.byScale.clear(); }
}

export const scaleMeasurementRegistry = new ScaleMeasurementRegistry();
