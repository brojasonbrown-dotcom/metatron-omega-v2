/**
 * Ω-CORPUS — public barrel and the process-wide singleton.
 *
 * The singleton is created lazily with the host's best blob store, so a test
 * that never touches it never opens IndexedDB or OPFS.
 */

export * from './types';
export * from './storage';
export { HotCache, hotCapacityFor, HOT_SHARE } from './HotCache';
export { WarmShards, DEFAULT_SHARD_FRAMES, type ShardIndexEntry } from './WarmShards';
export {
  ColdArchive,
  compactFrame,
  isRefusal,
  COLD_WIDTH,
  COLD_WIDTH_LADDER,
  narrowerWidth,
  DEFAULT_SEGMENT_SHARDS,
  QUOTA_GUARD,
  type SegmentIndexEntry,
  type ColdResult,
  type ColdRefusal,
} from './ColdArchive';
export {
  CorpusLedger,
  CORPUS_LOG_ID,
  type SealRecord,
  type SealedEntry,
  type ProofCarrying,
} from './CorpusLedger';
export { recall, type RecallQuery, type RecallResult } from './CorpusRecall';
export { Corpus, type CorpusOptions, type CorpusStats } from './Corpus';

import { Corpus } from './Corpus';

/** Warm tier width — the decimated frame the policy already assumes. */
export const CORPUS_WIDTH = 233;

let singleton: Corpus | null = null;

export function getCorpus(): Corpus {
  if (!singleton) singleton = new Corpus({ width: CORPUS_WIDTH });
  return singleton;
}
