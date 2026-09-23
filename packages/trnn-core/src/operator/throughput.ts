/**
 * Ω-SCALE P4 — throughput planning.
 *
 * The engine's bottleneck is not arithmetic, it is how much arithmetic can be
 * put in flight at once. Before adding workers or a GPU path, the honest first
 * step is to say what the machine actually offers and what a given split would
 * buy — a parallel plan that ignores Amdahl's law and per-chunk overhead
 * routinely runs *slower* than the serial version it replaced.
 *
 * This module measures nothing on its own and touches no global state; it
 * reports capability and computes projected speedup, so the decision to enable
 * a parallel path is made from numbers rather than optimism.
 *
 * WebGPU note: `navigator.gpu` is absent in browsers without support and
 * `requestAdapter()` resolves to null when the API exists but no adapter does.
 * Both are checked, and the CPU path is always the fallback — never an error.
 */

export interface HostCapability {
  /** Logical cores the host will admit to, or null when it won't say. */
  readonly cores: number | null;
  /** Real Worker constructor present (absent under some SSR/test runtimes). */
  readonly workers: boolean;
  /** `navigator.gpu` exists. Says nothing about an adapter being available. */
  readonly webgpuApi: boolean;
  /** SharedArrayBuffer available — decides zero-copy vs structured clone. */
  readonly sharedMemory: boolean;
  /** Recommended worker count: cores − 1, floored at 1, capped at 8. */
  readonly recommendedWorkers: number;
}

/** Synchronous, side-effect-free capability probe. Safe during SSR. */
export function probeHost(): HostCapability {
  const nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined;
  const cores =
    nav && typeof (nav as { hardwareConcurrency?: number }).hardwareConcurrency === 'number'
      ? (nav as { hardwareConcurrency: number }).hardwareConcurrency
      : null;
  const workers = typeof Worker !== 'undefined';
  const webgpuApi = !!nav && 'gpu' in (nav as object);
  const sharedMemory = typeof SharedArrayBuffer !== 'undefined';
  const recommendedWorkers = Math.max(1, Math.min(8, (cores ?? 2) - 1));
  return { cores, workers, webgpuApi, sharedMemory, recommendedWorkers };
}

/**
 * Does a usable GPU adapter exist? Async because `requestAdapter` is, and
 * deliberately total: any failure resolves false rather than throwing, so a
 * caller can gate on it without a try/catch at every site.
 */
export async function probeGpuAdapter(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } })?.gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

export interface ParallelPlan {
  readonly workers: number;
  readonly chunk: number;
  readonly chunks: number;
  /** Amdahl bound: the best speedup possible at this serial fraction. */
  readonly amdahlCeiling: number;
  /** Projected speedup once per-chunk overhead is charged. */
  readonly projectedSpeedup: number;
  /** True only when the split is projected to beat the serial path. */
  readonly worthwhile: boolean;
}

/**
 * Project the speedup of splitting `items` across `workers`.
 *
 * Serial time is modelled as `items · perItemNs`; parallel time as the
 * per-worker share plus `overheadNs` per chunk plus the irreducible serial
 * fraction. That last term is what makes small workloads not worth splitting,
 * and the reason this returns `worthwhile: false` instead of a bare number.
 */
export function planParallel(
  items: number,
  workers: number,
  perItemNs: number,
  overheadNs = 50_000,
  serialFraction = 0.05,
): ParallelPlan {
  const w = Math.max(1, Math.floor(workers));
  const n = Math.max(0, Math.floor(items));
  const chunk = w > 0 ? Math.ceil(n / w) : n;
  const chunks = chunk > 0 ? Math.ceil(n / chunk) : 0;

  const p = Math.min(1, Math.max(0, serialFraction));
  const amdahlCeiling = 1 / (p + (1 - p) / w);

  const serialNs = n * perItemNs;
  if (serialNs <= 0) {
    return { workers: w, chunk, chunks, amdahlCeiling, projectedSpeedup: 1, worthwhile: false };
  }
  const parallelNs = serialNs * p + (serialNs * (1 - p)) / w + chunks * overheadNs;
  const projectedSpeedup = serialNs / parallelNs;
  return {
    workers: w,
    chunk,
    chunks,
    amdahlCeiling,
    projectedSpeedup,
    worthwhile: projectedSpeedup > 1.1,
  };
}

/**
 * Best worker count for a workload — the peak of `planParallel`, not simply
 * "all the cores". Past the peak, chunk overhead dominates and adding workers
 * costs time.
 */
export function bestWorkerCount(
  items: number,
  maxWorkers: number,
  perItemNs: number,
  overheadNs = 50_000,
  serialFraction = 0.05,
): ParallelPlan {
  let best = planParallel(items, 1, perItemNs, overheadNs, serialFraction);
  for (let w = 2; w <= Math.max(1, maxWorkers); w++) {
    const plan = planParallel(items, w, perItemNs, overheadNs, serialFraction);
    if (plan.projectedSpeedup > best.projectedSpeedup) best = plan;
  }
  return best;
}
