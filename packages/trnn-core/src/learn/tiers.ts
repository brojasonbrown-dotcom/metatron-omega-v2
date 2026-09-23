/**
 * Ω-P8 — the four honest execution tiers.
 *
 *   T0  pure-TS inference in this thread/worker — always available
 *   T1  WebGPU training — only when an adapter really reports the limits we need
 *   T2  local Python sidecar over the tool bus — only when it answers a ping
 *   T3  hosted server function — only when the endpoint answers
 *
 * Nothing here guesses. Each probe either returns measured evidence or reports
 * the tier unavailable with the reason, and the reason is what the HARDWARE /
 * LEARN decks display. A tier is never "silently degraded": if T1 is missing,
 * training runs on T0 and says so.
 */

export type TierId = 'T0' | 'T1' | 'T2' | 'T3';

export interface TierStatus {
  readonly id: TierId;
  readonly label: string;
  readonly available: boolean;
  /** Why it is (un)available — measured, never assumed. */
  readonly reason: string;
  /** Measured evidence: adapter limits, ping latency, endpoint version. */
  readonly evidence?: Readonly<Record<string, string | number | boolean>>;
}

export interface TierProbeOptions {
  /** Injected so tests and the worker can probe without touching globals. */
  readonly navigatorRef?: unknown;
  /** Sidecar base URL, e.g. http://127.0.0.1:8765 */
  readonly sidecarUrl?: string;
  /** Hosted training endpoint. */
  readonly hostedUrl?: string;
  readonly fetchImpl?: (input: string, init?: { method?: string; signal?: AbortSignal }) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>;
  /** Per-probe timeout, ms. */
  readonly timeoutMs?: number;
}

/** Minimum WebGPU limits a training pass needs; below this T1 stays off. */
export const T1_MIN_LIMITS = {
  maxStorageBufferBindingSize: 64 * 1024 * 1024,
  maxComputeWorkgroupSizeX: 64,
} as const;

export function tier0(): TierStatus {
  return {
    id: 'T0',
    label: 'pure TypeScript',
    available: true,
    reason: 'always available — the certified engine path',
    evidence: { allocationFree: true },
  };
}

export async function probeTier1(opts: TierProbeOptions = {}): Promise<TierStatus> {
  const nav = (opts.navigatorRef ?? (typeof navigator !== 'undefined' ? navigator : undefined)) as
    | { gpu?: { requestAdapter(): Promise<unknown> } }
    | undefined;
  if (!nav?.gpu) {
    return { id: 'T1', label: 'WebGPU training', available: false, reason: 'no navigator.gpu in this context' };
  }
  try {
    const adapter = (await nav.gpu.requestAdapter()) as
      | { limits?: Record<string, number>; info?: { vendor?: string; architecture?: string } }
      | null;
    if (!adapter) {
      return { id: 'T1', label: 'WebGPU training', available: false, reason: 'requestAdapter() returned null' };
    }
    const limits = adapter.limits ?? {};
    const sb = Number(limits['maxStorageBufferBindingSize'] ?? 0);
    const wg = Number(limits['maxComputeWorkgroupSizeX'] ?? 0);
    const ok = sb >= T1_MIN_LIMITS.maxStorageBufferBindingSize && wg >= T1_MIN_LIMITS.maxComputeWorkgroupSizeX;
    return {
      id: 'T1',
      label: 'WebGPU training',
      available: ok,
      reason: ok
        ? 'adapter limits meet the training minimum'
        : `adapter under minimum (storage ${sb}B, workgroupX ${wg})`,
      evidence: {
        maxStorageBufferBindingSize: sb,
        maxComputeWorkgroupSizeX: wg,
        vendor: adapter.info?.vendor ?? 'unknown',
        architecture: adapter.info?.architecture ?? 'unknown',
      },
    };
  } catch (e) {
    return {
      id: 'T1',
      label: 'WebGPU training',
      available: false,
      reason: `adapter probe threw: ${(e as Error).message}`,
    };
  }
}

async function pingJson(url: string, opts: TierProbeOptions): Promise<{ ms: number; body: unknown }> {
  const f = opts.fetchImpl ?? (globalThis.fetch as TierProbeOptions['fetchImpl']);
  if (!f) throw new Error('no fetch in this context');
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 1500) : null;
  const t0 = Date.now();
  try {
    const res = await f(url, ctrl ? { method: 'GET', signal: ctrl.signal } : { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ms: Date.now() - t0, body: await res.json() };
  } finally {
    if (t) clearTimeout(t);
  }
}

export async function probeTier2(opts: TierProbeOptions = {}): Promise<TierStatus> {
  const base = opts.sidecarUrl;
  if (!base) {
    return { id: 'T2', label: 'local sidecar', available: false, reason: 'no sidecar URL configured' };
  }
  try {
    const { ms, body } = await pingJson(`${base.replace(/\/$/, '')}/health`, opts);
    const info = (body ?? {}) as Record<string, unknown>;
    return {
      id: 'T2',
      label: 'local sidecar',
      available: true,
      reason: `sidecar answered in ${ms} ms`,
      evidence: {
        latencyMs: ms,
        engine: String(info['engine'] ?? 'unknown'),
        version: String(info['version'] ?? 'unknown'),
      },
    };
  } catch (e) {
    return { id: 'T2', label: 'local sidecar', available: false, reason: `no answer: ${(e as Error).message}` };
  }
}

export async function probeTier3(opts: TierProbeOptions = {}): Promise<TierStatus> {
  const url = opts.hostedUrl;
  if (!url) {
    return { id: 'T3', label: 'hosted training', available: false, reason: 'no hosted endpoint configured' };
  }
  try {
    const { ms, body } = await pingJson(url, opts);
    const info = (body ?? {}) as Record<string, unknown>;
    return {
      id: 'T3',
      label: 'hosted training',
      available: true,
      reason: `endpoint answered in ${ms} ms`,
      evidence: { latencyMs: ms, version: String(info['version'] ?? 'unknown') },
    };
  } catch (e) {
    return { id: 'T3', label: 'hosted training', available: false, reason: `no answer: ${(e as Error).message}` };
  }
}

export interface TierMap {
  readonly tiers: readonly TierStatus[];
  /** Highest available tier for a training run — T0 is the guaranteed floor. */
  readonly selected: TierId;
}

export async function probeTiers(opts: TierProbeOptions = {}): Promise<TierMap> {
  const [t1, t2, t3] = await Promise.all([probeTier1(opts), probeTier2(opts), probeTier3(opts)]);
  const tiers = [tier0(), t1, t2, t3];
  const order: TierId[] = ['T3', 'T2', 'T1', 'T0'];
  const selected = order.find((id) => tiers.find((t) => t.id === id)?.available) ?? 'T0';
  return { tiers, selected };
}
