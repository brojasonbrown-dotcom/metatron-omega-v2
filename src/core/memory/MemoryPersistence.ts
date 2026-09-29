/**
 * MemoryPersistence — local-only snapshot store for MemoryStore.
 *
 * Adapters (auto-selected at runtime, no network ever):
 *   • IndexedDBAdapter  — browser (preferred for Windows installation / PWA)
 *   • InMemoryAdapter   — SSR / Node / fallback
 *
 * Schema is versioned. On version mismatch, restore() returns null instead
 * of throwing, so a forward-incompatible snapshot is treated as "no memory"
 * rather than corrupting the live session. Pure, deterministic serialization.
 */

import type { MemoryStore, MemorySnapshot } from './MemoryStore';
import { memoryPolicy, type MemoryPolicyState } from './MemoryPolicy';
import type { SensoryModality } from '@/core/sensory/SensoryAtom';

export const SCHEMA_VERSION = 2;
export const DEFAULT_DB = 'metatron-memory';
export const DEFAULT_KEY = 'main';

interface Envelope {
  schema: number;
  savedAt: number;
  snapshot: SerializedSnapshot;
  /** Added in schema v2. Absent on v1 envelopes — restore leaves policy at defaults. */
  policy?: MemoryPolicyState;
}

/** JSON-safe snapshot (Float64Array/Int32Array → number[]). */
interface SerializedSnapshot {
  hebbian: { entries: Array<[number, number, number]>; dim: number };
  patterns: Array<{
    tick: number; fibIndex: number; indices: number[]; amplitudes: number[];
    norm: number; poloidal: number; toroidal: number;
    qualiaScalar: number; hash: string; lastSeen: number;
  }>;
  pathway: Array<{ from: string; to: string; count: number; lastTick: number }>;
  journal: Array<{ tick: number; qualiaScalar: number; signatureHash: string; text?: string }>;
  /** L2 episodes (schema v2+). Absent on older envelopes. */
  episodes?: Array<Record<string, unknown>>;
  lexicon?: MemorySnapshot['lexicon'];
  soundWords?: MemorySnapshot['soundWords'];
  lastHash: string | null;
}

function serialize(snap: MemorySnapshot): SerializedSnapshot {
  return {
    hebbian: { entries: snap.hebbian.entries.map(([i, j, w]) => [i, j, w]), dim: snap.hebbian.dim },
    patterns: snap.patterns.map((p) => ({
      tick: p.tick, fibIndex: p.fibIndex,
      indices: Array.from(p.indices), amplitudes: Array.from(p.amplitudes),
      norm: p.norm, poloidal: p.poloidal, toroidal: p.toroidal,
      qualiaScalar: p.qualiaScalar, hash: p.hash, lastSeen: p.lastSeen,
    })),
    pathway: snap.pathway.map((e) => ({ ...e })),
    journal: snap.journal.map((r) => ({ ...r })),
    episodes: (snap.episodes ?? []).map((e) => ({
      ...e,
      indices: Array.from(e.indices),
      amplitudes: Array.from(e.amplitudes),
    })),
    // Typed arrays pass through: IndexedDB structured clone stores Float32
    // exactly, avoiding a ~10x number[] expansion of the meaning deltas.
    lexicon: snap.lexicon,
    soundWords: snap.soundWords,
    lastHash: snap.lastHash,
  };
}

function deserialize(s: SerializedSnapshot): MemorySnapshot {
  return {
    hebbian: { entries: s.hebbian.entries.map(([i, j, w]) => [i, j, w] as [number, number, number]), dim: s.hebbian.dim },
    patterns: s.patterns.map((p) => ({
      tick: p.tick, fibIndex: p.fibIndex,
      indices: new Int32Array(p.indices), amplitudes: new Float64Array(p.amplitudes),
      norm: p.norm, poloidal: p.poloidal, toroidal: p.toroidal,
      qualiaScalar: p.qualiaScalar, hash: p.hash, lastSeen: p.lastSeen,
    })),
    pathway: s.pathway.map((e) => ({ ...e })),
    journal: s.journal.map((r) => ({ ...r })),
    // Episode field shapes are restored tolerantly by EpisodicStore.restore.
    episodes: (s.episodes ?? []) as unknown as MemorySnapshot['episodes'],
    lexicon: s.lexicon,
    soundWords: s.soundWords,
    lastHash: s.lastHash,
  };
}

