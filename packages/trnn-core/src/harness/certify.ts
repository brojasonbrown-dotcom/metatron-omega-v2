/**
 * Ω-REAL P8 — the certification gate.
 *
 * One report, four independent gates, and a single boolean that is true only
 * when every gate is measured AND passing. Nothing here defaults to pass: a
 * gate with no evidence behind it fails, because "we did not measure it" and
 * "it is fine" are the two states this programme refuses to conflate.
 */

import { goldenGate, type GoldenGate } from './golden';
import { abstentionGate, type AbstentionGate, type AbstentionReport } from './abstention';
import {
  recoveryAfterShift,
  COVERAGE_TARGET,
  RECOVERY_BUDGET,
  type AciObservation,
  type CoverageReport,
  type RecoveryReport,
} from './conformal';
import { latencyGate, type LatencyGate, type LatencyReport } from './latency';

export interface CoverageGate {
  readonly pass: boolean;
  readonly coverage: number | null;
  readonly target: number;
  readonly recovery: RecoveryReport;
  readonly reasons: readonly string[];
}

export function coverageGate(
  observations: readonly AciObservation[],
  overall: CoverageReport,
  shiftAt: number,
  target = COVERAGE_TARGET,
  budget = RECOVERY_BUDGET,
): CoverageGate {
  const recovery = recoveryAfterShift(observations, shiftAt, target, budget);
  const reasons: string[] = [];
  if (overall.coverage === null) reasons.push('no scored events: coverage unmeasured');
  else if (overall.coverage < target) {
    reasons.push(`coverage ${overall.coverage.toFixed(4)} < target ${target}`);
  }
  if (!recovery.withinBudget) {
    reasons.push(
      recovery.recoveredAfter === null
        ? `coverage never returned to ${target} after the shift`
        : `recovery took ${recovery.recoveredAfter} events > budget ${budget}`,
    );
  }
  return { pass: reasons.length === 0, coverage: overall.coverage, target, recovery, reasons };
}

export interface CertificationInput {
  readonly abstention: AbstentionReport;
  readonly observations: readonly AciObservation[];
  readonly coverage: CoverageReport;
  readonly shiftAt: number;
  readonly proofLatency: LatencyReport;
}

export interface CertificationReport {
  readonly pass: boolean;
  readonly golden: GoldenGate;
  readonly abstention: AbstentionGate;
  readonly coverage: CoverageGate;
  readonly latency: LatencyGate;
  /** Every failing reason, prefixed by its gate. Empty iff pass. */
  readonly reasons: readonly string[];
}

export function certify(input: CertificationInput): CertificationReport {
  const golden = goldenGate();
  const abst = abstentionGate(input.abstention);
  const cov = coverageGate(input.observations, input.coverage, input.shiftAt);
  const lat = latencyGate(input.proofLatency);

  const reasons: string[] = [];
  for (const d of golden.drifted)
    reasons.push(`golden/${d.id}: digest ${d.actual} ≠ ${d.expected}`);
  for (const u of golden.unbaselined) reasons.push(`golden/${u}: not baselined`);
  for (const o of golden.orphaned) reasons.push(`golden/${o}: baseline has no case`);
  for (const r of abst.reasons) reasons.push(`abstention: ${r}`);
  for (const r of cov.reasons) reasons.push(`coverage: ${r}`);
  for (const r of lat.reasons) reasons.push(`latency: ${r}`);

  return {
    pass: golden.pass && abst.pass && cov.pass && lat.pass,
    golden,
    abstention: abst,
    coverage: cov,
    latency: lat,
    reasons,
  };
}
