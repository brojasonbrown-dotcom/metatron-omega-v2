/**
 * Ω-CORPUS area 5 — retrieval under an explicit budget.
 *
 * Recall walks the ladder outward — HOT (exact, free), then WARM (one shard
 * load), then COLD (one segment load) — and stops at the first tier that
 * satisfies the query within budget. A query that cannot be satisfied abstains
 * with a reason instead of scanning the archive; an unbounded scan over a
 * trillion-number store is not a slow answer, it is a wrong design.
 *
 * Budget is stated in numbers read, not in wall-clock guesses, because numbers
 * read is the quantity the caller can actually reason about ahead of time.
 */

import type { HotCache } from './HotCache';
import type { WarmShards } from './WarmShards';
import type { ColdArchive } from './ColdArchive';
import type { CorpusFrame } from './types';

export interface RecallQuery {
  readonly tickFrom: number;
  readonly tickTo: number;
  /** Max numbers this query may read. Exceeding it aborts before any I/O. */
  readonly budgetNumbers: number;
  /** Tiers to consider, outward. Defaults to all three. */
  readonly tiers?: readonly ('hot' | 'warm' | 'cold')[];
}

export interface RecallResult {
  readonly frames: readonly CorpusFrame[];
  readonly tier: 'hot' | 'warm' | 'cold' | null;
  readonly numbersRead: number;
  /** Present exactly when nothing was returned, and always explains why. */
  readonly abstained: string | null;
}

const ALL = ['hot', 'warm', 'cold'] as const;

export interface RecallSources {
  readonly hot: HotCache;
  readonly warm: WarmShards;
  readonly cold: ColdArchive;
}

export async function recall(src: RecallSources, q: RecallQuery): Promise<RecallResult> {
  const tiers = q.tiers ?? ALL;
  const from = Math.min(q.tickFrom, q.tickTo);
  const to = Math.max(q.tickFrom, q.tickTo);

  if (!Number.isFinite(q.budgetNumbers) || q.budgetNumbers <= 0) {
    return { frames: [], tier: null, numbersRead: 0, abstained: 'no read budget' };
  }

  if (tiers.includes('hot')) {
    const hits = src.hot
      .entries()
      .map((e) => e.payload)
      .filter((f) => f.tick >= from && f.tick <= to)
      .sort((a, b) => a.tick - b.tick);
    const cost = hits.length * src.hot.width;
    if (hits.length > 0 && cost <= q.budgetNumbers) {
      return { frames: hits, tier: 'hot', numbersRead: cost, abstained: null };
    }
  }

  if (tiers.includes('warm')) {
    const shards = src.warm.select(from, to);
    const cost = shards.reduce((a, s) => a + s.count * s.width, 0);
    if (shards.length > 0 && cost <= q.budgetNumbers) {
      const frames: CorpusFrame[] = [];
      for (const s of shards) {
        for (const f of await src.warm.readFrames(s.key)) {
          if (f.tick >= from && f.tick <= to) frames.push(f);
        }
      }
      frames.sort((a, b) => a.tick - b.tick);
      return { frames, tier: 'warm', numbersRead: cost, abstained: null };
    }
  }

  if (tiers.includes('cold')) {
    const segs = src.cold.select(from, to);
    const cost = segs.reduce((a, s) => a + s.count * s.width, 0);
    if (segs.length > 0 && cost <= q.budgetNumbers) {
      const frames: CorpusFrame[] = [];
      for (const s of segs) {
        for (const f of await src.cold.readFrames(s.key)) {
          if (f.tick >= from && f.tick <= to) frames.push(f);
        }
      }
      frames.sort((a, b) => a.tick - b.tick);
      return { frames, tier: 'cold', numbersRead: cost, abstained: null };
    }
    if (segs.length > 0) {
      return {
        frames: [], tier: null, numbersRead: 0,
        abstained: `range needs ${cost} numbers, budget is ${q.budgetNumbers}`,
      };
    }
  }

  return {
    frames: [], tier: null, numbersRead: 0,
    abstained: `no tier holds ticks [${from}, ${to}] within budget`,
  };
}
