/**
 * Ω-SCALE P2 — tiered retention with surprise-based admission.
 *
 * The engine touches millions of numbers per second and keeps roughly a
 * thousand. That ratio is the real ceiling on how much the system can learn:
 * not compute, not bandwidth — *what survives the tick*. Raising it by keeping
 * more of everything is the wrong move; the store fills with the frames that
 * were most predictable, which are precisely the ones carrying no information.
 *
 * The policy here keeps a frame in proportion to how badly it was predicted.
 * Surprise is measured against the calibrated band the conformal layer already
 * produces (Ω-SCALE P1), so admission is expressed in units of *guaranteed*
 * uncertainty rather than an arbitrary threshold:
 *
 *   surprise = |actual − predicted| / halfWidth
 *
 * A frame inside its own 90% band is by construction unremarkable; a frame far
 * outside it is either genuine novelty or a regime change, and both are worth
 * paying for. This is the information-theoretic form of the same idea — the
 * expected code length of a residual under its own predictive distribution.
 *
 * Tiers, and why three rather than one:
 *   HOT   — full fidelity, small, in memory, read every tick.
 *   WARM  — decimated (spectral band-limit upstream), larger, persisted.
 *   COLD  — signature only, effectively unbounded, archived.
 *
 * Each tier has its own budget and its own admission floor, so a frame demoted
 * out of HOT is not discarded but re-offered downward. Nothing is deleted
 * without first being offered to the tier below; that is what makes the total
 * store grow toward 10^12 numbers without the hot path growing at all.
 */

import { PHI, PHI_INV } from '../core/constants';

export type Tier = 'hot' | 'warm' | 'cold';

export const TIERS: readonly Tier[] = ['hot', 'warm', 'cold'] as const;

export interface TierPolicy {
  readonly tier: Tier;
  /** Max entries held. Exceeding it evicts the least-surprising entry. */
  readonly capacity: number;
  /**
   * Minimum surprise (in band half-widths) for admission. HOT is strict; COLD
   * accepts nearly everything, since a signature costs almost nothing.
   */
  readonly floor: number;
  /** Numbers stored per entry — the cost model, used by `footprint()`. */
  readonly width: number;
}

/**
 * Default ladder. Capacities and floors are φ-spaced: each tier is ~φ⁵ larger
 * and ~φ² cheaper to admit to than the one above it.
 */
export const DEFAULT_POLICY: readonly TierPolicy[] = [
  { tier: 'hot', capacity: 1597, floor: PHI, width: 4181 },
  { tier: 'warm', capacity: 17711, floor: PHI_INV, width: 233 },
  { tier: 'cold', capacity: 1_000_000, floor: 0, width: 13 },
];

export interface RetentionEntry<T> {
  readonly id: number;
  readonly tier: Tier;
  readonly surprise: number;
  readonly t: number;
  readonly payload: T;
}

export interface AdmissionResult<T> {
  /** Tier the frame landed in, or null when nothing would take it. */
  readonly tier: Tier | null;
  readonly surprise: number;
  /** Entries pushed out of their tier by this admission (already re-offered). */
  readonly demoted: readonly RetentionEntry<T>[];
  /** Entries that fell out of the bottom tier and are genuinely gone. */
  readonly dropped: readonly RetentionEntry<T>[];
}

export interface RetentionStats {
  readonly tier: Tier;
  readonly count: number;
  readonly capacity: number;
  readonly floor: number;
  /** Numbers currently stored in this tier. */
  readonly numbers: number;
  /** Mean surprise of what is held — a held tier should be above its floor. */
  readonly meanSurprise: number;
}

/**
 * Surprise of an observation in units of its calibrated band half-width.
 *
 * Returns `Infinity` for a non-finite band (nothing to compare against yet),
 * which admits the frame — during calibration warm-up the system must not
 * silently discard the very data the calibrator needs.
 */
export function surpriseOf(actual: number, predicted: number, halfWidth: number): number {
  if (!Number.isFinite(actual) || !Number.isFinite(predicted)) return 0;
  if (!Number.isFinite(halfWidth) || halfWidth <= 0) return Infinity;
  return Math.abs(actual - predicted) / halfWidth;
}

/**
 * Tiered store. Deterministic, allocation-light, and independent of any
 * particular payload — the engine supplies frames, signatures, or tape
 * fragments and gets back exactly which ones survived and why.
 */
export class TieredCorpus<T> {
  private readonly policy: readonly TierPolicy[];
  private readonly store = new Map<Tier, RetentionEntry<T>[]>();
  private seq = 0;
  private admitted = 0;
  private rejected = 0;
  private evicted = 0;

