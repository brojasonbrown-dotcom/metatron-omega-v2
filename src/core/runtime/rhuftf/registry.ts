/**
 * RHUFT-F registry — Phase 4 · Step 10.
 *
 * Central bootstrap for the n=0..8 measurement modules and their default
 * ShadowStateTape shapes. Enables the metric bank to iterate a single
 * canonical enumeration instead of hard-coding each scale.
 *
 * Registration remains opt-in per-scale via `FLAG_RHUFTF_FRAMEWORK_<n>`
 * (default OFF). A `*_Forced` sibling bypasses the flags for offline
 * scripts, cross-runtime harnesses, and the Phase-2 Lyapunov freeze test.
 *
 * Node counts mirror each module's spec:
 *   n=0 Septenary       → 7
 *   n=1 Quantum         → 55
 *   n=2 Atomic          → 7
 *   n=3 Geometric       → 13
 *   n=4 Color/Music     → 9
 *   n=5 Hebrew          → 22
 *   n=6 Galactic        → 55
 *   n=7 Sub-Planckian   → 55  (module is runtime-sized; the tape allocates a
 *                              stable 55-node buffer so cross-scale drift
 *                              with n=6/8 has shared modes)
 *   n=8 Hyper-Galactic  → 55
 */

import type { ScaleShape } from '../ShadowStateTape';
import type { ScaleMeasurement } from './ScaleMeasurement';
import { scaleMeasurementRegistry } from './ScaleMeasurement';

import {
  registerF1SeptenaryMeasurement,
  registerF1SeptenaryMeasurementForced,
} from './F1SeptenaryMeasurement';
import {
  registerF2QuantumMeasurement,
  registerF2QuantumMeasurementForced,
} from './F2QuantumMeasurement';
import {
  registerF3AtomicMeasurement,
  registerF3AtomicMeasurementForced,
} from './F3AtomicMeasurement';
import {
  registerF4GeometricMeasurement,
  registerF4GeometricMeasurementForced,
} from './F4GeometricMeasurement';
import {
  registerF5ColorMusicMeasurement,
  registerF5ColorMusicMeasurementForced,
} from './F5ColorMusicMeasurement';
import {
  registerF6HebrewMeasurement,
  registerF6HebrewMeasurementForced,
} from './F6HebrewMeasurement';
import {
  registerF7GalacticMeasurement,
  registerF7GalacticMeasurementForced,
} from './F7GalacticMeasurement';
import {
  registerF8SubPlanckianMeasurement,
  registerF8SubPlanckianMeasurementForced,
} from './F8SubPlanckianMeasurement';
import {
  registerF9HyperGalacticMeasurement,
  registerF9HyperGalacticMeasurementForced,
} from './F9HyperGalacticMeasurement';

/** Canonical per-scale shape ladder for the ShadowStateTape. */
export const RHUFTF_SCALE_SHAPES: readonly ScaleShape[] = Object.freeze([
  { scale: 0, nodes: 7 },
  { scale: 1, nodes: 55 },
  { scale: 2, nodes: 7 },
  { scale: 3, nodes: 13 },
  { scale: 4, nodes: 9 },
  { scale: 5, nodes: 22 },
  { scale: 6, nodes: 55 },
  { scale: 7, nodes: 55 },
  { scale: 8, nodes: 55 },
]);

export function rhuftfScaleShapes(): readonly ScaleShape[] {
  return RHUFTF_SCALE_SHAPES;
}

/**
 * Declared physical passband per rung, in Hz — `null` where no band is
 * physically defined for that rung's quantity.
 *
 * Only n=4 (Colour/Music) carries a carrier band this ladder actually samples:
 * the audible range, which a microphone at 48 kHz covers with Nyquist to
 * spare. Every other rung is `null`, hence `inferred`, hence never scored as
 * an observation. That is the honest state of the ladder: eight of nine rungs
 * are named scales with no instrument behind them. Adding a band here is a
 * claim that a frontend reads it, and `bindScaleSensors` will refuse the claim
 * unless a declared sensor covers the band and satisfies Nyquist.
 */
