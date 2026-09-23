/**
 * Ω-P4 — the engine host.
 *
 * Owns a MultiTorusEngine built from a profile and drives it off the UI thread
 * (a worker in the app; a plain object in tests). Responsibilities:
 *
 *   • build      — profile → rung set, node counts, coupling band, clocks
 *   • pump       — run a budgeted slice of ticks per frame, never blocking
 *                  longer than `sliceBudgetMs`
 *   • bus        — emit an immutable snapshot at an adaptive 8–64 Hz; the rate
 *                  falls when a slice overruns and climbs back when it recovers
 *   • checkpoint — periodic full-state capture, exact rollback
 *   • ledger     — digest marks for replay + divergence localisation
 *
 * The tick path itself stays clock-free: wall time is read only *between*
 * slices, so the digest chain is identical whatever the frame rate.
 */

import { DENSE_CORE, type Rung } from '../core/scaleLadder';
import { MultiTorusEngine, type WebCheckpoint, type WebTickReport } from '../engine/MultiTorusEngine';
import { nodesForRank, profileById, profileCost, type Profile, type ProfileId } from './profiles';
import { RunLedger, type RunMark } from './runLedger';
import { SensoryPlane, type SensePlaneReport } from '../sense/plane';
import {
  encodeAudio,
  encodeGrid,
  encodeScalars,
  encodeText,
  senseField,
  type EncodeReport,
  type Modality,
} from '../sense/encode';
import { TorusBraid, ratedCapacity, type BraidPattern, type Recall } from '../memory/braid';
import { Mind, type MindReport, type Thought } from '../cognition/mind';
import { createField, type CField } from '../core/complex';
import { runBattery, sampleTrajectory, type BatteryReport } from '../learn/battery';
import type { LearnableCell } from '../learn/cell';
import type { Certificate } from '../learn/params';
import {
  describeEngine,
  fieldFrame,
  rungScan,
  spectralView,
  webView,
  type EngineDescription,
  type FieldFrame,
  type RungScanReport,
  type SpectralView,
  type WebView,
} from './views';
import { dlog1p } from '../core/dmath';
import { largestFibonacciAtMost } from '../core/fibonacci';
import type { OrganOptions } from '../cell/organs';
import type { SensoryNodeOptions } from '../sense/nodeArray';
import type { ChordKind } from '../web/coupling';
import type { TuringTapeOptions } from '../memory/turingTape';

/**
 * Tape capacity for a ladder of `totalNodes`: the largest Fibonacci number at
 * most the node count, floored at 233 and capped at 10946 cells (175 KB) so
 * the permanent store never dominates the footprint.
 */
function tapeCapacityFor(totalNodes: number): number {
  return Math.max(233, Math.min(10946, largestFibonacciAtMost(Math.max(233, totalNodes))));
}

/** Ticks between braid memory folds — the checkpoint cadence (Fibonacci). */
export const MEMORY_STRIDE = 144;

/** Ticks between cognitive folds (Fibonacci; 21 ≈ 3 Hz at a 64 Hz bus). */
export const MIND_STRIDE = 21;

/** Default per-node organ configuration for a hosted run. */
export const DEFAULT_ORGANS: OrganOptions = { radialOrders: 8, radialGain: 0, stride: 3 };

/**
 * N1 — default sensory plan: 10 φ-spaced bands over a 233-tick Fibonacci
 * window. The deeper window is the highest-resolution plan that still latches
 * a spectrum inside a few seconds of bus time: it cuts the worst φ-target bin
 * drift from 3.13e-3 to 1.18e-3 cycles/tick and adds two more rungs of the
 * ladder. Every line convergence on every rung is instrumented; the array is
 * a pure observer, so this changes no digest.
 */
export const DEFAULT_SENSORS: SensoryNodeOptions = { bands: 10, depth: 233 };




