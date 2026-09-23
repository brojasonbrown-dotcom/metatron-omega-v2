/**
 * Ω-REAL P8 — the standing abstention battery.
 *
 * Real estimators, real inputs, and a stated expectation for each: does this
 * input contain enough evidence to justify a number, or does it not? The
 * battery is exported (not test-local) so a running build can re-prove its own
 * epistemic hygiene, not just CI.
 *
 * Every "abstain" case is under-evidenced for a *specific, named* reason —
 * below the F9 paired-sample floor, degenerate variance, empty input, too few
 * snapshots, an incoherent field. None of them are merely awkward numbers.
 */

import { SeedStream } from '../core/determinism';
import { PHI } from '../core/constants';
import { dsin, dcos, dpow } from '../core/dmath';
import {
  pearson, spearman, kendallTauB, distanceCorrelation, hsic, gaussianMI,
  type StatResult,
} from '../substrate/correlation';
import { grangerCausality, transferEntropyGaussian } from '../substrate/causal';
import { fuseResonance, circularPhaseDev, phaseClosureGamma } from '../substrate/resonanceBus';
import { randomHv, bundle, similarity, CleanupMemory, bind } from '../substrate/vsa';
import { fitDmd, MIN_SNAPSHOTS } from '../substrate/dmd';
import type { AbstentionCase } from './abstention';

const val = (r: StatResult) => r.value;

/** Deterministic coupled pair — same generator the golden set uses. */
export function pair(n: number, seed: string): { x: Float64Array; y: Float64Array } {
  const s = new SeedStream(seed);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    x[i] = dsin(i / PHI) + 0.35 * s.signed();
    prev = 0.55 * prev + 0.45 * (i > 0 ? x[i - 1] : 0) + 0.2 * s.signed();
    y[i] = prev;
  }
  return { x, y };
}

const FAM: readonly [string, (x: ArrayLike<number>, y: ArrayLike<number>) => StatResult][] = [
  ['pearson', pearson], ['spearman', spearman], ['kendall', kendallTauB],
  ['dcor', distanceCorrelation], ['hsic', hsic], ['mi', gaussianMI],
];

