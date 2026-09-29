/**
 * Ω-P4 — the governor.
 *
 * Given a measured probe, pick the heaviest profile that fits inside 75% of
 * measured capacity, on BOTH axes:
 *
 *   compute: nodeTicks(profile) * targetHz  ≤  0.75 * measured nodeTicks/s
 *   memory : bytes(profile)                 ≤  0.75 * memoryBudget
 *
 * The headroom fraction is explicit and adjustable; nothing is hidden. When the
 * platform refuses to disclose memory, the memory axis is reported as
 * `unconstrained` rather than assumed — the compute axis still binds.
 *
 * The verdict carries the full per-profile table so the HARDWARE deck can show
 * *why* a tier was rejected, and `verifyFootprint()` closes the loop by
 * comparing the prediction against the built engine.
 */

import { PROFILES_BY_TIER, profileCost, type Profile, type ProfileId } from './profiles';
import type { HardwareProbe } from './hardware';

export const DEFAULT_HEADROOM = 0.75;

export interface ProfileVerdict {
  readonly id: ProfileId;
  readonly tier: number;
  /** node-ticks/s this profile needs to hold the target rate. */
  readonly requiredRate: number;
  /** Fraction of the measured compute budget consumed (1 = at the limit). */
  readonly computeLoad: number;
  readonly bytes: number;
  /** Fraction of the memory budget consumed, or null when undisclosed. */
  readonly memoryLoad: number | null;
  readonly fits: boolean;
  readonly reason: 'ok' | 'compute' | 'memory' | 'compute+memory';
}

export interface GovernorVerdict {
  readonly selected: Profile;
  readonly targetHz: number;
  readonly headroom: number;
  /** Sustainable tick rate for the selected profile at full budget. */
  readonly maxHz: number;
  readonly table: readonly ProfileVerdict[];
  /** True when the lightest profile itself exceeds budget (we ship it anyway). */
  readonly degraded: boolean;
  readonly memoryConstrained: boolean;
}

export interface GovernorOptions {
  readonly targetHz?: number;
  readonly headroom?: number;
  /** Hard ceiling an operator can impose from the UI. */
  readonly maxProfile?: ProfileId;
  /** Floor, e.g. when the operator insists on a tier. */
  readonly minProfile?: ProfileId;
}

export function evaluateProfile(
  p: Profile,
  probe: HardwareProbe,
  targetHz: number,
  headroom: number,
): ProfileVerdict {
  const cost = profileCost(p);
  const requiredRate = cost.nodeTicks * targetHz;
  const computeBudget = probe.throughput.nodeTicksPerSecond * headroom;
  const computeLoad = computeBudget > 0 ? requiredRate / computeBudget : Infinity;
  const memBudget = probe.memoryBudget === null ? null : probe.memoryBudget * headroom;
  const memoryLoad = memBudget === null ? null : cost.bytes / memBudget;
  const computeBad = !(computeLoad <= 1);
  const memBad = memoryLoad !== null && !(memoryLoad <= 1);
  const reason: ProfileVerdict['reason'] =
    computeBad && memBad ? 'compute+memory' : computeBad ? 'compute' : memBad ? 'memory' : 'ok';
  return {
    id: p.id,
    tier: p.tier,
    requiredRate,
    computeLoad,
    bytes: cost.bytes,
    memoryLoad,
    fits: !computeBad && !memBad,
    reason,
  };
}

export function selectProfile(probe: HardwareProbe, opts: GovernorOptions = {}): GovernorVerdict {
  const targetHz = opts.targetHz ?? 64;
  const headroom = opts.headroom ?? DEFAULT_HEADROOM;
  const table = PROFILES_BY_TIER.map((p) => evaluateProfile(p, probe, targetHz, headroom));

  const ceiling = opts.maxProfile
    ? (PROFILES_BY_TIER.find((p) => p.id === opts.maxProfile)?.tier ?? Infinity)
    : Infinity;
  const floor = opts.minProfile
    ? (PROFILES_BY_TIER.find((p) => p.id === opts.minProfile)?.tier ?? -1)
    : -1;

  let chosen: Profile | null = null;
  for (let i = 0; i < PROFILES_BY_TIER.length; i++) {
    const p = PROFILES_BY_TIER[i];
    if (p.tier > ceiling) break;
    if (!table[i].fits && p.tier > floor) break;
    chosen = p;
  }
  const degraded = chosen === null;
  const selected = chosen ?? PROFILES_BY_TIER[0];

  const cost = profileCost(selected);
  const maxHz =
    cost.nodeTicks > 0
      ? (probe.throughput.nodeTicksPerSecond * headroom) / cost.nodeTicks
      : targetHz;

  return {
    selected,
    targetHz,
    headroom,
    maxHz,
    table,
    degraded,
    memoryConstrained: probe.memoryBudget !== null,
  };
}

export interface FootprintCheck {
  readonly predictedBytes: number;
  readonly measuredBytes: number;
  /** measured / predicted — 1.0 is a perfect model. */
  readonly ratio: number;
}

/**
 * Close the loop: compare the profile's predicted allocation against what the
 * built engine actually holds. Reported, never asserted — a drifting ratio is
 * information about the cost model, not a crash.
 */
export function verifyFootprint(p: Profile, measuredBytes: number): FootprintCheck {
  const predicted = profileCost(p).bytes;
  return {
    predictedBytes: predicted,
    measuredBytes,
    ratio: predicted > 0 ? measuredBytes / predicted : 0,
  };
}
