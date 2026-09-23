/**
 * Ω-SCALE P4 — throughput planning.
 *
 * The point of these tests is that the planner must be willing to say "no".
 * A planner that always recommends more workers is not a planner.
 */
import { describe, it, expect } from 'vitest';
import { probeHost, probeGpuAdapter, planParallel, bestWorkerCount } from '../src/operator';

describe('Ω-SCALE P4 · throughput', () => {
  it('p1 · host probe is total and never throws', () => {
    const h = probeHost();
    expect(typeof h.workers).toBe('boolean');
    expect(typeof h.webgpuApi).toBe('boolean');
    expect(h.recommendedWorkers).toBeGreaterThanOrEqual(1);
    expect(h.recommendedWorkers).toBeLessThanOrEqual(8);
  });

  it('p2 · GPU probe resolves false rather than throwing without an adapter', async () => {
    await expect(probeGpuAdapter()).resolves.toBe(false);
  });

  it('p3 · refuses to split a workload too small to pay for the overhead', () => {
    const plan = planParallel(10, 4, 100, 50_000);
    expect(plan.worthwhile).toBe(false);
    expect(plan.projectedSpeedup).toBeLessThan(1.1);
  });

  it('p4 · recommends splitting a large workload', () => {
    const plan = planParallel(1_000_000, 4, 100, 50_000);
    expect(plan.worthwhile).toBe(true);
    expect(plan.projectedSpeedup).toBeGreaterThan(2);
  });

  it('p5 · never projects above the Amdahl ceiling', () => {
    for (const w of [1, 2, 4, 8, 16]) {
      const plan = planParallel(1_000_000, w, 100, 50_000, 0.05);
      expect(plan.projectedSpeedup).toBeLessThanOrEqual(plan.amdahlCeiling + 1e-9);
    }
  });

  it('p6 · best worker count peaks rather than saturating the core list', () => {
    const small = bestWorkerCount(500, 32, 50, 500_000);
    expect(small.workers).toBe(1);
    const large = bestWorkerCount(5_000_000, 32, 100, 50_000);
    expect(large.workers).toBeGreaterThan(1);
  });

  it('p7 · a zero-item workload is never worth splitting', () => {
    const plan = planParallel(0, 8, 100);
    expect(plan.projectedSpeedup).toBe(1);
    expect(plan.worthwhile).toBe(false);
  });

  it('p8 · chunking covers every item exactly once', () => {
    const plan = planParallel(1000, 7, 100);
    expect(plan.chunk * plan.chunks).toBeGreaterThanOrEqual(1000);
    expect((plan.chunks - 1) * plan.chunk).toBeLessThan(1000);
  });
});
