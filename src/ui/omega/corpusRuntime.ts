/**
 * Ω-CORPUS — the durable feed.
 *
 * The analysis runtime already measures every channel and calibrates a band
 * around it. This runtime takes that same frame and offers it to the durable
 * ladder (HOT → WARM shard → COLD segment), each seal witnessed by the Merkle
 * ledger. Storage work is queued and awaited off the sample path: `feed()`
 * returns synchronously and never blocks a tick.
 */

import { Corpus, type CorpusStats } from '@/core/corpus';
import { CHANNEL_IDS } from '@/core/analysis/channelSampler';

/** One frame is the full channel vector — the unit the corpus stores. */
export const CORPUS_FRAME_WIDTH = CHANNEL_IDS.length;

/** Quota is a host property that moves slowly: re-read every 64 seals. */
const QUOTA_EVERY = 64;

export interface CorpusView extends CorpusStats {
  readonly version: number;
  readonly enabled: boolean;
  readonly frames: number;
  readonly retainedNumbers: number;
  readonly lastError: string | null;
}

class CorpusRuntime {
  private corpus: Corpus | null = null;
  private listeners = new Set<() => void>();
  private queue: Promise<void> = Promise.resolve();
  private tick = 0;
  private seals = 0;
  private frames = 0;
  private version = 0;
  private lastError: string | null = null;
  private view: CorpusView = {
    version: 0, enabled: false, frames: 0, retainedNumbers: 0, lastError: null,
    storeKind: 'none',
    hot: { count: 0, capacity: 0, numbers: 0, meanSurprise: NaN },
    warm: { shards: 0, pending: 0, numbers: 0, bytes: 0 },
    cold: { segments: 0, numbers: 0, bytes: 0, refused: 0 },
    ledger: { size: 0, rootHex: '', headTimestamp: null },
    counters: { admitted: 0, rejected: 0, evicted: 0, demoted: 0 },
    quota: { usage: NaN, quota: NaN },
  };

  /** Lazily built so a headless test never opens IndexedDB or OPFS. */
  private ensure(): Corpus | null {
    if (this.corpus) return this.corpus;
    if (typeof window === 'undefined') return null;
    this.corpus = new Corpus({ width: CORPUS_FRAME_WIDTH });
    return this.corpus;
  }

  /**
   * Offer one measured frame with its calibrated prediction. `values` is copied
   * on admission by the hot cache, so the caller may reuse its buffer.
   */
  feed(values: Float64Array, predicted: number, halfWidth: number, actual: number): void {
    const c = this.ensure();
    if (!c) return;
    if (values.length !== CORPUS_FRAME_WIDTH) return;
    const tick = this.tick++;
    this.frames++;
    const frame = { tick, rank: 0, values: Float64Array.from(values), surprise: NaN };
    this.queue = this.queue
      .then(async () => {
        const r = await c.offer(frame, predicted, halfWidth, actual, Date.now());
        if (r.sealed.length > 0 || r.cold) {
          this.seals += r.sealed.length + (r.cold ? 1 : 0);
          if (this.seals % QUOTA_EVERY === 0) await c.refreshQuota();
        }
        this.lastError = null;
      })
      .catch((e: unknown) => {
        // A storage failure must degrade the corpus, never the engine.
        this.lastError = e instanceof Error ? e.message : String(e);
      })
      .then(() => { this.publish(); });
  }

  /** Seal everything buffered — used when a session winds down. */
  flush(): Promise<void> {
    const c = this.corpus;
    if (!c) return Promise.resolve();
    this.queue = this.queue
      .then(async () => { await c.flush(Date.now()); await c.refreshQuota(); })
      .catch((e: unknown) => { this.lastError = e instanceof Error ? e.message : String(e); })
      .then(() => { this.publish(); });
    return this.queue;
  }

  private publish(): void {
    const c = this.corpus;
    if (!c) return;
    this.view = {
      ...c.stats(),
      version: ++this.version,
      enabled: true,
      frames: this.frames,
      retainedNumbers: c.retainedNumbers,
      lastError: this.lastError,
    };
    for (const fn of this.listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  getSnapshot = (): CorpusView => this.view;
}

let singleton: CorpusRuntime | null = null;

export function getCorpusRuntime(): CorpusRuntime {
  if (!singleton) singleton = new CorpusRuntime();
  return singleton;
}

export type { CorpusRuntime };
