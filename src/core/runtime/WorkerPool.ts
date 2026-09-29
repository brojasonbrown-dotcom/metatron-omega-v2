/**
 * METATRON V11 — LIVE LOCAL WORKER POOL
 * =====================================
 * Real browser Web-Worker pool for the field hot path. This is still
 * sovereign/local-only: no network, no remote workers, no hidden telemetry.
 */

export interface PoolStats {
  readonly size: number;
  readonly inFlight: number;
  readonly completed: number;
  readonly workerBacked: boolean;
}

export interface FieldShardSpec {
  readonly kStart: number;
  readonly kEnd: number;
}

export interface FieldShardResult {
  readonly nodes: number;
  readonly amplitudes: Float64Array;
  readonly term1: number;
  readonly term2: number;
  readonly term3: number;
  readonly term4: number;
  readonly energy: number;
  readonly coherenceNum: number;
  readonly coherenceDen: number;
  readonly elapsedMs: number;
}

type Pending = {
  resolve: (value: FieldShardResult | void) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout> | null;
};

type WorkerPacket =
  | { id: number; type: 'ready'; nodes: number }
  | ({ id: number; type: 'result'; amplitudes: ArrayBuffer } & Omit<FieldShardResult, 'amplitudes'>)
  | { id: number; type: 'error'; message: string };

export class FieldWorkerPool {
  private workers: Worker[] = [];
  private pending = new Map<number, Pending>();
  private seq = 0;
  private inFlight = 0;
  private completed = 0;
  private specs: FieldShardSpec[] = [];
  private initialized = false;
  private readyPromise: Promise<void> | null = null;
  private carrierHz = 144;
  private destroyed = false;
  private static readonly CALL_TIMEOUT_MS = 8000;
  // Phase 2b — per-shard Wolfram bank coefficient tables (length === shard.nodes).
  private bankCoefs: (Float64Array | undefined)[] = [];

  constructor(private readonly requestedSize: number) {
    if (typeof Worker === 'undefined') return;
    try {
      for (let i = 0; i < Math.max(1, requestedSize); i++) {
        const worker = new Worker(new URL('./fieldKernel.worker.ts', import.meta.url), {
          type: 'module',
        });
        worker.onmessage = (event: MessageEvent<WorkerPacket>) => this.receive(event.data);
        worker.onerror = (event) => this.failAll(event.message || 'worker error');
        this.workers.push(worker);
      }
    } catch {
      for (const worker of this.workers) worker.terminate();
      this.workers = [];
    }
  }

  get stats(): PoolStats {
    return {
      size: this.workers.length || Math.max(1, this.requestedSize),
      inFlight: this.inFlight,
      completed: this.completed,
      workerBacked: this.workers.length > 0,
    };
  }

  async configure(
    specs: FieldShardSpec[],
    carrierHz: number,
    bankCoefs?: (Float64Array | undefined)[],
  ): Promise<void> {
    this.specs = specs;
    this.carrierHz = carrierHz;
    this.bankCoefs = bankCoefs ? specs.map((_, i) => bankCoefs[i]) : specs.map(() => undefined);
    this.initialized = false;
    const ready = this.configureInner(specs, carrierHz);
    this.readyPromise = ready;
    return ready;
  }

  private async configureInner(specs: FieldShardSpec[], carrierHz: number): Promise<void> {
    if (!this.workers.length) {
      this.initialized = true;
      return;
    }
    await Promise.all(
      specs.map((spec, index) => {
        const coef = this.bankCoefs[index];
        const payload: Record<string, unknown> = { type: 'init', ...spec, carrierHz };
        const transfer: Transferable[] = [];
        if (coef && coef.length === Math.max(0, spec.kEnd - spec.kStart + 1)) {
          // Copy so the engine-side reference stays usable; transfer the copy.
          const copy = new Float64Array(coef);
          payload.bankCoef = copy.buffer;
          transfer.push(copy.buffer);
        }
        return this.call(index, payload, transfer);
      }),
    );
    this.initialized = true;
  }

  async compute(
    tSeconds: number,
    qScalar: number,
    reflectEnabled: boolean,
    computePressure: number,
    bankAlpha: number = 0,
  ): Promise<FieldShardResult[]> {
    if (!this.initialized) {
      // A rebuild race (slider drag / governor change) can destroy a pool while
      // its `configure` handshake is still in flight; the rejection used to
      // latch `initialized=false` forever and every later tick threw. Await the
      // in-flight handshake once, then fall back to the real in-thread kernel
      // rather than throwing — the numbers stay live, just unsharded.
      if (this.readyPromise) {
        try {
          await this.readyPromise;
        } catch {
          /* handshake lost — fall through */
        }
      }
      if (!this.initialized) {
        return this.computeFallback(tSeconds, qScalar, reflectEnabled, computePressure, bankAlpha);
      }
    }
    if (!this.workers.length)
      return this.computeFallback(tSeconds, qScalar, reflectEnabled, computePressure, bankAlpha);
    return Promise.all(
      this.specs.map(
        (_spec, index) =>
          this.call(index, {
            type: 'compute',
            tSeconds,
            qScalar,
            reflectEnabled,
            computePressure,
            bankAlpha,
          }) as Promise<FieldShardResult>,
      ),
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    for (const pending of this.pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.resolve();
    }
    this.pending.clear();
    this.inFlight = 0;
  }

  private call(
    workerIndex: number,
    payload: Record<string, unknown>,
    transfer: Transferable[] = [],
  ): Promise<FieldShardResult | void> {
    if (this.destroyed) return Promise.resolve();
    const worker = this.workers[workerIndex % this.workers.length];
    const id = ++this.seq;
    this.inFlight++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        this.inFlight = Math.max(0, this.inFlight - 1);
        reject(new Error('field worker timeout'));
      }, FieldWorkerPool.CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      worker.postMessage({ id, ...payload }, transfer);
    });
  }

  private receive(packet: WorkerPacket): void {
    const pending = this.pending.get(packet.id);
    if (!pending) return;
    this.pending.delete(packet.id);
    if (pending.timeout) clearTimeout(pending.timeout);
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (packet.type === 'error') {
      pending.reject(new Error(packet.message));
      return;
    }
    this.completed++;
    if (packet.type === 'ready') pending.resolve();
    else pending.resolve({ ...packet, amplitudes: new Float64Array(packet.amplitudes) });
  }

  private failAll(message: string): void {
    for (const pending of this.pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pending.clear();
    this.inFlight = 0;
  }

  private previous = new Map<string, Float64Array>();

  private async computeFallback(
    tSeconds: number,
    qScalar: number,
    reflectEnabled: boolean,
    computePressure: number,
    bankAlpha: number = 0,
  ): Promise<FieldShardResult[]> {
    const { computeShardOnMainThread } = await import('./workerPoolFallback');
    return this.specs.map((spec, index) => {
      const key = `${spec.kStart}:${spec.kEnd}`;
      const coef = this.bankCoefs[index];
      const result = computeShardOnMainThread(
        spec,
        this.carrierHz,
        tSeconds,
        qScalar,
        reflectEnabled,
        computePressure,
        this.previous.get(key),
        coef,
        bankAlpha,
      );
      this.previous.set(key, result.nextPrev);
      this.completed++;
      return result;
    });
  }
}