/** Default chord family for a hosted run — every stable ratio the ladder has. */
export const DEFAULT_CHORDS: ChordKind[] = ['fibonacci', 'lucas', 'spiral'];

/** Default chord strength — φ⁻¹. */
export const DEFAULT_CHORD_GAIN = 1 / 1.618033988749895;

/** Default vacuum drive setpoint for a hosted run — φ⁻¹. */
export const DEFAULT_DRIVE = 1 / 1.618033988749895;

export const MIN_HZ = 8;
export const MAX_HZ = 64;

export interface HostOptions {
  readonly profile: ProfileId | Profile;
  readonly seed?: string;
  /** Ticks the pump may spend per slice before yielding. */
  readonly sliceBudgetMs?: number;
  readonly targetHz?: number;
  readonly ledgerStride?: number;
  readonly rungs?: readonly Rung[];
  /**
   * Vacuum drive setpoint per rung (max-norm, [0, φ]). The nine-term cell is a
   * strict contraction, so without a drive a live run fades to the origin —
   * the host therefore arms it at φ⁻¹ by default. Pass 0 for an undriven,
   * oracle-exact run.
   */
  readonly drive?: number;
  /**
   * N0/N1 — per-node organ bank. Default: organs on, observing only
   * (radialGain 0), at a Fibonacci stride so the cost is bounded. Pass
   * `{ radialGain: g }` to let the radial transform drive the R slot, or
   * `null` to build without organs at all.
   */
  readonly organs?: OrganOptions | null;
  /**
   * N1 — per-node sensory array. Default: on with the standard 8-band /
   * 89-tick plan, so every line convergence on every rung is instrumented.
   * Pass `null` to build without it.
   */
  readonly sensors?: SensoryNodeOptions | null;
  /** N3 — stable-ratio chords. Default: Fibonacci + Lucas + spiral. */
  readonly chords?: ChordKind[] | null;
  /** N3 — chord strength in [0, 1]. Default φ⁻¹. */
  readonly chordGain?: number;
  /** N4 — permanent tape. Default: on, sized to the ladder. Pass null for off. */
  readonly tape?: TuringTapeOptions | null;
}

