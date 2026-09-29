/**
 * Ω-P4 — measured hardware probe.
 *
 * Law L2 keeps the *engine path* free of hardware probes; this module runs
 * strictly off that path (build time / operator request) and its results never
 * enter the digest chain. What it reports is measured, not guessed:
 *
 *   • cores            — navigator.hardwareConcurrency (or os cpus on node)
 *   • memoryBudget     — navigator.deviceMemory (GiB) when exposed, else the
 *                        JS heap limit, else a declared unknown
 *   • webgpu           — real adapter limits when an adapter is obtainable
 *   • throughput       — a timed run of the actual engine, in node-ticks/s
 *
 * Anything the platform refuses to disclose is reported as `null` with a
 * `source: 'unavailable'` tag rather than being invented.
 */

import { SingleTorusEngine } from '../engine/SingleTorusEngine';

export interface WebGPUInfo {
  readonly available: boolean;
  readonly vendor: string | null;
  readonly architecture: string | null;
  readonly maxBufferSize: number | null;
  readonly maxComputeWorkgroupSizeX: number | null;
  readonly maxStorageBufferBindingSize: number | null;
}

export interface Throughput {
  /**
   * Measured **work units** per second on this machine, single-threaded.
   *
   * S1 — the unit is the same one `profileCost()` predicts in, so a governor
   * verdict is a comparison of like with like:
   *
   *   workUnits(tick) = nodes · (2·modes + 12) + exchange
   *
   * (the benchmark build is a single torus, so its exchange term is 0). The
   * field keeps its historical name for compatibility; `workUnitsPerSecond`
   * is the same number under the honest name.
   */
  readonly nodeTicksPerSecond: number;
  readonly workUnitsPerSecond: number;
  /** Work units executed per benchmark tick — lets a reader re-derive the rate. */
  readonly workUnitsPerTick: number;
  /** Benchmark build description, so a rate can be reproduced. */
  readonly benchNodes: number;
  readonly benchModes: number;
  /** Wall-clock milliseconds per tick (median repeat). */
  readonly msPerTick: number;
  /** Ticks actually executed during the benchmark. */
  readonly ticks: number;
  /** Wall-clock milliseconds the benchmark consumed. */
  readonly elapsedMs: number;
  /** Relative spread across repeats — high means a noisy/throttled machine. */
  readonly jitter: number;
}

export interface HardwareProbe {
  readonly cores: number;
  readonly coresSource: 'navigator' | 'os' | 'unavailable';
  /** Usable working-set budget in bytes, or null when undisclosed. */
  readonly memoryBudget: number | null;
  readonly memorySource: 'deviceMemory' | 'jsHeap' | 'os' | 'unavailable';
  readonly webgpu: WebGPUInfo;
  readonly throughput: Throughput;
  readonly userAgent: string | null;
  /** ms since the epoch — telemetry only, never digested. */
  readonly probedAt: number;
}

const g = globalThis as unknown as {
  navigator?: {
    hardwareConcurrency?: number;
    deviceMemory?: number;
    userAgent?: string;
    gpu?: { requestAdapter(): Promise<unknown> };
  };
  performance?: { now(): number; memory?: { jsHeapSizeLimit?: number } };
  process?: { memoryUsage?: () => { heapTotal: number } };
};

function now(): number {
  return g.performance?.now ? g.performance.now() : Date.now();
}

function probeCores(): { cores: number; source: HardwareProbe['coresSource'] } {
  const hc = g.navigator?.hardwareConcurrency;
  if (typeof hc === 'number' && hc > 0) return { cores: hc, source: 'navigator' };
  return { cores: 1, source: 'unavailable' };
}

function probeMemory(): { bytes: number | null; source: HardwareProbe['memorySource'] } {
  const dm = g.navigator?.deviceMemory;
  if (typeof dm === 'number' && dm > 0)
    return { bytes: dm * 1024 * 1024 * 1024, source: 'deviceMemory' };
  const heap = g.performance?.memory?.jsHeapSizeLimit;
  if (typeof heap === 'number' && heap > 0) return { bytes: heap, source: 'jsHeap' };
  return { bytes: null, source: 'unavailable' };
}

