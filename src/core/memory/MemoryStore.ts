/**
 * MemoryStore — facade orchestrating all memory layers.
 *
 * Layers:
 *   L0 FieldTape          — continuous Ψ ring buffer (every tick)
 *   L1 HebbianMatrix      — sparse co-activation weights
 *   L2 EpisodicStore      — salience-triggered field snapshots
 *   L3 FibonacciPatterns  — consolidated φ-signatures (semantic)
 *   L4 PathwayGraph       — pattern→pattern transitions
 *   L5 TextJournal        — symbolic memory ring
 *   L6 ReflectiveIndex    — re-measurement priority queue
 *   L-S SensoryGateway    — content-addressed sensory atoms (audio/video/imu)
 *
 * Determinism: identical capture() sequence ⇒ identical snapshot().
 */

import { HebbianMatrix, type HebbianSnapshot } from './HebbianMatrix';
import { FibonacciPatterns, type PatternSignature, type PatternRecall } from './FibonacciPatterns';
import { PathwayGraph, type PathwayEdge } from './PathwayGraph';
import { TextJournal, type JournalRecord } from './TextJournal';
import { FieldTape, type FieldTapeFrame } from './FieldTape';
import { summariseTrajectory, EMPTY_TRAJECTORY, type TrajectorySummary } from './Trajectory';
import { EpisodicStore, type Episode } from './EpisodicStore';
import { ReflectiveIndex } from './ReflectiveIndex';
import { SensoryGateway } from '@/core/sensory/SensoryGateway';
import { PerceptRegistry } from './PerceptRegistry';
import { VisionFieldIndex } from './VisionFieldIndex';
import { MemoryCaptureKernel, type CaptureInput, type CaptureMetrics } from './MemoryCaptureKernel';

export interface MemoryIngest {
  tick: number;
  psi: Float64Array;
  qualiaScalar?: number;
  text?: string;
}

export interface MemoryRecall {
  hebbian: Float64Array;
  patterns: PatternRecall[];
  successors: PathwayEdge[];
  journalTail: JournalRecord[];
  /** Ω-ACTIVATE B2 — L0 dynamics around the recalled moment. */
  trajectory: TrajectorySummary;
}

export interface MemorySnapshot {
  hebbian: HebbianSnapshot;
  patterns: PatternSignature[];
  pathway: PathwayEdge[];
  journal: JournalRecord[];
  /** L2 episodes. Optional so pre-existing saves still restore. */
  episodes?: Episode[];
  lastHash: string | null;
}

export interface MemoryCaps {
  maxHebbianEntries: number;
  maxPatterns: number;
  maxPathwayEdges: number;
  maxJournalRecords: number;
  maxTapeFrames?: number;
  maxEpisodes?: number;
  maxSensoryAtoms?: number;
}

export class MemoryStore {
  readonly hebbian = new HebbianMatrix();
  readonly patterns = new FibonacciPatterns();          // L3 (now semantic-consolidated)
  readonly pathway = new PathwayGraph();
  readonly journal = new TextJournal();
  readonly fieldTape = new FieldTape(1 << 16);           // L0 — 65 536 frames default
  readonly episodic = new EpisodicStore(2048);           // L2
  readonly reflective: ReflectiveIndex;
  readonly sensory = new SensoryGateway(8192);           // L-S
  readonly percepts = new PerceptRegistry(1024);         // L-S+ named recognition
  readonly visionField = new VisionFieldIndex();         // L-V bidirectional image↔field cosine index
  readonly kernel: MemoryCaptureKernel;
  /** Ω-LEXICON — learned word meaning vectors (spelling ⊕ context). */
  readonly lexicon = new LexiconMemory();
  /** Words heard/read since the last memory tick; drained losslessly. */
  private readonly wordQueue: { text: string; at: number }[] = [];
  /** Scalar witness-coherence path the grounded predicates read. */
  readonly coherencePath: number[] = [];
  /** Last field → words transcription, null when nothing fired. */
  lastDescription: string | null = null;
  /** Word-rate counters: every enqueued token is either injected or still queued. */
  wordsEnqueued = 0;
  wordsInjected = 0;
  private lastHash: string | null = null;

  constructor() {
    this.reflective = new ReflectiveIndex(this.episodic);
    this.kernel = new MemoryCaptureKernel(this);
  }