export interface HostSnapshot {
  readonly running: boolean;
  readonly profile: ProfileId;
  readonly seed: string;
  readonly tick: number;
  /** Measured ticks per second over the last second of wall clock. */
  readonly tickRate: number;
  /** Current snapshot-bus rate, adaptive in [8, 64]. */
  readonly busHz: number;
  /** Mean coherence across stepped rungs, cold (unfilled) rungs counted as 0. */
  readonly coherence: number;
  /**
   * Mean coherence across stepped rungs whose meter is warm; NaN when none is.
   * This is the reading a dashboard should show — the plain `coherence` above
   * is dragged down by rungs on slow clocks that have not filled their ring.
   */
  readonly coherenceWarm: number;
  /** Ladder rungs whose coherence meter is warm. */
  readonly warmRungs: number;
  readonly energy: number;
  readonly fluxMoved: number;
  readonly fluxImbalance: number;
  readonly orderingViolations: number;
  readonly rowSumDefect: number;
  readonly worstEnergyRatio: number;
  readonly digest: string;
  readonly finite: boolean;
  readonly stepped: readonly number[];
  readonly rungs: readonly {
    readonly n: number;
    readonly nodes: number;
    readonly coherence: number;
    /** False while this rung's coherence ring is still filling — `coherence` is then not a measurement. */
    readonly warm: boolean;
    readonly energy: number;
    readonly regime: string;
    readonly clamped: number;
    readonly obstruction: number;
    /** Dimensionless closure defect in [0, 2] — what the corridor gate reads. */
    readonly closureDefect: number;
    /** Shift autocorrelation gamma in [0, 1]; 1 = exact toroidal closure. */
    readonly closureQuality: number;
    /** Corridor skill 1/(1+defect). */
    readonly skill: number;
  }[];
  readonly nodes: readonly number[];
  readonly totalNodes: number;
  readonly predictedBytes: number;
  readonly checkpointTick: number | null;
  readonly ledgerMarks: number;
  /** Fraction of the slice budget the last pump consumed. */
  readonly load: number;
  /** Live sensory channels currently contributing to the ξ-term. */
  readonly senseChannels: number;
  /** Peak of the largest per-rung injection, ≤ φ. */
  readonly sensePeak: number;
  /** Actuator loop gain in force, ≤ φ⁻². */
  readonly senseGain: number;
  /** Patterns held in the braid. */
  readonly memoryLoad: number;
  readonly memoryCapacity: number;
  /** Cosine of the current field against its best stored pattern. */
  readonly familiarity: number;
  readonly memoryStage: string;
  /** Concepts held in the semantic store. */
  readonly concepts: number;
  /** Novelty of the last cognitive fold (1 − cosine to nearest concept). */
  readonly novelty: number;
  /** Relative error of the prediction standing for the last fold. */
  readonly surprise: number;
  /** Whether the λ-SSM self-model currently beats its RLS baseline. */
  readonly selfModel: boolean;
  /** Measured (rls − ssm)/rls over the scoring window. */
  readonly selfMargin: number;
  /** Cognitive folds skipped because the ladder was quiescent. */
  readonly quiescentFolds: number;
  /** N0 — nodes carrying a full organ record (0 when organs are off). */
  readonly organNodes: number;
  /** N0 — mean per-node eigenmode residual across the ladder. */
  readonly organResidual: number;
  /** N0 — mean per-node participation ratio across the ladder. */
  readonly organParticipation: number;
  /** N3 — long-range chords installed in the channel matrix. */
  readonly chords: readonly number[];
  /** N4 — tape cells written at least once. */
  readonly tapeOccupancy: number;
  /** N4 — tape capacity in cells (0 when there is no tape). */
  readonly tapeCapacity: number;
  /** N4 — current head address. */
  readonly tapeHead: number;
}

export interface SenseChannelView {
  readonly id: string;
  readonly modality: Modality;
  readonly nodes: number;
  readonly gain: number;
  readonly peak: number;
  readonly energy: number;
  readonly support: number;
  readonly updatedAt: number;
}

export interface SenseView {
  readonly channels: readonly SenseChannelView[];
  readonly report: SensePlaneReport;
}

export interface MemoryView {
  readonly load: number;
  readonly capacity: number;
  readonly beta: number;
  readonly stride: number;
  readonly lastFoldTick: number;
  readonly stored: number;
  readonly skipped: number;
  readonly familiarity: number;
  readonly lastRecall: Recall | null;
  readonly patterns: readonly BraidPattern[];
}

export class EngineHost {
  readonly profile: Profile;
  readonly seed: string;
  readonly ledger: RunLedger;

  private engine: MultiTorusEngine;
  private readonly nodes: number[];
  private readonly sliceBudgetMs: number;
  private targetHz: number;
  private busHz = MAX_HZ;
  private running = false;
  private last: WebTickReport | null = null;
  private lastLoad = 0;
  private tickRate = 0;
  private rateWindowStart = 0;
  private rateWindowTicks = 0;
  private checkpointTick: number | null = null;
  private overruns = 0;
  /** Fractional tick debt carried between frames so the rate matches targetHz. */
  private debt = 0;

  // ---- Ω-P6 sensory + braid memory ----
  private plane: SensoryPlane | null = null;
  private readonly channelMeta = new Map<string, { modality: Modality; nodes: number; gain: number; report: EncodeReport | null; updatedAt: number }>();
  private braid: TorusBraid | null = null;
  private lastRecall: Recall | null = null;
  private lastFoldTick = -1;
  private stored = 0;
  private skipped = 0;
  private scratchField: CField | null = null;