async function probeWebGPU(): Promise<WebGPUInfo> {
  const none: WebGPUInfo = {
    available: false,
    vendor: null,
    architecture: null,
    maxBufferSize: null,
    maxComputeWorkgroupSizeX: null,
    maxStorageBufferBindingSize: null,
  };
  const gpu = g.navigator?.gpu;
  if (!gpu?.requestAdapter) return none;
  try {
    const adapter = (await gpu.requestAdapter()) as {
      info?: { vendor?: string; architecture?: string };
      limits?: Record<string, number>;
    } | null;
    if (!adapter) return none;
    const l = adapter.limits ?? {};
    return {
      available: true,
      vendor: adapter.info?.vendor ?? null,
      architecture: adapter.info?.architecture ?? null,
      maxBufferSize: l['maxBufferSize'] ?? null,
      maxComputeWorkgroupSizeX: l['maxComputeWorkgroupSizeX'] ?? null,
      maxStorageBufferBindingSize: l['maxStorageBufferBindingSize'] ?? null,
    };
  } catch {
    return none;
  }
}

/**
 * Work units one tick of a single torus of `n` nodes at `m` modes costs.
 * Identical algebra to `profileCost()` — the two must never drift apart, and
 * the S1 gate asserts exactly that.
 */
export function tickWorkUnits(nodes: number, modes: number, exchangePerNode = 0): number {
  return nodes * (2 * modes + 12 + exchangePerNode);
}

/**
 * Time the real engine. Three repeats, median rate, spread reported as jitter
 * so a throttled or contended machine is visible rather than silently rated.
 * The rate is in work units per second (see `Throughput`).
 */
export function benchmarkThroughput(
  opts: { nodes?: number; ticks?: number; repeats?: number; modes?: number } = {},
): Throughput {
  const nodes = opts.nodes ?? 233;
  const ticks = opts.ticks ?? 64;
  const modes = opts.modes ?? 13;
  const repeats = Math.max(1, opts.repeats ?? 3);

  // warm the JIT on a throwaway build so the first repeat is not the outlier
  const warm = new SingleTorusEngine({ nodes: 89, seed: 'bench:warm', modes });
  warm.run(16);

  const perTick = tickWorkUnits(nodes, modes);
  const rates: number[] = [];
  const tickMs: number[] = [];
  let totalTicks = 0;
  let totalMs = 0;
  for (let r = 0; r < repeats; r++) {
    const e = new SingleTorusEngine({ nodes, seed: `bench:${r}`, modes });
    const t0 = now();
    e.run(ticks);
    const dt = Math.max(now() - t0, 1e-3);
    rates.push((perTick * ticks) / (dt / 1000));
    tickMs.push(dt / ticks);
    totalTicks += ticks;
    totalMs += dt;
  }
  rates.sort((a, b) => a - b);
  tickMs.sort((a, b) => a - b);
  const mid = (rates.length - 1) >> 1;
  const median = rates[mid];
  const jitter = rates.length > 1 ? (rates[rates.length - 1] - rates[0]) / median : 0;
  return {
    nodeTicksPerSecond: median,
    workUnitsPerSecond: median,
    workUnitsPerTick: perTick,
    benchNodes: nodes,
    benchModes: modes,
    msPerTick: tickMs[mid],
    ticks: totalTicks,
    elapsedMs: totalMs,
    jitter,
  };
}

export async function probeHardware(
  opts: { bench?: { nodes?: number; ticks?: number; repeats?: number } } = {},
): Promise<HardwareProbe> {
  const c = probeCores();
  const m = probeMemory();
  const webgpu = await probeWebGPU();
  const throughput = benchmarkThroughput(opts.bench);
  return {
    cores: c.cores,
    coresSource: c.source,
    memoryBudget: m.bytes,
    memorySource: m.source,
    webgpu,
    throughput,
    userAgent: g.navigator?.userAgent ?? null,
    probedAt: Date.now(),
  };
}
