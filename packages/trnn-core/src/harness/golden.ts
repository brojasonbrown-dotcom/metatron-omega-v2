/**
 * Ω-REAL P8 — the golden regression set.
 *
 * Each case pins one estimator family to a fixed, seeded input and digests its
 * output vector. The digest is the contract: any change in the numbers a
 * certified estimator produces shows up as a digest break, on the exact case,
 * in the exact test run — not as a slow drift somebody notices on a dashboard
 * three phases later.
 *
 * Rules for this file (they are what make the digests worth anything):
 *   - inputs come from `SeedStream`, never `Math.random`, never a clock;
 *   - abstentions are digested as a distinguished marker, so "abstained" and
 *     "returned 0" can never collide into the same digest;
 *   - a digest break is investigated and either reverted or re-baselined with
 *     a written reason. It is never silently re-frozen.
 */

import { Digest, SeedStream } from '../core/determinism';
import { PHI } from '../core/constants';
import { dsin, dcos } from '../core/dmath';
import {
  pearson,
  spearman,
  kendallTauB,
  distanceCorrelation,
  hsic,
  gaussianMI,
  type StatResult,
} from '../substrate/correlation';
import { grangerCausality, transferEntropyGaussian } from '../substrate/causal';
import { fuseResonance, circularPhaseDev, phaseClosureGamma } from '../substrate/resonanceBus';
import { randomHv, bind, unbind, bundle, similarity } from '../substrate/vsa';
import {
  substrateParity,
  metatronSpectrum,
  pisotDefect,
  heartbeatGaps,
  stableRungsMod28,
} from '../substrate/phiSubstrate';
import { analyticExpectedC, expectedCBias, kernelRoots } from '../substrate/coherenceKernel';

/**
 * Abstention marker for the digest only. NaN is correct here precisely because
 * it is not plottable: `Digest.float` absorbs the raw IEEE-754 bytes, so an
 * abstention and a measured 0 can never hash to the same thing, and no caller
 * can mistake the marker for a reading. It never leaves this module.
 */
const ABSTAIN_MARK = Number.NaN;

function statValues(rs: readonly StatResult[]): number[] {
  const out: number[] = [];
  for (const r of rs) {
    out.push(r.value === null ? ABSTAIN_MARK : r.value);
    out.push(r.abstained ? 1 : 0);
    out.push(r.n);
  }
  return out;
}

export interface GoldenCase {
  readonly id: string;
  /** What breaking this digest would mean. */
  readonly guards: string;
  readonly run: () => number[];
}

/** Deterministic coupled pair: y is a φ-lagged, noisy function of x. */
function coupledPair(n: number, seed: string): { x: Float64Array; y: Float64Array } {
  const s = new SeedStream(seed);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const drive = dsin(i / PHI) + 0.35 * s.signed();
    x[i] = drive;
    prev = 0.55 * prev + 0.45 * (i > 0 ? x[i - 1] : 0) + 0.2 * s.signed();
    y[i] = prev;
  }
  return { x, y };
}