  // ---- Ω-P7 cognition ----
  private mind: Mind | null = null;
  private learnCell: LearnableCell | null = null;
  private lastLearn: LearnRun | null = null;
  private obs: Float64Array | null = null;
  private lastThought: Thought | null = null;
  private lastMindTick = -1;
  /** Folds skipped because the ladder had nothing to report. */
  private quiescentFolds = 0;


  constructor(opts: HostOptions) {
    this.profile = typeof opts.profile === 'string' ? profileById(opts.profile) : opts.profile;
    this.seed = opts.seed ?? 'metatron-omega';
    // a zero budget would make the load ratio undefined; floor it at 10 µs.
    this.sliceBudgetMs = Math.max(0.01, opts.sliceBudgetMs ?? 8);
    this.targetHz = Math.min(MAX_HZ, Math.max(MIN_HZ, opts.targetHz ?? MAX_HZ));

    const ladder = opts.rungs ?? DENSE_CORE;
    const rungs = ladder.slice(0, this.profile.rungs);
    this.nodes = rungs.map((_, rank) => nodesForRank(this.profile, rank));
    this.engine = new MultiTorusEngine({
      rungs,
      nodes: (_r, rank) => this.nodes[rank],
      seed: this.seed,
      couplingBand: this.profile.couplingBand,
      clock: this.profile.clock,
      modes: this.profile.modes,
      tapeCapacity: this.profile.tape,
      drive: opts.drive ?? DEFAULT_DRIVE,
      organs: opts.organs === null ? undefined : (opts.organs ?? DEFAULT_ORGANS),
      sensors: opts.sensors === null ? undefined : (opts.sensors ?? DEFAULT_SENSORS),
      chords: opts.chords === null ? undefined : (opts.chords ?? DEFAULT_CHORDS),
      chordGain: opts.chordGain ?? DEFAULT_CHORD_GAIN,
      tape:
        opts.tape === null
          ? undefined
          : (opts.tape ?? { capacity: tapeCapacityFor(this.nodes.reduce((a, b) => a + b, 0)) }),
    });

    this.ledger = new RunLedger(
      {
        id: `${this.profile.id}:${this.seed}:${Date.now().toString(36)}`,
        profileId: this.profile.id,
        seed: this.seed,
        nodes: this.nodes.slice(),
        startedAt: Date.now(),
      },
      4181,
      opts.ledgerStride ?? 13,
    );
  }

  start(): void {
    this.running = true;
    this.debt = 0;
  }

  stop(): void {
    this.running = false;
    this.debt = 0;
  }


  isRunning(): boolean {
    return this.running;
  }

  setTargetHz(hz: number): void {
    this.targetHz = Math.min(MAX_HZ, Math.max(MIN_HZ, hz));
    this.busHz = Math.min(this.busHz, this.targetHz);
  }

  /** One deterministic tick, ledgered. Usable directly in tests. */
  stepOnce(): WebTickReport {
    const rep = this.engine.step();
    this.last = rep;
    const mark: RunMark = {
      tick: rep.tick,
      digest: rep.digest,
      coherence: rep.coherence,
      energy: rep.rungs.reduce((s, r) => s + (r?.energy ?? 0), 0),
      fluxImbalance: rep.fluxImbalance,
      orderingViolations: rep.orderingViolations,
      finite: rep.finite,
    };
    this.ledger.mark(mark);
    this.foldMemory(rep.tick);
    this.foldMind(rep);
    return rep;
  }

  // ---- Ω-P6: sensory plane ----

  /** Lazily build the plane over the live rung geometry. */
  private ensurePlane(): SensoryPlane {
    if (!this.plane) {
      this.plane = new SensoryPlane(this.engine.engines.map((e) => e.nodes));
      this.engine.attachSensory(this.plane);
    }
    return this.plane;
  }

  declareChannel(id: string, modality: Modality, nodes?: number, gain = 1): void {
    const plane = this.ensurePlane();
    const n = nodes ?? this.nodes[0];
    plane.declare({ id, modality, nodes: n, gain });
    this.channelMeta.set(id, { modality, nodes: n, gain, report: null, updatedAt: -1 });
  }