  constructor(policy: readonly TierPolicy[] = DEFAULT_POLICY) {
    if (policy.length === 0) throw new RangeError('TieredCorpus: empty policy');
    // Ordering is load-bearing: demotion walks the array downward.
    this.policy = [...policy].sort((a, b) => b.floor - a.floor);
    for (const p of this.policy) this.store.set(p.tier, []);
  }

  get totalCount(): number {
    let n = 0;
    for (const arr of this.store.values()) n += arr.length;
    return n;
  }

  get counters(): { admitted: number; rejected: number; evicted: number } {
    return { admitted: this.admitted, rejected: this.rejected, evicted: this.evicted };
  }

  /** Total numbers held across every tier — the footprint the policy implies. */
  footprint(): number {
    let n = 0;
    for (const p of this.policy) n += (this.store.get(p.tier)?.length ?? 0) * p.width;
    return n;
  }

  /** Maximum numbers this policy can ever hold. */
  capacityNumbers(): number {
    return this.policy.reduce((acc, p) => acc + p.capacity * p.width, 0);
  }

  entries(tier: Tier): readonly RetentionEntry<T>[] {
    return this.store.get(tier) ?? [];
  }

  stats(): RetentionStats[] {
    return this.policy.map((p) => {
      const arr = this.store.get(p.tier) ?? [];
      let s = 0;
      for (const e of arr) s += e.surprise === Infinity ? 0 : e.surprise;
      return {
        tier: p.tier,
        count: arr.length,
        capacity: p.capacity,
        floor: p.floor,
        numbers: arr.length * p.width,
        meanSurprise: arr.length > 0 ? s / arr.length : 0,
      };
    });
  }

  clear(): void {
    for (const p of this.policy) this.store.set(p.tier, []);
    this.seq = 0;
    this.admitted = 0;
    this.rejected = 0;
    this.evicted = 0;
  }

  /**
   * Offer a frame to the ladder. It enters the highest tier whose floor it
   * clears; anything it displaces cascades downward rather than vanishing.
   */
  admit(payload: T, surprise: number, t: number): AdmissionResult<T> {
    const s = Number.isFinite(surprise) || surprise === Infinity ? surprise : 0;
    const demoted: RetentionEntry<T>[] = [];
    const dropped: RetentionEntry<T>[] = [];

    const idx = this.policy.findIndex((p) => s >= p.floor);
    if (idx < 0) {
      this.rejected++;
      return { tier: null, surprise: s, demoted, dropped };
    }

    const entry: RetentionEntry<T> = {
      id: this.seq++,
      tier: this.policy[idx].tier,
      surprise: s,
      t,
      payload,
    };
    this.admitted++;
    this.insert(idx, entry, demoted, dropped);
    return { tier: entry.tier, surprise: s, demoted, dropped };
  }

  /**
   * Insert into tier `idx`, evicting the least-surprising entry when full and
   * cascading it into the next tier down. An entry evicted from the bottom
   * tier is dropped — and only there.
   */
  private insert(
    idx: number,
    entry: RetentionEntry<T>,
    demoted: RetentionEntry<T>[],
    dropped: RetentionEntry<T>[],
  ): void {
    const p = this.policy[idx];
    const arr = this.store.get(p.tier)!;
    arr.push({ ...entry, tier: p.tier });
    if (arr.length <= p.capacity) return;

    // Evict the least surprising; ties break toward the older entry so a burst
    // of equally-surprising frames does not thrash the tier.
    let worst = 0;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].surprise < arr[worst].surprise) worst = i;
      else if (arr[i].surprise === arr[worst].surprise && arr[i].t < arr[worst].t) worst = i;
    }
    const [out] = arr.splice(worst, 1);
    this.evicted++;

    const next = idx + 1;
    if (next < this.policy.length) {
      demoted.push(out);
      this.insert(next, out, demoted, dropped);
    } else {
      dropped.push(out);
    }
  }
}

/**
 * Projected footprint of a policy at a given admission rate, in numbers and
 * bytes — the honest answer to "how far does this actually scale?".
 *
 * `rateHz` is offers per second; `pass[i]` is the fraction of offers that
 * clears tier i's floor. Steady state is capacity-bound, so the useful output
 * is time-to-full per tier, not an unbounded growth curve.
 */
export function projectFootprint(
  policy: readonly TierPolicy[],
  rateHz: number,
  pass: readonly number[],
): { tier: Tier; numbers: number; bytes: number; secondsToFull: number }[] {
  return policy.map((p, i) => {
    const f = pass[i] ?? 1;
    const perSec = rateHz * f;
    return {
      tier: p.tier,
      numbers: p.capacity * p.width,
      bytes: p.capacity * p.width * 8,
      secondsToFull: perSec > 0 ? p.capacity / perSec : Infinity,
    };
  });
}
