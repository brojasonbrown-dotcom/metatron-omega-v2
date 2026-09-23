/**
 * knowledgeRuntime — the single live driver for the local-first knowledge base.
 *
 * Owns the KnowledgeBase, the LocalArchive (OPFS → IndexedDB → memory), and
 * the AcquisitionRunner. Exposes an external store so panels subscribe to a
 * version counter instead of re-rendering per event.
 *
 * Nothing here touches the network directly: acquisition goes through the
 * existing tool-dispatch server function, which is a stateless proxy — no
 * corpus ever leaves the device.
 */

import { KnowledgeBase } from '@/core/knowledge/KnowledgeBase';
import { LocalArchive } from '@/core/knowledge/LocalArchive';
import { AcquisitionRunner, type RunState, type ToolCall } from '@/core/knowledge/Acquisition';
import type { KnowledgeStats, RecallHit } from '@/core/knowledge/types';
import type { FieldContext } from '@/core/memory/Resonance';
import type { ConsolidationReport } from '@/core/memory/Consolidator';
import type { LatentBuildReport } from '@/core/knowledge/LatentSpace';
import type { BasisReport } from '@/core/knowledge/fieldSignature';
import { memoryPolicy } from '@/core/memory/MemoryPolicy';
import { registerFlush } from '@/lib/persist/flush';


const FIELD_KEY = 'metatron.omega.knowledge.field';

export interface KnowledgeRuntimeStats {
  version: number;
  stats: KnowledgeStats;
  run: RunState;
  storage: { kind: string; bytes: number; usage: number; quota: number };
  saving: boolean;
  lastSavedAt: number | null;
  field: string;
  /** Last consolidation pass (plane D), null until one has run. */
  consolidation: ConsolidationReport | null;
  consolidatedAt: number | null;
  /** Last latent-space build (plane E), null until one has run. */
  latent: LatentBuildReport | null;
  latentAt: number | null;
  /** Ω-SHFN G — measured eigenbasis for field signatures, null until built. */
  signature: BasisReport | null;
  /** Chunks carrying a measured field signature / corpus size. */
  signatureCovered: number;
  signatureTotal: number;
  /** True while the incremental signature sweep is running. */
  signing: boolean;
}

class KnowledgeRuntime {
  readonly kb = new KnowledgeBase();
  private archive = new LocalArchive();
  private runner: AcquisitionRunner | null = null;
  private listeners = new Set<() => void>();
  private call: ToolCall | null = null;
  private hydrated = false;
  private rungAt: () => number = () => -1;
  private dirty = false;
  private savingNow = false;
  private lastAutoSave = 0;