  /**
   * Encode raw modality data and push it into a channel. The host owns the
   * encoders so the worker boundary only ever carries plain arrays.
   */
  pushChannel(
    id: string,
    data: ArrayLike<number> | string,
    opts: { width?: number; height?: number } = {},
  ): EncodeReport {
    const meta = this.channelMeta.get(id);
    if (!meta) throw new Error(`EngineHost: channel "${id}" is not declared`);
    const plane = this.ensurePlane();
    const f = senseField(meta.nodes);
    let report: EncodeReport;
    switch (meta.modality) {
      case 'text':
        report = encodeText(typeof data === 'string' ? data : String(data), f);
        break;
      case 'grid':
        report = encodeGrid(
          typeof data === 'string' ? [] : data,
          opts.width ?? 0,
          opts.height ?? 0,
          f,
        );
        break;
      case 'audio':
        report = encodeAudio(typeof data === 'string' ? [] : data, f);
        break;
      default:
        report = encodeScalars(typeof data === 'string' ? [] : data, f);
        break;
    }
    plane.push(id, f, this.engine.currentTick());
    meta.report = report;
    meta.updatedAt = this.engine.currentTick();
    return report;
  }

  muteChannel(id: string): void {
    this.plane?.mute(id);
    const meta = this.channelMeta.get(id);
    if (meta) meta.report = null;
  }

  /** Set the actuator loop gain (throws above φ⁻², Law L-S2). */
  setSenseGain(g: number): number {
    return this.ensurePlane().setLoopGain(g);
  }

  sense(): SenseView {
    const plane = this.ensurePlane();
    const channels: SenseChannelView[] = [...this.channelMeta.entries()].map(([id, m]) => ({
      id,
      modality: m.modality,
      nodes: m.nodes,
      gain: m.gain,
      peak: m.report?.peak ?? 0,
      energy: m.report?.energy ?? 0,
      support: m.report?.support ?? 0,
      updatedAt: m.updatedAt,
    }));
    channels.sort((a, b) => (a.id < b.id ? -1 : 1));
    return { channels, report: plane.report() };
  }

  // ---- Ω-P6: braid memory ----

  private ensureBraid(): TorusBraid {
    if (!this.braid) {
      const nodes = this.nodes[0] ?? 144;
      this.braid = new TorusBraid({ nodes, capacity: ratedCapacity(nodes) });
      this.scratchField = createField(nodes);
    }
    return this.braid;
  }

  /**
   * Fold the rank-0 field into the braid on the memory stride, behind a
   * novelty gate: a field the braid already recognises is *not* re-stored, so
   * capacity buys distinct experience rather than repetition. The recall that
   * decides this is the same cascade the UI reads as `familiarity`.
   */
  private foldMemory(tick: number): void {
    if (tick % MEMORY_STRIDE !== 0 || tick === this.lastFoldTick) return;
    const braid = this.ensureBraid();
    const snap = this.engine.engines[0].snapshot();
    const probe = this.scratchField!;
    const n = Math.min(probe.n, snap.z.n);
    probe.re.fill(0);
    probe.im.fill(0);
    for (let i = 0; i < n; i++) {
      probe.re[i] = snap.z.re[i];
      probe.im[i] = snap.z.im[i];
    }
    const r = braid.recall(probe);
    this.lastRecall = r;
    this.lastFoldTick = tick;
    if (r.accepted && r.similarity >= braid.accept) {
      this.skipped++;
    } else {
      braid.store(snap.digest.slice(0, 16), probe, tick);
      this.stored++;
    }
  }

  // ---- Ω-P7: cognition ----

