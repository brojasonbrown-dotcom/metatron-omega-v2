/**
 * Ω-P9.2 — the analysis runtime.
 *
 * The certified measurement stack (correlation family, directed causality,
 * resonance bus) existed for eight phases without a single live sample going
 * into it. This runtime is the feed: it samples the engine, memory and sensory
 * snapshots at a fixed cadence into a bounded `StreamWindow`, and on a slow
 * cadence runs the spine over every channel pair.
 *
 * Two safety properties, both deliberate:
 *   • Sampling only records genuinely new observations (see `channelSampler`);
 *     a stalled source contributes gaps, not repeats.
 *   • Analysis runs off the tick path on its own slow timer, with a pair
 *     budget, so the O(n²) members can never stall the UI thread's frame.
 */

import { StreamWindow } from '@/core/analysis/streamWindow';
import { analyseWindow, type SpineReport } from '@/core/analysis/analysisSpine';
import { operator } from '@metatron/trnn-core';
import {
  CHANNEL_IDS,
  freshCursors,
  frameHasData,
  sampleFrame,
  type AnalysisChannelId,
  type SamplerCursors,
  type SampleInput,
} from '@/core/analysis/channelSampler';

import { FindingLedger, sessionSeed, type LedgerEntry } from '@/core/analysis/findingLedger';
import {
  FindingConsolidator, sweepLines, type SweepLine,
} from '@/core/analysis/consolidation';
import { getOmegaRuntime } from './omegaRuntime';
import { getMemoryRuntime } from './memoryRuntime';
import { getSensoryDriver } from './sensoryDriver';
import { getCognitiveDriver } from './cognitiveDriver';
import { getCorpusRuntime } from './corpusRuntime';

/** Sampling cadence: 16 Hz. Fast enough for second-scale structure, cheap. */
export const SAMPLE_PERIOD_MS = 1000 / 16;

/** Analysis cadence: φ⁴ seconds ≈ 6.85 s. Off the tick path by design. */
export const ANALYSIS_PERIOD_MS = 6854;

/** Window capacity per channel: ~100 s of 16 Hz samples. */
export const WINDOW_CAPACITY = 1597;

/** Conformal miscoverage: 90% bands. */
export const CALIBRATION_ALPHA = 0.1;
/** Calibration ring per channel: ~24 s of 16 Hz residuals. */
export const CALIBRATION_CAPACITY = 377;

/** One channel's published band. `null` fields mean "not yet guaranteed". */
export interface CalibrationRow {
  readonly id: AnalysisChannelId;
  readonly value: number;
  readonly halfWidth: number;
  readonly lower: number;
  readonly upper: number;
  readonly level: number;
  readonly samples: number;
  readonly coverage: number;
  readonly stale: boolean;
}

/** One retention tier's live occupancy. */
export interface RetentionRow {
  readonly tier: string;
  readonly count: number;
  readonly capacity: number;
  readonly floor: number;
  readonly numbers: number;
  readonly meanSurprise: number;
}

/** What one admitted frame carries into the corpus. */
interface RetainedFrame {
  readonly id: AnalysisChannelId;
  readonly value: number;
}


export interface AnalysisState {
  version: number;
  running: boolean;
  /** Frames recorded since start (frames with at least one measured value). */
  frames: number;
  /** Completed analysis passes. */
  passes: number;
  /** Wall-clock ms the last pass took — the cost of honesty, shown. */
  lastPassMs: number;
  /** Most recent report, or null before the first pass. */
  report: SpineReport | null;
  /** Per-channel occupancy, so an empty deck can say which source is silent. */
  channels: { id: string; count: number; hz: number; gaps: number }[];
  /**
   * Ω-SCALE P1 — split-conformal band per channel, against the persistence
   * predictor (ŷ_{t+1} = y_t). A channel appears here only once its band
   * carries a real finite-sample guarantee; `stale` means the measured
   * coverage has drifted off nominal and the band should not be trusted.
   */
  calibration: CalibrationRow[];

  /**
   * Ω-SCALE P2 — tiered retention, live. Every calibrated observation is
   * offered to the corpus with its surprise measured in band half-widths; a
   * frame that carries no new information is not stored at all.
   */
  retention: {
    tiers: RetentionRow[];
    admitted: number;
    rejected: number;
    evicted: number;
    /** Numbers currently held across every tier. */
    numbers: number;
    /** Numbers the policy could ever hold — the honest ceiling. */
    capacityNumbers: number;
  };

