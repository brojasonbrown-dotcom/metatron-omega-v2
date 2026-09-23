/**
 * METATRON V11 — ENGINE BUS CLIENT
 * =================================
 *
 * WebSocket client for the native Rust engine daemon. Auto-reconnects,
 * negotiates a capability handshake, exposes a typed JSON-RPC surface,
 * and broadcasts FieldSnapshot events to subscribers.
 *
 * Designed so the rest of the app never has to know whether it is talking
 * to the native engine, the WASM fallback, or nothing at all — see
 * EngineProvider.ts for the unified facade.
 */

import {
  ENGINE_WS_DEFAULT_URL,
  PROTOCOL_VERSION,
  type EngineCapabilities,
  type FieldSnapshot,
  type FieldSubscriptionEvent,
  type RpcMethod,
  type RpcRequest,
  type RpcResponse,
  isRpcError,
} from './protocol';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface EngineBusEvents {
  state: (state: ConnectionState) => void;
  capabilities: (caps: EngineCapabilities) => void;
  snapshot: (snapshot: FieldSnapshot) => void;
  error: (err: Error) => void;
}

type Listener<T extends keyof EngineBusEvents> = EngineBusEvents[T];

export interface EngineBusOptions {
  readonly url?: string;
  readonly reconnectMs?: number;
  readonly probeTimeoutMs?: number;
}

export class EngineBus {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'idle';
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private readonly listeners: {
    [K in keyof EngineBusEvents]: Set<Listener<K>>;
  } = {
    state: new Set(),
    capabilities: new Set(),
    snapshot: new Set(),
    error: new Set(),
  };
  private capabilities: EngineCapabilities | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private readonly opts: EngineBusOptions = {}) {}

  get url(): string {
    return this.opts.url ?? ENGINE_WS_DEFAULT_URL;
  }

  get reconnectMs(): number {
    return this.opts.reconnectMs ?? 2000;
  }

  get currentState(): ConnectionState {
    return this.state;
  }

  get currentCapabilities(): EngineCapabilities | null {
    return this.capabilities;
  }

  on<K extends keyof EngineBusEvents>(event: K, listener: Listener<K>): () => void {
    (this.listeners[event] as Set<Listener<K>>).add(listener);
    return () => (this.listeners[event] as Set<Listener<K>>).delete(listener);
  }

  private emit<K extends keyof EngineBusEvents>(event: K, ...args: Parameters<Listener<K>>): void {
    for (const l of this.listeners[event] as Set<Listener<K>>) {
      try {
        // @ts-expect-error variadic listener call
        l(...args);
      } catch (e) {
        console.error('EngineBus listener threw', e);
      }
    }
  }

  private setState(s: ConnectionState): void {
    if (s === this.state) return;
    this.state = s;
    this.emit('state', s);
  }

  /** Probe the daemon. Resolves true if a hello succeeds within timeout. */
  static async probe(url: string = ENGINE_WS_DEFAULT_URL, timeoutMs = 800): Promise<boolean> {
    if (typeof WebSocket === 'undefined') return false;
    return await new Promise((resolve) => {
      let settled = false;
      let ws: WebSocket;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        try {
          ws?.close();
        } catch {
          /* noop */
        }
        resolve(ok);
      };
      const timer = setTimeout(() => done(false), timeoutMs);
      try {
        ws = new WebSocket(url);
      } catch {
        clearTimeout(timer);
        return done(false);
      }
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        done(true);
      });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        done(false);
      });
    });
  }

  connect(): void {
    if (this.destroyed) return;
    if (typeof WebSocket === 'undefined') {
      this.setState('error');
      return;
    }
    if (this.ws && (this.state === 'connecting' || this.state === 'open')) return;
    this.setState('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this.emit('error', e as Error);
      this.setState('error');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => this.handleOpen());
    ws.addEventListener('message', (ev) => this.handleMessage(ev));
    ws.addEventListener('close', () => this.handleClose());
    ws.addEventListener('error', () => this.emit('error', new Error('engine socket error')));
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
    this.ws = null;
    this.setState('closed');
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectMs);
  }

  private async handleOpen(): Promise<void> {
    try {
      const caps = await this.call<EngineCapabilities>('engine.hello', {
        protocol: PROTOCOL_VERSION,
      });
      if (caps.protocol !== PROTOCOL_VERSION) {
        throw new Error(
          `engine protocol mismatch: client=${PROTOCOL_VERSION} engine=${caps.protocol}`,
        );
      }
      this.capabilities = caps;
      this.emit('capabilities', caps);
      this.setState('open');
    } catch (e) {
      this.emit('error', e as Error);
      this.setState('error');
      try {
        this.ws?.close();
      } catch {
        /* noop */
      }
    }
  }

  private handleClose(): void {
    this.ws = null;
    this.capabilities = null;
    this.setState('closed');
    // reject all pending
    for (const { reject } of this.pending.values()) {
      reject(new Error('engine bus closed'));
    }
    this.pending.clear();
    this.scheduleReconnect();
  }

  private handleMessage(ev: MessageEvent): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
    } catch (e) {
      this.emit('error', new Error('engine bus: invalid JSON'));
      return;
    }
    if (!parsed || typeof parsed !== 'object') return;
    const msg = parsed as { id?: number; method?: string };
    if (typeof msg.id === 'number') {
      const handler = this.pending.get(msg.id);
      if (!handler) return;
      this.pending.delete(msg.id);
      const r = parsed as RpcResponse;
      if (isRpcError(r)) handler.reject(new Error(`${r.error.code}: ${r.error.message}`));
      else handler.resolve((r as { result: unknown }).result);
      return;
    }
    if (msg.method === 'field.snapshot.event') {
      const evt = parsed as FieldSubscriptionEvent;
      this.emit('snapshot', evt.params);
    }
  }

  call<R = unknown, P = unknown>(method: RpcMethod, params?: P): Promise<R> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`engine bus not open (state=${this.state})`));
    }
    const id = this.nextId++;
    const req: RpcRequest<P> = { jsonrpc: '2.0', id, method, params };
    return new Promise<R>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as R),
        reject,
      });
      try {
        this.ws!.send(JSON.stringify(req));
      } catch (e) {
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }
}
