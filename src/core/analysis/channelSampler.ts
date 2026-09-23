/**
 * channelSampler — turns the three live snapshots into one analysable frame.
 *
 * The rule that matters: a quantity the machine did not measure this instant
 * is **NaN**, never its last value and never 0. `StreamWindow` treats NaN as a
 * gap, so an idle or missing source contributes nothing instead of a flat
 * segment that would correlate with every other flat segment in the system.
 *
 * Staleness is enforced here rather than in the window, because only this
 * layer knows what "fresh" means for each source: the engine advances a tick,
 * the memory runtime advances a driven-tick counter, the sensory gateway
 * advances an ingest counter. If the counter has not moved, the reading is the
 * same observation again — resampling it would fabricate evidence.
 */

/** Channel ids the spine analyses. Stable strings: they appear in findings. */
export const CHANNEL_IDS = [
  'engine.coherence',
  'engine.energy',
  'engine.flux',
  'engine.imbalance',
  'engine.tickRate',
  'memory.surprise',
  'memory.merged',
  'sense.arousal',
  'spectral.drift',
  'spectral.residual',
  'spectral.entropy',
  'field.modeCirculation',
  'field.roughness',
  'field.leakage',
  'field.persistence',
] as const;

export type AnalysisChannelId = (typeof CHANNEL_IDS)[number];

export type Frame = Record<AnalysisChannelId, number>;

export interface EngineSample {
  readonly tick: number;
  readonly coherenceWarm: number;
  readonly warmRungs: number;
  readonly energy: number;
  readonly fluxMoved: number;
  readonly fluxImbalance: number;
  readonly tickRate: number;
}

export interface MemorySample {
  /** Monotone count of memory ticks actually driven. */
  readonly drivenTicks: number;
  readonly meanSurprise: number;
  readonly totalMerged: number;
}

export interface SenseSample {
  /** Monotone count of sensory ingests. */
  readonly totalIngests: number;
  readonly arousal: number | null;
}

/** Ω-COG — one measured spectral pass; `passes` is the freshness cursor. */
export interface SpectralSample {
  /** Monotone count of completed spectral passes. */
  readonly passes: number;
  readonly drift: number;
  readonly residual: number;
  readonly entropy: number;
  /**
   * Ω-OPERATOR N2′ — solenoidal fraction of the mode-space energy current.
   * Driver-invariant by construction, so it is measured *beside* the ladder's
   * Ω rather than folded into it. NaN until two passes exist.
   */
  readonly circulation?: number;
  /** Ω-CONSISTENCY K2 — Sobolev h1/l2 of the inter-pass change. */
  readonly roughness?: number;
  /** Spectral tail fraction of the pass window (seam honesty). */
  readonly leakage?: number;
  /** Gated-recurrence novelty against the slow mode memory, [0,1]. */
  readonly persistence?: number;
}

export interface SamplerCursors {
  engineTick: number;
  memoryTicks: number;
  senseIngests: number;
  spectralPasses: number;
}

export const freshCursors = (): SamplerCursors => ({
  engineTick: -1,
  memoryTicks: -1,
  senseIngests: -1,
  spectralPasses: -1,
});

const BLANK: Frame = {
  'engine.coherence': NaN,
  'engine.energy': NaN,
  'engine.flux': NaN,
  'engine.imbalance': NaN,
  'engine.tickRate': NaN,
  'memory.surprise': NaN,
  'memory.merged': NaN,
  'sense.arousal': NaN,
  'spectral.drift': NaN,
  'spectral.residual': NaN,
  'spectral.entropy': NaN,
  'field.modeCirculation': NaN,
  'field.roughness': NaN,
  'field.leakage': NaN,
  'field.persistence': NaN,
};

const fin = (v: number | null | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : NaN;

export interface SampleInput {
  readonly engine: EngineSample | null;
  readonly memory: MemorySample | null;
  readonly sense: SenseSample | null;
  readonly spectral?: SpectralSample | null;
}

/**
 * Builds one frame, mutating the cursors so the next call knows what was
 * already observed. Sources whose cursor has not advanced yield NaN.
 */
export function sampleFrame(input: SampleInput, cursors: SamplerCursors): Frame {
  const f: Frame = { ...BLANK };

  const e = input.engine;
  if (e && Number.isFinite(e.tick) && e.tick > cursors.engineTick) {
    cursors.engineTick = e.tick;
    // A warm-rung count of zero means the coherence figure is not a
    // measurement yet — the exact defect that produced false full-coherence
    // readings on the dashboard. It abstains here too.
    f['engine.coherence'] = e.warmRungs > 0 ? fin(e.coherenceWarm) : NaN;
    f['engine.energy'] = fin(e.energy);
    f['engine.flux'] = fin(e.fluxMoved);
    f['engine.imbalance'] = fin(e.fluxImbalance);
    f['engine.tickRate'] = fin(e.tickRate);
  }

  const m = input.memory;
  if (m && Number.isFinite(m.drivenTicks) && m.drivenTicks > cursors.memoryTicks) {
    cursors.memoryTicks = m.drivenTicks;
    f['memory.surprise'] = fin(m.meanSurprise);
    f['memory.merged'] = fin(m.totalMerged);
  }

  const s = input.sense;
  if (s && Number.isFinite(s.totalIngests) && s.totalIngests > cursors.senseIngests) {
    cursors.senseIngests = s.totalIngests;
    f['sense.arousal'] = fin(s.arousal);
  }

  const sp = input.spectral;
  if (sp && Number.isFinite(sp.passes) && sp.passes > cursors.spectralPasses) {
    cursors.spectralPasses = sp.passes;
    f['spectral.drift'] = fin(sp.drift);
    f['spectral.residual'] = fin(sp.residual);
    f['spectral.entropy'] = fin(sp.entropy);
    f['field.modeCirculation'] = fin(sp.circulation);
    f['field.roughness'] = fin(sp.roughness);
    f['field.leakage'] = fin(sp.leakage);
    f['field.persistence'] = fin(sp.persistence);
  }

  return f;
}

/** True when the frame carries at least one measured channel. */
export function frameHasData(f: Frame): boolean {
  for (const id of CHANNEL_IDS) if (Number.isFinite(f[id])) return true;
  return false;
}
