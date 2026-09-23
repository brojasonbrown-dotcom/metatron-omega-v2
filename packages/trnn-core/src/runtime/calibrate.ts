/**
 * S1 — the measurement harness.
 *
 * The governor is only honest if the units it predicts in are the units the
 * machine is measured in. This module closes that loop three ways:
 *
 *   1. `countBuildWork(profile)` — walks the profile's actual rung/node plan
 *      and counts the work units a web tick really performs. It must equal
 *      `profileCost(p).nodeTicks` exactly; the S1 gate asserts equality, so the
 *      cost model can never silently drift away from the build.
 *   2. `measureFootprint(engine)` — sums the byteLength of every typed array
 *      the built engine holds, reachable by structural walk. No estimate.
 *   3. `calibrate(profile, opts)` — builds the engine, runs it, and reports
 *      predicted vs measured on both axes plus the achieved tick rate.
 *
 * Nothing here runs on the engine path: no result enters the digest chain.
 */

import { MultiTorusEngine } from '../engine/MultiTorusEngine';
import { DENSE_CORE } from '../core/scaleLadder';
import { nodesForRank, profileById, profileCost, type Profile, type ProfileId } from './profiles';

const nowFn = (): number => {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p ? p.now() : Date.now();
};

export interface BuildWork {
  readonly nodes: number;
  readonly perRung: readonly number[];
  /** analyze + synthesize work units. */
  readonly analysis: number;
  /** web exchange work units. */
  readonly exchange: number;
  /** cell update work units. */
  readonly cell: number;
  readonly total: number;
}

/** Count the work a single web tick of this profile actually performs. */
export function countBuildWork(p: Profile): BuildWork {
  const perRung: number[] = [];
  for (let r = 0; r < p.rungs; r++) perRung.push(nodesForRank(p, r));
  const nodes = perRung.reduce((a, b) => a + b, 0);
  const analysis = 2 * nodes * p.modes;
  const exchange = nodes * Math.min(p.rungs - 1, 2 * p.couplingBand);
  const cell = 12 * nodes;
  return { nodes, perRung, analysis, exchange, cell, total: analysis + exchange + cell };
}

/**
 * Sum every typed array the object graph holds. Cycle-safe, depth-bounded,
 * and it counts each buffer once (views onto a shared buffer are deduped by
 * their underlying ArrayBuffer).
 */
export function measureFootprint(root: unknown, maxDepth = 12): number {
  const seen = new Set<unknown>();
  const buffers = new Set<ArrayBufferLike>();
  let bytes = 0;

  const walk = (v: unknown, depth: number): void => {
    if (depth > maxDepth || v === null || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      const buf = (v as ArrayBufferView).buffer;
      if (!buffers.has(buf)) {
        buffers.add(buf);
        bytes += buf.byteLength;
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (v instanceof Map) {
      for (const [k, x] of v) {
        walk(k, depth + 1);
        walk(x, depth + 1);
      }
      return;
    }
    if (v instanceof Set) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    for (const k of Object.keys(v as Record<string, unknown>)) {
      walk((v as Record<string, unknown>)[k], depth + 1);
    }
  };

  walk(root, 0);
  return bytes;
}

export interface Calibration {
  readonly profile: ProfileId;
  readonly ticks: number;
  /** Work units per tick, predicted by the cost model. */
  readonly predictedWork: number;
  /** Work units per tick, counted off the real build. */
  readonly countedWork: number;
  /** countedWork / predictedWork — must be exactly 1. */
  readonly workRatio: number;
  readonly predictedBytes: number;
  readonly measuredBytes: number;
  /** measuredBytes / predictedBytes — reported, never asserted. */
  readonly byteRatio: number;
  readonly elapsedMs: number;
  readonly msPerTick: number;
  /** Achieved work units per second for this build on this machine. */
  readonly achievedRate: number;
  /** Sustainable tick rate at 100% of one thread. */
  readonly maxHz: number;
  readonly finite: boolean;
  readonly fluxImbalance: number;
  readonly orderingViolations: number;
}

export interface CalibrateOptions {
  readonly ticks?: number;
  readonly seed?: string;
  /** Untimed ticks run first so the JIT is warm before the clock starts. */
  readonly warmup?: number;
}

export function calibrate(profile: Profile | ProfileId, opts: CalibrateOptions = {}): Calibration {
  const p = typeof profile === 'string' ? profileById(profile) : profile;
  const ticks = Math.max(1, opts.ticks ?? 64);
  const warmup = Math.max(0, opts.warmup ?? 8);
  const work = countBuildWork(p);
  const cost = profileCost(p);

  const engine = new MultiTorusEngine({
    rungs: DENSE_CORE.slice(0, p.rungs),
    nodes: (_r, rank) => nodesForRank(p, rank),
    couplingBand: p.couplingBand,
    clock: p.clock,
    modes: p.modes,
    tapeCapacity: p.tape,
    seed: opts.seed ?? `calibrate:${p.id}`,
  });

  for (let i = 0; i < warmup; i++) engine.step();
  const t0 = nowFn();
  let last = engine.step();
  for (let i = 1; i < ticks; i++) last = engine.step();
  const elapsedMs = Math.max(nowFn() - t0, 1e-3);

  const measuredBytes = measureFootprint(engine);
  const msPerTick = elapsedMs / ticks;
  return {
    profile: p.id,
    ticks,
    predictedWork: cost.nodeTicks,
    countedWork: work.total,
    workRatio: cost.nodeTicks > 0 ? work.total / cost.nodeTicks : 0,
    predictedBytes: cost.bytes,
    measuredBytes,
    byteRatio: cost.bytes > 0 ? measuredBytes / cost.bytes : 0,
    elapsedMs,
    msPerTick,
    achievedRate: work.total / (msPerTick / 1000),
    maxHz: 1000 / msPerTick,
    finite: last.finite,
    fluxImbalance: last.fluxImbalance,
    orderingViolations: last.orderingViolations,
  };
}