export const GOLDEN_CASES: readonly GoldenCase[] = [
  {
    id: 'substrate-parity',
    guards: 'the Class-A φ identities and the Lucas-mod-13 heartbeat',
    run: () => {
      const v: number[] = [];
      // ok-flag plus a digest of the name+detail text: a check that silently
      // changes what it measures breaks the digest even when it still passes.
      for (const p of substrateParity()) {
        v.push(
          p.ok ? 1 : 0,
          Number(new Digest().text(p.name).text(p.detail).value() & 0xffffffffn),
        );
      }
      v.push(...metatronSpectrum(), ...heartbeatGaps(), ...stableRungsMod28());
      for (let n = 1; n <= 13; n++) v.push(pisotDefect(n));
      return v;
    },
  },
  {
    id: 'coherence-kernel',
    guards: 'the innovation-form C(t) roots and its finite-d bias correction',
    run: () => {
      const [r1, r2] = kernelRoots();
      const v = [r1, r2];
      for (const d of [4, 8, 16, 28]) v.push(analyticExpectedC(1, d, 1), expectedCBias(d, 1));
      return v;
    },
  },
  {
    id: 'correlation-family',
    guards: 'all six Level-2 statistics on one coupled pair',
    run: () => {
      const { x, y } = coupledPair(233, 'golden/corr');
      return statValues([
        pearson(x, y),
        spearman(x, y),
        kendallTauB(x, y),
        distanceCorrelation(x, y),
        hsic(x, y),
        gaussianMI(x, y),
      ]);
    },
  },
  {
    id: 'correlation-underfloor',
    guards: 'the F9 sample floor: every member abstains, none returns 0',
    run: () => {
      const { x, y } = coupledPair(21, 'golden/corr-small');
      return statValues([
        pearson(x, y),
        spearman(x, y),
        kendallTauB(x, y),
        distanceCorrelation(x, y),
        hsic(x, y),
        gaussianMI(x, y),
      ]);
    },
  },
  {
    id: 'causal-layer',
    guards: 'Granger F/p and Gaussian transfer entropy at lags 1..3',
    run: () => {
      const { x, y } = coupledPair(377, 'golden/causal');
      const v: number[] = [];
      for (const lag of [1, 2, 3]) {
        const g = grangerCausality(x, y, lag);
        const t = transferEntropyGaussian(x, y, lag);
        v.push(g.value ?? ABSTAIN_MARK, g.p ?? ABSTAIN_MARK, g.n, g.lag);
        v.push(t.value ?? ABSTAIN_MARK, t.p ?? ABSTAIN_MARK);
      }
      return v;
    },
  },
  {
    id: 'resonance-bus',
    guards: 'the fusion law, the γ factor, the veto and the coherence gate',
    run: () => {
      const chans = [
        { id: 'a', value: 0.9 },
        { id: 'b', value: 0.6 },
        { id: 'c', value: 0.34 },
      ];
      const phases = [0.1, 0.2, 0.12, 0.31, 0.05];
      const dev = circularPhaseDev(phases);
      const g = phaseClosureGamma(dev);
      const plain = fuseResonance(chans);
      const withGamma = fuseResonance(chans, { phaseDev: dev });
      const vetoed = fuseResonance([...chans, { id: 'dead', value: 0 }], { phaseDev: dev });
      const abstaining = fuseResonance([...chans, { id: 'unknown', value: NaN }]);
      const gated = fuseResonance(chans, { coherence: 0.05 });
      return [
        dev,
        g,
        plain.value,
        plain.counted,
        plain.abstained,
        withGamma.value,
        withGamma.gamma,
        withGamma.vetoValue,
        vetoed.value,
        vetoed.dead ? 1 : 0,
        abstaining.value,
        abstaining.abstained,
        Number.isFinite(gated.value) ? gated.value : ABSTAIN_MARK,
        gated.gated ? 1 : 0,
      ];
    },
  },
  {
    id: 'vsa-algebra',
    guards: 'FHRR bind/unbind exactness and bundle crosstalk at dim 1024',
    run: () => {
      const dim = 1024;
      const a = randomHv(dim, 'golden/a');
      const b = randomHv(dim, 'golden/b');
      const c = randomHv(dim, 'golden/c');
      const ab = bind(a, b);
      const rec = unbind(ab, a);
      const bag = bundle([a, b, c]);
      return [
        similarity(rec, b),
        similarity(ab, a),
        similarity(ab, b),
        similarity(bag.hv, a),
        similarity(bag.hv, b),
        similarity(bag.hv, c),
        bag.meanAgreement,
      ];
    },
  },
];

export interface GoldenResult {
  readonly id: string;
  readonly digest: string;
  readonly length: number;
  readonly guards: string;
}

/** Digest one case's output vector. */
export function digestValues(values: readonly number[]): string {
  return new Digest().array(values).hex();
}

export function runGolden(cases: readonly GoldenCase[] = GOLDEN_CASES): GoldenResult[] {
  return cases.map((c) => {
    const values = c.run();
    return { id: c.id, digest: digestValues(values), length: values.length, guards: c.guards };
  });
}

/**
 * Frozen baseline. Cross-engine: the inputs use the deterministic `dmath`
 * kernels, never `Math.sin`/`Math.cos`, whose results are implementation-
 * defined and differ between JavaScriptCore and V8 — a digest that moves when
 * you change runtime is not a contract. Re-baselining requires a written reason in the phase log;
 * a bare digest swap is a regression laundered into a commit.
 */
export const GOLDEN_BASELINE: Readonly<Record<string, string>> = {
  'substrate-parity': 'b740fed66ab56c8b',
  'coherence-kernel': '928e38bd0682e011',
  'correlation-family': '2e1db62195a14c4b',
  'correlation-underfloor': '235beaee40582307',
  'causal-layer': '7be87d2c7214af97',
  'resonance-bus': '178bea5f3a721c1b',
  'vsa-algebra': '50ff1689cb06c40d',
};

export interface GoldenDrift {
  readonly id: string;
  readonly expected: string;
  readonly actual: string;
}

export interface GoldenGate {
  readonly pass: boolean;
  readonly results: readonly GoldenResult[];
  readonly drifted: readonly GoldenDrift[];
  /** Cases present in the run but absent from the baseline — unfrozen. */
  readonly unbaselined: readonly string[];
  /** Baseline entries with no case left to guard them — dead contracts. */
  readonly orphaned: readonly string[];
}

export function goldenGate(
  baseline: Readonly<Record<string, string>> = GOLDEN_BASELINE,
  cases: readonly GoldenCase[] = GOLDEN_CASES,
): GoldenGate {
  const results = runGolden(cases);
  const drifted: GoldenDrift[] = [];
  const unbaselined: string[] = [];
  for (const r of results) {
    const want = baseline[r.id];
    if (!want) {
      unbaselined.push(r.id);
      continue;
    }
    if (want !== r.digest) drifted.push({ id: r.id, expected: want, actual: r.digest });
  }
  const ids = new Set(results.map((r) => r.id));
  const orphaned = Object.keys(baseline).filter((k) => !ids.has(k));
  return {
    pass: drifted.length === 0 && unbaselined.length === 0 && orphaned.length === 0,
    results,
    drifted,
    unbaselined,
    orphaned,
  };
}