  /** Ω-SCALE P4 — what this host actually offers, and what a split would buy. */
  throughput: {
    cores: number | null;
    workers: boolean;
    webgpuApi: boolean;
    sharedMemory: boolean;
    recommendedWorkers: number;
    plannedWorkers: number;
    projectedSpeedup: number;
    amdahlCeiling: number;
    worthwhile: boolean;
  };



  /** Ω-P9.3 evidence ledger: sealed passes, current head, self-audit result. */
  ledger: {
    size: number;
    rootHex: string;
    headTimestamp: number;
    publicKey: string;
    verified: boolean;
    verifyReason: string | null;
    recent: readonly LedgerEntry[];
  };
  /** Ω-P9.4 consolidation: the Ten-Sweep protocol over the sealed findings. */
  consolidation: {
    cycles: number;
    atoms: number;
    open: number;
    prototypes: number;
    ingested: number;
    superseded: number;
    contradictions: number;
    sweeps: readonly SweepLine[];
    failed: number;
    lastCycleMs: number;
  };
}

const EMPTY: AnalysisState = {
  version: 0,
  running: false,
  frames: 0,
  passes: 0,
  lastPassMs: NaN,
  report: null,
  channels: [],
  calibration: [],
  retention: {
    tiers: [], admitted: 0, rejected: 0, evicted: 0, numbers: 0, capacityNumbers: 0,
  },
  throughput: {
    cores: null, workers: false, webgpuApi: false, sharedMemory: false,
    recommendedWorkers: 1, plannedWorkers: 1, projectedSpeedup: 1,
    amdahlCeiling: 1, worthwhile: false,
  },



  ledger: {
    size: 0, rootHex: '', headTimestamp: 0, publicKey: '',
    verified: false, verifyReason: null, recent: [],
  },
  consolidation: {
    cycles: 0, atoms: 0, open: 0, prototypes: 0, ingested: 0,
    superseded: 0, contradictions: 0, sweeps: [], failed: 0, lastCycleMs: NaN,
  },
};

/** Consolidation runs every Nth analysis pass: the sweeps are O(atoms²). */
export const CONSOLIDATION_EVERY = 3;

class AnalysisRuntime {
  private readonly win = new StreamWindow(WINDOW_CAPACITY);
  private cursors: SamplerCursors = freshCursors();
  /** Ω-SCALE P1 — one conformal calibrator per channel, allocated on use. */
  private readonly bank = new operator.CalibrationBank<AnalysisChannelId>({
    alpha: CALIBRATION_ALPHA,
    capacity: CALIBRATION_CAPACITY,
  });
  /** Last measured value per channel — the persistence predictor's state. */
  private readonly prev = new Map<AnalysisChannelId, number>();
  private readonly bands = new Map<AnalysisChannelId, CalibrationRow>();
  /** Ω-SCALE P2 — the live tiered corpus fed by calibrated surprise. */
  private readonly corpus = new operator.TieredCorpus<RetainedFrame>();
  private listeners = new Set<() => void>();


  private state: AnalysisState = EMPTY;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private analysisTimer: ReturnType<typeof setInterval> | null = null;
  private readonly ledger = new FindingLedger(sessionSeed());
  private readonly consolidator = new FindingConsolidator(sessionSeed());
  private ingested = 0;
  private superseded = 0;
  private contradictions = 0;
  private frames = 0;
  private passes = 0;
  private version = 0;

  start(): void {
    if (typeof window === 'undefined' || this.sampleTimer) return;
    this.sampleTimer = setInterval(() => this.sample(), SAMPLE_PERIOD_MS);
    this.analysisTimer = setInterval(() => this.analyse(), ANALYSIS_PERIOD_MS);
    this.publish({ running: true });
  }

  stop(): void {
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    if (this.analysisTimer) clearInterval(this.analysisTimer);
    this.sampleTimer = null;
    this.analysisTimer = null;
    this.publish({ running: false });
  }

  /** Drops every sample. The ledger is untouched: sealed passes are evidence,
   *  and evidence is not erased because the window was cleared. */
  reset(): void {
    this.win.clear();
    this.cursors = freshCursors();
    this.frames = 0;
    this.passes = 0;
    // Calibration is a property of the cleared samples, so it clears with them:
    // keeping bands derived from discarded data would be exactly the kind of
    // stale-but-confident number this phase exists to eliminate.
    this.bank.reset();
    this.prev.clear();
    this.bands.clear();
    // Retention is derived from those same residuals, so it clears with them.
    this.corpus.clear();
    this.publish({ report: null, lastPassMs: NaN, calibration: [] });

  }


  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  getSnapshot = (): AnalysisState => this.state;

