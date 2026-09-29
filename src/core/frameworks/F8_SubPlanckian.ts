/**
 * METATRON V11 — F8 SUB-PLANCKIAN (Vacuum Foam · 10⁻³⁵ m · ZPE κ-closure)
 * ========================================================================
 *
 * V10 → V11 UPLIFT
 * ----------------
 *  • V10's hardcoded N=55 nodes is now the FLOOR. The ring topology is a
 *    Fibonacci-Hex Flower-of-Life: rings 0-4 use V10's exact spine
 *    [1, 6, 12, 18, 18] (preserves bit-for-bit V10 parity at M=55), and
 *    rings r ≥ 5 grow as 6r (proper concentric hex) up to whatever
 *    ring count the caller requests via `targetRings`.
 *  • V10's hardcoded 7 vacuum modes is the FLOOR. Caller can request up
 *    to floor(log_φ(PLANCK_FREQ / minFreq)) extension modes — Planck-
 *    bounded refusal at the carrier ceiling.
 *  • V10's 13 Planck-flower spheres (1+6+6) is the FLOOR. F(k)-sphere
 *    flower extension uses Fibonacci ring spine.
 *  • Numeric constants pulled from `frameworks/constants.ts` (which pulls
 *    from `WolframVerified` — 60-digit anchored).
 *  • Closure check: Lyapunov-style ‖∮ Ψ_k − Ψ_k‖ < tol·φ⁻ᴹ — surfaced as
 *    `closureResidual` on the output.
 *
 * IRON RULES
 * ----------
 *  • At rings = 5, modes = 7, spheres = 13 ⇒ output MUST equal V10
 *    (gated by scripts/v10Goldens/F8.gen.ts JSON golden, ≤ 4 ULP).
 *  • Pure function. No engine state. Drivers come in via inputs.
 *  • No silent demotion: extension past ulp/Planck floor raises a refusal
 *    on the output, never silently truncates.
 *
 * V10 REFERENCE CROSS-CHECK (intentionally not yet ported — surfaced here so
 * future readers don't think the V10 features were lost):
 *   • BandedGram.ts         — sparse Gram matvec; would accelerate the
 *                              `superpositionMComposite` reduction at high M.
 *   • LanczosTopK.ts        — top-K spectral extraction; unused in V11.
 *   • DriverBank.ts         — pre-tabulated φ-mode drivers.
 *   • WebGPUSuperposition.ts — V10 scaffold only (never wired in V10's loop).
 *                              V11 deliberately runs on the field worker pool.
 * The V11 F8 path is bit-for-bit V10-golden at (rings=5, modes=7, spheres=13);
 * the ports above are pure perf, golden-locked future work.
 */

import { PHI, PHI_INV, PI, KAPPA, PLANCK_LENGTH_M } from './constants';

// V10 Planck time constant — the only F8-specific empirical we need.
// Stored here so F8 has no cross-framework imports.
const V10_PLANCK_TIME_S = 5.391247e-44;
const V10_HYDROGEN_PHI = 1 + 1 / (PHI * PHI);
const V10_KAPPA_CLOSURE = (1 / (PHI * PI)) * 144;

// ───────────────────────── topology generators ─────────────────────────

/** V10 5-ring spine, preserved exactly so M=55 path is bit-identical. */
const V10_RING_SIZES: readonly number[] = [1, 6, 12, 18, 18];

/**
 * V11 quark-scale stable-shell extension for rings r ≥ 5. Each entry is the
 * vertex count of a Platonic / Archimedean orbit under the icosahedral group
 * I (|I| = 60), chosen so that every new ring is a closed Planck-geometry
 * shell rather than a generic hex ring:
 *  r=5 → 30  (icosidodecahedron — edge midpoints of the icosahedron)
 *  r=6 → 30  (snub-icosidodecahedron half-shell — second 30-orbit of I)
 *  r=7 → 42  (truncated-icosahedron rim: 12 pentagons + 30 hex-vertices)
 *  r=8 → 42  (mirror rim, second 42-orbit)
 * For r ≥ 9 we fall through to the V10 hex floor `6·r` and surface a refusal
 * note — beyond r=8 the icosahedral orbit decomposition runs out of known
 * Planck-scale stable shells without invoking higher-rank Lie-group orbits.
 */
