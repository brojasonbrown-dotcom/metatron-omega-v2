/**
 * S0 — the regression oracle.
 *
 * Three fixed builds, 1000 web ticks each, hashed end-to-end. Every later stage
 * of the Ω-MAX rebuild must either reproduce these hashes exactly (behaviour
 * preserved) or explicitly re-bless them in the same commit that changes the
 * law. This is the "no regressions" contract in executable form.
 *
 * The hash absorbs, per tick: the web digest, coherence, flux moved, flux
 * imbalance, ordering violations, row-sum defect — and, at the end, every
 * rung's full complex field. Nothing here reads a clock or an RNG.
 */

import { Digest, DENSE_CORE, type Rung } from '../src/index';
import { MultiTorusEngine, type MultiTorusOptions } from '../src/engine/MultiTorusEngine';

export interface OracleConfig {
  readonly id: string;
  readonly ticks: number;
  readonly options: MultiTorusOptions;
}

/** Fibonacci window helper — nodes ramp along the ladder across the rungs. */
export function windowNodes(ladder: readonly number[]): (rung: Rung, rank: number) => number {
  return (_r, rank) => ladder[Math.min(rank, ladder.length - 1)];
}

export const ORACLE_CONFIGS: readonly OracleConfig[] = [
  {
    id: 'PICO',
    ticks: 1000,
    options: {
      rungs: DENSE_CORE.slice(0, 3),
      nodes: windowNodes([13, 21, 34]),
      modes: 8,
      couplingBand: 2,
      clock: 'uniform',
      seed: 'omega-oracle-pico',
    },
  },
  {
    id: 'NANO',
    ticks: 1000,
    options: {
      rungs: DENSE_CORE.slice(0, 5),
      nodes: windowNodes([34, 55, 89, 144, 233]),
      modes: 13,
      couplingBand: 2,
      clock: 'uniform',
      seed: 'omega-oracle-nano',
    },
  },
  {
    id: 'MICRO',
    ticks: 1000,
    options: {
      rungs: DENSE_CORE.slice(0, 8),
      nodes: windowNodes([55, 89, 144, 233, 377, 610, 610, 610]),
      modes: 13,
      couplingBand: 3,
      clock: 'fibonacci',
      seed: 'omega-oracle-micro',
    },
  },
];

export interface OracleRun {
  readonly id: string;
  readonly hash: string;
  readonly ticks: number;
  readonly finalCoherence: number;
  readonly fluxImbalance: number;
  readonly orderingViolations: number;
  readonly finite: boolean;
}

export function runOracle(cfg: OracleConfig): OracleRun {
  const eng = new MultiTorusEngine(cfg.options);
  const d = new Digest();
  d.text(cfg.id);
  let last = eng.step();
  d.text(last.digest);
  for (let t = 1; t < cfg.ticks; t++) {
    last = eng.step();
    d.text(last.digest);
    d.float(last.coherence).float(last.fluxMoved).float(last.fluxImbalance);
    d.int(last.orderingViolations).float(last.rowSumDefect);
  }
  for (const e of eng.engines) {
    const s = e.snapshot();
    d.array(s.z.re).array(s.z.im);
  }
  return {
    id: cfg.id,
    hash: d.hex(),
    ticks: cfg.ticks,
    finalCoherence: last.coherence,
    fluxImbalance: last.fluxImbalance,
    orderingViolations: last.orderingViolations,
    finite: last.finite,
  };
}
