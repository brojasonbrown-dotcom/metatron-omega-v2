/**
 * TapeDmd — Dynamic Mode Decomposition over the L0 field tape.
 *
 * The tape records a scalar observable vector per tick. DMD fits the linear
 * operator A with y ≈ A·x across consecutive frames, which yields three things
 * the engine previously had no honest way to state:
 *
 *   • the oscillation frequencies actually present in the substrate (Hz),
 *   • whether those oscillations are growing or damping (growth, 1/s),
 *   • a one-step forecast, so "surprise" can be measured against a prediction
 *     instead of against the previous sample.
 *
 * Everything here is read-only over the tape and allocation-bounded: the fit
 * runs on at most `window` frames of a 6-dimensional observable.
 */

import { fitDmd, MIN_SNAPSHOTS, type DmdFit } from '@metatron/trnn-core/substrate/dmd';
import type { FieldTape, FieldTapeFrame } from './FieldTape';

/** Observable channels, in fixed order. Order is part of the contract. */
export const TAPE_OBSERVABLES = [
  'coherence',
  'energy',
  'salience',
  'novelty',
  'surprise',
  'qualiaScalar',
] as const;

export type TapeObservable = (typeof TAPE_OBSERVABLES)[number];

export interface TapeDynamics {
  /** Number of independent modes retained. */
  readonly rank: number;
  /** Dominant (largest-|λ|) oscillation frequency in Hz, 0 when non-oscillatory. */
  readonly dominantHz: number;
  /** Growth rate of the dominant mode, 1/s. Negative = damping. */
  readonly dominantGrowth: number;
  /** max|λ|. >1 means the fitted dynamics diverge — an instability signal. */
  readonly spectralRadius: number;
  /** One-step reconstruction error, relative. Large = the tape is not linear here. */
  readonly relError: number;
  /** Forecast of the next observable vector, channel order = TAPE_OBSERVABLES. */
  readonly forecast: Readonly<Record<TapeObservable, number>>;
  /** Frames consumed. */
  readonly frames: number;
}

function observableOf(f: FieldTapeFrame): Float64Array {
  const v = new Float64Array(TAPE_OBSERVABLES.length);
  v[0] = f.coherence;
  v[1] = f.energy;
  v[2] = f.salience;
  v[3] = f.novelty;
  v[4] = f.surprise;
  v[5] = f.qualiaScalar;
  return v;
}

export interface TapeDmdOptions {
  /** Frames to fit over (newest-last). Default 144 (F₁₂). */
  window?: number;
  /** Tick rate of the tape, Hz. Default 30. */
  hz?: number;
}

/**
 * Fit the tape's recent dynamics. Returns null when the tape holds fewer than
 * MIN_SNAPSHOTS frames or the fit is rank-deficient — an honest "not enough
 * evidence" rather than a fabricated spectrum.
 */
export function fitTapeDynamics(tape: FieldTape, opts: TapeDmdOptions = {}): TapeDynamics | null {
  const window = Math.max(MIN_SNAPSHOTS, Math.floor(opts.window ?? 144));
  const hz = opts.hz && opts.hz > 0 ? opts.hz : 30;
  const tail = tape.tail(window);
  if (tail.length < MIN_SNAPSHOTS) return null;

  // tail() is newest-first; DMD needs chronological order.
  const snapshots: Float64Array[] = [];
  for (let i = tail.length - 1; i >= 0; i--) snapshots.push(observableOf(tail[i]));

  const fit: DmdFit | null = fitDmd(snapshots, { dt: 1 / hz });
  if (!fit || fit.rank === 0) return null;

  // The largest-|λ| mode of a real signal is almost always the DC/trend mode
  // (λ real, f = 0). Reporting that as "the" dominant mode would tell the
  // operator the substrate never oscillates. Rank the OSCILLATORY modes and
  // fall back to the overall leader only when the tape is genuinely static.
  const osc = fit.modes.filter((m) => Math.abs(m.frequency) > 1e-9);
  const pool = osc.length > 0 ? osc : fit.modes;
  let dom = pool[0];
  for (const m of pool) if (m.magnitude > dom.magnitude) dom = m;

  const next = fit.predict(snapshots[snapshots.length - 1]);
  const forecast = {} as Record<TapeObservable, number>;
  TAPE_OBSERVABLES.forEach((k, i) => { forecast[k] = next[i]; });

  return {
    rank: fit.rank,
    dominantHz: Math.abs(dom.frequency),
    dominantGrowth: dom.growth,
    spectralRadius: fit.spectralRadius,
    relError: fit.relError,
    forecast,
    frames: tail.length,
  };
}
