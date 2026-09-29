/**
 * Ω-REAL P8 certification — the harness that certifies everything else.
 *
 * A harness is the one component whose own failures are invisible: a gate that
 * always passes looks exactly like a healthy system. So every gate here is
 * tested twice — once that it passes on good evidence, and once that it FAILS
 * on evidence that is deliberately broken.
 */

import { describe, it, expect } from 'vitest';
import {
  GOLDEN_CASES,
  GOLDEN_BASELINE,
  runGolden,
  goldenGate,
  digestValues,
} from '../src/harness/golden';
import {
  scoreAbstention,
  abstentionGate,
  verdictOf,
  ABSTENTION_TARGET,
  type AbstentionCase,
} from '../src/harness/abstention';
import { abstentionBattery } from '../src/harness/battery';
import {
  AdaptiveConformal,
  recoveryAfterShift,
  ACI_ALPHA,
  COVERAGE_TARGET,
  RECOVERY_BUDGET,
} from '../src/harness/conformal';
import {
  measureLatency,
  latencyGate,
  percentile,
  PROOF_LATENCY_BUDGET_MS,
} from '../src/harness/latency';
import { certify, coverageGate } from '../src/harness/certify';
import { SeedStream } from '../src/core/determinism';
import { dsin } from '../src/core/dmath';
import { STAT_FLOOR } from '../src/substrate/correlation';
import { GenomeLedger, verifyInclusion, leafBytes, type SealedRecord } from '../src/genome/record';
import { keyPairFromSeed } from '../src/ledger/sth';
import { hashLeaf, fromHex } from '../src/ledger/merkle';

/* ── 1. golden regression set ─────────────────────────────────────────────── */

describe('P8 golden set', () => {
  it('every case matches its frozen digest', () => {
    const g = goldenGate();
    expect(g.drifted).toEqual([]);
    expect(g.unbaselined).toEqual([]);
    expect(g.orphaned).toEqual([]);
    expect(g.pass).toBe(true);
  });

  it('is deterministic across repeated runs', () => {
    const a = runGolden();
    const b = runGolden();
    expect(a.map((r) => r.digest)).toEqual(b.map((r) => r.digest));
  });

  it('detects drift on the exact case that moved', () => {
    const tampered = { ...GOLDEN_BASELINE, 'vsa-algebra': '0000000000000000' };
    const g = goldenGate(tampered);
    expect(g.pass).toBe(false);
    expect(g.drifted.map((d) => d.id)).toEqual(['vsa-algebra']);
  });

  it('fails on an unbaselined case rather than accepting it', () => {
    const extra = [...GOLDEN_CASES, { id: 'new-case', guards: 'x', run: () => [1, 2, 3] }];
    const g = goldenGate(GOLDEN_BASELINE, extra);
    expect(g.pass).toBe(false);
    expect(g.unbaselined).toEqual(['new-case']);
  });

  it('fails on an orphaned baseline entry (a contract with nothing behind it)', () => {
    const g = goldenGate({ ...GOLDEN_BASELINE, ghost: 'deadbeefdeadbeef' });
    expect(g.pass).toBe(false);
    expect(g.orphaned).toEqual(['ghost']);
  });

  it('never collides an abstention with a measured zero', () => {
    expect(digestValues([NaN, 1, 34])).not.toBe(digestValues([0, 1, 34]));
    expect(digestValues([0])).not.toBe(digestValues([-0]));
  });

  it('the under-floor case really abstains everywhere', () => {
    const c = GOLDEN_CASES.find((x) => x.id === 'correlation-underfloor')!;
    const v = c.run();
    // triples of (value, abstained, n): every value NaN, every flag 1
    for (let i = 0; i < v.length; i += 3) {
      expect(Number.isNaN(v[i])).toBe(true);
      expect(v[i + 1]).toBe(1);
      expect(v[i + 2]).toBeLessThan(STAT_FLOOR);
    }
  });
});

/* ── 2. abstention correctness ────────────────────────────────────────────── */