  /** Enqueue an utterance at word rate; it is consumed by the next tick. */
  hear(text: string, at = Date.now()): void {
    if (!text || !text.trim()) return;
    this.wordQueue.push({ text, at });
    this.wordsEnqueued += text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).length;
  }

  /** Drain every queued utterance in arrival order. */
  drainWords(): { text: string; at: number }[] {
    return this.wordQueue.splice(0, this.wordQueue.length);
  }

  /** Modern capture entry — drives every layer through the PhiLock scheduler. */
  capture(input: CaptureInput): CaptureMetrics {
    return this.kernel.capture(input);
  }

  /** Legacy ingest (kept for compatibility). Routes through capture(). */
  ingest(input: MemoryIngest): { stored: PatternSignature | null } {
    const m = this.capture({
      tick: input.tick,
      psi: input.psi,
      qualiaScalar: input.qualiaScalar ?? 0,
      coherence: input.qualiaScalar ?? 0,
      energy: 0,
      text: input.text,
    });
    // Legacy callers expect Fibonacci-tick ingest to warm the semantic pattern
    // store immediately. The modern capture path still schedules richer L3
    // consolidation at F12; this direct ingest restores the old facade contract
    // without changing live engine math or scheduler behavior.
    const stored = this.patterns.ingest(input.tick, input.psi, input.qualiaScalar ?? 0);
    const last = stored ?? this.patterns.snapshot().at(-1) ?? null;
    void m;
    return { stored: last };
  }

  recall(cue: Float64Array, currentTick?: number, topN = 5): MemoryRecall {
    const patterns = this.patterns.recall(cue, topN, currentTick);
    const head = patterns[0]?.pattern.hash;
    // Ω-ACTIVATE B2: attach L0 evidence. Anchor on the recalled pattern's own
    // tick when we have one (what the field was doing when the memory formed),
    // else on the caller's current tick.
    const anchor = patterns[0]?.pattern.tick ?? currentTick ?? null;
    const trajectory = anchor === null
      ? EMPTY_TRAJECTORY
      : summariseTrajectory(this.fieldTape.window(anchor, 21, 21));
    return {
      hebbian: this.hebbian.recall(cue),
      patterns,
      successors: head ? this.pathway.successors(head, topN) : [],
      journalTail: this.journal.tail(topN),
      trajectory,
    };
  }

  /** Ω-ACTIVATE B1 — direct L0 replay for the UI and the mind loop. */
  replay(n = 89): FieldTapeFrame[] {
    return this.fieldTape.tail(n).reverse();
  }

  /** Trajectory summary around an arbitrary tick (empty when the tape has no cover). */
  trajectoryAt(tick: number, before = 21, after = 21): TrajectorySummary {
    return summariseTrajectory(this.fieldTape.window(tick, before, after));
  }

  snapshot(): MemorySnapshot {
    return {
      hebbian: this.hebbian.snapshot(),
      patterns: this.patterns.snapshot(),
      pathway: this.pathway.snapshot(),
      journal: this.journal.snapshot(),
      episodes: this.episodic.snapshot(),
      lastHash: this.lastHash,
    };
  }

  restore(snap: MemorySnapshot): void {
    this.hebbian.restore(snap.hebbian);
    this.patterns.restore(snap.patterns);
    this.pathway.restore(snap.pathway);
    this.journal.restore(snap.journal);
    // Absent on legacy snapshots: leave the live L2 store untouched rather
    // than clearing memories that the transport simply never carried.
    if (snap.episodes) this.episodic.restore(snap.episodes);
    this.lastHash = snap.lastHash;
  }

  stats() {
    const sens = this.sensory.stats();
    return {
      hebbianEntries: this.hebbian.size(),
      hebbianFrobenius: this.hebbian.frobenius(),
      patternCount: this.patterns.size(),
      pathwayEdges: this.pathway.size(),
      journalRecords: this.journal.size(),
      tapeFrames: this.fieldTape.size(),
      tapeTotalWrites: this.fieldTape.totalWrites(),
      tapeBytesUsed: this.fieldTape.bytesUsed(),
      tapeBytesBudget: this.fieldTape.bytesBudget(),
      episodes: this.episodic.size(),
      sensoryAtoms: sens.atoms,
      sensoryBytesUsed: sens.bytesUsed,
      sensoryUniqueRatio: sens.uniqueRatio,
      sensoryPerModality: sens.perModality,
      lastSalience: this.kernel.metrics()?.salience ?? 0,
    };
  }

  capacities() {
    return {
      hebbian: this.hebbian.capacity(),
      patterns: this.patterns.capacity(),
      pathway: this.pathway.capacity(),
      journal: this.journal.capacity(),
      tape: this.fieldTape.capacity(),
      episodes: this.episodic.capacity(),
      sensory: this.sensory.capacity(),
    };
  }

  /** Resize every layer from a fresh MemoryGovernor.computeMemoryCaps() result. */
  applyCaps(caps: MemoryCaps): void {
    this.hebbian.setCap(caps.maxHebbianEntries);
    this.patterns.setCap(caps.maxPatterns);
    this.pathway.setCap(caps.maxPathwayEdges);
    this.journal.setCap(caps.maxJournalRecords);
    if (caps.maxTapeFrames) this.fieldTape.setCap(caps.maxTapeFrames);
    if (caps.maxEpisodes) this.episodic.setCap(caps.maxEpisodes);
    if (caps.maxSensoryAtoms) this.sensory.setCap(caps.maxSensoryAtoms);
  }
}

export type { Episode };