  /** Reads the three live sources. Any unavailable source is simply absent. */
  private read(): SampleInput {
    let engine: SampleInput['engine'] = null;
    let memory: SampleInput['memory'] = null;
    let sense: SampleInput['sense'] = null;
    let spectral: SampleInput['spectral'] = null;
    try {
      const snap = getOmegaRuntime().get().snapshot;
      if (snap) {
        engine = {
          tick: snap.tick,
          coherenceWarm: snap.coherenceWarm,
          warmRungs: snap.warmRungs,
          energy: snap.energy,
          fluxMoved: snap.fluxMoved,
          fluxImbalance: snap.fluxImbalance,
          tickRate: snap.tickRate,
        };
      }
    } catch { /* engine not built: leave null */ }
    try {
      const m = getMemoryRuntime().getStats();
      memory = {
        drivenTicks: m.drivenTicks,
        meanSurprise: m.meanSurprise,
        totalMerged: m.totalMerged,
      };
    } catch { /* memory runtime not constructed yet */ }
    try {
      const s = getSensoryDriver().getSnapshot();
      sense = { totalIngests: s.totalIngests, arousal: s.arousal };
    } catch { /* sensory driver not started */ }
    try {
      const c = getCognitiveDriver().getSnapshot();
      spectral = {
        passes: c.passes, drift: c.drift, residual: c.residual, entropy: c.entropy,
        circulation: c.circulation,
        roughness: c.roughness,
        leakage: c.leakage,
        persistence: c.persistence,
      };
    } catch { /* cognitive driver not started */ }
    return { engine, memory, sense, spectral };
  }

  private sample(): void {
    const frame = sampleFrame(this.read(), this.cursors);
    if (!frameHasData(frame)) return;
    const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.win.pushFrame(t, frame as unknown as Record<string, number>);
    this.frames++;
    this.calibrate(frame as unknown as Record<AnalysisChannelId, number>);
    this.retain(frame as unknown as Record<AnalysisChannelId, number>);
  }

  /**
   * Ω-SCALE P1 — conformal update, once per recorded frame.
   *
   * The predictor is persistence (ŷ_t = y_{t-1}) — the weakest honest baseline,
   * chosen deliberately: the band it produces is a statement about how fast the
   * channel actually moves, not about how good some model is. Order matters:
   * `interval()` is called on the prediction *before* the truth is absorbed, so
   * the coverage the calibrator reports is genuinely out-of-sample.
   *
   * A channel that is NaN this frame (unmeasured, per the sampler's contract)
   * contributes nothing and keeps its previous band untouched — a gap must not
   * be scored as a residual of zero.
   */
  private calibrate(frame: Record<AnalysisChannelId, number>): void {
    for (const id of CHANNEL_IDS) {
      const actual = frame[id];
      if (!Number.isFinite(actual)) continue;
      const predicted = this.prev.get(id);
      this.prev.set(id, actual);
      if (predicted === undefined) continue;
      const cal = this.bank.get(id);
      const iv = cal.interval(predicted);
      cal.observe(predicted, actual);
      if (iv) {
        this.bands.set(id, {
          id,
          value: actual,
          halfWidth: iv.halfWidth,
          lower: actual - iv.halfWidth,
          upper: actual + iv.halfWidth,
          level: iv.level,
          samples: iv.samples,
          coverage: iv.coverage,
          stale: iv.stale,
        });
      }
      // Ω-SCALE P2 — admission by surprise, not by clock. Before a band exists
      // the surprise is Infinity, so warm-up data is kept: the corpus must not
      // discard the very frames the calibrator needs to become honest.
      const half = iv ? iv.halfWidth : NaN;
      this.corpus.admit(
        { id, value: actual },
        operator.surpriseOf(actual, predicted, half),
        this.frames,
      );

    }
  }


  /**
   * Ω-CORPUS — the durable offer, once per recorded frame.
   *
   * The frame is the whole channel vector; the admission decision is taken on
   * the widest calibrated surprise across channels, so a frame is kept when any
   * channel did something its own band did not predict. Unmeasured channels are
   * written as 0 in the vector but never drive admission.
   */
  private retain(frame: Record<AnalysisChannelId, number>): void {
    const values = new Float64Array(CHANNEL_IDS.length);
    let worst = -Infinity;
    let pick: { predicted: number; half: number; actual: number } | null = null;
    for (let i = 0; i < CHANNEL_IDS.length; i++) {
      const id = CHANNEL_IDS[i];
      const actual = frame[id];
      if (!Number.isFinite(actual)) continue;
      values[i] = actual;
      const band = this.bands.get(id);
      const predicted = band ? band.value : actual;
      const half = band ? band.halfWidth : NaN;
      const s = operator.surpriseOf(actual, predicted, half);
      if (s > worst) { worst = s; pick = { predicted, half, actual }; }
    }
    if (!pick) return;
    getCorpusRuntime().feed(values, pick.predicted, pick.half, pick.actual);
  }