  private ensureMind(): Mind {
    if (!this.mind) {
      const dim = Math.max(6, this.engine.rungs.length * 6);
      this.mind = new Mind({ dim, capacity: 610, seed: `${this.seed}-mind` });
      this.obs = new Float64Array(dim);
    }
    return this.mind;
  }

  /**
   * One cognitive fold per MIND_STRIDE ticks. The observation is the engine's
   * own per-rung telemetry — coherence, energy, obstruction, clamp pressure —
   * so a concept is literally a recurring shape of the ladder's behaviour, and
   * surprise is measured against that same vector. Nothing here is synthesised.
   */
  private foldMind(rep: WebTickReport): void {
    if (rep.tick % MIND_STRIDE !== 0 || rep.tick === this.lastMindTick) return;
    const mind = this.ensureMind();
    const v = this.obs!;
    for (let i = 0; i < this.engine.rungs.length; i++) {
      const t = rep.rungs[i];
      const o = i * 6;
      v[o] = t?.coherence ?? 0;
      v[o + 1] = dlog1p(Math.max(0, t?.energy ?? 0));
      // bounded, amplitude-invariant closure feature — the raw obstruction
      // swings with the golden walk and would teach the mind that oscillation.
      v[o + 2] = t?.closureDefect ?? 0;
      v[o + 3] = t?.clamped ?? 0;
      v[o + 4] = t?.realizedGain ?? 0;
      v[o + 5] = t?.skill ?? 0;
    }
    // A quiescent field carries no experience. Folding a zero observation would
    // mint a degenerate concept and report novelty 1 forever, so an idle ladder
    // is skipped outright rather than recorded as something learned.
    let norm = 0;
    for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
    if (!(norm > 1e-18) || !Number.isFinite(norm)) {
      this.quiescentFolds++;
      this.lastMindTick = rep.tick;
      return;
    }
    this.lastThought = mind.observe(v, rep.tick, rep.digest.slice(0, 16));
    this.lastMindTick = rep.tick;
  }

  cognition(): MindReport {
    return this.ensureMind().report();
  }

  /** Nearest concepts to the live observation — the read side of the store. */
  reflect(k = 5) {
    const mind = this.ensureMind();
    return mind.recall(this.obs ?? new Float64Array(mind.dim), k);
  }

  memory(): MemoryView {
    const braid = this.ensureBraid();
    return {
      load: braid.load,
      capacity: braid.capacity,
      beta: braid.beta(),
      stride: MEMORY_STRIDE,
      lastFoldTick: this.lastFoldTick,
      stored: this.stored,
      skipped: this.skipped,
      familiarity: this.lastRecall?.similarity ?? 0,
      lastRecall: this.lastRecall,
      patterns: braid.patterns().slice(-13),
    };
  }

  /**
   * Run as many ticks as fit in the slice budget, capped by the target rate.
   * `nowMs` is the frame timeline (injected, so the rate window is testable);
   * the slice budget is measured on the host's own monotonic clock — mixing
   * the two would compare an injected timeline against real time.
   */
  pump(nowMs: number, elapsedMs: number): number {
    if (!this.running) return 0;
    // Fractional tick debt: flooring at 1 tick per frame would silently run
    // faster than targetHz whenever the frame interval is shorter than a tick
    // period (an 8 ms rAF at 64 Hz would give 125 Hz). Debt carries the
    // remainder forward instead, and is capped so a stalled tab cannot bank an
    // unbounded catch-up burst.
    this.debt = Math.min(this.debt + (this.targetHz * elapsedMs) / 1000, this.targetHz);
    const wanted = Math.floor(this.debt);
    if (wanted < 1) return 0;

    const t0 = this.clock();
    let done = 0;
    for (let i = 0; i < wanted; i++) {
      this.stepOnce();
      done++;
      if (this.clock() - t0 >= this.sliceBudgetMs) break;
    }
    this.debt -= done; // unspent debt (budget-truncated slice) carries forward
    const spent = this.clock() - t0;
    this.lastLoad = spent / this.sliceBudgetMs;


    // adaptive bus: back off on overrun, recover geometrically (φ-paced).
    if (done < wanted || this.lastLoad > 1) {
      this.overruns++;
      this.busHz = Math.max(MIN_HZ, this.busHz / 1.618033988749895);
    } else if (this.lastLoad < 0.5) {
      this.busHz = Math.min(this.targetHz, this.busHz * 1.1);
    }

    // measured tick rate over a 1 s sliding window
    if (this.rateWindowStart === 0) this.rateWindowStart = nowMs;
    this.rateWindowTicks += done;
    const span = nowMs - this.rateWindowStart;
    if (span >= 1000) {
      this.tickRate = (this.rateWindowTicks * 1000) / span;
      this.rateWindowStart = nowMs;
      this.rateWindowTicks = 0;
    }
    return done;
  }

