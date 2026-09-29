/**
 * Gate S0 — the frozen regression oracle.
 *
 * These hashes are the contract: any stage that changes them without an
 * explicit, argued re-blessing is a regression.
 *
 * RE-BLESSING #1 — deterministic transcendental bank (S5.1).
 * ---------------------------------------------------------
 * The first hash set was NOT reproducible: it depended on the host JS engine.
 * ECMAScript specifies Math.sin/cos/exp/log/pow/hypot/atan2 only as
 * "implementation-approximated", and V8 and JavaScriptCore differ in the last
 * ulp — enough to move a 1000-tick state hash. The oracle therefore hashed the
 * runtime, not the engine.
 *
 * The fix is `core/dmath.ts`: every transcendental on a state-bearing path is
 * now computed from IEEE-exact operations (+ − × ÷ sqrt, bit-level scaling)
 * with measured accuracy <= 2 ulp against the host libm. The hashes below are
 * verified identical under both JavaScriptCore (bun) and V8 (node), so from
 * here on a hash change means an engine change and nothing else.
 */

import { describe, expect, it } from 'vitest';
import { ORACLE_CONFIGS, runOracle } from './oracle';

/** Frozen 1000-tick end-state hashes (S0 baseline, engine-independent). */
export const ORACLE_HASHES: Readonly<Record<string, string>> = {
  PICO: 'dc8dcc16bcac8ffd',
  NANO: 'ac6a427d92c2157b',
  MICRO: 'b48fdafef2879ab9',
};

describe('S0 — regression oracle', () => {
  for (const cfg of ORACLE_CONFIGS) {
    it(`${cfg.id} reproduces its frozen 1000-tick hash`, () => {
      const run = runOracle(cfg);
      expect(run.hash).toBe(ORACLE_HASHES[cfg.id]);
      expect(run.finite).toBe(true);
      expect(run.fluxImbalance).toBe(0);
      expect(run.orderingViolations).toBe(0);
      expect(run.finalCoherence).toBeGreaterThan(0);
      expect(run.finalCoherence).toBeLessThanOrEqual(1);
      // 30 s: a 1000-tick MICRO oracle is CPU-bound and shares the box with the
      // rung scans, so the default 5 s budget flakes under parallel load.
    }, 30_000);
  }

  it('two independent instances of the same build agree bit-for-bit', () => {
    const cfg = ORACLE_CONFIGS[0];
    expect(runOracle(cfg).hash).toBe(runOracle(cfg).hash);
  }, 30_000);
});