  /** Runs one analysis pass. Exposed so the deck can force one on demand. */
  analyse(): SpineReport {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const report = analyseWindow(this.win, { maxLag: 5, pairBudget: 28 });
    const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.passes++;
    // Seal before publishing: the deck should never show a pass that is not
    // yet provable. Sealing is hashing only — microseconds, off the tick path.
    const now = Date.now();
    const entry = this.ledger.seal(report, now);
    const audit = this.ledger.verifyEntry(entry);

    // Ω-P9.4: sealed findings feed the corpus, and every CONSOLIDATION_EVERY
    // passes the certified Ten-Sweep protocol runs over it. Ingest is cheap;
    // the cycle is the expensive part, so it is the part that is rate-limited.
    const ing = this.consolidator.ingest(report, now);
    this.ingested += ing.added;
    this.superseded += ing.superseded;
    this.contradictions += ing.contradictions;
    let consolidation = this.state.consolidation;
    if (this.passes % CONSOLIDATION_EVERY === 0) {
      const c0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const cycle = this.consolidator.run(report, now);
      const c1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const lines = sweepLines(cycle);
      consolidation = {
        cycles: this.consolidator.cycleCount,
        atoms: this.consolidator.corpus.items.length,
        open: this.consolidator.corpus.open().length,
        prototypes: this.consolidator.corpus.items.filter((i) => i.kind === 'Prototype').length,
        ingested: this.ingested,
        superseded: this.superseded,
        contradictions: this.contradictions,
        sweeps: lines,
        failed: lines.filter((l) => !l.ok).length,
        lastCycleMs: c1 - c0,
      };
    } else {
      consolidation = {
        ...consolidation,
        atoms: this.consolidator.corpus.items.length,
        open: this.consolidator.corpus.open().length,
        ingested: this.ingested,
        superseded: this.superseded,
        contradictions: this.contradictions,
      };
    }

    this.publish({
      consolidation,
      report,
      lastPassMs: t1 - t0,
      ledger: {
        size: this.ledger.size,
        rootHex: this.ledger.rootHex,
        headTimestamp: entry.sth.timestamp,
        publicKey: entry.sth.publicKey,
        verified: audit.ok,
        verifyReason: audit.reason,
        recent: this.ledger.recent(13),
      },
    });
    return report;
  }

  /** Host capability is a property of the machine, so it is probed once. */
  private cap: ReturnType<typeof operator.probeHost> | null = null;

  private publish(patch: Partial<AnalysisState> = {}): void {
    if (!this.cap) this.cap = operator.probeHost();
    const tiers = this.corpus.stats();
    const counters = this.corpus.counters;
    // The parallelisable workload is the pair scan: O(channels²) lag windows.
    const items = CHANNEL_IDS.length * CHANNEL_IDS.length * WINDOW_CAPACITY;
    const plan = operator.bestWorkerCount(items, this.cap.recommendedWorkers, 40);

    this.state = {
      ...this.state,
      version: ++this.version,
      frames: this.frames,
      passes: this.passes,
      channels: this.win.allStats().map((c) => ({
        id: c.id,
        count: c.count,
        hz: c.hz,
        gaps: c.gaps,
      })),
      calibration: [...this.bands.values()],
      retention: {
        tiers: tiers.map((t) => ({
          tier: t.tier,
          count: t.count,
          capacity: t.capacity,
          floor: t.floor,
          numbers: t.numbers,
          meanSurprise: t.meanSurprise,
        })),
        admitted: counters.admitted,
        rejected: counters.rejected,
        evicted: counters.evicted,
        numbers: this.corpus.footprint(),
        capacityNumbers: this.corpus.capacityNumbers(),
      },
      throughput: {
        cores: this.cap.cores,
        workers: this.cap.workers,
        webgpuApi: this.cap.webgpuApi,
        sharedMemory: this.cap.sharedMemory,
        recommendedWorkers: this.cap.recommendedWorkers,
        plannedWorkers: plan.workers,
        projectedSpeedup: plan.projectedSpeedup,
        amdahlCeiling: plan.amdahlCeiling,
        worthwhile: plan.worthwhile,
      },
      ...patch,
    };
    for (const fn of this.listeners) fn();
  }


}

let singleton: AnalysisRuntime | null = null;

export function getAnalysisRuntime(): AnalysisRuntime {
  if (!singleton) singleton = new AnalysisRuntime();
  return singleton;
}

export type { AnalysisRuntime };