describe('P8 abstention', () => {
  const report = scoreAbstention(abstentionBattery());

  it('classifies null, undefined and non-finite as abstention', () => {
    expect(verdictOf(null)).toBe('abstain');
    expect(verdictOf(undefined)).toBe('abstain');
    expect(verdictOf(NaN)).toBe('abstain');
    expect(verdictOf(Infinity)).toBe('abstain');
    expect(verdictOf(0)).toBe('report');
    expect(verdictOf(-0)).toBe('report');
  });

  it('the standing battery covers both verdicts at real scale', () => {
    expect(report.total).toBeGreaterThanOrEqual(34);
    const abstains = report.outcomes.filter((o) => o.expected === 'abstain').length;
    const reports = report.total - abstains;
    expect(abstains).toBeGreaterThanOrEqual(13);
    expect(reports).toBeGreaterThanOrEqual(13);
  });

  it('meets the ≥95% gate with zero false-confident readings', () => {
    expect(report.threw).toEqual([]);
    expect(report.falseConfident).toEqual([]);
    expect(report.rate).not.toBeNull();
    expect(report.rate!).toBeGreaterThanOrEqual(ABSTENTION_TARGET);
    expect(abstentionGate(report).pass).toBe(true);
  });

  it('every case carries a stated rationale', () => {
    for (const o of report.outcomes) expect(o.rationale.length).toBeGreaterThan(8);
  });

  it('a single false-confident case fails the gate even at a high rate', () => {
    const cases: AbstentionCase[] = [];
    for (let i = 0; i < 99; i++) {
      cases.push({ id: `ok${i}`, expected: 'report', rationale: 'well evidenced', run: () => i });
    }
    cases.push({
      id: 'fabricated',
      expected: 'abstain',
      rationale: 'no evidence',
      run: () => 0.99,
    });
    const r = scoreAbstention(cases);
    expect(r.rate!).toBeGreaterThan(ABSTENTION_TARGET);
    const gate = abstentionGate(r);
    expect(gate.pass).toBe(false);
    expect(gate.reasons.join(' ')).toContain('false-confident');
  });

  it('a throwing estimator is a failure, not a lucky abstention', () => {
    const r = scoreAbstention([
      {
        id: 'boom',
        expected: 'abstain',
        rationale: 'x',
        run: () => {
          throw new Error('kaboom');
        },
      },
    ]);
    expect(r.threw).toEqual(['boom']);
    expect(r.correct).toBe(0);
    expect(r.outcomes[0].threw).toContain('kaboom');
    expect(abstentionGate(r).pass).toBe(false);
  });

  it('an empty battery fails: unrun is not passed', () => {
    const r = scoreAbstention([]);
    expect(r.rate).toBeNull();
    expect(abstentionGate(r).pass).toBe(false);
  });
});

/* ── 3. adaptive conformal coverage ───────────────────────────────────────── */

const SHIFT_AT = 800;
const N_EVENTS = 1600;

function runAci(seed: string, opts?: ConstructorParameters<typeof AdaptiveConformal>[0]) {
  const s = new SeedStream(seed);
  const aci = new AdaptiveConformal(opts);
  for (let t = 0; t < N_EVENTS; t++) {
    const sigma = t < SHIFT_AT ? 1 : 5; // 5× scale shift mid-run
    const pred = dsin(t / 13);
    const truth = pred + (sigma * (s.signed() + s.signed() + s.signed())) / 1.5;
    aci.observe(pred, truth);
  }
  return aci;
}

