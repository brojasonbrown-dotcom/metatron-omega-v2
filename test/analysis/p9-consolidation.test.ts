/**
 * Ω-P9.4 certification — findings become a consolidated, swept corpus.
 *
 * The properties that matter are not "the sweeps ran": they are that ingest
 * preserves evidence semantics (abstentions never become facts, NaN trust is
 * never 0), that every atom stays openable and provable, and that a failing
 * sweep is reported rather than hidden.
 */

import { describe, expect, it } from 'vitest';
import {
  FindingConsolidator,
  findingVector,
  levelHv,
  effectEstimates,
  rescoreInputs,
  sweepLines,
  FINDING_DIM,
} from '@/core/analysis/consolidation';
import type { PairFinding, SpineReport } from '@/core/analysis/analysisSpine';
import { similarity } from '@metatron/trnn-core/substrate/vsa';

const seed = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);

function corr(p: number, s: number, d: number, mi: number) {
  return {
    n: 128,
    pearson: { value: p },
    spearman: { value: s },
    dcor: { value: d },
    mi: { value: mi },
  } as unknown as PairFinding['correlation'];
}

function finding(a: string, b: string, over: Partial<PairFinding> = {}): PairFinding {
  return {
    a,
    b,
    n: 128,
    unmatched: 0,
    toleranceMs: 32,
    verdict: 'report',
    correlation: corr(0.8, 0.78, 0.7, 0.4),
    causal: null,
    association: 0.72,
    bus: null,
    direction: 0.5,
    directionVerdict: 'a→b' as PairFinding['directionVerdict'],
    ...over,
  };
}

function report(findings: PairFinding[]): SpineReport {
  const reported = findings.filter((f) => f.verdict === 'report').length;
  return {
    findings,
    reported,
    abstained: findings.length - reported,
    skipped: 0,
    strongest: findings.find((f) => f.verdict === 'report') ?? null,
  };
}

describe('P9.4 encoding', () => {
  it('encodes findings at full width and merges quantised duplicates', () => {
    const v1 = findingVector(finding('x', 'y'));
    const v2 = findingVector(finding('x', 'y', { association: 0.721 }));
    expect(v1.length).toBe(FINDING_DIM);
    expect(similarity(v1, v2)).toBeGreaterThan(0.99);
  });

  it('separates distinct pairs far below any consolidation threshold', () => {
    const s = similarity(findingVector(finding('x', 'y')), findingVector(finding('p', 'q')));
    expect(Math.abs(s)).toBeLessThan(0.4);
  });

  it('gives unmeasured slots their own atom rather than a zero level', () => {
    const un = levelHv('mi', null);
    const zero = levelHv('mi', 0);
    expect(similarity(un, zero)).toBeLessThan(0.4);
  });
});

describe('P9.4 ingest', () => {
  it('ingests reported findings only — abstentions are not facts', () => {
    const c = new FindingConsolidator(seed);
    const r = c.ingest(
      report([
        finding('a', 'b'),
        finding('c', 'd', { verdict: 'abstain', reason: 'n below floor', association: null }),
      ]),
      1000,
    );
    expect(r.added).toBe(1);
    expect(c.size).toBe(1);
  });

  it('supersedes the previous atom for the same pair, keeping both sealed', () => {
    const c = new FindingConsolidator(seed);
    c.ingest(report([finding('a', 'b')]), 1000);
    const r = c.ingest(report([finding('a', 'b', { association: 0.4 })]), 2000);
    expect(r.superseded).toBe(1);
    expect(c.size).toBe(2);
    expect(c.corpus.open().length).toBe(1);
  });

  it('records a direction reversal as an explicit contradiction', () => {
    const c = new FindingConsolidator(seed);
    c.ingest(report([finding('a', 'b', { direction: 0.6 })]), 1000);
    const r = c.ingest(report([finding('a', 'b', { direction: -0.6 })]), 2000);
    expect(r.contradictions).toBe(1);
    expect(c.corpus.items[1].contradicts).toEqual([c.corpus.items[0].id]);
  });

  it('carries NaN trust for an association-free finding, never 0', () => {
    const c = new FindingConsolidator(seed);
    c.ingest(report([finding('a', 'b', { association: null })]), 1000);
    expect(Number.isNaN(c.corpus.items[0].trust)).toBe(true);
  });
});