  private clock(): number {
    const p = (globalThis as { performance?: { now(): number } }).performance;
    return p?.now ? p.now() : Date.now();
  }

  /** Exact web-wide checkpoint (rung state + web tick + digest chain). */
  checkpoint(): WebCheckpoint {
    const cp = this.engine.checkpoint();
    this.checkpointTick = cp.tick;
    return cp;
  }

  restore(cp: WebCheckpoint): void {
    this.engine.restore(cp);
    this.last = null;
    this.checkpointTick = cp.tick;
  }

  snapshot(): HostSnapshot {
    const rep = this.last;
    const cost = profileCost(this.profile);
    const rungs = this.engine.rungs.map((r, i) => {
      const t = rep?.rungs[i];
      return {
        n: r.n,
        nodes: this.nodes[i],
        coherence: t?.coherence ?? 0,
        warm: t?.coherenceWarm ?? false,
        energy: t?.energy ?? 0,
        regime: t?.regime ?? 'IDLE',
        clamped: t?.clamped ?? 0,
        obstruction: t?.obstruction ?? 0,
        closureDefect: t?.closureDefect ?? 0,
        closureQuality: t?.closureQuality ?? 0,
        skill: t?.skill ?? 0,
      };
    });
    return {
      running: this.running,
      profile: this.profile.id,
      seed: this.seed,
      tick: this.engine.currentTick(),
      tickRate: this.tickRate,
      busHz: this.busHz,
      coherence: rep?.coherence ?? 0,
      coherenceWarm: rep?.coherenceWarm ?? NaN,
      warmRungs: rep?.warmRungsTotal ?? 0,
      energy: rungs.reduce((s, r) => s + r.energy, 0),
      fluxMoved: rep?.fluxMoved ?? 0,
      fluxImbalance: rep?.fluxImbalance ?? 0,
      orderingViolations: rep?.orderingViolations ?? 0,
      rowSumDefect: rep?.rowSumDefect ?? this.engine.coupling.rowSumDefect,
      worstEnergyRatio: rep?.worstEnergyRatio ?? 1,
      digest: rep?.digest ?? this.engine.digest(),
      finite: rep?.finite ?? true,
      stepped: rep?.stepped ?? [],
      rungs,
      nodes: this.nodes.slice(),
      totalNodes: cost.nodes,
      predictedBytes: cost.bytes,
      checkpointTick: this.checkpointTick,
      ledgerMarks: this.ledger.size(),
      load: this.lastLoad,
      senseChannels: this.plane?.report().channels ?? 0,
      sensePeak: this.plane?.report().maxPeak ?? 0,
      senseGain: this.plane?.currentLoopGain() ?? 0,
      memoryLoad: this.braid?.load ?? 0,
      memoryCapacity: this.braid?.capacity ?? 0,
      familiarity: this.lastRecall?.similarity ?? 0,
      memoryStage: this.lastRecall?.stage ?? 'idle',
      concepts: this.mind?.store.size ?? 0,
      novelty: this.lastThought?.novelty ?? 0,
      surprise: this.lastThought?.surprise ?? 0,
      selfModel: this.mind?.self.enabled ?? false,
      selfMargin: this.mind?.self.margin() ?? 0,
      quiescentFolds: this.quiescentFolds,
      ...this.organSnapshot(),
      chords: this.engine.coupling.chords,
      tapeOccupancy: this.engine.tape?.occupied() ?? 0,
      tapeCapacity: this.engine.tape?.capacity ?? 0,
      tapeHead: this.engine.tape?.position() ?? 0,
    };
  }