  private cache: KnowledgeRuntimeStats = {
    version: 0,
    stats: { fields: 0, documents: 0, chunks: 0, terms: 0, concepts: 0, edges: 0, bytes: 0, bands: 0 },
    run: { field: '', active: false, phase: 'idle', cycle: 0, fetched: 0, failed: 0, newChunks: 0, novelty: 1, frontier: 0, events: [] },
    storage: { kind: 'memory', bytes: 0, usage: 0, quota: 0 },
    saving: false,
    lastSavedAt: null,
    consolidation: null,
    consolidatedAt: null,
    latent: null,
    latentAt: null,
    signature: null,
    signatureCovered: 0,
    signatureTotal: 0,
    signing: false,
    field: typeof localStorage !== 'undefined' ? (localStorage.getItem(FIELD_KEY) ?? '') : '',
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getStats = (): KnowledgeRuntimeStats => this.cache;
  getVersion = (): number => this.cache.version;

  private bump(patch: Partial<KnowledgeRuntimeStats> = {}): void {
    this.cache = {
      ...this.cache,
      ...patch,
      stats: patch.stats ?? this.kb.stats(),
      version: this.cache.version + 1,
    };
    // Any state change makes the corpus dirty; the checkpoint loop below
    // writes it out so acquisition, consolidation, latent training and recall
    // reinforcement all survive a reload without a manual save.
    if (patch.saving === undefined) this.dirty = true;
    for (const l of this.listeners) l();
  }

  /** Persist when dirty, never overlapping, at most once per 10 s. */
  private async autoSave(force = false): Promise<void> {
    if (!this.dirty || this.savingNow || !this.hydrated) return;
    const now = Date.now();
    if (!force && now - this.lastAutoSave < 10_000) return;
    this.savingNow = true;
    try {
      await this.archive.save(this.kb.snapshot());
      this.dirty = false;
      this.lastAutoSave = Date.now();
      await this.refreshStorage();
      this.bump({ lastSavedAt: this.lastAutoSave });
    } catch { /* stay dirty; the next checkpoint retries */ }
    this.savingNow = false;
  }

  /** Wire the tool dispatcher (a bound useServerFn from the panel). */
  setToolCall(call: ToolCall): void { this.call = call; }

  setField(field: string): void {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FIELD_KEY, field);
    this.bump({ field });
  }

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    const payload = await this.archive.load<ReturnType<KnowledgeBase['snapshot']>>();
    if (payload) this.kb.restore(payload);
    await this.refreshStorage();
    this.dirty = false;
    if (typeof window !== 'undefined') {
      setInterval(() => { void this.autoSave(); }, 20_000);
      registerFlush(() => { void this.autoSave(true); });
    }
    this.bump();
    this.dirty = false;
    this.warmSignatures();
  }

  /**
   * Ω-WAKE S4 — build the field-signature eigenbasis once per session, at idle.
   *
   * Without this the FLD recall channel abstains for the whole session and the
   * `knowledge.field` self-test fails ("eigenbasis never built"). The sweep is
   * already slice-budgeted and yields between slices, so it costs the UI
   * nothing; we only choose *when* to start it.
   */
  warmSignatures(): void {
    if (typeof window === 'undefined') return;
    if (this.cache.signing || this.cache.stats.chunks === 0) return;
    if (this.kb.signatureState().ready) return;
    const start = () => { void this.buildSignatures(); };
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (typeof ric === 'function') ric(start, { timeout: 4000 });
    else setTimeout(start, 1200);
  }

  async refreshStorage(): Promise<void> {
    const bytes = await this.archive.bytes().catch(() => 0);
    const q = await this.archive.quota().catch(() => null);
    this.cache = {
      ...this.cache,
      storage: {
        kind: this.archive.adapter.kind,
        bytes,
        usage: q?.usage ?? 0,
        quota: q?.quota ?? 0,
      },
    };
  }

  async save(): Promise<void> {
    this.bump({ saving: true });
    try {
      await this.archive.save(this.kb.snapshot());
      await this.refreshStorage();
      this.dirty = false;
      this.lastAutoSave = Date.now();
      this.bump({ saving: false, lastSavedAt: this.lastAutoSave });
    } catch {
      this.bump({ saving: false });
    }
  }

  async wipe(): Promise<void> {
    this.stop();
    this.kb.clear();
    await this.archive.clear();
    await this.refreshStorage();
    this.bump({ lastSavedAt: null });
  }

  removeDocument(id: string): void {
    this.kb.removeDocument(id);
    this.bump();
  }

  /**
   * Recall. `ctx` carries live field telemetry so the resonance channel can
   * measure; omit it and that channel abstains, leaving ranking identical to
   * the text-only cascade.
   */
  recall(query: string, topN = 8, field?: string, ctx?: FieldContext): RecallHit[] {
    return this.kb.recall(query, topN, field, ctx);
  }


  /**
   * Run one consolidation pass. Budgeted by the single memory dial so a large
   * corpus cannot stall the tab; the pass is annotation-only and never deletes.
   */
  consolidate(): ConsolidationReport {
    const report = this.kb.consolidate(memoryPolicy.consolidationBudget());
    this.bump({ consolidation: report, consolidatedAt: Date.now() });
    return report;
  }

  /**
   * Train the PPMI-SVD latent space over the whole corpus (Phase 3). The
   * latent recall channel abstains until this has run at least once.
   */
  trainLatent() {
    const report = this.kb.trainLatent();
    this.bump({ latent: report, latentAt: Date.now() });
    return report;
  }

  /**
   * Ω-SHFN G — build the field-signature eigenbasis, then sweep the corpus in
   * budgeted slices so the tab never blocks. Every slice yields to the event
   * loop and republishes real coverage; nothing here is estimated.
   */
  async buildSignatures(tierId?: string, slice = 64): Promise<void> {
    if (this.cache.signing) return;
    this.bump({ signing: true });
    try {
      const basis = this.kb.prepareSignatures(tierId);
      this.bump({ signature: basis });
      for (;;) {
        const r = this.kb.buildSignatures(slice);
        this.bump({ signatureCovered: r.covered, signatureTotal: r.total });
        if (r.built === 0 || r.covered >= r.total) break;
        await new Promise((res) => setTimeout(res, 0));
      }
    } finally {
      this.bump({ signing: false });
    }
  }

  signatureState() { return this.kb.signatureState(); }

  /**
   * Ingest one locally provided document (drag-dropped CAD/BIM asset, OCR'd
   * image, pasted note). Same path as acquisition — chunked, hashed, barcoded
   * — so a local file is indistinguishable from a crawled one at recall time.
   */
  ingestLocal(input: Parameters<KnowledgeBase['ingest']>[0]) {
    const out = this.kb.ingest({ rung: this.rungAt(), ...input });
    this.bump();
    void this.autoSave(true);
    return out;
  }

  /** Live rung provider used to scale-tag newly acquired material. */
  setRungProvider(fn: () => number): void { this.rungAt = fn; }

  running(): boolean { return this.cache.run.active; }

  start(field: string): void {
    if (!this.call) throw new Error('tool dispatcher not wired');
    if (this.cache.run.active) return;
    this.setField(field);
    let sinceSave = 0;
    this.runner = new AcquisitionRunner({
      field,
      kb: this.kb,
      call: this.call,
      rungAt: () => this.rungAt(),
      onUpdate: (run) => {
        this.bump({ run });
        // Autosave every 10 successful documents so a crash costs nothing.
        if (run.fetched > 0 && run.fetched - sinceSave >= 10) {
          sinceSave = run.fetched;
          void this.save();
        }
      },
    });
    void this.runner.run().then(() => { void this.save(); });
  }

  stop(): void {
    this.runner?.stop();
  }
}

let singleton: KnowledgeRuntime | null = null;
export function getKnowledgeRuntime(): KnowledgeRuntime {
  if (!singleton) singleton = new KnowledgeRuntime();
  return singleton;
}
export type { KnowledgeRuntime, RecallHit };
