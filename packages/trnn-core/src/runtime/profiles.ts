/**
 * Ω-P4 — capacity profiles.
 *
 * A profile is a *complete* description of an engine build: how many rungs of
 * the dense core are instantiated, how many nodes each carries, how wide the
 * spectral signature is, and how deep the transcription tape runs. Nothing
 * here is adaptive — the governor picks a profile, the profile then fully
 * determines the build, so a run is reproducible from `(profileId, seed)`.
 *
 * Node counts are Fibonacci by law (the lattice and the octave transport both
 * assume it). Rung counts never exceed the 18-rung dense core.
 *
 * Cost model (measured units, not vibes):
 *   nodeTicks(profile) = Σ_r nodes(r)          — one web tick touches each node
 *   bytes(profile)     = Σ_r fieldBytes(r) + tapeBytes(r) + basisBytes(r)
 * Both are exact counts of what the engine actually allocates, so the governor
 * can be checked against `measureFootprint()` after the build.
 */

import { DENSE_CORE_COUNT } from '../core/scaleLadder';
import { COHERENCE_DELAY } from '../core/constants';
import { dexp, dlog } from '../core/dmath';

export type ProfileId = 'PICO' | 'NANO' | 'MICRO' | 'MESO' | 'MACRO' | 'GRAND';

export interface Profile {
  readonly id: ProfileId;
  /** Ordinal — higher is heavier. Used for monotone selection. */
  readonly tier: number;
  /** Rungs of the dense core to instantiate (from rank 0 upward). */
  readonly rungs: number;
  /** Nodes on the lowest rung. */
  readonly baseNodes: number;
  /** Nodes on the highest rung (interpolated along the Fibonacci ladder). */
  readonly topNodes: number;
  /** Spectral signature width. */
  readonly modes: number;
  /** Transcription tape depth, frames. */
  readonly tape: number;
  /** Coupling band half-width. */
  readonly couplingBand: number;
  /** Multi-rate clock policy. */
  readonly clock: 'uniform' | 'fibonacci';
  /** Coherence ring depth in frames; defaults to the global COHERENCE_DELAY. */
  readonly coherenceDelay?: number;
  readonly note: string;
}

/** Fibonacci numbers used for node counts (F7..F21). */
export const NODE_LADDER = [
  13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946,
] as const;

