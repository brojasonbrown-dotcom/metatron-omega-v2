/**
 * Banding — Fibonacci age-banded selection.
 *
 * A flat top-N cut silences old material permanently: once the corpus is
 * large enough, every slot is taken by whatever was written most recently,
 * and a decisive memory from last year can never be recalled again no matter
 * how well it matches.
 *
 * The fix is quota, not weighting. Candidates are bucketed by Fibonacci age
 * band (see Resonance.ageBand) and each band receives a Fibonacci quota
 * 1,1,2,3,5,8,13,21… reading from the OLDEST band inward, so:
 *
 *   • recency still dominates the result, because the freshest bands carry
 *     the largest quotas;
 *   • every non-empty band is guaranteed at least one slot, so age alone can
 *     never exclude a memory;
 *   • leftover quota (from empty or under-filled bands) is redistributed to
 *     the best remaining candidates by score — no slot is ever wasted.
 *
 * Deterministic: ties break on a caller-supplied stable id.
 */

/** Fibonacci quota ladder, freshest band first. */
export const FIB_QUOTA = [8, 5, 3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] as const;

export interface Banded {
  /** Fibonacci age band index — 0 is freshest. */
  band: number;
  /** Ranking score, higher is better. */
  score: number;
  /** Stable identity for deterministic tie-breaks. */
  id: string;
}

/** Fibonacci quota for a band index (clamped at the ladder tail). */
export function bandQuota(band: number): number {
  if (!Number.isFinite(band) || band < 0) return 1;
  const i = Math.min(Math.floor(band), FIB_QUOTA.length - 1);
  return FIB_QUOTA[i];
}

function byScore<T extends Banded>(a: T, b: T): number {
  return b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Select up to `k` items honouring per-band Fibonacci quotas, then fill any
 * remaining slots with the best leftovers.
 */
export function fibonacciBandedSelect<T extends Banded>(items: readonly T[], k: number): T[] {
  if (k <= 0 || items.length === 0) return [];
  if (items.length <= k) return [...items].sort(byScore);

  const buckets = new Map<number, T[]>();
  for (const it of items) {
    const b = Math.max(0, Math.floor(it.band));
    const arr = buckets.get(b);
    if (arr) arr.push(it);
    else buckets.set(b, [it]);
  }

  const bands = [...buckets.keys()].sort((a, b) => a - b);
  const picked: T[] = [];
  const taken = new Set<string>();

  for (const b of bands) {
    const arr = buckets.get(b)!.sort(byScore);
    const quota = Math.min(bandQuota(b), arr.length);
    for (let i = 0; i < quota && picked.length < k; i++) {
      picked.push(arr[i]);
      taken.add(arr[i].id);
    }
    if (picked.length >= k) break;
  }

  if (picked.length < k) {
    const rest = items.filter((i) => !taken.has(i.id)).sort(byScore);
    for (const r of rest) {
      if (picked.length >= k) break;
      picked.push(r);
      taken.add(r.id);
    }
  }

  return picked.sort(byScore);
}
