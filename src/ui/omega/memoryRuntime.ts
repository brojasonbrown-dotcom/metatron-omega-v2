/**
 * memoryRuntime — the single live memory driver for the V13 shell.
 *
 * Before this module existed the V13 workstation constructed a MemoryStore
 * and never fed it, so every memory readout was dead. The runtime owns:
 *
 *   • the MemoryStore (all 8 layers) and its governor caps
 *   • the drive loop: MetatronOutput → tickMemory() → LearningEngine.observe()
 *   • an external store (useSyncExternalStore) so panels re-render on
 *     memory versions, never at engine tick rate
 *   • IndexedDB persistence (save / load / clear)
 *
 * The drive cadence is owned by the caller (V11EngineBridge, 2 Hz) — the same
 * cadence the Metatron recompute already runs at, so there is no added
 * per-frame cost and the 64 Hz field loop is untouched.
 */

import { MemoryStore } from '@/core/memory/MemoryStore';
import { MemoryPersistence } from '@/core/memory/MemoryPersistence';
import { computeMemoryCaps, type MemoryCaps } from '@/core/memory/MemoryGovernor';
import { tickMemory, type TickMemoryResult } from '@/core/memory/tickMemory';
import {
  LearningEngine,
  type LearningMetrics,
  type LearningOptions,
} from '@/core/memory/LearningEngine';
import type { MetatronOutput } from '@/core/MetatronCore';
import { registerFlush } from '@/lib/persist/flush';
import { SoundWordMap, soundDescriptor } from '@/core/knowledge/lexicon';