describe('P8 adaptive conformal', () => {
  const aci = runAci('p8/aci');

  it('abstains until the calibration window clears the sample floor', () => {
    const obs = aci.observations();
    for (let i = 0; i < STAT_FLOOR; i++) {
      expect(obs[i].covered).toBeNull();
      expect(obs[i].lo).toBeNull();
      expect(obs[i].hi).toBeNull();
    }
    expect(obs[STAT_FLOOR].covered).not.toBeNull();
  });

  it('warm-up abstentions are excluded from coverage, not counted as misses', () => {
    const r = aci.report();
    expect(r.abstained).toBe(STAT_FLOOR);
    expect(r.scored + r.abstained).toBe(N_EVENTS);
  });

  it('holds coverage at or above the 0.85 gate over the whole run', () => {
    const r = aci.report();
    expect(r.coverage).not.toBeNull();
    expect(r.coverage!).toBeGreaterThanOrEqual(COVERAGE_TARGET);
  });

  it('recovers coverage within the 100-event budget after a 5× scale shift', () => {
    const rec = recoveryAfterShift(aci.observations(), SHIFT_AT);
    expect(rec.recoveredAfter).not.toBeNull();
    expect(rec.recoveredAfter!).toBeLessThanOrEqual(RECOVERY_BUDGET);
    expect(rec.withinBudget).toBe(true);
    expect(rec.settledCoverage!).toBeGreaterThanOrEqual(COVERAGE_TARGET);
  });

  it('widens the interval after the shift instead of pretending it did not happen', () => {
    const pre = aci.report(0).meanWidth!;
    const post = aci.report(SHIFT_AT + 200).meanWidth!;
    expect(post).toBeGreaterThan(pre);
  });

  it('is bit-deterministic on replay', () => {
    const a = runAci('p8/aci')
      .observations()
      .map((o) => `${o.score}|${o.halfWidth}|${o.covered}`);
    const b = runAci('p8/aci')
      .observations()
      .map((o) => `${o.score}|${o.halfWidth}|${o.covered}`);
    expect(a).toEqual(b);
  });

  it('the α recursion is what recovers: a frozen level does strictly worse', () => {
    // γ → 0 disables adaptation, leaving a plain fixed-α split-conformal.
    const frozen = runAci('p8/aci', { gamma: 1e-12 });
    const adaptive = recoveryAfterShift(aci.observations(), SHIFT_AT);
    const fixed = recoveryAfterShift(frozen.observations(), SHIFT_AT);
    expect(Math.abs(frozen.currentAlpha() - ACI_ALPHA)).toBeLessThan(1e-6);
    const adaptiveN = adaptive.recoveredAfter ?? Number.POSITIVE_INFINITY;
    const fixedN = fixed.recoveredAfter ?? Number.POSITIVE_INFINITY;
    expect(adaptiveN).toBeLessThanOrEqual(fixedN);
    expect(adaptive.tailCoverage!).toBeGreaterThanOrEqual(fixed.tailCoverage!);
  });

  it('rejects impossible configuration instead of silently clamping', () => {
    expect(() => new AdaptiveConformal({ alpha: 0 })).toThrow();
    expect(() => new AdaptiveConformal({ alpha: 1 })).toThrow();
    expect(() => new AdaptiveConformal({ gamma: 0 })).toThrow();
  });

  it('non-finite events abstain and never poison the calibration window', () => {
    const a = new AdaptiveConformal({ floor: 5, window: 50 });
    for (let i = 0; i < 20; i++) a.observe(0, (i % 5) * 0.1);
    const before = a.calibrationSize();
    const o = a.observe(0, NaN);
    expect(o.covered).toBeNull();
    expect(a.calibrationSize()).toBe(before);
    expect(a.halfWidth()).not.toBeNull();
  });

  it('a systematically biased predictor fails the coverage gate', () => {
    const s = new SeedStream('p8/biased');
    const a = new AdaptiveConformal({ window: 100 });
    for (let t = 0; t < 400; t++) a.observe(0, s.signed());
    // Truth ramps away without bound: no past quantile can ever catch a
    // residual that is larger than every residual before it. Conformal
    // widening absorbs a step change; it cannot absorb a runaway, and the
    // gate must say so instead of quietly widening forever.
    for (let t = 0; t < 400; t++) a.observe(0, 5 * (t + 1) + s.signed());
    const gate = coverageGate(a.observations(), a.report(400), 400);
    expect(gate.pass).toBe(false);
  });
});

/* ── 4. proof latency ─────────────────────────────────────────────────────── */

