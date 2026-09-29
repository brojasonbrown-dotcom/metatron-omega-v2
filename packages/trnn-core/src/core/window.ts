/**
 * S3 — Fibonacci windows and per-rung environment binding.
 *
 * Law L1 fixes node counts to Fibonacci numbers. Ω-MAX fixes *which*
 * Fibonacci numbers: a build selects an 18-long contiguous **window** of the
 * spine and lays it over the dense core, so rank 0 carries the narrowest rung
 * and rank 17 the widest. A quark-scale rung and a cell-scale rung do not host
 * the same number of geometric overlaps, and the window is how that is stated
 * once instead of being re-guessed per profile.
 *
 *   spine  13 21 34 55 89 144 233 377 610 987 1597 2584 4181 6765 10946 17711 28657 46368
 *
 * The window also carries the per-rung environment: the coherence delay τ, the
 * temperature T and the magnetic bias B. All three default to the values that
 * reproduce the S0 oracle exactly (uniform τ, T = 0, B = 0) — a window is a
 * description, never a behaviour change on its own.
 */

import {
  COHERENCE_DELAY,
  coherenceDelayForRank,
  magneticPhase,
  qrfAttenuation,
  thermalLambda,
  LAMBDA_MEMORY,
  type CoherenceClock,
} from './constants';
import { DENSE_CORE, DENSE_CORE_COUNT, type Rung } from './scaleLadder';
import { dpow } from './dmath';

/** The Fibonacci spine node counts may be drawn from (F7 … F24). */
export const FIB_SPINE = [
  13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946, 17711, 28657, 46368,
] as const;

/**
 * Ω-UNBOUND P1 — the spine is generated, not tabulated.
 *
 * `FIB_SPINE` above is the eagerly materialised prefix and remains the default
 * bound for every existing caller, so nothing below index 18 changes. But the
 * spine itself is a recurrence, not a list: `rungAt` continues it on demand for
 * as long as float64 can name the integer exactly. The old 18-entry ceiling was
 * an artefact of the table, and it is gone.
 *
 * The bound that remains is real and stated: F79 = 14472334024676221 is the last
 * Fibonacci number that is an exact float64 integer. Past that, `rungAt` throws
 * rather than return a rung whose node count is silently wrong.
 */
export const SPINE_MATERIALISED = FIB_SPINE.length;

const spineCache: number[] = [...FIB_SPINE];

/** Node count at spine index `i`, generated on demand. Exact for all i it returns. */
export function rungAt(i: number): number {
  if (!Number.isInteger(i) || i < 0) {
    throw new RangeError(`rungAt: index must be a non-negative integer, got ${i}`);
  }
  while (spineCache.length <= i) {
    const n = spineCache.length;
    const next = spineCache[n - 1] + spineCache[n - 2];
    if (!Number.isSafeInteger(next)) {
      throw new RangeError(
        `rungAt: spine index ${i} exceeds exact float64 integers (last exact index ${n - 1} = ${spineCache[n - 1]})`,
      );
    }
    spineCache.push(next);
  }
  return spineCache[i];
}

/** The spine from index 0 up to but excluding `n`, generated as needed. */
export function spineUpTo(n: number): readonly number[] {
  if (n > 0) rungAt(n - 1);
  return spineCache.slice(0, Math.max(0, n));
}

export type FibSpineIndex = number;

export interface WindowEnvironment {
  /** Temperature at rank 0, in the field's own units (0 = inert). */
  readonly baseTemperature?: number;
  /** Temperature multiplier per rank (1 = flat). */
  readonly temperatureRamp?: number;
  /** Magnetic bias at rank 0 (0 = inert). */
  readonly baseMagnetic?: number;
  /** Magnetic bias multiplier per rank (1 = flat). */
  readonly magneticRamp?: number;
  /** Coherence clock policy; 'uniform' reproduces the historical constant. */
  readonly coherenceClock?: CoherenceClock;
}

export interface WindowRung {
  readonly rank: number;
  readonly rung: Rung;
  /** Nodes on this rung — a Fibonacci number, by law. */
  readonly nodes: number;
  /** Index into FIB_SPINE. */
  readonly spineIndex: number;
  /** Coherence ring depth for this rung, ticks. */
  readonly coherenceDelay: number;
  /** Temperature at this rung. */
  readonly temperature: number;
  /** Effective memory kernel after the thermal map — always ≤ LAMBDA_MEMORY. */
  readonly lambda: number;
  /** Magnetic bias at this rung. */
  readonly magnetic: number;
  /** Mode phase offset the bias induces, radians. */
  readonly magneticPhase: number;
  /** QRF attenuation φ^(−n/89) for this rung's ladder index. */
  readonly qrf: number;
}

export interface LadderWindow {
  readonly id: string;
  /** First spine index used (rank 0). */
  readonly start: FibSpineIndex;
  readonly rungs: readonly WindowRung[];
  readonly totalNodes: number;
  readonly minNodes: number;
  readonly maxNodes: number;
  readonly environment: Required<WindowEnvironment>;
}