export function abstentionBattery(): AbstentionCase[] {
  const cases: AbstentionCase[] = [];
  const big = pair(233, 'batt/big');
  const small = pair(21, 'batt/small');
  const flat = new Float64Array(233); // zero variance: correlation is undefined

  for (const [name, fn] of FAM) {
    cases.push({
      id: `${name}/n233`, expected: 'report',
      rationale: '233 paired samples, above the F9 floor, genuine dependence',
      run: () => val(fn(big.x, big.y)),
    });
    cases.push({
      id: `${name}/n21`, expected: 'abstain',
      rationale: '21 paired samples — below the F9 floor of 34',
      run: () => val(fn(small.x, small.y)),
    });
    cases.push({
      id: `${name}/degenerate`, expected: 'abstain',
      rationale: 'constant series: correlation with a zero-variance variable is undefined',
      run: () => val(fn(big.x, flat)),
    });
    cases.push({
      id: `${name}/empty`, expected: 'abstain',
      rationale: 'no samples at all',
      run: () => val(fn(new Float64Array(0), new Float64Array(0))),
    });
  }

  const causal = pair(377, 'batt/causal');
  const causalSmall = pair(20, 'batt/causal-small');
  for (const lag of [1, 2]) {
    cases.push({
      id: `granger/lag${lag}`, expected: 'report',
      rationale: 'x drives y at unit lag over 377 samples',
      run: () => grangerCausality(causal.x, causal.y, lag).value,
    });
    cases.push({
      id: `te/lag${lag}`, expected: 'report',
      rationale: 'Gaussian transfer entropy on the same driven pair',
      run: () => transferEntropyGaussian(causal.x, causal.y, lag).value,
    });
  }
  cases.push({
    id: 'granger/short', expected: 'abstain',
    rationale: 'n − lag falls under the paired-sample floor',
    run: () => grangerCausality(causalSmall.x, causalSmall.y, 1).value,
  });
  cases.push({
    id: 'granger/lag-eats-sample', expected: 'abstain',
    rationale: 'lag 300 of 377 leaves too few rows to fit',
    run: () => grangerCausality(causal.x, causal.y, 350).value,
  });
  cases.push({
    id: 'te/short', expected: 'abstain',
    rationale: 'transfer entropy inherits the Granger abstention',
    run: () => transferEntropyGaussian(causalSmall.x, causalSmall.y, 1).value,
  });

  const phases = [0.1, 0.2, 0.12, 0.31, 0.05];
  cases.push({
    id: 'phase/locked', expected: 'report',
    rationale: 'five near-locked phases give a defined circular deviation',
    run: () => circularPhaseDev(phases),
  });
  cases.push({
    id: 'phase/single', expected: 'abstain',
    rationale: 'one phase has no deviation to measure',
    run: () => circularPhaseDev([0.4]),
  });
  cases.push({
    id: 'gamma/unmeasured-dev', expected: 'abstain',
    rationale: 'γ of an unmeasured phase deviation is unknown, not 1',
    run: () => phaseClosureGamma(NaN),
  });
  cases.push({
    id: 'gamma/total-scatter', expected: 'report',
    rationale: 'infinite deviation is a MEASURED total scatter: γ = 0 is a reading',
    run: () => phaseClosureGamma(Number.POSITIVE_INFINITY),
  });

  const chans = [{ id: 'a', value: 0.9 }, { id: 'b', value: 0.6 }];
  cases.push({
    id: 'bus/measured', expected: 'report',
    rationale: 'two measured channels fuse to a defined resonance',
    run: () => fuseResonance(chans).value,
  });
  cases.push({
    id: 'bus/all-abstain', expected: 'abstain',
    rationale: 'every channel abstained: there is nothing to average',
    run: () => fuseResonance([{ id: 'a', value: NaN }, { id: 'b', value: NaN }]).value,
  });
  cases.push({
    id: 'bus/veto-zero', expected: 'report',
    rationale: 'a measured zero is a hard 0 reading, not an absence of evidence',
    run: () => fuseResonance([...chans, { id: 'dead', value: 0 }]).value,
  });
  cases.push({
    id: 'bus/gated', expected: 'abstain',
    rationale: 'field coherence below the φ⁻² gate: the fusion is not believable',
    run: () => fuseResonance(chans, { coherence: 0.05 }).value,
  });

  const dim = 1024;
  const a = randomHv(dim, 'batt/a');
  const b = randomHv(dim, 'batt/b');
  cases.push({
    id: 'vsa/similarity', expected: 'report',
    rationale: 'two hypervectors always have a defined similarity',
    run: () => similarity(a, b),
  });
  cases.push({
    id: 'vsa/empty-bundle', expected: 'abstain',
    rationale: 'the agreement of an empty superposition is undefined',
    run: () => bundle([]).meanAgreement,
  });

  const mem = new CleanupMemory(dim);
  mem.add('a', a); mem.add('b', b);
  cases.push({
    id: 'cleanup/exact', expected: 'report',
    rationale: 'an exact stored vector clears the 5σ chance floor',
    run: () => mem.query(a)?.similarity ?? null,
  });
  cases.push({
    id: 'cleanup/noise', expected: 'abstain',
    rationale: 'an unrelated vector is chance-level: naming a winner would be fabrication',
    run: () => mem.query(bind(randomHv(dim, 'batt/noise'), randomHv(dim, 'batt/noise2')))?.similarity ?? null,
  });
  cases.push({
    id: 'cleanup/empty-store', expected: 'abstain',
    rationale: 'an empty cleanup memory cannot name anything',
    run: () => new CleanupMemory(dim).query(a)?.similarity ?? null,
  });

  const snaps: Float64Array[] = [];
  for (let t = 0; t < 60; t++) {
    const v = new Float64Array(8);
    for (let i = 0; i < 8; i++) v[i] = dcos(0.21 * t + i) * dpow(0.995, t);
    snaps.push(v);
  }
  cases.push({
    id: 'dmd/oscillatory', expected: 'report',
    rationale: '60 snapshots of a decaying oscillation: growth rate is identifiable',
    run: () => fitDmd(snaps)?.modes[0]?.growth ?? null,
  });
  cases.push({
    id: 'dmd/too-few', expected: 'abstain',
    rationale: `fewer than ${MIN_SNAPSHOTS} snapshots cannot identify a mode`,
    run: () => fitDmd(snaps.slice(0, MIN_SNAPSHOTS - 1))?.modes[0]?.growth ?? null,
  });

  return cases;
}
