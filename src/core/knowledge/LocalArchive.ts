/**
 * LocalArchive — on-device persistence for the knowledge base.
 *
 * Two tiers, auto-selected, never any network:
 *   • OPFS (Origin Private File System) — near-disk-speed binary blobs, tens
 *     of GB on desktop Chromium. Preferred.
 *   • IndexedDB — universal fallback.
 *   • In-memory — SSR / tests.
 *
 * The payload is a single versioned JSON envelope written atomically
 * (temp file → rename on OPFS; single put on IDB), so a crash mid-write can
 * never leave a half-parsed corpus. A version mismatch loads as "no archive"
 * rather than corrupting the live session.
 */

export const ARCHIVE_VERSION = 1;
const DB_NAME = 'metatron-knowledge';
const STORE = 'archive';
const FILE = 'knowledge.json';

export interface ArchiveEnvelope<T = unknown> {
  version: number;
  savedAt: number;
  payload: T;
}

export interface ArchiveAdapter {
  readonly kind: 'opfs' | 'indexeddb' | 'memory';
  write(key: string, data: string): Promise<void>;
  read(key: string): Promise<string | null>;
  erase(key: string): Promise<void>;
  bytes(key: string): Promise<number>;
}

class MemoryAdapter implements ArchiveAdapter {
  readonly kind = 'memory' as const;
  private m = new Map<string, string>();
  async write(k: string, d: string) { this.m.set(k, d); }
  async read(k: string) { return this.m.get(k) ?? null; }
  async erase(k: string) { this.m.delete(k); }
  async bytes(k: string) { return this.m.get(k)?.length ?? 0; }
}

class IdbAdapter implements ArchiveAdapter {
  readonly kind = 'indexeddb' as const;
  private open(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  private tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.open().then((db) => new Promise<T>((res, rej) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      t.oncomplete = () => db.close();
    }));
  }
  async write(k: string, d: string) { await this.tx('readwrite', (s) => s.put(d, k)); }
  async read(k: string) { return (await this.tx<string | undefined>('readonly', (s) => s.get(k))) ?? null; }
  async erase(k: string) { await this.tx('readwrite', (s) => s.delete(k)); }
  async bytes(k: string) { return (await this.read(k))?.length ?? 0; }
}

class OpfsAdapter implements ArchiveAdapter {
  readonly kind = 'opfs' as const;
  private async dir(): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle('metatron', { create: true });
  }
  async write(k: string, d: string) {
    const dir = await this.dir();
    const tmpName = `${k}.tmp`;
    const tmp = await dir.getFileHandle(tmpName, { create: true });
    const w = await tmp.createWritable();
    await w.write(d);
    await w.close();
    // No rename API in every engine: copy through then drop the temp.
    const target = await dir.getFileHandle(k, { create: true });
    const tw = await target.createWritable();
    await tw.write(await (await tmp.getFile()).text());
    await tw.close();
    await dir.removeEntry(tmpName).catch(() => {});
  }
  async read(k: string) {
    try {
      const dir = await this.dir();
      const fh = await dir.getFileHandle(k);
      return await (await fh.getFile()).text();
    } catch { return null; }
  }
  async erase(k: string) {
    try { (await this.dir()).removeEntry(k); } catch { /* absent */ }
  }
  async bytes(k: string) {
    try {
      const dir = await this.dir();
      return (await (await dir.getFileHandle(k)).getFile()).size;
    } catch { return 0; }
  }
}

export function defaultArchiveAdapter(): ArchiveAdapter {
  if (typeof navigator !== 'undefined' && navigator.storage && 'getDirectory' in navigator.storage) {
    try { return new OpfsAdapter(); } catch { /* fall through */ }
  }
  if (typeof indexedDB !== 'undefined') {
    try { return new IdbAdapter(); } catch { /* fall through */ }
  }
  return new MemoryAdapter();
}

export class LocalArchive {
  readonly adapter: ArchiveAdapter;
  constructor(adapter: ArchiveAdapter = defaultArchiveAdapter()) { this.adapter = adapter; }

  async save<T>(payload: T, key = FILE): Promise<number> {
    const env: ArchiveEnvelope<T> = { version: ARCHIVE_VERSION, savedAt: Date.now(), payload };
    const json = JSON.stringify(env);
    await this.adapter.write(key, json);
    return json.length;
  }

  async load<T>(key = FILE): Promise<T | null> {
    const raw = await this.adapter.read(key);
    if (!raw) return null;
    try {
      const env = JSON.parse(raw) as ArchiveEnvelope<T>;
      if (!env || env.version !== ARCHIVE_VERSION) return null;
      return env.payload;
    } catch { return null; }
  }

  async clear(key = FILE): Promise<void> { await this.adapter.erase(key); }
  async bytes(key = FILE): Promise<number> { return this.adapter.bytes(key); }

  /** Real quota reading from the browser — never an estimate we invented. */
  async quota(): Promise<{ usage: number; quota: number } | null> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  }
}

export const _internal = { MemoryAdapter, IdbAdapter, OpfsAdapter };