export interface WindowOptions extends WindowEnvironment {
  /** Rungs to instantiate; defaults to the full dense core. */
  readonly count?: number;
  readonly id?: string;
  /**
   * Ω-UNBOUND: permit windows past the materialised prefix, continuing the
   * spine by recurrence. Off by default so no existing caller silently escapes
   * the bound it was written against.
   */
  readonly unbounded?: boolean;
}

const DEFAULT_ENV: Required<WindowEnvironment> = {
  baseTemperature: 0,
  temperatureRamp: 1,
  baseMagnetic: 0,
  magneticRamp: 1,
  coherenceClock: 'uniform',
};

/**
 * Build a window starting at `start` on the Fibonacci spine.
 *
 * The window is clamped, never wrapped: asking for a start so high that the
 * window would run off the end of the spine throws, because silently narrowing
 * a build is exactly the kind of compromise this engine refuses.
 */
export function buildWindow(start: FibSpineIndex, opts: WindowOptions = {}): LadderWindow {
  const count = Math.max(1, Math.trunc(opts.count ?? DENSE_CORE_COUNT));
  if (count > DENSE_CORE_COUNT) {
    throw new RangeError(
      `buildWindow: ${count} rungs exceeds the ${DENSE_CORE_COUNT}-rung dense core`,
    );
  }
  if (!Number.isInteger(start) || start < 0) {
    throw new RangeError(`buildWindow: start must be a non-negative integer, got ${start}`);
  }
  if (!opts.unbounded && start + count > SPINE_MATERIALISED) {
    throw new RangeError(
      `buildWindow: window [${start}, ${start + count}) runs past the Fibonacci spine (${SPINE_MATERIALISED}); pass { unbounded: true } to continue it`,
    );
  }

  const env: Required<WindowEnvironment> = { ...DEFAULT_ENV, ...stripUndefined(opts) };
  const rungs: WindowRung[] = [];
  let total = 0;
  for (let rank = 0; rank < count; rank++) {
    const spineIndex = start + rank;
    const nodes = rungAt(spineIndex);
    const rung = DENSE_CORE[rank];
    const temperature = env.baseTemperature * dpow(env.temperatureRamp, rank);
    const magnetic = env.baseMagnetic * dpow(env.magneticRamp, rank);
    rungs.push({
      rank,
      rung,
      nodes,
      spineIndex,
      coherenceDelay: coherenceDelayForRank(rank, env.coherenceClock),
      temperature,
      lambda: thermalLambda(temperature),
      magnetic,
      magneticPhase: magneticPhase(magnetic),
      qrf: qrfAttenuation(rung.n),
    });
    total += nodes;
  }

  return {
    id: opts.id ?? `OMEGA-${rungAt(start + count - 1)}`,
    start,
    rungs,
    totalNodes: total,
    minNodes: rungs[0].nodes,
    maxNodes: rungs[rungs.length - 1].nodes,
    environment: env,
  };
}

function stripUndefined(o: WindowOptions): WindowEnvironment {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && k !== 'count' && k !== 'id' && k !== 'unbounded') out[k] = v;
  }
  return out as WindowEnvironment;
}

/** Every window of `count` rungs the spine admits, narrowest first. */
export function enumerateWindows(
  count = DENSE_CORE_COUNT,
  env: WindowEnvironment = {},
): LadderWindow[] {
  const out: LadderWindow[] = [];
  for (let s = 0; s + count <= FIB_SPINE.length; s++) out.push(buildWindow(s, { ...env, count }));
  return out;
}

/** Window whose top rung is exactly `nodes`, or undefined when off-spine. */
export function windowByTopNodes(
  nodes: number,
  count = DENSE_CORE_COUNT,
  env: WindowEnvironment = {},
): LadderWindow | undefined {
  const top = FIB_SPINE.indexOf(nodes as (typeof FIB_SPINE)[number]);
  if (top < 0) return undefined;
  const start = top - count + 1;
  if (start < 0) return undefined;
  return buildWindow(start, { ...env, count });
}

/** Work units one web tick of this window costs, in the S1 cost-model unit. */
export function windowWork(w: LadderWindow, modes: number, couplingBand: number): number {
  const analysis = 2 * w.totalNodes * modes;
  const exchange = w.totalNodes * Math.min(w.rungs.length - 1, 2 * couplingBand);
  return analysis + exchange + 12 * w.totalNodes;
}

/** True when the window's environment is the inert default. */
export function isInertWindow(w: LadderWindow): boolean {
  const e = w.environment;
  return (
    e.baseTemperature === 0 &&
    e.baseMagnetic === 0 &&
    e.coherenceClock === 'uniform' &&
    w.rungs.every(
      (r) =>
        r.lambda === LAMBDA_MEMORY && r.magneticPhase === 0 && r.coherenceDelay === COHERENCE_DELAY,
    )
  );
}
