/**
 * Ω-REAL P8 — proof latency.
 *
 * Auditability is only real if it is affordable. An inclusion proof that takes
 * a second is a proof nobody runs, and an unrun proof is not evidence. The gate
 * is p95 < 100 ms per proof, measured end to end (generate + verify) against a
 * ledger of realistic depth.
 *
 * The clock is injected. Benchmarks that read the wall clock directly cannot be
 * replayed, and a benchmark that cannot be replayed cannot be regressed against.
 */

/** p95 budget in milliseconds for one generate+verify round trip. */
export const PROOF_LATENCY_BUDGET_MS = 100;

export type Clock = () => number;

const defaultClock: Clock = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export interface LatencySample {
  readonly label: string;
  readonly ms: number;
  /** Whether the operation reported success; a fast failure is not a pass. */
  readonly ok: boolean;
}

export interface LatencyReport {
  readonly label: string;
  readonly runs: number;
  readonly failures: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly max: number | null;
  readonly mean: number | null;
}

/** Nearest-rank percentile over a sorted copy; empty input yields null. */
export function percentile(xs: readonly number[], p: number): number | null {
  const s = [...xs].filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const k = Math.min(s.length, Math.max(1, Math.ceil((p / 100) * s.length)));
  return s[k - 1];
}

/**
 * Time `op` over `runs` iterations. `op` returns whether the operation
 * succeeded; a false return is counted as a failure and excluded from the
 * timing distribution so a crash-fast path cannot flatter the percentiles.
 */
export function measureLatency(
  label: string,
  runs: number,
  op: (i: number) => boolean,
  clock: Clock = defaultClock,
): LatencyReport {
  const times: number[] = [];
  let failures = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = clock();
    let ok = false;
    try {
      ok = op(i);
    } catch {
      ok = false;
    }
    const dt = clock() - t0;
    if (ok) times.push(dt);
    else failures++;
  }
  const mean = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null;
  return {
    label,
    runs,
    failures,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    max: percentile(times, 100),
    mean,
  };
}

export interface LatencyGate {
  readonly pass: boolean;
  readonly p95: number | null;
  readonly budgetMs: number;
  readonly reasons: readonly string[];
}

export function latencyGate(r: LatencyReport, budgetMs = PROOF_LATENCY_BUDGET_MS): LatencyGate {
  const reasons: string[] = [];
  if (r.failures > 0) reasons.push(`${r.failures}/${r.runs} operations failed`);
  if (r.p95 === null)
    reasons.push('no successful timed run: an unmeasured gate is not a passed gate');
  else if (r.p95 >= budgetMs) reasons.push(`p95 ${r.p95.toFixed(3)} ms ≥ budget ${budgetMs} ms`);
  return { pass: reasons.length === 0, p95: r.p95, budgetMs, reasons };
}
