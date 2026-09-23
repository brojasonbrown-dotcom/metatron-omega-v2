/**
 * Ω-CORPUS — the blob substrate.
 *
 * Three adapters, auto-selected, never any network:
 *   • OPFS        — near-disk-speed immutable files, tens of GB on desktop.
 *   • IndexedDB   — universal browser fallback.
 *   • In-memory   — SSR, tests, and any host that grants nothing.
 *
 * Every write is atomic at the record level: a sealed shard either exists in
 * full or does not exist. There is no update path — the corpus below HOT is
 * append-only, so the API deliberately offers `put`, `get`, `list`, `erase`
 * and nothing that could rewrite a sealed unit in place.
 */

export type BlobStoreKind = 'opfs' | 'indexeddb' | 'memory';

export interface QuotaEstimate {
  /** Bytes the origin is currently using, or NaN when the host will not say. */
  readonly usage: number;
  /** Bytes the origin may use, or NaN when unknown. */
  readonly quota: number;
}

export interface BlobStore {
  readonly kind: BlobStoreKind;
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  list(prefix: string): Promise<string[]>;
  erase(key: string): Promise<void>;
  bytes(key: string): Promise<number>;
  estimate(): Promise<QuotaEstimate>;
}

const UNKNOWN_QUOTA: QuotaEstimate = { usage: NaN, quota: NaN };

async function hostEstimate(): Promise<QuotaEstimate> {
  try {
    const s = (globalThis as { navigator?: { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } } })
      .navigator?.storage;
    if (!s?.estimate) return UNKNOWN_QUOTA;
    const e = await s.estimate();
    return { usage: e.usage ?? NaN, quota: e.quota ?? NaN };
  } catch {
    return UNKNOWN_QUOTA;
  }
}

export class MemoryBlobStore implements BlobStore {
  readonly kind = 'memory' as const;
  private m = new Map<string, Uint8Array>();
  async put(k: string, d: Uint8Array) { this.m.set(k, Uint8Array.from(d)); }
  async get(k: string) { const v = this.m.get(k); return v ? Uint8Array.from(v) : null; }
  async list(p: string) { return [...this.m.keys()].filter((k) => k.startsWith(p)).sort(); }
  async erase(k: string) { this.m.delete(k); }
  async bytes(k: string) { return this.m.get(k)?.byteLength ?? 0; }
  async estimate(): Promise<QuotaEstimate> {
    let usage = 0;
    for (const v of this.m.values()) usage += v.byteLength;
    return { usage, quota: NaN };
  }
}

const DB_NAME = 'metatron-corpus';
const STORE = 'blobs';

class IdbBlobStore implements BlobStore {
  readonly kind = 'indexeddb' as const;

  private open(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    try {
      return await new Promise<T>((res, rej) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    } finally {
      db.close();
    }
  }

  async put(k: string, d: Uint8Array) {
    await this.tx('readwrite', (s) => s.put(Uint8Array.from(d), k) as IDBRequest<IDBValidKey>);
  }
  async get(k: string) {
    const v = await this.tx<unknown>('readonly', (s) => s.get(k) as IDBRequest<unknown>);
    if (!v) return null;
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    return null;
  }
  async list(p: string) {
    const keys = await this.tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>);
    return keys.map(String).filter((k) => k.startsWith(p)).sort();
  }
  async erase(k: string) {
    await this.tx('readwrite', (s) => s.delete(k) as unknown as IDBRequest<undefined>);
  }
  async bytes(k: string) { return (await this.get(k))?.byteLength ?? 0; }
  estimate() { return hostEstimate(); }
}

class OpfsBlobStore implements BlobStore {
  readonly kind = 'opfs' as const;
  private dirName: string;
  constructor(dirName = 'corpus') { this.dirName = dirName; }

  private async dir(): Promise<FileSystemDirectoryHandle> {
    const root = await (navigator.storage as unknown as {
      getDirectory: () => Promise<FileSystemDirectoryHandle>;
    }).getDirectory();
    return root.getDirectoryHandle(this.dirName, { create: true });
  }

  /** Safe file name for a key — OPFS has no namespacing of its own. */
  private file(key: string): string { return key.replace(/[^\w.-]+/g, '_'); }

  async put(k: string, d: Uint8Array) {
    const dir = await this.dir();
    // temp → rename, so a crash mid-write can never leave a half shard behind.
    const tmp = `${this.file(k)}.tmp`;
    const h = await dir.getFileHandle(tmp, { create: true });
    const w = await (h as unknown as { createWritable: () => Promise<WritableStream & { write: (d: Uint8Array) => Promise<void>; close: () => Promise<void> }> }).createWritable();
    await w.write(Uint8Array.from(d));
    await w.close();
    const mv = (h as unknown as { move?: (dir: FileSystemDirectoryHandle, name: string) => Promise<void> }).move;
    if (typeof mv === 'function') {
      await mv.call(h, dir, this.file(k));
    } else {
      // No rename on this host: copy through and drop the temp file.
      const src = await (await dir.getFileHandle(tmp)).getFile();
      const buf = new Uint8Array(await src.arrayBuffer());
      const dst = await dir.getFileHandle(this.file(k), { create: true });
      const w2 = await (dst as unknown as { createWritable: () => Promise<{ write: (d: Uint8Array) => Promise<void>; close: () => Promise<void> }> }).createWritable();
      await w2.write(buf);
      await w2.close();
      await dir.removeEntry(tmp).catch(() => {});
    }
  }

  async get(k: string) {
    try {
      const dir = await this.dir();
      const f = await (await dir.getFileHandle(this.file(k))).getFile();
      return new Uint8Array(await f.arrayBuffer());
    } catch {
      return null;
    }
  }

  async list(p: string) {
    const dir = await this.dir();
    const out: string[] = [];
    const it = (dir as unknown as { keys: () => AsyncIterableIterator<string> }).keys();
    for await (const name of it) {
      if (name.endsWith('.tmp')) continue;
      if (name.startsWith(this.file(p))) out.push(name);
    }
    return out.sort();
  }

  async erase(k: string) {
    const dir = await this.dir();
    await dir.removeEntry(this.file(k)).catch(() => {});
  }

  async bytes(k: string) { return (await this.get(k))?.byteLength ?? 0; }
  estimate() { return hostEstimate(); }
}

/** OPFS if the host really has it, then IndexedDB, then memory. */
export function selectBlobStore(preferred?: BlobStoreKind, dirName = 'corpus'): BlobStore {
  const nav = (globalThis as { navigator?: { storage?: { getDirectory?: unknown } } }).navigator;
  const hasOpfs = typeof nav?.storage?.getDirectory === 'function';
  const hasIdb = typeof (globalThis as { indexedDB?: unknown }).indexedDB !== 'undefined';

  if (preferred === 'memory') return new MemoryBlobStore();
  if (preferred === 'opfs' && hasOpfs) return new OpfsBlobStore(dirName);
  if (preferred === 'indexeddb' && hasIdb) return new IdbBlobStore();
  if (!preferred && hasOpfs) return new OpfsBlobStore(dirName);
  if (!preferred && hasIdb) return new IdbBlobStore();
  return new MemoryBlobStore();
}
