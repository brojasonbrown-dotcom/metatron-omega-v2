/**
 * N1 — the six-section toroid scan.
 *
 * One rung at a time, this produces a written report of the state of every
 * line convergence on that toroid. Nothing here computes dynamics and nothing
 * here invents a number: each section either reads engine state directly or
 * derives it by a transform documented on the section.
 *
 *   S1 census    node count, Fibonacci check, grid separation, incident stride
 *   S2 organs    structural readout distribution across nodes
 *   S3 spectral  the per-node band plan and what the receptors actually latched
 *   S4 energy    per-node energy share, peak convergence, distribution entropy
 *   S5 flux      per-node current divergence and its closure identity
 *   S6 verdict   pass/defect list against the laws each section can check
 *
 * A section that has nothing real to report says so (`status: 'ABSENT'`)
 * rather than emitting zeros that would read as a measurement.
 */

import type { SingleTorusEngine } from '../engine/SingleTorusEngine';
import { minSeparation } from '../torus/lattice';
import type { OrganReport } from '../cell/organs';
import type { BandPlan, SpectralProbe } from './nodeArray';

export type SectionStatus = 'OK' | 'DEFECT' | 'ABSENT' | 'WARMING';

export interface ScanCensus {
  readonly status: SectionStatus;
  readonly nodes: number;
  readonly fibonacci: boolean;
  readonly latticeKind: string;
  /** Minimum angular separation of the minor-angle sequence, radians. */
  readonly minSeparation: number;
  /** Discrepancy proxy: minSeparation × nodes; ≈1 for an ideal golden grid. */
  readonly separationRatio: number;
  /** Golden stride — offset of the minor-spiral incident neighbour. */
  readonly goldenStride: number;
  /** Lines crossing at each convergence (2 major + 2 minor). */
  readonly incidentLines: number;
  readonly modes: number;
}

export interface ScanOrgans {
  readonly status: SectionStatus;
  readonly report: OrganReport | null;
  /** Fraction of nodes whose modal residual is below 1e-9. */
  readonly cleanFraction: number;
  /** Coherence histogram over 8 equal buckets of [0, 1]. */
  readonly coherenceHistogram: readonly number[];
  /** Participation histogram over 8 equal buckets of [0, 1]. */
  readonly participationHistogram: readonly number[];
}

export interface ScanSpectral {
  readonly status: SectionStatus;
  readonly bands: number;
  readonly depth: number;
  readonly windowPhase: number;
  readonly windowsClosed: number;
  readonly plan: readonly BandPlan[];
  /** Mean latched magnitude per band across every node. */
  readonly occupancy: readonly number[];
  /** Largest latched magnitude per band across every node. */
  readonly peakPerBand: readonly number[];
  readonly meanCapture: number;
  readonly minCapture: number;
  readonly silentNodes: number;
  /** Largest |realised − target|/target across the plan. */
  readonly maxDrift: number;
  /**
   * Mean share of window energy sitting on DC — the standing amplitude of the
   * convergences rather than their motion. Near 1 means a quiet rung.
   */
  readonly meanDcShare: number;
  /**
   * Full-spectrum probe of the busiest convergence — where the motion
   * actually is, independent of where the φ ladder looks.
   */
  readonly probe: SpectralProbe | null;
}

export interface ScanEnergy {
  readonly status: SectionStatus;
  readonly total: number;
  readonly peakShare: number;
  readonly peakNode: number;
  /** Normalised Shannon entropy of the share distribution, [0, 1]. */
  readonly entropy: number;
  /** Mean |instantaneous frequency| across nodes, cycles/tick. */
  readonly meanFrequency: number;
  /** Frequency of the peak-energy convergence, cycles/tick. */
  readonly peakFrequency: number;
  /** The eight highest-energy convergences, by node index. */
  readonly hotNodes: readonly number[];
}

export interface ScanFlux {
  readonly status: SectionStatus;
  /** Σ_j div_j — structurally 0 by antisymmetry of the current. */
  readonly divergenceSum: number;
  /** Σ_j |div_j| — total current crossing the grid lines. */
  readonly circulation: number;
  readonly maxDivergence: number;
  readonly maxDivergenceNode: number;
  /** |Σ div| / (Σ|div| + ε) — the relative closure defect actually measured. */
  readonly closureDefect: number;
}

export interface ScanVerdict {
  readonly pass: boolean;
  readonly defects: readonly string[];
  readonly notes: readonly string[];
  readonly digest: string;
}