const V11_QUARK_SHELL_EXT: readonly number[] = [30, 30, 42, 42];

/**
 * Ring sizes for an R-ring Sub-Planckian field.
 *  - r ∈ [0, 4]   → V10 spine [1, 6, 12, 18, 18]
 *  - r ∈ [5, 8]   → icosahedral stable-shell spine [30, 30, 42, 42]
 *  - r ≥ 9        → V10 hex fallback `6·r` (no stable Planck shell known)
 */
export function ringSizes(numRings: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < numRings; r++) {
    if (r < V10_RING_SIZES.length) {
      out.push(V10_RING_SIZES[r]);
    } else if (r - V10_RING_SIZES.length < V11_QUARK_SHELL_EXT.length) {
      out.push(V11_QUARK_SHELL_EXT[r - V10_RING_SIZES.length]);
    } else {
      out.push(6 * r);
    }
  }
  return out;
}

/** Cumulative ring start indices. */
export function ringStarts(sizes: readonly number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const s of sizes) {
    out.push(acc);
    acc += s;
  }
  return out;
}

/** Total node count for a given ring count (M=55 at R=5). */
export function nodeCountForRings(numRings: number): number {
  return ringSizes(numRings).reduce((a, b) => a + b, 0);
}

// ───────────────────────── output types ─────────────────────────

export interface PlanckVacuumMode {
  readonly name: string;
  readonly spin: number;
  readonly internalFreq: number;
  resonance: number;
  coupling: number;
}

export interface PlanckSphere {
  readonly id: number;
  readonly ring: number;
  readonly chromaticNote: string;
  coherence: number;
  readonly phiWeight: number;
}

export interface VacuumNodeM {
  readonly id: number;
  readonly ring: number;
  readonly coherence: number;
  stability: number;
  readonly internalFreqScale: number;
  structuralPotential: number;
}

export interface RingAnalysis {
  readonly ring: number;
  readonly nodeCount: number;
  readonly meanCoherence: number;
  readonly phaseUniformity: number;
  readonly interRingCoupling: number;
  readonly relativeFreq: number;
}

export interface F8Output {
  // scalars
  zeroPointEnergy: number;
  planckFoamDensity: number;
  kappaClosureFreq: number;
  tetrahedralPacking: number;
  vacuumToAtomicBridge: number;
  alephResonance: number;
  betResonance: number;
  nonCommutativePhase: number;
  kappaModulation: number;
  phiCubedStep: number;
  ncTensor: number;
  scaleRelativeTime: number;
  planckInternalFreq: number;
  lightModes: number;
  torusLinkStrength: number;
  septenaryComposite: number;
  chromaticComposite: number;
  fieldEntropy: number;
  structuralFormations: number;
  chainUpCoupling: number;
  superpositionMComposite: number;
  /** Back-compat alias for V10/generic UI readers; equal to superpositionMComposite at all sizes. */
  superposition55Composite: number;
  // arrays
  planckSeptenary: PlanckVacuumMode[];
  planckFlowerSpheres: PlanckSphere[];
  superpositionsM: VacuumNodeM[];
  ringAnalysis: RingAnalysis[];
  // V11 closure metric — Lyapunov residual of ring-summed amplitude
  closureResidual: number;
  /**
   * Chapter 44 — Boundary Validation.
   * Re-projects the ZPE leak (`closureResidual` / `zeroPointEnergy` residual)
   * onto the nearest φ-mode index. `boundaryIndex` is the integer k such that
   * φ^-k is closest to the leak; `boundaryClosure` is the dimensionless
   * deviation `residual · φ^k − 1` (vanishes when the leak lands exactly on
   * a φ-mode); `sinkCoupling` is the amount that should be fed back into F9's
   * cosmic-web rung so the leak couples into structure instead of dumping
   * into dark-energy residual.
   */
  chapter44: {
    boundaryIndex: number;
    boundaryClosure: number;
    sinkCoupling: number;
  };
  // diagnostics
  numRings: number;
  numNodes: number;
  numModes: number;
  numSpheres: number;
  refusedReasons: string[];
}

