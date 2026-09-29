/**
 * Ω-P8 — the learning battery.
 *
 * A learnable piece ships enabled only if it *measurably* beats its fixed-φ
 * baseline on data it never trained on, by the recorded margin. Otherwise it
 * ships disabled and the verdict is written down. This is the same discipline
 * as the Python project's kill ledger, ported verbatim.
 *
 * Task (well-posed, non-trivial, no leakage):
 *   given z_t alone — no memory trace — predict z_{t+1} of a certified
 *   SingleTorusEngine trajectory.
 * The generator sees the memory field m; the predictor does not, so neither the
 * baseline nor the learnable model can be exact, and the learnable mix has
 * something real to buy: it can re-weight the drives it *can* compute
 * (G, P, R←z, Π, ẑ←persistence) plus a bounded self-eigenvalue to compensate
 * for the hidden state.
 *
 * Split is strictly temporal: train on the first `trainTicks`, score on the
 * following `holdTicks`, never the reverse. Everything is deterministic — the
 * trajectory from its seed, the SPSA perturbations from a named stream.
 */

import { PHI_INV, SIGNATURE_MODES, phiPow } from '../core/constants';
import { SeedStream } from '../core/determinism';
import { createField, type CField } from '../core/complex';
import { createLattice } from '../torus/lattice';
import {
  analyze,
  buildBasis,
  coeffBuffer,
  synthesize,
  type ModeBasis,
} from '../torus/superposition';
import { closureTarget } from '../cell/closure';
import { SingleTorusEngine } from '../engine/SingleTorusEngine';
import { LearnableCell } from './cell';
import { rawVector, setRawVector } from './params';
import { dcos, dpow, dsin } from '../core/dmath';

/** Held-out margin a learnable must clear to ship enabled (Gate G8): φ⁻². */
export const SHIP_MARGIN = phiPow(-2);

export interface TrajectoryOptions {
  readonly nodes?: number;
  readonly seed?: string;
  readonly rung?: number;
  readonly warmup?: number;
  readonly trainTicks?: number;
  readonly holdTicks?: number;
}

export interface Trajectory {
  readonly nodes: number;
  readonly rung: number;
  readonly basis: ModeBasis;
  /** Consecutive states: frames[k] → frames[k+1] is one supervised pair. */
  readonly frames: readonly CField[];
  /** Engine tick index of frames[k] (drives the closure walk phase). */
  readonly ticks: readonly number[];
  readonly trainPairs: number;
  readonly holdPairs: number;
}

/** Deterministically sample a certified trajectory to learn against. */
export function sampleTrajectory(opts: TrajectoryOptions = {}): Trajectory {
  const nodes = opts.nodes ?? 89;
  const rung = opts.rung ?? 1;
  const warmup = opts.warmup ?? 233;
  const trainTicks = opts.trainTicks ?? 377;
  const holdTicks = opts.holdTicks ?? 144;

  const engine = new SingleTorusEngine({
    nodes,
    rung,
    seed: opts.seed ?? 'omega-battery',
    coherenceDelay: 21,
  });
  engine.run(warmup);

  const frames: CField[] = [];
  const ticks: number[] = [];
  const total = trainTicks + holdTicks + 1;
  for (let k = 0; k < total; k++) {
    const s = engine.snapshot();
    frames.push(s.z);
    ticks.push(s.tick);
    engine.step();
  }

  return {
    nodes,
    rung,
    basis: buildBasis(createLattice(nodes, 'fibonacci'), SIGNATURE_MODES),
    frames,
    ticks,
    trainPairs: trainTicks,
    holdPairs: holdTicks,
  };
}

/** Reusable scratch so scoring allocates nothing inside the loop. */
class Scratch {
  readonly G: CField;
  readonly P: CField;
  readonly R: CField;
  readonly Pi: CField;
  readonly zhat: CField;
  readonly out: CField;
  readonly coeffs: Float64Array;

  constructor(private readonly traj: Trajectory) {
    const n = traj.nodes;
    this.G = createField(n);
    this.P = createField(n);
    this.R = createField(n);
    this.Pi = createField(n);
    this.zhat = createField(n);
    this.out = createField(n);
    this.coeffs = coeffBuffer(traj.basis);
  }

  /** Drives computable from z_t alone (memory is hidden from the predictor). */
  drives(z: CField, tick: number): void {
    analyze(this.traj.basis, z, this.coeffs);
    synthesize(this.traj.basis, this.coeffs, this.G);
    const th = 2 * Math.PI * PHI_INV;
    const c = dcos(th);
    const s = dsin(th);
    for (let i = 0; i < z.n; i++) {
      this.P.re[i] = this.G.re[i] * c - this.G.im[i] * s;
      this.P.im[i] = this.G.re[i] * s + this.G.im[i] * c;
      // memory surrogate: the only honest stand-in without the hidden trace
      this.R.re[i] = z.re[i];
      this.R.im[i] = z.im[i];
      this.zhat.re[i] = z.re[i];
      this.zhat.im[i] = z.im[i];
    }
    closureTarget(z, this.Pi, tick, this.traj.rung);
  }
}

export interface ScoreReport {
  /** Normalized RMS error: sqrt(Σ‖e‖² / Σ‖z_{t+1}‖²). */
  readonly nrmse: number;
  readonly pairs: number;
}

