/**
 * Ω-REAL P8 — abstention correctness.
 *
 * Every estimator in the substrate is allowed to say "I don't know". The gate
 * that matters is not accuracy, it is *whether the silence is in the right
 * place*: an estimator that reports a confident number from 9 samples is the
 * failure mode this whole programme exists to remove.
 *
 * Two error classes, deliberately not symmetric:
 *   false-confident — a number was reported where the evidence does not
 *                     support one. Budget: ZERO. This is the class that puts a
 *                     fabricated reading on a dashboard.
 *   false-silent    — abstained where a measurement was available. Wasteful,
 *                     not dangerous; counted against the ≥95% rate.
 */

export type Verdict = 'report' | 'abstain';

/**
 * A case is a thunk so a battery can be replayed. Return `null`, `undefined`
 * or any non-finite number to abstain; anything else is a report.
 */
export interface AbstentionCase {
  readonly id: string;
  /** What a correct estimator must do with this input. */
  readonly expected: Verdict;
  /** Why this case is a legitimate abstention/report — kept in the report. */
  readonly rationale: string;
  readonly run: () => number | null | undefined;
}

export interface AbstentionOutcome {
  readonly id: string;
  readonly expected: Verdict;
  readonly actual: Verdict;
  readonly correct: boolean;
  /** Reported value, or null when it abstained. */
  readonly value: number | null;
  readonly rationale: string;
  /** Thrown errors are failures, never silently an abstention. */
  readonly threw: string | null;
}

export interface AbstentionReport {
  readonly total: number;
  readonly correct: number;
  /** correct / total, or null for an empty battery (not 1). */
  readonly rate: number | null;
  readonly falseConfident: readonly string[];
  readonly falseSilent: readonly string[];
  readonly threw: readonly string[];
  readonly outcomes: readonly AbstentionOutcome[];
}

/** Normalise an estimator return into a verdict. */
export function verdictOf(v: number | null | undefined): Verdict {
  return v === null || v === undefined || !Number.isFinite(v) ? 'abstain' : 'report';
}

/**
 * Run a battery. A throwing case is recorded as a failure with its message —
 * catching it as an abstention would let a crash masquerade as good judgement.
 */
export function scoreAbstention(cases: readonly AbstentionCase[]): AbstentionReport {
  const outcomes: AbstentionOutcome[] = [];
  const falseConfident: string[] = [];
  const falseSilent: string[] = [];
  const threw: string[] = [];

  for (const c of cases) {
    let value: number | null = null;
    let actual: Verdict = 'abstain';
    let err: string | null = null;
    try {
      const v = c.run();
      actual = verdictOf(v);
      value = actual === 'report' ? (v as number) : null;
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      threw.push(c.id);
    }

    const correct = err === null && actual === c.expected;
    if (err === null && !correct) {
      if (c.expected === 'abstain') falseConfident.push(c.id);
      else falseSilent.push(c.id);
    }
    outcomes.push({
      id: c.id, expected: c.expected, actual, correct, value,
      rationale: c.rationale, threw: err,
    });
  }

  const correct = outcomes.reduce((a, o) => a + (o.correct ? 1 : 0), 0);
  return {
    total: cases.length,
    correct,
    rate: cases.length > 0 ? correct / cases.length : null,
    falseConfident, falseSilent, threw, outcomes,
  };
}

/** Rate a certified build must reach. */
export const ABSTENTION_TARGET = 0.95;

export interface AbstentionGate {
  readonly pass: boolean;
  readonly rate: number | null;
  readonly reasons: readonly string[];
}

/** Gate: rate ≥ target AND zero false-confident AND zero throws. */
export function abstentionGate(
  r: AbstentionReport,
  target = ABSTENTION_TARGET,
): AbstentionGate {
  const reasons: string[] = [];
  if (r.rate === null) reasons.push('empty battery: an unrun gate is not a passed gate');
  else if (r.rate < target) reasons.push(`rate ${r.rate.toFixed(4)} < target ${target}`);
  if (r.falseConfident.length > 0) {
    reasons.push(`false-confident (zero budget): ${r.falseConfident.join(', ')}`);
  }
  if (r.threw.length > 0) reasons.push(`threw: ${r.threw.join(', ')}`);
  return { pass: reasons.length === 0, rate: r.rate, reasons };
}