describe('P9.4 sweeps', () => {
  const build = () => {
    const c = new FindingConsolidator(seed);
    const rep = report([
      finding('engine.energy', 'memory.surprise'),
      finding('sense.arousal', 'engine.tickRate', { association: 0.31, direction: -0.2 }),
    ]);
    c.ingest(rep, 1000);
    return { c, rep };
  };

  it('runs all ten sweeps and seals each one', () => {
    const { c, rep } = build();
    const res = c.run(rep, 2000);
    expect(res.reports.length).toBe(10);
    expect(res.sealedTo - res.sealedFrom).toBeGreaterThanOrEqual(10);
    for (const line of sweepLines(res)) expect(line.sealId).toMatch(/^sweep:0:\d+$/);
  });

  it('replays every atom out of the ledger (sweep 1 clean)', () => {
    const { c, rep } = build();
    const m = c.run(rep, 2000).reports[0].metric as { total: number; replayed: number };
    expect(m.total).toBe(2);
    expect(m.replayed).toBe(2);
  });

  it('verifies every genuine atom against the live root (sweep 8)', () => {
    const { c, rep } = build();
    const m = c.run(rep, 2000).reports.find((r) => r.n === 8)!.metric as {
      genuine: number;
      genuineVerified: number;
      accepted: readonly string[];
    };
    expect(m.genuine).toBe(m.genuineVerified);
    expect(m.accepted).toEqual([]);
  });

  it('reflection agrees with the individual sweep verdicts', () => {
    const { c, rep } = build();
    const res = c.run(rep, 2000);
    const m = res.reports[9].metric as {
      sweepsOk: number;
      sweepsTotal: number;
      failed: readonly string[];
    };
    const first9 = res.reports.slice(0, 9);
    expect(m.sweepsTotal).toBe(9);
    expect(m.sweepsOk).toBe(first9.filter((r) => r.ok).length);
    expect(m.failed).toEqual(first9.filter((r) => !r.ok).map((r) => `${r.n}:${r.name}`));
  });

  it('stays deterministic across two identical consolidators', () => {
    const a = build();
    const b = build();
    const ra = a.c.run(a.rep, 2000);
    const rb = b.c.run(b.rep, 2000);
    expect(a.c.summary(3000).rootHex).toBe(b.c.summary(3000).rootHex);
    expect(ra.reports.map((r) => r.ok)).toEqual(rb.reports.map((r) => r.ok));
  });

  it('reports cross-level resonance instead of a confident zero', () => {
    const { c, rep } = build();
    const inputs = rescoreInputs(rep);
    expect(inputs.length).toBe(2);
    const m = c.run(rep, 2000).reports.find((r) => r.n === 7)!.metric as {
      items: number;
      rMean: number | null;
    };
    expect(m.items).toBe(2);
    expect(m.rMean === null || (m.rMean > 0 && m.rMean <= 1)).toBe(true);
  });

  it('derives effect estimates only where a direction was measured', () => {
    const est = effectEstimates(
      report([finding('a', 'b'), finding('c', 'd', { direction: null })]),
    );
    expect(Object.keys(est)).toEqual(['a|b']);
    expect(est['a|b'].se).toBeCloseTo(1 / Math.sqrt(128), 12);
  });

  it('empty corpus: sweeps still run and report nothing measured', () => {
    const c = new FindingConsolidator(seed);
    const res = c.run(null, 500);
    expect(res.reports.length).toBe(10);
    const m5 = res.reports[4].metric as { residualCos: number | null };
    expect(m5.residualCos).toBeNull();
  });
});