function scoreWindow(
  traj: Trajectory,
  cell: LearnableCell,
  from: number,
  count: number,
  sc: Scratch,
): ScoreReport {
  let num = 0;
  let den = 0;
  for (let k = from; k < from + count; k++) {
    const z = traj.frames[k];
    const y = traj.frames[k + 1];
    sc.drives(z, traj.ticks[k]);
    cell.step(z, sc.out, { G: sc.G, P: sc.P, R: sc.R, Pi: sc.Pi, zhat: sc.zhat });
    for (let i = 0; i < z.n; i++) {
      const er = sc.out.re[i] - y.re[i];
      const ei = sc.out.im[i] - y.im[i];
      num += er * er + ei * ei;
      den += y.re[i] * y.re[i] + y.im[i] * y.im[i];
    }
  }
  return { nrmse: den > 0 ? Math.sqrt(num / den) : 0, pairs: count };
}

export interface TrainOptions {
  readonly iterations?: number;
  /** SPSA step scale. */
  readonly stepScale?: number;
  /** SPSA perturbation scale. */
  readonly probeScale?: number;
  readonly seed?: string;
}

export interface BatteryReport {
  readonly baselineTrain: number;
  readonly baselineHold: number;
  readonly learnedTrain: number;
  readonly learnedHold: number;
  /** Relative held-out error reduction, 1 − learned/baseline. */
  readonly margin: number;
  readonly required: number;
  /** True only when the margin clears φ⁻² on held-out data. */
  readonly enabled: boolean;
  readonly verdict: string;
  readonly iterations: number;
  readonly certifiedGain: number;
  readonly gate: number;
  readonly mix: readonly number[];
  readonly lambda: number;
  readonly trainPairs: number;
  readonly holdPairs: number;
}

/**
 * Train a LearnableCell with deterministic SPSA and return the honest verdict.
 * The returned cell has its gate set to 1 only when the battery passes; on a
 * kill verdict the cell is left at gate 0 with its raw parameters restored, so
 * the caller cannot accidentally ship an unproven model.
 */
export function runBattery(
  traj: Trajectory,
  train: TrainOptions = {},
): { cell: LearnableCell; report: BatteryReport } {
  const iterations = train.iterations ?? 400;
  const a0 = train.stepScale ?? 1.5;
  const c0 = train.probeScale ?? 0.25;
  const stream = new SeedStream(train.seed ?? 'omega-spsa');
  const sc = new Scratch(traj);

  const holdFrom = traj.trainPairs;
  const baseline = new LearnableCell({ gate: 0 });
  const baselineTrain = scoreWindow(traj, baseline, 0, traj.trainPairs, sc).nrmse;
  const baselineHold = scoreWindow(traj, baseline, holdFrom, traj.holdPairs, sc).nrmse;

  const cell = new LearnableCell({ gate: 1 });
  const params = cell.params();
  let theta = rawVector(params);
  const dim = theta.length;
  const plus = new Float64Array(dim);
  const minus = new Float64Array(dim);
  const delta = new Float64Array(dim);

  const evalTrain = (v: Float64Array): number => {
    setRawVector(params, v);
    return scoreWindow(traj, cell, 0, traj.trainPairs, sc).nrmse;
  };

  let best = new Float64Array(theta);
  let bestLoss = evalTrain(theta);

  for (let k = 0; k < iterations; k++) {
    const ck = c0 / dpow(k + 1, 0.101);
    const ak = a0 / dpow(k + 10, 0.602);
    for (let i = 0; i < dim; i++) {
      delta[i] = stream.next() < 0.5 ? -1 : 1; // Rademacher, deterministic
      plus[i] = theta[i] + ck * delta[i];
      minus[i] = theta[i] - ck * delta[i];
    }
    const lp = evalTrain(plus);
    const lm = evalTrain(minus);
    if (!Number.isFinite(lp) || !Number.isFinite(lm)) break;
    const g = (lp - lm) / (2 * ck);
    for (let i = 0; i < dim; i++) theta[i] -= ak * g * delta[i];
    const loss = evalTrain(theta);
    if (Number.isFinite(loss) && loss < bestLoss) {
      bestLoss = loss;
      best = new Float64Array(theta);
    }
  }

  theta = best;
  setRawVector(params, theta);
  const learnedTrain = scoreWindow(traj, cell, 0, traj.trainPairs, sc).nrmse;
  const learnedHold = scoreWindow(traj, cell, holdFrom, traj.holdPairs, sc).nrmse;

  const margin = baselineHold > 0 ? 1 - learnedHold / baselineHold : 0;
  const enabled = margin >= SHIP_MARGIN && Number.isFinite(learnedHold);

  if (!enabled) {
    cell.setGate(0);
  }

  const mix = Array.from(cell.mix.values());
  const report: BatteryReport = {
    baselineTrain,
    baselineHold,
    learnedTrain,
    learnedHold,
    margin,
    required: SHIP_MARGIN,
    enabled,
    verdict: enabled
      ? `SHIP — held-out margin ${margin.toFixed(4)} ≥ φ⁻² (${SHIP_MARGIN.toFixed(4)})`
      : `KILL — held-out margin ${margin.toFixed(4)} < φ⁻² (${SHIP_MARGIN.toFixed(4)}); learnable cell ships disabled (gate 0, bit-exact baseline)`,
    iterations,
    certifiedGain: cell.certifiedGain(),
    gate: cell.gate,
    mix,
    lambda: cell.lambda.lambda(),
    trainPairs: traj.trainPairs,
    holdPairs: traj.holdPairs,
  };

  return { cell, report };
}