export const RHUFTF_SCALE_BANDS: readonly (ScaleBand | null)[] = Object.freeze([
  null,                        // n=0 Septenary      — partition index, not a frequency
  null,                        // n=1 Quantum        — no sampled carrier in this build
  null,                        // n=2 Atomic         — shell index, not a frequency
  null,                        // n=3 Geometric      — dihedral angles, dimensionless
  { fLo: 20, fHi: 20000 },     // n=4 Colour/Music   — audible band, 9.965784285 octaves
  null,                        // n=5 Hebrew         — symbol channel, not a frequency
  null,                        // n=6 Galactic       — inferred
  null,                        // n=7 Sub-Planckian  — inferred
  null,                        // n=8 Hyper-Galactic — inferred
]);

/**
 * Passbands of the frontends that actually exist in `src/core/sensory`.
 *   - `audio`  AudioFrontend/AudioCortex, 48 kHz capture (Nyquist 24 kHz).
 *   - `vision` VideoFrontend/VisionEncoder — an integrating detector, so no
 *              Nyquist criterion applies to the optical carrier; the visible
 *              band spans only 0.802554 of one octave.
 *   - `imu`    IMUFrontend, ~377 Hz device motion.
 *   - `screen` ScreenFrontend, 5–15 Hz frame capture (Nyquist 7.5 Hz).
 * The optical and acoustic bands are separated by 44.2894 octaves =
 * 63.7953 φ-rungs of completely unsampled spacetime.
 */
export const RHUFTF_SENSOR_PASSBANDS: readonly SensorPassband[] = Object.freeze([
  { sensor: 'audio', fLo: 20, fHi: 20000, sampleRateHz: 48000 },
  { sensor: 'imu', fLo: 0.1, fHi: 188.5, sampleRateHz: 377 },
  { sensor: 'screen', fLo: 0.5, fHi: 7.5, sampleRateHz: 15 },
  { sensor: 'vision', fLo: 4.3e14, fHi: 7.5e14 },
]);

/** Rung → sensor binding with `measured`/`inferred` provenance. */
export function rhuftfScaleBindings(): readonly ScaleBinding[] {
  return bindScaleSensors(RHUFTF_SCALE_SHAPES, RHUFTF_SCALE_BANDS, RHUFTF_SENSOR_PASSBANDS);
}

/**
 * Flag-respecting bulk register. Returns the ordered set of scale indices
 * that were actually activated (i.e. whose `FLAG_RHUFTF_FRAMEWORK_<n>` was
 * on). Idempotent — safe to call from HMR, tests, or panel bootstraps.
 */
export function registerAllRhuftfMeasurements(): readonly number[] {
  const activated: number[] = [];
  if (registerF1SeptenaryMeasurement()) activated.push(0);
  if (registerF2QuantumMeasurement()) activated.push(1);
  if (registerF3AtomicMeasurement()) activated.push(2);
  if (registerF4GeometricMeasurement()) activated.push(3);
  if (registerF5ColorMusicMeasurement()) activated.push(4);
  if (registerF6HebrewMeasurement()) activated.push(5);
  if (registerF7GalacticMeasurement()) activated.push(6);
  if (registerF8SubPlanckianMeasurement()) activated.push(7);
  if (registerF9HyperGalacticMeasurement()) activated.push(8);
  return activated;
}

/**
 * Bypasses every `FLAG_RHUFTF_FRAMEWORK_<n>`; intended for offline scripts
 * (freeze test, cross-runtime harness, Phase-4 truth suites). Never call
 * from client-facing code paths.
 */
export function registerAllRhuftfMeasurementsForced(): readonly number[] {
  registerF1SeptenaryMeasurementForced();
  registerF2QuantumMeasurementForced();
  registerF3AtomicMeasurementForced();
  registerF4GeometricMeasurementForced();
  registerF5ColorMusicMeasurementForced();
  registerF6HebrewMeasurementForced();
  registerF7GalacticMeasurementForced();
  registerF8SubPlanckianMeasurementForced();
  registerF9HyperGalacticMeasurementForced();
  return [0, 1, 2, 3, 4, 5, 6, 7, 8];
}

/** Read-only registry snapshot (metric bank helper). */
export function activeRhuftfMeasurements(): readonly ScaleMeasurement[] {
  return scaleMeasurementRegistry.list();
}