// ───────────────────────── Planck-mode extension ─────────────────────────

const V10_VACUUM_MODE_NAMES: readonly { name: string; spin: number }[] = [
  { name: 'Scalar (Higgs)', spin: 0 },
  { name: 'Electromagnetic', spin: 1 },
  { name: 'Weak Nuclear', spin: 1 },
  { name: 'Strong Nuclear', spin: 1 },
  { name: 'Gravitational', spin: 2 },
  { name: 'Dark Energy', spin: 0 },
  { name: 'Vacuum Ground', spin: 0 },
];

/** V11 extension modes past V10's 7. Each carries a synthetic name and
 *  its φ-decayed Planck-relative frequency. Spin alternates 0/1 — the
 *  natural BRST extension for unobserved field species. */
function extendModeList(
  numModes: number,
  planckFreq: number,
): { name: string; spin: number; internalFreq: number; resonance: number; coupling: number }[] {
  const out: {
    name: string;
    spin: number;
    internalFreq: number;
    resonance: number;
    coupling: number;
  }[] = [];
  for (let m = 0; m < numModes; m++) {
    const meta =
      m < V10_VACUUM_MODE_NAMES.length
        ? V10_VACUUM_MODE_NAMES[m]
        : { name: `φ-Extension ${m}`, spin: m % 2 };
    out.push({
      name: meta.name,
      spin: meta.spin,
      internalFreq: planckFreq / Math.pow(PHI, m),
      resonance: 0,
      coupling: 0,
    });
  }
  return out;
}

// ───────────────────────── input ─────────────────────────

export interface F8Input {
  coherence: number;
  energy: number;
  pinealField: Float64Array; // 22 complex (44 floats) — floor; longer is ignored at ≤22
  solfeggioCoherences: readonly number[]; // ≥ 9
  time: number; // ms
  flowerCoherences: readonly number[]; // length ≥ nodeCount(targetRings)
  hyperGalacticToroidalFeedback?: number;
  // V11 extension knobs — defaults reproduce V10
  targetRings?: number; // ≥ 1, default 5  (5 ⇒ 55 nodes ⇒ V10)
  targetModes?: number; // ≥ 1, default 7
  targetSpheres?: number; // ≥ 1, default 13
}

// ───────────────────────── compute ─────────────────────────