function nearestFib(x: number): number {
  let best: number = NODE_LADDER[0];
  let bd = Infinity;
  for (const f of NODE_LADDER) {
    const d = Math.abs(dlog(f) - dlog(Math.max(1, x)));
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

export const CAPACITY_PROFILES: readonly Profile[] = [
  {
    id: 'PICO',
    tier: 0,
    rungs: 3,
    baseNodes: 13,
    topNodes: 34,
    modes: 8,
    tape: 233,
    couplingBand: 2,
    clock: 'uniform',
    note: 'smoke tier — runs anywhere, including throttled mobile',
  },
  {
    id: 'NANO',
    tier: 1,
    rungs: 5,
    baseNodes: 34,
    topNodes: 89,
    modes: 13,
    tape: 610,
    couplingBand: 2,
    clock: 'uniform',
    note: 'low-power laptop / tablet',
  },
  {
    id: 'MICRO',
    tier: 2,
    rungs: 8,
    baseNodes: 55,
    topNodes: 233,
    modes: 13,
    tape: 987,
    couplingBand: 3,
    clock: 'fibonacci',
    note: 'typical browser default',
  },
  {
    id: 'MESO',
    tier: 3,
    rungs: 13,
    baseNodes: 89,
    topNodes: 610,
    modes: 13,
    tape: 1597,
    couplingBand: 3,
    clock: 'fibonacci',
    note: 'desktop class',
  },
  {
    id: 'MACRO',
    tier: 4,
    rungs: DENSE_CORE_COUNT,
    baseNodes: 144,
    topNodes: 1597,
    modes: 21,
    tape: 2584,
    couplingBand: 4,
    clock: 'fibonacci',
    note: 'full dense core, workstation',
  },
  {
    id: 'GRAND',
    tier: 5,
    rungs: DENSE_CORE_COUNT,
    baseNodes: 377,
    topNodes: 6765,
    modes: 21,
    tape: 4181,
    couplingBand: 5,
    clock: 'fibonacci',
    note: 'full dense core at spectral width — needs real hardware',
  },
] as const;

export function profileById(id: ProfileId): Profile {
  const p = CAPACITY_PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`unknown profile ${id}`);
  return p;
}

/**
 * Node count for rank `r` of a profile: geometric interpolation between
 * baseNodes and topNodes, snapped to the Fibonacci ladder (log-space nearest,
 * so the snap is scale-free).
 */
export function nodesForRank(p: Profile, rank: number): number {
  if (p.rungs <= 1) return p.baseNodes;
  const t = Math.min(rank, p.rungs - 1) / (p.rungs - 1);
  const x = dexp(dlog(p.baseNodes) * (1 - t) + dlog(p.topNodes) * t);
  return nearestFib(x);
}

export function profileNodes(p: Profile): number[] {
  const out: number[] = [];
  for (let r = 0; r < p.rungs; r++) out.push(nodesForRank(p, r));
  return out;
}

export interface ProfileCost {
  /** Total nodes across all rungs — one web tick touches each once. */
  readonly nodes: number;
  /**
   * Dominant per-tick work unit. Modal analysis/synthesis is O(nodes*modes)
   * and runs twice per tick; the web exchange is O(rungs*band*nodes).
   */
  readonly nodeTicks: number;
  /** Exact bytes the build allocates in typed arrays. */
  readonly bytes: number;
}

/** Bytes the engine allocates for one rung of `n` nodes at this profile. */
function rungBytes(p: Profile, n: number): number {
  // Counted against the real build (S1, `measureFootprint`), not estimated:
  //   8 complex work fields (z, zNext, m, G, P, R, Pi, zhat)  16 B/node each
  //   3 lazily-allocated complex buffers (input, web, sense)  16 B/node each
  //   lattice u,v (+ the derived weight strip)                 3 x 8 B/node
  //   mode basis: `modes` complex vectors                     16 B/node each
  //   coherence ring: (delay + 1) FULL frames                 16 B/node each
  //     — this is the dominant term at small node counts and the reason the
  //       per-rung coherence delay (S2) is a memory decision, not cosmetics
  //   signature + coefficient buffers, transcription tape
  const fields = 11 * 16 * n;
  const lattice = 3 * 8 * n;
  const basis = p.modes * 16 * n;
  const meter = (p.coherenceDelay ?? COHERENCE_DELAY) * 16 * n + 16 * n;
  const coeffs = p.modes * 16 * 2 + p.modes * 8;
  const tape = p.tape * (p.modes * 8 + 4);
  return fields + lattice + basis + meter + coeffs + tape;
}

export function profileCost(p: Profile): ProfileCost {
  const ns = profileNodes(p);
  let nodes = 0;
  let bytes = 0;
  for (const n of ns) {
    nodes += n;
    bytes += rungBytes(p, n);
  }
  // web staging + receipts: two extra complex fields per rung, plus the
  // coupling matrix and the octave scratch (worst-case one field at topNodes).
  const web = 2 * 16 * nodes + p.rungs * p.rungs * 8 + 16 * Math.max(...ns);
  const analysis = 2 * nodes * p.modes; // analyze + synthesize
  const exchange = nodes * Math.min(p.rungs - 1, 2 * p.couplingBand);
  return { nodes, nodeTicks: analysis + exchange + 12 * nodes, bytes: bytes + web };
}

/** Profiles ordered lightest → heaviest. */
export const PROFILES_BY_TIER: readonly Profile[] = [...CAPACITY_PROFILES].sort(
  (a, b) => a.tier - b.tier,
);