export interface PersistenceAdapter {
  save(key: string, env: Envelope): Promise<void>;
  load(key: string): Promise<Envelope | null>;
  clear(key: string): Promise<void>;
}

// ─── In-memory adapter (SSR / Node / tests) ──────────────────────────────
class InMemoryAdapter implements PersistenceAdapter {
  private store = new Map<string, Envelope>();
  async save(k: string, e: Envelope) { this.store.set(k, e); }
  async load(k: string) { return this.store.get(k) ?? null; }
  async clear(k: string) { this.store.delete(k); }
}

// ─── IndexedDB adapter (browser / Windows local) ─────────────────────────
class IndexedDBAdapter implements PersistenceAdapter {
  private dbName: string;
  private storeName = 'snapshots';
  constructor(dbName = DEFAULT_DB) { this.dbName = dbName; }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(this.storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.open().then((db) => new Promise<T>((resolve, reject) => {
      const t = db.transaction(this.storeName, mode);
      const s = t.objectStore(this.storeName);
      const r = fn(s);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      t.oncomplete = () => db.close();
    }));
  }

  async save(key: string, env: Envelope): Promise<void> {
    await this.tx('readwrite', (s) => s.put(env, key));
  }
  async load(key: string): Promise<Envelope | null> {
    const v = await this.tx('readonly', (s) => s.get(key));
    return (v as Envelope | undefined) ?? null;
  }
  async clear(key: string): Promise<void> {
    await this.tx('readwrite', (s) => s.delete(key));
  }
}

/** Pick the best adapter for the current runtime. Always local. */
export function defaultAdapter(): PersistenceAdapter {
  if (typeof indexedDB !== 'undefined') {
    try { return new IndexedDBAdapter(); } catch { /* fall through */ }
  }
  return new InMemoryAdapter();
}

// ─── Public API ──────────────────────────────────────────────────────────

export class MemoryPersistence {
  private adapter: PersistenceAdapter;
  constructor(adapter: PersistenceAdapter = defaultAdapter()) {
    this.adapter = adapter;
  }

  async save(store: MemoryStore, key = DEFAULT_KEY): Promise<void> {
    const env: Envelope = {
      schema: SCHEMA_VERSION,
      savedAt: Date.now(),
      snapshot: serialize(store.snapshot()),
      policy: memoryPolicy.get(),
    };
    await this.adapter.save(key, env);
  }

  /** Returns true iff a snapshot was loaded; false if missing or schema-mismatched.
   *  v1 envelopes restore the store but leave MemoryPolicy at defaults (forward-compat). */
  async restore(store: MemoryStore, key = DEFAULT_KEY): Promise<boolean> {
    const env = await this.adapter.load(key);
    if (!env || env.schema < 1 || env.schema > SCHEMA_VERSION) return false;
    store.restore(deserialize(env.snapshot));
    if (env.schema >= 2 && env.policy) {
      const p = env.policy;
      if (typeof p.aggression === 'number') memoryPolicy.setAggression(p.aggression);
      if (p.modalities) {
        (Object.keys(p.modalities) as SensoryModality[]).forEach((m) =>
          memoryPolicy.setModality(m, !!p.modalities[m])
        );
      }
      if (typeof p.fieldStateEnabled === 'boolean') memoryPolicy.setFieldStateEnabled(p.fieldStateEnabled);
    }
    return true;
  }

  async clear(key = DEFAULT_KEY): Promise<void> { await this.adapter.clear(key); }
}

// Test-only export so harness can inject the in-memory adapter deterministically.
export const _internal = { InMemoryAdapter, IndexedDBAdapter, serialize, deserialize };
