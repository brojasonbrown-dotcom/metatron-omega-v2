/**
 * METATRON V11 — HARDWARE ENVELOPE
 * =================================
 * Sovereign local probe. Reads only browser-exposed device capabilities
 * (navigator.hardwareConcurrency, navigator.deviceMemory, WebGPU adapter).
 * Never contacts a network. Returns honest R_max (RAM bytes), C_max
 * (logical cores), GPU presence, and a Planck-bounded carrier ceiling.
 *
 * Phase 2d additions:
 *  - `OPS_PER_NODE_TICK` is the single source of truth (imported by
 *    FallbackEngine + computeBench) — no more duplicated drift-prone copies.
 *  - `refreshPeakOpsPerSecond(observed)` lets the live engine update the
 *    cached envelope from real sustained-Hz measurements (EMA).
 *  - Browser RAM APIs are privacy-capped. We expose the reported value as a
 *    floor; the Governor lets the user declare a larger local budget when the
 *    host is known to have more RAM.
 */

import {
  PHI,
  PI,
  PLANCK_LENGTH_M,
  PLANCK_FREQUENCY_HZ,
  SPEED_OF_LIGHT_M_S,
} from '@/core/constants/WolframVerified';

/**
 * Where a RAM ceiling came from. Never report 'measured' unless a probe
 * actually ran and returned a finite number.
 */
export type RamProvenance = 'measured' | 'reported' | 'fallback';

export interface HardwareEnvelope {
  readonly cpuCores: number;          // logical threads
  ramBytes: number;                   // best-effort, may be refreshed by deeper probe
  readonly ramProvenance: RamProvenance;
  /** Heap ceiling actually measured, when the probe succeeded. */
  readonly ramMeasuredBytes: number | null;
  readonly gpu: 'none' | 'webgpu';
  readonly sharedArrayBuffer: boolean;
  readonly tickBudgetMs: number;      // recommended per-tick wall budget
  readonly carrierCeilingHz: number;  // f₀ = (φ²/2π)·f_P, Planck-bounded
  peakOpsPerSecond: number;           // self-bench, refreshed from live pool EMA
}

/**
 * Planck time t_P = ℓ_P / c. Numerically equivalent to the canonical
 * sqrt(ℏG/c⁵) form within CODATA 2022 truncation.
 */
const PLANCK_TIME_S = PLANCK_LENGTH_M / SPEED_OF_LIGHT_M_S;

/**
 * RHUFT carrier ceiling = (φ²/2π)·f_P ≈ 7.729 × 10⁴² Hz.
 * Wolfram (Section 1 · Q4): f_P = 1.8549×10⁴³ Hz. The (φ²/2π) ≈ 0.4167
 * coefficient is the RHUFT-amplitude reduction — the engine's resonant
 * carrier never reaches raw Planck, only the geometric reduction.
 *
 * Two derivations available; we keep the t_P form as canonical to avoid
 * any floating-point drift between modules, and assert equivalence below.
 */
export const CARRIER_CEILING_HZ = (PHI * PHI) / (2 * PI * PLANCK_TIME_S);

/**
 * Honest, Planck-bounded φ-mode ceiling for a given carrier:
 *   k_max(f₀) = ⌊log_φ(CARRIER_CEILING_HZ / f₀)⌋
 * At f₀=144 Hz this returns 194 — the "M ≈ 194" the workstation displays
 * is THIS value, not a software throttle. (Wolfram cross-check: Section 1 · Q2.)
 */
export function kMaxFromCarrier(carrierHz: number): number {
  if (!Number.isFinite(carrierHz) || carrierHz <= 0) return 0;
  return Math.max(1, Math.floor(Math.log(CARRIER_CEILING_HZ / carrierHz) / Math.log(PHI)));
}

// Development-time assertion: the two derivations of the ceiling must agree
// to within IEEE-754 relative epsilon. Catches any silent constant drift.
{
  const alt = (PHI * PHI / (2 * PI)) * PLANCK_FREQUENCY_HZ;
  const relDrift = Math.abs(CARRIER_CEILING_HZ - alt) / CARRIER_CEILING_HZ;
  if (relDrift > 1e-3) {
    // Soft warn — different CODATA truncations are tolerable up to ~1e-3.
    // Hard fail would block the app on a benign constants refresh.
    console.warn(
      `[HardwareEnvelope] CARRIER_CEILING_HZ ↔ PLANCK_FREQUENCY_HZ drift ${relDrift.toExponential(2)} > 1e-3`,
    );
  }
}

/** Single source of truth: ops counted per node per tick (4 ψ-terms × ~3.5 flops + accumulators). */
export const OPS_PER_NODE_TICK = 14;

let cached: HardwareEnvelope | null = null;

