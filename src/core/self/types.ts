/**
 * Ω-SELF — the shared vocabulary for self-description.
 *
 * Every fact the system reports about itself carries a liveness state. A
 * module that exists in the codebase but is not running is `dormant`, not
 * "available"; a module whose handle is missing entirely is `absent`. Nothing
 * here fabricates a value: when a probe cannot read a metric it reports null.
 */

export type LiveState = 'live' | 'dormant' | 'absent' | 'stale';

export interface SelfMetric {
  label: string;
  /** null means "not measurable right now" — never a placeholder number */
  value: number | string | null;
  unit?: string;
}

export interface SelfModule {
  /** stable dotted id, e.g. `engine.field` */
  id: string;
  title: string;
  /** what this module is SUPPOSED to do */
  purpose: string;
  /** the invariant it must satisfy to be considered correct */
  contract: string;
  state: LiveState;
  /** one line of evidence for the state above */
  detail: string;
  /** where the probe read from (module path / runtime handle) */
  source: string;
  metrics: SelfMetric[];
  /** true when a deterministic self-test exists for this module */
  testable: boolean;
  /** cheap tests run pre-turn; heavy tests only on request */
  cost: 'cheap' | 'heavy';
}

export interface SelfRegistry {
  builtAt: number;
  modules: SelfModule[];
  counts: { live: number; dormant: number; absent: number; stale: number };
}

export interface SelfTestResult {
  /** module id this assertion belongs to */
  id: string;
  name: string;
  passed: boolean;
  /** what was measured, verbatim */
  measured: string;
  /** what had to hold for a pass */
  expected: string;
  ms: number;
}

export interface SelfTestRun {
  at: number;
  scope: string;
  results: SelfTestResult[];
  passed: number;
  failed: number;
  ms: number;
}

export function summarise(modules: SelfModule[]): SelfRegistry['counts'] {
  const counts = { live: 0, dormant: 0, absent: 0, stale: 0 };
  for (const m of modules) counts[m.state]++;
  return counts;
}
