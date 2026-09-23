/**
 * Gate S1 — the measurement harness.
 *
 * The cost model and the real build must agree exactly on work units, the
 * benchmark must report in those same units, and the footprint estimate must
 * be within a stated factor of the bytes the engine actually allocates.
 */
import { describe, expect, it } from 'vitest';
import { CAPACITY_PROFILES, PROFILES_BY_TIER, profileCost } from '../src/runtime/profiles';
import { calibrate, countBuildWork, measureFootprint } from '../src/runtime/calibrate';
import { benchmarkThroughput, tickWorkUnits } from '../src/runtime/hardware';

describe('S1 — cost model vs the real build', () => {
  it('counted work units equal predicted work units for every profile', () => {
    for (const p of CAPACITY_PROFILES) {
      expect(countBuildWork(p).total).toBe(profileCost(p).nodeTicks);
    }
  });

  it('work-unit accounting is monotone in tier', () => {
    for (let i = 1; i < PROFILES_BY_TIER.length; i++) {
      expect(profileCost(PROFILES_BY_TIER[i]).nodeTicks).toBeGreaterThan(
        profileCost(PROFILES_BY_TIER[i - 1]).nodeTicks,
      );
    }
  });

  it('the benchmark reports in cost-model units', () => {
    const t = benchmarkThroughput({ nodes: 89, ticks: 16, repeats: 2, modes: 13 });
    expect(t.workUnitsPerTick).toBe(tickWorkUnits(89, 13));
    expect(t.workUnitsPerSecond).toBe(t.nodeTicksPerSecond);
    expect(t.workUnitsPerSecond).toBeGreaterThan(0);
    expect(Number.isFinite(t.msPerTick)).toBe(true);
    expect(t.benchNodes).toBe(89);
    expect(t.benchModes).toBe(13);
  });

  it('footprint is measured, not estimated — and the model is within 10%', () => {
    for (const id of ['PICO', 'NANO', 'MICRO'] as const) {
      const c = calibrate(id, { ticks: 16, warmup: 4 });
      expect(c.workRatio).toBe(1);
      expect(c.measuredBytes).toBeGreaterThan(0);
      expect(c.byteRatio).toBeGreaterThan(0.9);
      expect(c.byteRatio).toBeLessThan(1.1);
      expect(c.finite).toBe(true);
      expect(c.fluxImbalance).toBe(0);
      expect(c.orderingViolations).toBe(0);
      expect(c.maxHz).toBeGreaterThan(0);
    }
  });

  it('the footprint walker dedupes views onto one buffer', () => {
    const buf = new ArrayBuffer(1024);
    const obj = { a: new Float64Array(buf, 0, 64), b: new Float64Array(buf, 0, 32) };
    expect(measureFootprint(obj)).toBe(1024);
  });

  it('the footprint walker is cycle safe', () => {
    const a: Record<string, unknown> = { arr: new Float64Array(8) };
    a['self'] = a;
    expect(measureFootprint(a)).toBe(64);
  });
});