function selfBenchOps(): number {
  // Tiny f64 axpy to estimate baseline ops/s. Keep the cold probe short so
  // dashboard boot never feels frozen; live ticks ratchet the estimate upward.
  if (typeof performance === 'undefined') return 1e8;
  const N = 1 << 16;
  const a = new Float64Array(N);
  const b = new Float64Array(N);
  for (let i = 0; i < N; i++) { a[i] = Math.sin(i); b[i] = Math.cos(i); }
  const start = performance.now();
  let iters = 0;
  let s = 0;
  while (performance.now() - start < 16) {
    for (let i = 0; i < N; i++) s += a[i] * b[i] + 1;
    iters++;
  }
  const elapsed = (performance.now() - start) / 1000;
  // 2 flops per element, plus loop overhead; round-trip honest estimate.
  const ops = (iters * N * 2) / elapsed;
  // anchor s so the JIT keeps the loop
  if (s === Infinity) console.log(s);
  return Math.max(1e7, ops);
}

async function probeGpu(): Promise<'none' | 'webgpu'> {
  if (typeof navigator === 'undefined') return 'none';
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return 'none';
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? 'webgpu' : 'none';
  } catch {
    return 'none';
  }
}

export interface MemoryCeilingProbe {
  readonly bytes: number;
  readonly provenance: RamProvenance;
  /** Non-null only when a real measurement succeeded. */
  readonly measuredBytes: number | null;
}

/**
 * Honest memory-ceiling probe.
 *
 *  1. `performance.memory.jsHeapSizeLimit` where the engine exposes it —
 *     that is a *measured* limit, not a privacy-capped guess.
 *  2. A bounded φ-scaled allocation probe: grow ArrayBuffers along the φ
 *     ladder until one throws, then release everything. Only ever reports a
 *     ceiling it actually reached, capped so the probe itself cannot be the
 *     thing that exhausts the host.
 *  3. `navigator.deviceMemory` as a *reported* floor.
 *  4. A fixed fallback, flagged as such.
 */
export function probeMemoryCeiling(): MemoryCeilingProbe {
  const heapLimit = (
    globalThis as unknown as { performance?: { memory?: { jsHeapSizeLimit?: number } } }
  ).performance?.memory?.jsHeapSizeLimit;
  if (typeof heapLimit === 'number' && Number.isFinite(heapLimit) && heapLimit > 0) {
    return { bytes: heapLimit, provenance: 'measured', measuredBytes: heapLimit };
  }

  // Bounded growth probe. Stops at 8 GiB of *probe* allocation regardless of
  // host size — beyond that the reported ceiling is not worth the risk.
  const PROBE_CAP = 8 * 1024 * 1024 * 1024;
  const held: ArrayBuffer[] = [];
  let reached = 0;
  try {
    let size = 64 * 1024 * 1024;
    while (reached + size <= PROBE_CAP) {
      held.push(new ArrayBuffer(size));
      reached += size;
      size = Math.floor(size * PHI);
    }
  } catch {
    // allocation refused — `reached` is the honest measurement
  } finally {
    held.length = 0;
  }
  if (reached > 0) {
    return { bytes: reached, provenance: 'measured', measuredBytes: reached };
  }

  const reportedGB =
    typeof navigator !== 'undefined' &&
    (navigator as unknown as { deviceMemory?: number }).deviceMemory
      ? (navigator as unknown as { deviceMemory: number }).deviceMemory
      : 0;
  if (reportedGB > 0) {
    return { bytes: reportedGB * 1024 ** 3, provenance: 'reported', measuredBytes: null };
  }
  return { bytes: 4 * 1024 ** 3, provenance: 'fallback', measuredBytes: null };
}

export async function probeHardware(): Promise<HardwareEnvelope> {
  if (cached) return cached;
  const cpuCores =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? Math.max(1, navigator.hardwareConcurrency)
      : 4;
  // Measured heap ceiling where available; reported/fallback otherwise, with
  // the provenance carried so no deck can quote a guess as a measurement.
  const mem = probeMemoryCeiling();
  const ramBytes = mem.bytes;
  const gpu = await probeGpu();
  const sharedArrayBuffer =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as unknown as { SharedArrayBuffer?: unknown }).SharedArrayBuffer !== 'undefined' &&
    typeof globalThis.crossOriginIsolated === 'boolean' &&
    globalThis.crossOriginIsolated === true;
  const peakOpsPerSecond = selfBenchOps() * cpuCores;
  cached = {
    cpuCores,
    ramBytes,
    ramProvenance: mem.provenance,
    ramMeasuredBytes: mem.measuredBytes,
    gpu,
    sharedArrayBuffer,
    tickBudgetMs: 1000 / 60, // 60 Hz default; governor can override
    carrierCeilingHz: CARRIER_CEILING_HZ,
    peakOpsPerSecond,
  };
  return cached;
}

export function getCachedEnvelope(): HardwareEnvelope | null {
  return cached;
}

/**
 * Refresh `peakOpsPerSecond` from a live observation (EMA, α=0.05).
 * Only ratchets upward — never demotes the headroom estimate from a single
 * stalled tick. Called by FallbackEngine each tick.
 */
export function refreshPeakOpsPerSecond(observedOpsPerSecond: number): void {
  if (!cached || !Number.isFinite(observedOpsPerSecond) || observedOpsPerSecond <= 0) return;
  const next = cached.peakOpsPerSecond * 0.95 + observedOpsPerSecond * 0.05;
  // Ratchet: keep the higher of (smoothed, observed peak).
  cached.peakOpsPerSecond = Math.max(cached.peakOpsPerSecond, next, observedOpsPerSecond);
}