/** Decode one self-contained recorder chunk and compute its acoustic descriptor. */
async function chunkDescriptor(blob: Blob): Promise<Float64Array | null> {
  try {
    const Ctx = (globalThis as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    try {
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      return soundDescriptor(buf.getChannelData(0), buf.sampleRate);
    } finally {
      void ctx.close();
    }
  } catch {
    return null;
  }
}

const ENABLED_KEY = 'metatron.v13.memory.enabled';
const LEARN_KEY = 'metatron.v13.memory.learning';

export type MemoryStatus = 'disabled' | 'idle' | 'live' | 'saving' | 'loading' | 'error';

export interface MemoryRuntimeStats {
  version: number;
  enabled: boolean;
  status: MemoryStatus;
  statusText: string;
  tick: number;
  drivenTicks: number;
  hz: number;
  lastResult: TickMemoryResult | null;
  learning: LearningMetrics;
  meanSurprise: number;
  totalMerged: number;
  caps: MemoryCaps;
  store: ReturnType<MemoryStore['stats']>;
  capacities: ReturnType<MemoryStore['capacities']>;
}

function readBool(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback;
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === '1';
}

class MemoryRuntime {
  readonly store = new MemoryStore();
  readonly learning = new LearningEngine(this.store);
  private persistence = new MemoryPersistence();
  private listeners = new Set<() => void>();
  private version = 0;
  private enabled = readBool(ENABLED_KEY, true);
  private learnEnabled = readBool(LEARN_KEY, true);
  private status: MemoryStatus = 'idle';
  private statusText = 'idle';
  private tick = 0;
  private driven = 0;
  private lastResult: TickMemoryResult | null = null;
  private caps: MemoryCaps = computeMemoryCaps();
  private hz = 0;
  private lastTs = 0;
  private cache: MemoryRuntimeStats | null = null;

  /** Autosave bookkeeping: learning is durable without a manual save click. */
  private dirty = false;
  private savingNow = false;
  private lastAutoSave = 0;
  private autoTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.store.applyCaps(this.caps);
    // Re-derive layer caps whenever the brain tier/budget changes so the
    // memory substrate always tracks the governed hardware envelope.
    if (typeof window !== 'undefined') {
      // Periodic checkpoint (every 20 s while dirty) + a flush on page hide,
      // so no learned state depends on the user remembering to press save.
      this.autoTimer = setInterval(() => {
        void this.autoSave();
      }, 20_000);
      registerFlush(() => {
        void this.autoSave(true);
      });
    }
  }

  /** Persist only when something changed; never overlaps with itself. */
  private async autoSave(force = false): Promise<void> {
    if (!this.dirty || this.savingNow) return;
    const now = Date.now();
    if (!force && now - this.lastAutoSave < 10_000) return;
    this.savingNow = true;
    try {
      await this.persistence.save(this.store);
      this.dirty = false;
      this.lastAutoSave = Date.now();
    } catch {
      /* keep dirty; the next checkpoint retries */
    }
    this.savingNow = false;
  }

  // ── external store plumbing ────────────────────────────────────────────
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getStats = (): MemoryRuntimeStats => {
    if (this.cache && this.cache.version === this.version) return this.cache;
    this.cache = {
      version: this.version,
      enabled: this.enabled,
      status: this.status,
      statusText: this.statusText,
      tick: this.tick,
      drivenTicks: this.driven,
      hz: this.hz,
      lastResult: this.lastResult,
      learning: this.learning.metrics(),
      meanSurprise: this.learning.meanSurprise(),
      totalMerged: this.learning.totalMerged(),
      caps: this.caps,
      store: this.store.stats(),
      capacities: this.store.capacities(),
    };
    return this.cache;
  };

  getVersion = (): number => this.version;

  private bump(): void {
    this.version++;
    for (const cb of this.listeners) cb();
  }

  // ── configuration ──────────────────────────────────────────────────────
  isEnabled(): boolean {
    return this.enabled;
  }
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (typeof localStorage !== 'undefined') localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
    this.status = on ? 'idle' : 'disabled';
    this.statusText = on ? 'idle' : 'disabled';
    this.bump();
  }

  isLearningEnabled(): boolean {
    return this.learnEnabled;
  }
  setLearningEnabled(on: boolean): void {
    this.learnEnabled = on;
    if (typeof localStorage !== 'undefined') localStorage.setItem(LEARN_KEY, on ? '1' : '0');
    this.bump();
  }

  setLearningOptions(next: Partial<LearningOptions>): void {
    this.learning.setOptions(next);
    this.bump();
  }
  learningOptions(): LearningOptions {
    return this.learning.options();
  }

  /** Bytes the memory layers are measured to be holding right now. */
  usedBytes(): number {
    const s = this.store.stats();
    return (s.tapeBytesUsed ?? 0) + (s.sensoryBytesUsed ?? 0);
  }

  /** Re-read the governor and resize every layer (called on budget changes). */
  refreshCaps(): MemoryCaps {
    this.caps = computeMemoryCaps({ usedBytes: this.usedBytes() });
    this.store.applyCaps(this.caps);
    this.bump();
    return this.caps;
  }

  // ── the drive loop ─────────────────────────────────────────────────────
  /** One memory tick. Safe to call at any cadence; no-op while disabled. */
  drive(out: MetatronOutput): TickMemoryResult | null {
    if (!this.enabled) return null;
    this.tick++;
    let result: TickMemoryResult;
    try {
      result = tickMemory(out, this.store, this.tick);
      if (this.learnEnabled && result.psi.length > 0) {
        this.learning.observe(this.tick, result.psi);
      }
      this.status = 'live';
      this.statusText = result.isFibonacci ? `φ-tick ${this.tick}` : `live · t=${this.tick}`;
    } catch (err) {
      this.status = 'error';
      this.statusText = err instanceof Error ? err.message : 'memory tick failed';
      this.bump();
      return null;
    }
    this.driven++;
    this.dirty = true;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.lastTs) {
      const dt = now - this.lastTs;
      if (dt > 0) {
        const inst = 1000 / dt;
        this.hz = this.hz ? this.hz * 0.8 + inst * 0.2 : inst;
      }
    }
    this.lastTs = now;
    this.lastResult = result;
    this.bump();
    return result;
  }

  // ── Ω-LEXICON: hearing and reading words ───────────────────────────────
  private recorder: MediaRecorder | null = null;
  private micStream: MediaStream | null = null;
  private ownsMic = false;
  private enabledAudio = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  hearingStatus = 'off';
  lastHeard = '';

  /** Typed words take the same review path as heard words. */
  hear(text: string): void {
    this.store.submit(text, 'typed');
    this.ensureFlushTimer();
    this.bump();
  }

  private ensureFlushTimer(): void {
    if (this.flushTimer || typeof window === 'undefined') return;
    this.flushTimer = setInterval(() => {
      if (this.store.flushPending() > 0) {
        this.dirty = true;
        this.bump();
      }
    }, 500);
  }

  pendingWords() {
    return this.store.pending.list();
  }
  heardHistory() {
    return this.store.pending.history;
  }
  correctWord(id: number, index: number, word: string): void {
    if (this.store.pending.edit(id, index, word)) this.bump();
  }
  dropPending(id: number): void {
    if (this.store.pending.drop(id)) this.bump();
  }
  confirmPending(id: number): void {
    const u = this.store.pending.take(id);
    if (u) {
      this.store.commitPending(u);
      this.dirty = true;
      this.bump();
    }
  }
  confirmAll(): void {
    for (const u of [...this.store.pending.list()]) this.confirmPending(u.id);
  }
  setHold(ms: number): void {
    this.store.pending.holdMs = Math.max(1000, Math.min(60000, ms));
    this.bump();
  }
  setHoldPaused(p: boolean): void {
    this.store.pending.paused = p;
    this.bump();
  }

  inspectWord(w: string) {
    const psi = this.lastResult?.psi;
    const rungs = psi && psi.length > 4 ? Math.floor((psi.length - 4) / 4) : 9;
    return this.store.lexicon.inspect(w, rungs);
  }

  recallWord(w: string) {
    const lex = this.store.lexicon;
    return lex.recall(lex.signature(w), 5);
  }

  lexiconStats() {
    const s = this.store;
    return {
      words: s.lexicon.size,
      tokens: s.lexicon.tokens,
      enqueued: s.wordsEnqueued,
      injected: s.wordsInjected,
      description: s.lastDescription,
      hearing: this.hearingStatus,
      lastHeard: this.lastHeard,
      sound: s.soundWords.stats(),
      holdMs: s.pending.holdMs,
      paused: s.pending.paused,
      corrections: s.pending.corrections,
      drops: s.pending.drops,
      sharedMic: this.micStream !== null && !this.ownsMic,
    };
  }

  /** Per-layer activity: current size, when it last changed, and whether it is saved. */
  private activityPrev = new Map<string, number>();
  private activityAt = new Map<string, number>();
  activity() {
    const st = this.store.stats();
    const snd = this.store.soundWords.stats();
    const rows: [string, string, number][] = [
      ['tape', 'field tape frames written', st.tapeTotalWrites],
      ['hebbian', 'Hebbian links', st.hebbianEntries],
      ['episodes', 'episodes', st.episodes],
      ['patterns', 'patterns', st.patternCount],
      ['pathways', 'pathway edges', st.pathwayEdges],
      ['journal', 'journal records', st.journalRecords],
      ['lexicon', 'words learned (tokens)', this.store.lexicon.tokens],
      ['sound', 'sound→word pairs', snd.trials],
      ['sensory', 'sensory atoms', st.sensoryAtoms],
    ];
    const now = Date.now();
    return {
      rows: rows.map(([id, label, value]) => {
        if (this.activityPrev.get(id) !== value) {
          if (this.activityPrev.has(id)) this.activityAt.set(id, now);
          this.activityPrev.set(id, value);
        }
        return {
          id,
          label,
          value,
          lastChange: this.activityAt.get(id) ?? null,
          dormant: value === 0,
        };
      }),
      savedAt: this.lastAutoSave || null,
      unsaved: this.dirty,
    };
  }

  /**
   * Start/stop hearing. Both ears together: the spectral channel (sound
   * features into the field) and the speech teacher (4 s chunks → words),
   * sharing one microphone stream so sound and words sit on one clock.
   */
  async setListening(on: boolean): Promise<void> {
    if (!on) {
      const rec = this.recorder;
      this.recorder = null;
      rec?.stop();
      if (this.ownsMic) this.micStream?.getTracks().forEach((t) => t.stop());
      this.micStream = null;
      this.ownsMic = false;
      if (this.enabledAudio) {
        const { getSensoryDriver } = await import('./sensoryDriver');
        getSensoryDriver().disable('audio');
        this.enabledAudio = false;
      }
      this.hearingStatus = 'off';
      this.bump();
      return;
    }
    if (this.recorder || typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    this.hearingStatus = 'starting';
    this.bump();
    const { getSensoryDriver } = await import('./sensoryDriver');
    const drv = getSensoryDriver();
    if (!drv.isLive('audio')) this.enabledAudio = await drv.enable('audio');
    const shared = drv.audioStream();
    if (shared) {
      this.micStream = shared;
      this.ownsMic = false;
    } else {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.ownsMic = true;
      } catch {
        this.hearingStatus = 'microphone blocked';
        this.bump();
        return;
      }
    }
    this.ensureFlushTimer();
    const startChunk = () => {
      if (!this.micStream) return;
      const rec = new MediaRecorder(this.micStream);
      this.recorder = rec;
      rec.ondataavailable = async (e) => {
        if (!e.data.size) return;
        const form = new FormData();
        form.append(
          'file',
          new File([e.data], 'chunk.webm', { type: e.data.type || 'audio/webm' }),
        );
        try {
          const res = await fetch('/api/transcribe', { method: 'POST', body: form });
          const body = (await res.json()) as { text?: string; error?: string };
          if (!res.ok) {
            // 401/402/403 are terminal: stop listening and show why.
            this.hearingStatus = body.error ?? `error ${res.status}`;
            if (res.status === 402 || res.status === 403 || res.status === 401)
              void this.setListening(false).then(() => {
                this.hearingStatus = body.error ?? 'stopped';
                this.bump();
              });
          } else if (body.text) {
            this.lastHeard = body.text;
            const descriptor = await chunkDescriptor(e.data);
            this.store.submit(body.text, 'heard', descriptor);
            if (this.recorder) this.hearingStatus = 'listening';
          }
        } catch {
          this.hearingStatus = 'network error';
        }
        this.bump();
      };
      rec.onstop = () => {
        if (this.recorder === rec && this.micStream) startChunk();
      };
      rec.start();
      setTimeout(() => {
        if (rec.state === 'recording') rec.stop();
      }, 4000);
    };
    this.hearingStatus = 'listening';
    this.bump();
    startChunk();
  }

  // ── persistence ────────────────────────────────────────────────────────
  async save(): Promise<void> {
    this.status = 'saving';
    this.statusText = 'saving…';
    this.bump();
    try {
      await this.persistence.save(this.store);
      this.dirty = false;
      this.lastAutoSave = Date.now();
      this.status = 'live';
      this.statusText = 'saved to local storage';
    } catch (err) {
      this.status = 'error';
      this.statusText = err instanceof Error ? err.message : 'save failed';
    }
    this.bump();
  }

  async load(): Promise<void> {
    this.status = 'loading';
    this.statusText = 'loading…';
    this.bump();
    try {
      const ok = await this.persistence.restore(this.store);
      this.learning.reset();
      this.status = 'live';
      this.statusText = ok ? 'restored from local storage' : 'no saved snapshot';
    } catch (err) {
      this.status = 'error';
      this.statusText = err instanceof Error ? err.message : 'load failed';
    }
    this.bump();
  }

  async clear(): Promise<void> {
    try {
      await this.persistence.clear();
      this.store.restore({
        hebbian: { entries: [], dim: 0 },
        patterns: [],
        pathway: [],
        journal: [],
        lexicon: { d: this.store.lexicon.d, total: 0, words: [] },
        soundWords: new SoundWordMap(this.store.soundWords.d).snapshot(),
        lastHash: null,
      });
      this.store.percepts.clear();
      this.learning.reset();
      this.tick = 0;
      this.driven = 0;
      this.lastResult = null;
      this.status = 'idle';
      this.statusText = 'cleared';
    } catch (err) {
      this.status = 'error';
      this.statusText = err instanceof Error ? err.message : 'clear failed';
    }
    this.bump();
  }
}

let singleton: MemoryRuntime | null = null;

export function getMemoryRuntime(): MemoryRuntime {
  if (!singleton) singleton = new MemoryRuntime();
  return singleton;
}

export type { MemoryRuntime };
