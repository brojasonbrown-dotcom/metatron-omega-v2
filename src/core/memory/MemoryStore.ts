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

import {
  LexiconMemory,
  SoundWordMap,
  type LexiconSnapshot,
  type SoundWordSnapshot,
} from '@/core/knowledge/lexicon';

export interface MemorySnapshot {
  hebbian: HebbianSnapshot;
  patterns: PatternSignature[];
  pathway: PathwayEdge[];
  journal: JournalRecord[];
  /** L2 episodes. Optional so pre-existing saves still restore. */
  episodes?: Episode[];
  /** Learned word meanings. Optional so pre-lexicon saves still restore. */
  lexicon?: LexiconSnapshot;
  /** Learned sound→word map + its prequential score. */
  soundWords?: SoundWordSnapshot;
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

/** One heard or typed utterance waiting for review before it becomes memory. */
export interface PendingUtterance {
  readonly id: number;
  words: string[];
  readonly original: string;
  readonly source: 'heard' | 'typed';
  readonly at: number;
  readonly descriptor: Float64Array | null;
  /** The field's own guess from sound alone, made before the label was seen. */
  readonly guess: string | null;
  edited: boolean;
}

export interface HeardWord {
  readonly word: string;
  readonly source: 'heard' | 'typed';
  readonly at: number;
  readonly corrected: boolean;
  /** Did the field's sound-only guess name this word? null when no guess. */
  readonly hit: boolean | null;
}

/**
 * Review window between hearing and memory. Nothing enters the field until an
 * utterance is confirmed or its hold expires, so a misheard word can be fixed
 * or removed and is never learned. Deterministic given the `now` it is fed.
 */
export class PendingTranscript {
  holdMs = 8000;
  paused = false;
  corrections = 0;
  drops = 0;
  private items: PendingUtterance[] = [];
  private nextId = 1;
  readonly history: HeardWord[] = [];
  static readonly HISTORY = 30;

  push(
    text: string,
    source: 'heard' | 'typed',
    descriptor: Float64Array | null,
    guess: string | null,
    at: number,
  ): PendingUtterance | null {
    const words = text
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .map((w) => w.replace(/'/g, ''))
      .filter(Boolean);
    if (words.length === 0) return null;
    const u: PendingUtterance = {
      id: this.nextId++,
      words,
      original: text,
      source,
      at,
      descriptor,
      guess,
      edited: false,
    };
    this.items.push(u);
    return u;
  }

  list(): readonly PendingUtterance[] {
    return this.items;
  }

  /** Replace word `index` of utterance `id`; an empty string removes it. */
  edit(id: number, index: number, word: string): boolean {
    const u = this.items.find((x) => x.id === id);
    if (!u || index < 0 || index >= u.words.length) return false;
    const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (w === u.words[index]) return false;
    if (w) u.words[index] = w;
    else u.words.splice(index, 1);
    if (!u.edited) this.corrections++;
    u.edited = true;
    if (u.words.length === 0) this.drop(id);
    return true;
  }

  drop(id: number): boolean {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.items.splice(i, 1);
    this.drops++;
    return true;
  }

  take(id: number): PendingUtterance | null {
    const i = this.items.findIndex((x) => x.id === id);
    return i < 0 ? null : this.items.splice(i, 1)[0];
  }

  /** Remove and return every utterance whose hold has elapsed (none while paused). */
  expired(now: number): PendingUtterance[] {
    if (this.paused) return [];
    const out: PendingUtterance[] = [];
    this.items = this.items.filter((u) => {
      if (now - u.at >= this.holdMs) {
        out.push(u);
        return false;
      }
      return true;
    });
    return out;
  }

  record(u: PendingUtterance): void {
    for (const w of u.words) {
      this.history.push({
        word: w,
        source: u.source,
        at: u.at,
        corrected: u.edited,
        hit: u.guess === null ? null : u.guess === w,
      });
    }
    if (this.history.length > PendingTranscript.HISTORY)
      this.history.splice(0, this.history.length - PendingTranscript.HISTORY);
  }

  clear(): void {
    this.items = [];
    this.history.length = 0;
    this.corrections = 0;
    this.drops = 0;
  }
}

export class MemoryStore {
  readonly hebbian = new HebbianMatrix();
  readonly patterns = new FibonacciPatterns(); // L3 (now semantic-consolidated)
  readonly pathway = new PathwayGraph();
  readonly journal = new TextJournal();
  readonly fieldTape = new FieldTape(1 << 16); // L0 — 65 536 frames default
  readonly episodic = new EpisodicStore(2048); // L2
  readonly reflective: ReflectiveIndex;
  readonly sensory = new SensoryGateway(8192); // L-S
  readonly percepts = new PerceptRegistry(1024); // L-S+ named recognition
  readonly visionField = new VisionFieldIndex(); // L-V bidirectional image↔field cosine index
  readonly kernel: MemoryCaptureKernel;
  /** Ω-LEXICON — learned word meaning vectors (spelling ⊕ context). */
  readonly lexicon = new LexiconMemory();
  /** Sound→word map taught by the speech-to-text teacher. */
  readonly soundWords = new SoundWordMap();
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
    this.wordsEnqueued += text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean).length;
  }

  /**
   * One teacher-labelled sound chunk: score the field's own guess from the
   * sound, then learn the pair, then queue the words for the field.
   */
  hearWithSound(text: string, descriptor: ArrayLike<number> | null, at = Date.now()) {
    const trial = descriptor ? this.soundWords.observe(descriptor, text, this.lexicon) : null;
    // The words themselves enter the lexicon at the next memory tick.
    this.hear(text, at);
    return trial;
  }

  /** Drain every queued utterance in arrival order. */
  drainWords(): { text: string; at: number }[] {
    return this.wordQueue.splice(0, this.wordQueue.length);
  }

  /** Review window: heard/typed words wait here before becoming memory. */
  readonly pending = new PendingTranscript();

  /** Queue an utterance for review; the sound-only guess is made now, before any learning. */
  submit(
    text: string,
    source: 'heard' | 'typed',
    descriptor: Float64Array | null = null,
    at = Date.now(),
  ): PendingUtterance | null {
    const g = descriptor ? this.soundWords.guess(descriptor, this.lexicon, 1) : null;
    return this.pending.push(text, source, descriptor, g?.hits[0]?.word ?? null, at);
  }

  /**
   * Commit one reviewed utterance. Only the corrected words are ever learned:
   * the sound is bound to them, and the field's earlier guess is scored
   * against them, so a wrong guess counts as a miss.
   */
  commitPending(u: PendingUtterance, at = Date.now()) {
    if (u.words.length === 0) return null;
    const text = u.words.join(' ');
    const trial = this.hearWithSound(text, u.descriptor, at);
    this.pending.record(u);
    return trial;
  }

  /** Commit every utterance whose hold has elapsed. Returns how many were committed. */
  flushPending(now = Date.now()): number {
    const due = this.pending.expired(now);
    for (const u of due) this.commitPending(u, now);
    return due.length;
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
    const trajectory =
      anchor === null
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
      lexicon: this.lexicon.snapshot(),
      soundWords: this.soundWords.snapshot(),
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
    if (snap.lexicon) this.lexicon.load(snap.lexicon);
    if (snap.soundWords) this.soundWords.load(snap.soundWords);
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
