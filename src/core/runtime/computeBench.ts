/**
 * METATRON V11 — COMPUTE FREQUENCY PROBE
 * =======================================
 * Real-world self-measurement: drives the live field worker pool for a fixed
 * number of ticks at the current shard configuration and measures the actual
 * sustained tick frequency. From that we derive:
 *   - maxSustainedHz       — the honest tick rate this device can deliver
 *   - amplitudeNyquistHz   — Shannon-Nyquist limit on the carrier we can
 *                             modulate without aliasing at this tick rate
 *   - planckGapDecades     — log10(CARRIER_CEILING_HZ / amplitudeNyquistHz)
 *
 * Planck-frequency compute (~7.7×10⁴² Hz) is physically out of reach by ~40
 * decades on consumer silicon. This probe surfaces that truth instead of
 * pretending otherwise.
 */

import { CARRIER_CEILING_HZ, OPS_PER_NODE_TICK } from './HardwareEnvelope';
import type { FieldWorkerPool } from './WorkerPool';
import type { ResourceGovernor } from './ResourceGovernor';

export interface ComputeBenchResult {
  ticks: number;
  elapsedMs: number;
  nodesPerTick: number;
  maxSustainedHz: number;
  /** Per-tick jitter (std-dev / mean) — lower = more stable. */
  jitter: number;
  /** Stability score [0,1] = 1/(1+jitter). 1.0 = perfectly periodic. */
  stability: number;
  amplitudeNyquistHz: number;
  carrierCeilingHz: number;
  planckGapDecades: number;
  effectiveOpsPerSecond: number;
  workerBacked: boolean;
  ranAt: number;
}

export async function benchmarkComputeFrequency(
  pool: FieldWorkerPool,
  governor: ResourceGovernor,
  ticks = 24,
): Promise<ComputeBenchResult> {
  const settings = governor.settings;
  const start = performance.now();
  let nodes = 0;
  const dts = new Float64Array(ticks);
  let prev = start;
  for (let i = 0; i < ticks; i++) {
    const t = (start + i * 1.0) / 1000;
    const results = await pool.compute(t, 0, settings.reflectEnabled, settings.computePressure);
    if (i === 0) nodes = results.reduce((s, r) => s + r.nodes, 0);
    const now = performance.now();
    dts[i] = now - prev;
    prev = now;
  }
  const elapsedMs = performance.now() - start;
  const maxSustainedHz = (ticks * 1000) / Math.max(0.001, elapsedMs);
  // Jitter on the per-tick deltas (drop the first sample which includes warmup).
  let mean = 0,
    n = 0;
  for (let i = 1; i < dts.length; i++) {
    mean += dts[i];
    n++;
  }
  mean = n > 0 ? mean / n : 0;
  let v = 0;
  for (let i = 1; i < dts.length; i++) {
    const d = dts[i] - mean;
    v += d * d;
  }
  const std = n > 1 ? Math.sqrt(v / (n - 1)) : 0;
  const jitter = mean > 0 ? std / mean : 1;
  const stability = 1 / (1 + jitter);
  const amplitudeNyquistHz = maxSustainedHz / 2;
  const planckGapDecades = Math.log10(
    Math.max(1, CARRIER_CEILING_HZ / Math.max(1, amplitudeNyquistHz)),
  );
  const effectiveOpsPerSecond =
    nodes * settings.computePressure * OPS_PER_NODE_TICK * maxSustainedHz;
  return {
    ticks,
    elapsedMs,
    nodesPerTick: nodes,
    maxSustainedHz,
    jitter,
    stability,
    amplitudeNyquistHz,
    carrierCeilingHz: CARRIER_CEILING_HZ,
    planckGapDecades,
    effectiveOpsPerSecond,
    workerBacked: pool.stats.workerBacked,
    ranAt: Date.now(),
  };
}