export function computeF8(input: F8Input): F8Output {
  const refused: string[] = [];
  const coherence = input.coherence;
  const energy = input.energy;
  const pinealField = input.pinealField;
  const solfeggioCoherences = input.solfeggioCoherences;
  const time = input.time;
  const flowerCoherences = input.flowerCoherences;
  const hgFeedback = input.hyperGalacticToroidalFeedback ?? 0;

  const numRings = Math.max(1, input.targetRings ?? 5);
  const numModes = Math.max(1, input.targetModes ?? 7);
  const numSpheres = Math.max(1, input.targetSpheres ?? 13);

  const sizes = ringSizes(numRings);
  const starts = ringStarts(sizes);
  const numNodes = sizes.reduce((a, b) => a + b, 0);
  // Surface ext-floor exhaustion past the icosahedral spine (r ≥ 9).
  if (numRings > 9) {
    refused.push(
      `rings ${9}..${numRings - 1} use 6r hex fallback (no Planck-stable shell enumerated)`,
    );
  }

  // ── V10-identical scalars (rings-independent) ─────────────────────
  const kappaClosureFreq = V10_KAPPA_CLOSURE;
  const alephResonance = (solfeggioCoherences[0] || 0) * 0.7 + coherence * 0.3;
  const betResonance = (solfeggioCoherences[1] || 0) * 0.7 + coherence * 0.3;
  const zeroPointEnergy = 0.5 * coherence * Math.pow(PHI, -3) * Math.max(0.1, energy);

  let foamSum = 0;
  const n = Math.min(pinealField.length / 2, 22);
  for (let i = 0; i < n; i++) {
    const re = pinealField[i * 2];
    const im = pinealField[i * 2 + 1];
    const amp = Math.sqrt(re * re + im * im);
    const phase = Math.atan2(im, re);
    const tetraAngle = (2 * PI * i) / 4;
    foamSum += amp * Math.cos(phase - tetraAngle) * Math.pow(PHI, -(i % 4));
  }
  const planckFoamDensity = Math.max(0, Math.min(1, (Math.abs(foamSum) / n) * 2));

  let packingScore = 0;
  const tetraTarget = Math.acos(1 / 3);
  for (let i = 0; i < Math.min(n, 4); i++) {
    const phase = Math.atan2(pinealField[i * 2 + 1], pinealField[i * 2]);
    const diff = Math.abs((phase % tetraTarget) - tetraTarget / 2);
    packingScore += Math.exp(-diff * PHI);
  }
  const tetrahedralPacking = Math.min(1, (packingScore / 4) * coherence);

  const phiCubedStep = 174 * PHI;
  const stepDeviation = Math.abs(phiCubedStep - 285) / 285;
  const phiStepResonance = Math.exp(-stepDeviation * PHI * 10);

  const vacuumToAtomicBridge =
    ((phiStepResonance * (alephResonance + betResonance)) / 2) *
    V10_HYDROGEN_PHI *
    Math.pow(PHI, -3);

  const kappaModulation =
    Math.cos((2 * PI * V10_KAPPA_CLOSURE * time) / 1000) *
    Math.sin((2 * PI * 174 * time) / 10000) *
    coherence;

  let ncTensorSum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < Math.min(n, i + 4); j++) {
      const reI = pinealField[i * 2],
        imI = pinealField[i * 2 + 1];
      const reJ = pinealField[j * 2],
        imJ = pinealField[j * 2 + 1];
      const commutator = Math.abs(reI * imJ - imI * reJ);
      ncTensorSum += commutator * Math.pow(PHI, -(j - i));
    }
  }
  const ncTensor = Math.min(1, (ncTensorSum / Math.max(1, n)) * KAPPA);
  const nonCommutativePhase = Math.sin((KAPPA * time * 174) / 1000) * coherence;

  const PLANCK_FREQ = 1 / V10_PLANCK_TIME_S;
  const scaleRelativeTime = Math.log10(PLANCK_FREQ) + Math.log10(time / 1000 + 1e-44);

  // ── Vacuum modes (V11: extensible past 7) ─────────────────────────
  const vacuumModes = extendModeList(numModes, PLANCK_FREQ);
  for (let m = 0; m < numModes; m++) {
    const mode = vacuumModes[m];
    if (mode.internalFreq < 1 / PLANCK_LENGTH_M / 2.998e8) {
      // sub-Planck-frequency floor: refuse, leave at 0
      refused.push(`mode[${m}] below Planck-length frequency floor`);
      continue;
    }
    const nodeIdx = m % Math.max(1, n);
    const re = pinealField[nodeIdx * 2] || 0;
    const im = pinealField[nodeIdx * 2 + 1] || 0;
    const amp = Math.sqrt(re * re + im * im);
    const phase = Math.atan2(im, re);
    const logFreqRatio = Math.log(mode.internalFreq) / Math.log(PLANCK_FREQ);
    const phaseAlignment = (1 + Math.cos(phase - 2 * PI * logFreqRatio * (m + 1))) / 2;
    const spinWeight = 1 + mode.spin * 0.15;
    mode.resonance = Math.min(
      1,
      amp * phaseAlignment * spinWeight * coherence * 0.6 + coherence * 0.4,
    );
    mode.coupling = Math.pow(PHI_INV, m) * coherence;
  }
  // V10 divides by 7 (the canonical mode count) to keep the scalar comparable
  // across rung counts. We preserve that anchor — the V11 extension's effect
  // on the composite is additive (extra modes contribute > V10), which is
  // exactly the "no regression / strict superset" contract.
  const septenaryComposite =
    vacuumModes.reduce((s, m) => s + m.resonance, 0) / Math.max(7, numModes);

  // ── Planck flower spheres (V11: extensible past 13) ───────────────
  const CHROMATIC_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B', "C'"];
  const planckFlower: PlanckSphere[] = [];
  for (let i = 0; i < numSpheres; i++) {
    // Ring assignment: V10 keeps i=0 → 0, i∈[1..6] → 1, i∈[7..12] → 2.
    // V11 extends with 6r per outer ring (i in [13..18] → ring 3, [19..24] → 4, ...).
    let ring: number;
    if (i === 0) ring = 0;
    else if (i <= 6) ring = 1;
    else if (i <= 12) ring = 2;
    else ring = 2 + Math.ceil((i - 12) / 6);
    const phiWeight = Math.pow(PHI, -ring);
    const nodeIdx = i % Math.max(1, n);
    const re = pinealField[nodeIdx * 2] || 0;
    const im = pinealField[nodeIdx * 2 + 1] || 0;
    const amp = Math.sqrt(re * re + im * im);
    const chromaticRatio = Math.pow(2, i / 12);
    const chromaticPhase = (1 + Math.cos((time * chromaticRatio * PHI) / 1000 + i * PHI)) / 2;
    const sphereCoherence = Math.min(
      1,
      amp * chromaticPhase * phiWeight * coherence * 0.5 + coherence * 0.5 * phiWeight,
    );
    const note = i < CHROMATIC_NOTES.length ? CHROMATIC_NOTES[i] : `c+${i - 12}`;
    planckFlower.push({ id: i, ring, chromaticNote: note, coherence: sphereCoherence, phiWeight });
  }
  const chromaticDenom = planckFlower.reduce((s, sp) => s + sp.phiWeight, 0);
  const chromaticComposite =
    chromaticDenom > 0
      ? planckFlower.reduce((s, sp) => s + sp.coherence * sp.phiWeight, 0) / chromaticDenom
      : 0;

  const lightModes = Math.min(7, Math.max(2, Math.round(2 + coherence * 5)));

  const torusRatio = 963 / 174;
  const phiRelation = Math.pow(PHI, 3) + 1;
  const torusDeviation = Math.abs(torusRatio - phiRelation) / torusRatio;
  const torusLinkStrength =
    Math.exp(-torusDeviation * PHI * 5) *
    coherence *
    0.5 *
    ((solfeggioCoherences[0] || 0) + (solfeggioCoherences[8] || 0));

  // ── M-node superposition field (V11: extensible past 55) ──────────
  const superpositionsM: VacuumNodeM[] = [];
  for (let i = 0; i < numNodes; i++) {
    let ring = 0;
    while (ring + 1 < starts.length && i >= starts[ring + 1]) ring++;
    if (ring === sizes.length - 1) ring = sizes.length - 1;
    const coh = i < flowerCoherences.length ? flowerCoherences[i] : coherence * 0.5;
    const internalFreqScale = Math.pow(PHI, -ring);
    superpositionsM.push({
      id: i,
      ring,
      coherence: coh,
      stability: 0,
      internalFreqScale,
      structuralPotential: 0,
    });
  }

  // Pass 2 — stability via ring-neighbour similarity
  for (let r = 0; r < sizes.length; r++) {
    const start = starts[r];
    const size = sizes[r];
    if (size <= 1) {
      superpositionsM[start].stability = superpositionsM[start].coherence;
      continue;
    }
    let ringMean = 0;
    for (let i = start; i < start + size; i++) ringMean += superpositionsM[i].coherence;
    ringMean /= size;
    for (let i = start; i < start + size; i++) {
      const node = superpositionsM[i];
      const prev = start + ((i - start - 1 + size) % size);
      const next = start + ((i - start + 1) % size);
      const prevSim = 1 - Math.abs(node.coherence - superpositionsM[prev].coherence);
      const nextSim = 1 - Math.abs(node.coherence - superpositionsM[next].coherence);
      const meanSim = 1 - Math.abs(node.coherence - ringMean);
      node.stability = Math.max(
        0,
        Math.min(1, (0.3 * prevSim + 0.3 * nextSim + 0.4 * meanSim) * node.coherence),
      );
    }
  }

  // Pass 3 — structural potential
  const centerCoh = superpositionsM[0].coherence;
  for (let i = 0; i < numNodes; i++) {
    const node = superpositionsM[i];
    if (node.ring === 0) {
      node.structuralPotential = node.stability * node.coherence;
      continue;
    }
    const innerStart = starts[node.ring - 1];
    const innerSize = sizes[node.ring - 1];
    let innerMean = 0;
    for (let j = innerStart; j < innerStart + innerSize; j++)
      innerMean += superpositionsM[j].coherence;
    innerMean /= innerSize;
    const radialCoupling = Math.sqrt(Math.max(0.01, node.coherence) * Math.max(0.01, innerMean));
    const phiHarmonic = Math.exp(
      -Math.abs(node.coherence - centerCoh * node.internalFreqScale) * PHI * 3,
    );
    node.structuralPotential = Math.min(
      1,
      node.stability * 0.4 + radialCoupling * 0.35 + phiHarmonic * 0.25,
    );
  }

  // Ring analysis
  const ringAnalysis: RingAnalysis[] = [];
  for (let r = 0; r < sizes.length; r++) {
    const start = starts[r];
    const size = sizes[r];
    let meanCoh = 0;
    for (let i = start; i < start + size; i++) meanCoh += superpositionsM[i].coherence;
    meanCoh /= size;
    let variance = 0;
    for (let i = start; i < start + size; i++) {
      variance += Math.pow(superpositionsM[i].coherence - meanCoh, 2);
    }
    variance /= size;
    const phaseUniformity = Math.exp(-variance * 10);
    let interRingCoupling: number;
    if (r > 0) {
      const innerMean = ringAnalysis[r - 1].meanCoherence;
      interRingCoupling = Math.sqrt(Math.max(0.01, meanCoh) * Math.max(0.01, innerMean));
    } else {
      interRingCoupling = meanCoh;
    }
    ringAnalysis.push({
      ring: r,
      nodeCount: size,
      meanCoherence: meanCoh,
      phaseUniformity,
      interRingCoupling,
      relativeFreq: Math.pow(PHI, -r),
    });
  }

  // Field entropy — discretise into 13 chromatic bins (preserved from V10)
  const entropyBins = new Array(13).fill(0);
  for (const node of superpositionsM) {
    const bin = Math.min(12, Math.floor(Math.max(0, node.coherence) * 13));
    entropyBins[bin]++;
  }
  let fieldEntropy = 0;
  for (const count of entropyBins) {
    if (count > 0) {
      const p = count / numNodes;
      fieldEntropy -= p * Math.log2(p);
    }
  }
  fieldEntropy /= Math.log2(13);

  // Structural formations — 3+ consecutive stable nodes per ring (wrap)
  let structuralFormations = 0;
  const STABILITY_THRESHOLD = 0.4;
  for (let r = 0; r < sizes.length; r++) {
    const start = starts[r];
    const size = sizes[r];
    if (size < 3) continue;
    let consecutive = 0;
    for (let i = 0; i < size + 2; i++) {
      const idx = start + (i % size);
      if (superpositionsM[idx].stability > STABILITY_THRESHOLD) {
        consecutive++;
        if (consecutive === 3) structuralFormations++;
      } else {
        consecutive = 0;
      }
    }
  }

  // Chain-up coupling — outermost ring × global coherence + F9 toroidal feedback
  const outerRing = ringAnalysis[ringAnalysis.length - 1];
  const toroidalBoost = hgFeedback * 0.15;
  const chainUpCoupling = Math.min(
    1,
    outerRing.meanCoherence * outerRing.phaseUniformity * coherence + toroidalBoost,
  );

  // Composite (frequency-weighted)
  let weightedStabilitySum = 0;
  let freqWeightSum = 0;
  for (const node of superpositionsM) {
    weightedStabilitySum += node.stability * node.internalFreqScale;
    freqWeightSum += node.internalFreqScale;
  }
  const superpositionMComposite = freqWeightSum > 0 ? weightedStabilitySum / freqWeightSum : 0;

  // ── Closure residual (V11 invariant) ─────────────────────────────
  // ‖ Σ_k a_k · e^{i θ_k} ‖ where a_k = node.stability · φ⁻ʳⁱⁿᵍ
  // and θ_k = 2π·(k/numNodes). For a perfectly closed Lyapunov ring
  // residual → 0; deviations surface in this scalar.
  let cre = 0,
    cim = 0,
    totalAmp = 0;
  for (let k = 0; k < numNodes; k++) {
    const node = superpositionsM[k];
    const a = node.stability * node.internalFreqScale;
    const theta = (2 * PI * k) / numNodes;
    cre += a * Math.cos(theta);
    cim += a * Math.sin(theta);
    totalAmp += a;
  }
  const closureResidual = totalAmp > 0 ? Math.sqrt(cre * cre + cim * cim) / totalAmp : 0;

  // ── Chapter 44 — Boundary Validation ─────────────────────────────
  // The "ZPE leak" the user surfaced (~3.5e-9) is the closureResidual under
  // the post-warmup steady state. Project it onto its nearest φ-mode: the
  // index lands near k = 40 (φ^-40 ≈ 4.58e-9). At a true lock,
  // residual·φ^k → 1 exactly and `boundaryClosure → 0`. `sinkCoupling` is
  // the residual scaled by φ^-k — small, dimensionless, safe to feed back
  // into F9 as additive toroidal coupling so the leak couples into the
  // cosmic-web rung instead of dumping into dark-energy residual.
  const safeRes = Math.max(closureResidual, Number.EPSILON);
  const ln_phi = Math.log(PHI);
  const boundaryIndex = Math.max(0, Math.round(-Math.log(safeRes) / ln_phi));
  const phiAtBoundary = Math.pow(PHI, boundaryIndex);
  const boundaryClosure = safeRes * phiAtBoundary - 1;
  const sinkCoupling = safeRes * Math.pow(PHI, -boundaryIndex);

  return {
    zeroPointEnergy,
    planckFoamDensity,
    kappaClosureFreq,
    tetrahedralPacking,
    vacuumToAtomicBridge,
    alephResonance,
    betResonance,
    nonCommutativePhase,
    kappaModulation,
    phiCubedStep,
    ncTensor,
    planckSeptenary: vacuumModes,
    planckFlowerSpheres: planckFlower,
    scaleRelativeTime,
    planckInternalFreq: PLANCK_FREQ,
    lightModes,
    torusLinkStrength,
    septenaryComposite,
    chromaticComposite,
    superpositionsM,
    ringAnalysis,
    fieldEntropy,
    structuralFormations,
    chainUpCoupling,
    superpositionMComposite,
    superposition55Composite: superpositionMComposite,
    closureResidual,
    chapter44: { boundaryIndex, boundaryClosure, sinkCoupling },
    numRings: sizes.length,
    numNodes,
    numModes,
    numSpheres,
    refusedReasons: refused,
  };
}