export interface RungScanReport {
  readonly rank: number;
  /** Ladder index n of this rung. */
  readonly n: number;
  readonly tick: number;
  readonly census: ScanCensus;
  readonly organs: ScanOrgans;
  readonly spectral: ScanSpectral;
  readonly energy: ScanEnergy;
  readonly flux: ScanFlux;
  readonly verdict: ScanVerdict;
}

/** Closure defect above this is a real transport leak, not rounding. */
export const FLUX_CLOSURE_TOLERANCE = 1e-9;
/** Band capture below this means the φ ladder is missing the node's motion. */
export const CAPTURE_FLOOR = 0.5;

function histogram(src: Float64Array, buckets = 8): number[] {
  const out = new Array<number>(buckets).fill(0);
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    let b = Math.floor(v * buckets);
    if (!Number.isFinite(b)) b = 0;
    if (b < 0) b = 0;
    if (b >= buckets) b = buckets - 1;
    out[b]++;
  }
  return out;
}

/** Scan one toroid. Read-only: the engine is never advanced or mutated. */
export function scanRung(engine: SingleTorusEngine, rank: number): RungScanReport {
  const defects: string[] = [];
  const notes: string[] = [];

  const lattice = engine.lattice;
  const nodes = engine.nodes;
  const sep = minSeparation(lattice);
  const sensors = engine.sensors;
  const organs = engine.organs;
  const snap = engine.snapshot();

  // --- S1 census -----------------------------------------------------------
  const census: ScanCensus = {
    status: 'OK',
    nodes,
    fibonacci: true, // createLattice refuses a non-Fibonacci count at build
    latticeKind: lattice.kind,
    minSeparation: sep,
    separationRatio: sep * nodes,
    goldenStride: sensors ? sensors.goldenStep : 0,
    incidentLines: 4,
    modes: engine.basis.vectors.length,
  };
  if (!(sep > 0)) defects.push('S1: two convergences coincide — the grid is degenerate');

  // --- S2 organs -----------------------------------------------------------
  let organSection: ScanOrgans;
  if (!organs) {
    organSection = {
      status: 'ABSENT',
      report: null,
      cleanFraction: 0,
      coherenceHistogram: [],
      participationHistogram: [],
    };
    notes.push('S2: this rung carries no organ bank — structural readout unavailable');
  } else {
    let clean = 0;
    for (let j = 0; j < nodes; j++) if (organs.eigenResidual[j] < 1e-9) clean++;
    const rep = organs.report();
    organSection = {
      status: rep.maxEigenResidual > 1 ? 'DEFECT' : 'OK',
      report: rep,
      cleanFraction: clean / nodes,
      coherenceHistogram: histogram(organs.localCoherence),
      participationHistogram: histogram(organs.participation),
    };
    if (organSection.status === 'DEFECT') {
      defects.push(
        `S2: max modal residual ${rep.maxEigenResidual.toExponential(3)} exceeds the field scale`,
      );
    }
  }

  // --- S3/S4/S5 need the sensory array -------------------------------------
  let spectral: ScanSpectral;
  let energy: ScanEnergy;
  let flux: ScanFlux;

  if (!sensors) {
    spectral = {
      status: 'ABSENT',
      bands: 0,
      depth: 0,
      windowPhase: 0,
      windowsClosed: 0,
      plan: [],
      occupancy: [],
      peakPerBand: [],
      meanCapture: 0,
      minCapture: 0,
      silentNodes: 0,
      maxDrift: 0,
      meanDcShare: 0,
      probe: null,
    };
    energy = {
      status: 'ABSENT',
      total: 0,
      peakShare: 0,
      peakNode: -1,
      entropy: 0,
      meanFrequency: 0,
      peakFrequency: 0,
      hotNodes: [],
    };
    flux = {
      status: 'ABSENT',
      divergenceSum: 0,
      circulation: 0,
      maxDivergence: 0,
      maxDivergenceNode: -1,
      closureDefect: 0,
    };
    notes.push('S3–S5: no sensory node array on this rung — build with sensors to scan it');
  } else {
    const rep = sensors.report();
    const B = sensors.bands;

    // S3 — band occupancy across every convergence
    const occupancy = new Array<number>(B).fill(0);
    const peakPerBand = new Array<number>(B).fill(0);
    for (let j = 0; j < nodes; j++) {
      const row = j * B;
      for (let k = 0; k < B; k++) {
        const m = sensors.bandAmp[row + k];
        occupancy[k] += m;
        if (m > peakPerBand[k]) peakPerBand[k] = m;
      }
    }
    for (let k = 0; k < B; k++) occupancy[k] /= nodes;
    let maxDrift = 0;
    for (const p of sensors.plan) if (p.drift > maxDrift) maxDrift = p.drift;

    const warming = rep.windowsClosed === 0;
    // A receptor is defective when it latches nothing at all. Low capture is
    // NOT a defect: the φ ladder is deliberately sparse, so a rung whose
    // motion sits between rungs is under-sampled by design. The probe says
    // exactly where that motion went, and the note carries it.
    const blind = !warming && rep.silent === nodes;
    spectral = {
      status: warming ? 'WARMING' : blind ? 'DEFECT' : 'OK',
      bands: B,
      depth: sensors.depth,
      windowPhase: rep.windowPhase,
      windowsClosed: rep.windowsClosed,
      plan: sensors.plan,
      occupancy,
      peakPerBand,
      meanCapture: rep.meanCapture,
      minCapture: rep.minCapture,
      silentNodes: rep.silent,
      maxDrift,
      meanDcShare: rep.meanDcShare,
      probe: rep.probe,
    };
    if (warming) {
      notes.push(
        `S3: first ${sensors.depth}-tick window still open (${rep.windowPhase}/${sensors.depth}) — no spectrum has latched yet`,
      );
    } else if (blind) {
      defects.push('S3: every receptor latched an empty spectrum — the array is blind');
    } else if (rep.meanCapture < CAPTURE_FLOOR) {
      const top = rep.probe?.lines[0];
      notes.push(
        top
          ? `S3: the φ ladder holds ${(rep.meanCapture * 100).toFixed(2)}% of this rung's motion — its dominant line sits at ${top.frequency.toFixed(4)} cycles/tick (node ${rep.probe!.node}, ${(top.share * 100).toFixed(1)}% of that node's AC energy, ${top.onLadder ? 'on' : 'off'} the ladder)`
          : `S3: the φ ladder holds ${(rep.meanCapture * 100).toFixed(2)}% of this rung's motion`,
      );
    }

    // S4 — energy distribution
    let peakNode = -1;
    let peak = -1;
    for (let j = 0; j < nodes; j++) {
      if (sensors.energy[j] > peak) {
        peak = sensors.energy[j];
        peakNode = j;
      }
    }
    const order = Array.from({ length: nodes }, (_, j) => j).sort(
      (a, b) => sensors.energy[b] - sensors.energy[a],
    );
    energy = {
      status: rep.energy > 0 ? 'OK' : 'DEFECT',
      total: rep.energy,
      peakShare: rep.peakShare,
      peakNode,
      entropy: rep.energyEntropy,
      meanFrequency: rep.meanFrequency,
      peakFrequency: peakNode >= 0 ? sensors.frequency[peakNode] : 0,
      hotNodes: order.slice(0, 8),
    };
    if (energy.status === 'DEFECT') {
      defects.push('S4: the rung carries zero energy — the field is dark');
    }

    // S5 — flux closure
    let maxDiv = 0;
    let maxNode = -1;
    for (let j = 0; j < nodes; j++) {
      const a = Math.abs(sensors.divergence[j]);
      if (a > maxDiv) {
        maxDiv = a;
        maxNode = j;
      }
    }
    const closureDefect =
      rep.circulation > 0 ? Math.abs(rep.divergenceSum) / rep.circulation : Math.abs(rep.divergenceSum);
    flux = {
      status: closureDefect > FLUX_CLOSURE_TOLERANCE ? 'DEFECT' : 'OK',
      divergenceSum: rep.divergenceSum,
      circulation: rep.circulation,
      maxDivergence: maxDiv,
      maxDivergenceNode: maxNode,
      closureDefect,
    };
    if (flux.status === 'DEFECT') {
      defects.push(
        `S5: current divergence does not close — relative defect ${closureDefect.toExponential(3)}`,
      );
    }
  }

  return {
    rank,
    n: engine.rung,
    tick: snap.tick,
    census,
    organs: organSection,
    spectral,
    energy,
    flux,
    verdict: {
      pass: defects.length === 0,
      defects,
      notes,
      digest: snap.digest,
    },
  };
}