  /**
   * Ladder-wide organ rollup. Organ coverage is counted, not assumed: a rung
   * without an organ bank contributes 0 nodes, so `organNodes < totalNodes`
   * is visible in the UI instead of being papered over.
   */
  private organSnapshot(): { organNodes: number; organResidual: number; organParticipation: number } {
    let nodes = 0;
    let res = 0;
    let part = 0;
    let rungs = 0;
    for (const e of this.engine.engines) {
      const r = e.organReport();
      if (!r) continue;
      nodes += e.nodes;
      res += r.meanEigenResidual;
      part += r.meanParticipation;
      rungs++;
    }
    return {
      organNodes: nodes,
      organResidual: rungs > 0 ? res / rungs : 0,
      organParticipation: rungs > 0 ? part / rungs : 0,
    };
  }

  overrunCount(): number {
    return this.overruns;
  }

  // ---- Ω-P5 on-demand views (never on the snapshot bus) ----

  /** Static topology: ladder rungs, clocks, channel matrix. */
  describe(): EngineDescription {
    return describeEngine(this.engine);
  }

  /** One rung's live field, decimated for rendering. */
  field(rank: number, maxSamples = 610): FieldFrame {
    return fieldFrame(this.engine, rank, maxSamples);
  }

  /** Ledger positions and the tail of the double-entry journal. */
  web(tail = 24): WebView {
    return webView(this.engine, tail);
  }

  /** N1 — six-section sensory scan of one toroid. */
  scan(rank: number): RungScanReport | null {
    return rungScan(this.engine, rank);
  }

  /** Measured spectral roundtrip on the shell and radial planes. */
  spectral(rank: number): SpectralView {
    return spectralView(this.engine, rank);
  }

  // ---- Ω-P8: learning ----

  /**
   * Run the held-out battery for the learnable cell against this host's seed.
   * Synchronous and off the bus by design: it is an explicit operator action,
   * not something the tick loop does behind the user's back. The engine state
   * is untouched — the battery builds its own private SingleTorusEngine.
   */
  learn(opts: LearnRunOptions = {}): LearnRun {
    const t0 = Date.now();
    const traj = sampleTrajectory({
      nodes: opts.nodes ?? Math.min(89, this.nodes[this.nodes.length - 1] ?? 55),
      seed: `${this.seed}-learn`,
      warmup: opts.warmup ?? 89,
      trainTicks: opts.trainTicks ?? 233,
      holdTicks: opts.holdTicks ?? 89,
    });
    const { cell, report } = runBattery(traj, {
      iterations: opts.iterations ?? 240,
      seed: `${this.seed}-spsa`,
    });
    this.learnCell = cell;
    this.lastLearn = {
      report,
      elapsedMs: Date.now() - t0,
      certificates: cell.certificates().map((c) => ({ ...c })),
      nodes: traj.nodes,
    };
    return this.lastLearn;
  }

  /** Last battery result, or null when learning has never been run. */
  learnState(): LearnRun | null {
    return this.lastLearn;
  }
}

export interface LearnRunOptions {
  readonly nodes?: number;
  readonly warmup?: number;
  readonly trainTicks?: number;
  readonly holdTicks?: number;
  readonly iterations?: number;
}

export interface LearnRun {
  readonly report: BatteryReport;
  readonly elapsedMs: number;
  readonly certificates: readonly Certificate[];
  readonly nodes: number;
}


