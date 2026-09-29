/**
 * Trajectory (Ω-ACTIVATE B2) — what the field was doing around a moment.
 *
 * L0 holds a compressed Ψ frame per tick, but until now nothing read those
 * frames back, so every recall was a still image: a pattern hash with no
 * before and no after. A trajectory turns a tape window into the small set of
 * scalars that actually characterise a moment's dynamics — level, drift and
 * volatility of coherence and energy, plus the modal support that persisted
 * across the window.
 *
 * Pure: takes frames, returns numbers. No store, no clock, no allocation
 * beyond the summary itself, so it is safe to call on the recall hot path.
 */

import type { FieldTapeFrame } from './FieldTape';

export interface TrajectorySummary {
  /** Frames the summary is built from. 0 means "no tape evidence". */
  frames: number;
  /** Tick span [first, last] of the window. */
  fromTick: number;
  toTick: number;
  /** Mean coherence across the window. */
  coherenceMean: number;
  /** Least-squares slope of coherence per tick — is it consolidating or losing hold. */
  coherenceDrift: number;
  /** Standard deviation of coherence — how turbulent the moment was. */
  coherenceVolatility: number;
  meanEnergy: number;
  energyDrift: number;
  /** Mean per-frame salience and peak surprise inside the window. */
  meanSalience: number;
  peakSurprise: number;
  /**
   * Modal persistence: the fraction of the window's top mode slots occupied by
   * the single most persistent mode index. 1 = a locked mode, ~0 = scattered.
   */
  modalPersistence: number;
  /** The most persistent mode index, or -1 when the window is empty. */
  dominantMode: number;
}

export const EMPTY_TRAJECTORY: TrajectorySummary = {
  frames: 0,
  fromTick: 0,
  toTick: 0,
  coherenceMean: 0,
  coherenceDrift: 0,
  coherenceVolatility: 0,
  meanEnergy: 0,
  energyDrift: 0,
  meanSalience: 0,
  peakSurprise: 0,
  modalPersistence: 0,
  dominantMode: -1,
};

/** Least-squares slope of `ys` against `xs`. Returns 0 for a degenerate window. */
function slope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let sx = 0,
    sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n,
    my = sy / n;
  let num = 0,
    den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    num += dx * (ys[i] - my);
    den += dx * dx;
  }
  return den > 0 ? num / den : 0;
}

/** Summarise a tape window (oldest → newest) into its dynamics. */
export function summariseTrajectory(frames: readonly FieldTapeFrame[]): TrajectorySummary {
  if (frames.length === 0) return EMPTY_TRAJECTORY;

  const ticks: number[] = [];
  const coh: number[] = [];
  const en: number[] = [];
  let salSum = 0;
  let peakSurprise = 0;
  const modeCount = new Map<number, number>();
  let slots = 0;

  for (const f of frames) {
    ticks.push(f.tick);
    coh.push(f.coherence);
    en.push(f.energy);
    salSum += f.salience;
    if (f.surprise > peakSurprise) peakSurprise = f.surprise;
    for (let k = 0; k < f.indices.length; k++) {
      const idx = f.indices[k];
      if (idx < 0) continue;
      modeCount.set(idx, (modeCount.get(idx) ?? 0) + 1);
      slots++;
    }
  }

  const n = frames.length;
  const cMean = coh.reduce((a, b) => a + b, 0) / n;
  let varSum = 0;
  for (const c of coh) varSum += (c - cMean) * (c - cMean);

  let dominantMode = -1;
  let dominantHits = 0;
  for (const [idx, hits] of modeCount) {
    if (hits > dominantHits || (hits === dominantHits && idx < dominantMode)) {
      dominantHits = hits;
      dominantMode = idx;
    }
  }

  return {
    frames: n,
    fromTick: ticks[0],
    toTick: ticks[n - 1],
    coherenceMean: cMean,
    coherenceDrift: slope(ticks, coh),
    coherenceVolatility: Math.sqrt(varSum / n),
    meanEnergy: en.reduce((a, b) => a + b, 0) / n,
    energyDrift: slope(ticks, en),
    meanSalience: salSum / n,
    peakSurprise,
    modalPersistence: slots > 0 ? dominantHits / slots : 0,
    dominantMode,
  };
}