describe('P8 proof latency', () => {
  const ledger = new GenomeLedger(
    'p8-log',
    new Uint8Array(32).fill(7),
    keyPairFromSeed(new Uint8Array(32).fill(5)),
  );
  const recs: SealedRecord[] = [];
  for (let i = 0; i < 1024; i++) {
    const id = `rec-${i}`;
    recs.push(
      ledger.append({
        id,
        kind: 'Episode',
        body: { i, note: `event ${i}` },
        recordedAt: 1000 + i,
        provenance: { attributedTo: 'p8', generatedBy: 'latency', evidence: 'measured' },
      }),
    );
  }

  it('percentile is nearest-rank and abstains on empty input', () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
    expect(percentile([5, 1, 3], 1)).toBe(1);
  });

  it('generate+verify over a 1024-leaf log stays under the 100 ms p95 budget', () => {
    const r = measureLatency('inclusion-proof', 256, (i) => {
      const rec = recs[(i * 37) % recs.length];
      const ev = ledger.prove(rec.header.id, 2000 + i);
      if (!ev) return false;
      // The verifier recomputes the leaf from the record's own bytes; it never
      // takes the log's word for what was committed.
      const leaf = hashLeaf(leafBytes(rec.header, rec.sealed));
      return verifyInclusion(
        leaf,
        ev.leafIndex,
        ev.treeSize,
        ev.proofHex.map(fromHex),
        fromHex(ev.rootHex),
      );
    });
    expect(r.failures).toBe(0);
    expect(latencyGate(r).pass).toBe(true);
    expect(r.p95!).toBeLessThan(PROOF_LATENCY_BUDGET_MS);
  });

  it('a full self-audit of 1024 records still verifies', () => {
    const a = ledger.audit(3000);
    expect(a.failures).toEqual([]);
    expect(a.checked).toBe(1024);
    expect(a.ok).toBe(true);
  });

  it('counts a failing operation as a failure, not a fast pass', () => {
    const r = measureLatency('always-false', 10, () => false);
    expect(r.failures).toBe(10);
    expect(r.p95).toBeNull();
    expect(latencyGate(r).pass).toBe(false);
  });

  it('a throwing operation cannot flatter the percentiles', () => {
    const r = measureLatency('throws', 5, () => {
      throw new Error('x');
    });
    expect(r.failures).toBe(5);
    expect(latencyGate(r).pass).toBe(false);
  });

  it('a slow proof fails the budget under an injected clock', () => {
    let t = 0;
    const r = measureLatency(
      'slow',
      10,
      () => true,
      () => (t += 60),
    );
    expect(r.p95!).toBe(60);
    expect(latencyGate(r, 50).pass).toBe(false);
  });
});

/* ── 5. the composed certificate ──────────────────────────────────────────── */

describe('P8 certification', () => {
  const aci = runAci('p8/cert');
  const abst = scoreAbstention(abstentionBattery());
  const good = measureLatency(
    'proof',
    8,
    () => true,
    (() => {
      let t = 0;
      return () => (t += 1);
    })(),
  );

  const input = {
    abstention: abst,
    observations: aci.observations(),
    coverage: aci.report(),
    shiftAt: SHIFT_AT,
    proofLatency: good,
  };

  it('passes with every gate measured and green', () => {
    const c = certify(input);
    expect(c.reasons).toEqual([]);
    expect(c.pass).toBe(true);
    expect(c.golden.pass && c.abstention.pass && c.coverage.pass && c.latency.pass).toBe(true);
  });

  it('fails when abstention regresses, and names the gate', () => {
    const broken = scoreAbstention([
      ...abstentionBattery(),
      { id: 'fab', expected: 'abstain', rationale: 'nothing', run: () => 1 },
    ]);
    const c = certify({ ...input, abstention: broken });
    expect(c.pass).toBe(false);
    expect(c.reasons.some((r) => r.startsWith('abstention:'))).toBe(true);
  });

  it('fails when coverage regresses, and names the gate', () => {
    const c = certify({ ...input, coverage: { ...input.coverage, coverage: 0.4 } });
    expect(c.pass).toBe(false);
    expect(c.reasons.some((r) => r.startsWith('coverage:'))).toBe(true);
  });

  it('fails when proof latency regresses, and names the gate', () => {
    let t = 0;
    const slow = measureLatency(
      'slow',
      4,
      () => true,
      () => (t += 250),
    );
    const c = certify({ ...input, proofLatency: slow });
    expect(c.pass).toBe(false);
    expect(c.reasons.some((r) => r.startsWith('latency:'))).toBe(true);
  });

  it('fails when the coverage evidence is missing entirely', () => {
    const c = certify({
      ...input,
      observations: [],
      coverage: { ...input.coverage, coverage: null, scored: 0 },
    });
    expect(c.pass).toBe(false);
    expect(c.reasons.some((r) => r.includes('unmeasured'))).toBe(true);
  });
});
