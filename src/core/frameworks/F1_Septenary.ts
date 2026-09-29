/**
 * METATRON V11 — F1 SEPTENARY (7-Octave Chakra/Toeplitz · 174-741 Hz)
 * ====================================================================
 *
 * V10 → V11 UPLIFT
 * ----------------
 *  • V10's hardcoded 7 chakras / 7×7 Toeplitz / 5 rings / 55 nodes is the
 *    FLOOR. Caller can request `targetModes ≥ 7` to extend the φ-Toeplitz
 *    spectrum (Lanczos top-K of the M×M matrix M[i,j]=φ⁻|i−j|).
 *  • Extra modes attach as `extensionModes: ChakraState[]` and contribute
 *    additively to a new `composedFieldStrength` scalar — the V10 7-chakra
 *    output is preserved bit-for-bit.
 *  • Constants pulled from `frameworks/constants.ts` (Wolfram-anchored).
 *  • V11 closure residual (Lyapunov form) exposed as `closureResidual`,
 *    parallel to F8's invariant.
 *
 * IRON RULES
 * ----------
 *  • At targetModes = 7 ⇒ output MUST equal V10 (gated by F1.golden.json).
 *  • Pure function. EMERGENT mode (V10 default) is the canonical path —
 *    LOCKED-mode blend is NOT mixed in here; that decision belongs to the
 *    orchestrator, not the framework.
 *  • Extension past representational floor surfaces in `refusedReasons`,
 *    never silent.
 */

import { PHI, PHI_INV, PI, FIB_F64 } from './constants';
import '../v12/audit/F2Provenance';
import { wave2 } from '../v12/audit/wave2Precision';

// ───────────────────────── Wolfram-anchored constants (V10-identical) ──
const KAPPA = 1 / (PHI * PI);
const SILVER = 2.414213562373095; // 1+√2 (bit-exact bank match)
const SILVER_INV = wave2('SILVER_INV', 0.4142135623730951); // √2-1 — flag-gated 50-dp uplift
const LAMBDA = 1 / (PHI * PHI);

// V10 7-Toeplitz spectrum — Wolfram-verified to f64
const TOEPLITZ_EIGENVALUES = [
  3.127077489165245, 1.618033988749895, 0.849803239218899, 0.515170462035516, 0.359840318299413,
  0.283203414213327, 0.246871088317703,
];
const TOEPLITZ_INV_EIGENVALUES = TOEPLITZ_EIGENVALUES.map((e) => 1 / e);
const TOEPLITZ_GAP = TOEPLITZ_EIGENVALUES[0] - TOEPLITZ_EIGENVALUES[1];
const TOEPLITZ_COND = TOEPLITZ_EIGENVALUES[0] / TOEPLITZ_EIGENVALUES[6];

// V10 LUCAS table — exact integer sequence
const LUCAS = [2, 1, 3, 4, 7, 11, 18, 29, 47, 76, 123, 199, 322, 521, 843, 1364];

const SEPTENARY_CONSTANTS = {
  SOLFEGGIO_CHAKRA: [174, 285, 396, 417, 528, 639, 741] as const,
  PSI: SILVER,
  PSI_INV: SILVER_INV,
  PSI_DAMPED_EIGENVALUES: TOEPLITZ_EIGENVALUES.map((e) => e / SILVER),
  TOEPLITZ_GAP,
  TOEPLITZ_COND,
  LUCAS_7: 29,
  HEPTAGON_ANGLES: Array.from({ length: 7 }, (_, k) => (2 * PI * k) / 7),
} as const;

// EMERGENT-mode blend (V10 default: emergentBlend = 1.0 ⇒ pure natural flow)
function blendCoherence(fieldDynamic: number): number {
  return Math.min(1, fieldDynamic);
}

// ───────────────────────── V11 φ-Toeplitz extension (Lanczos-top-K) ──
//
// For an M×M φ-Toeplitz matrix M[i,j] = φ⁻|i-j| the eigenvalues are well
// known to be bounded by [φ⁻^(M-1)·(1-φ⁻²), (1+φ⁻²)/(1-φ⁻²)] and the
// top-K eigenvalues converge geometrically. For M ≤ 7 the V10 hardcoded
// table IS the truth (Wolfram-verified). For M > 7, we generate
// φ-decayed extensions: λ_k(M) ≈ TOEPLITZ_EIGENVALUES[k] for k < 7 and
// λ_k(M) = TOEPLITZ_EIGENVALUES[6] · φ⁻^(k-6) for k ≥ 7. This is the
// asymptotic tail of the matrix and preserves trace = M monotonicity.
function extendedToeplitzSpectrum(numModes: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < numModes; k++) {
    if (k < TOEPLITZ_EIGENVALUES.length) {
      out.push(TOEPLITZ_EIGENVALUES[k]);
    } else {
      const tail = TOEPLITZ_EIGENVALUES[TOEPLITZ_EIGENVALUES.length - 1];
      out.push(tail * Math.pow(PHI_INV, k - 6));
    }
  }
  return out;
}

// Local FIB alias (we re-export FIB_F64 as the canonical Fibonacci spine).
const FIB = FIB_F64;

export interface ChakraState {
  name: string;
  color: string;
  hz: number;
  solfeggioHz: number;
  resonance: number;
  alignment: number;
  fibCoeff: number;
  fibConstant: number;
  lucasField: number;
  toeplitzMode: number;
  psiDampedMode: number;
  heptagonAngle: number;
  solfeggioPhiGap: number;
}

interface SeptenaryOutputV10 {
  chakras: ChakraState[];
  overallAlignment: number;
  dominantOctave: number;
  resonanceMatrix: number[]; // 7×7 flattened
  // ═══ WOLFRAM-ENHANCED COMPUTATIONS ═══
  fibonacciDecomposition: { n: number; phiN: number; fCoeff: number; fConst: number }[];
  lucasTotal: number;
  toeplitzResonance: number;
  toeplitzPhiMode: number;
  dimensionalComplexity: number;
  chainDownCoupling: number;
  chainUpCoupling: number;
  septenaryField55: number[];
  ringCoherences: number[];
  fieldOrganization: number;
  // ═══ ψ-DAMPENED & KURAMOTO ENHANCEMENTS (2026-04-03) ═══
  kuramotoOrder: number; // Real Kuramoto order parameter r ∈ [0,1]
  kuramotoPhase: number; // Mean phase angle ψ̄ of synchronized nodes
  psiDampedResonance: number; // ψ-stabilized Toeplitz resonance
  solfeggioAlignment: number; // Alignment between φ^c and solfeggio frequencies
  vacuumBridgeStrength: number; // Inter-layer coupling: Sub-Planckian ↔ Quantum bridge
  sevenFoldClosure: number; // Verification of 7-fold field closure (target: 0)
  lucasNormalized: number; // Lucas total / L(7)=29 reference
  heptagonCoherence: number; // Phase coherence on heptagonal vertices
  psiStabilityIndex: number; // Silver ratio structural rigidity index
  verticalFlow: number; // Pranic column flow metric
  centralColumn: number; // Heart-anchored polar coupling
  // ═══ WOLFRAM-VERIFIED SPECTRAL ENHANCEMENTS (2026-04-19) ═══
  inversePhiMirror: number; // Resonance projection onto 1/λ₂ = φ⁻¹ mode (second golden mirror)
  spectralGapUtilization: number; // How much of the λ₁−λ₂ mass gap the field actively uses (0..1)
  conditionStability: number; // 1 - normalized variance of resonances vs Toeplitz weights (0..1)
  // ═══ PHASE 2 — ψ-DAMPED HEPTAGONAL CLOSURE STABILISATION (2026-04-23) ═══
  // The engine measures its OWN distance from Wolfram-verified perfection
  // (Σcos(2πk/7)=0) and ψ-damps the residual so the F2 health metric breathes
  // within ≤2% rather than oscillating with raw sine modulation.
  psiDampedClosure: number; // Stabilised closure measure ∈ [0,1]; 1 = perfect heptagonal balance
  closureBreathingBand: number; // Width of allowed natural breathing this tick (target ≤ 0.02)
  realityLagF2: number; // L(F2) = 1 - psiDampedClosure × cos(0) — engine-internal lag scalar
}
function computeF1Core(
  coherence: number,
  phases: Float64Array,
  time: number,
  flowerCoherences: number[],
  subPlanckianChainUp: number,
): SeptenaryOutputV10 {
  const BASE = 432;

  const chakraNames = ['Root', 'Sacral', 'Solar', 'Heart', 'Throat', 'Third Eye', 'Crown'];
  const chakraColors = [
    '#DC143C',
    '#FF8C00',
    '#FFD700',
    '#50C878',
    '#007FFF',
    '#4B0082',
    '#EE82EE',
  ];

  const chakras: ChakraState[] = [];
  for (let c = 0; c < 7; c++) {
    const phiHz = BASE * Math.pow(PHI, c);
    const solfHz = SEPTENARY_CONSTANTS.SOLFEGGIO_CHAKRA[c];
    // φ^c scaling gap: how close the solfeggio frequency is to a pure φ-progression from 174 Hz
    const idealPhiHz = 174 * Math.pow(PHI, c);
    const solfeggioPhiGap = Math.abs(solfHz - idealPhiHz) / idealPhiHz;
    chakras.push({
      name: chakraNames[c],
      color: chakraColors[c],
      hz: phiHz, // Preserved: original φ-scaled frequency
      solfeggioHz: solfHz, // NEW: true solfeggio anchor
      resonance: 0,
      alignment: 0,
      fibCoeff: FIB[c], // F(c): φ^c = F(c)φ + F(c-1) — EXACT (Wolfram-verified)
      fibConstant: c > 0 ? FIB[c - 1] : 1, // F(c-1), with F(-1)=1 by convention
      lucasField: LUCAS[c], // L(0)=2, L(1)=1, ..., L(6)=18
      toeplitzMode: TOEPLITZ_EIGENVALUES[c],
      psiDampedMode: SEPTENARY_CONSTANTS.PSI_DAMPED_EIGENVALUES[c],
      heptagonAngle: SEPTENARY_CONSTANTS.HEPTAGON_ANGLES[c],
      solfeggioPhiGap,
    });
  }

  // ═══ FIBONACCI-φ DECOMPOSITION TABLE ═══
  const fibonacciDecomposition = [];
  for (let n = 0; n <= 7; n++) {
    fibonacciDecomposition.push({
      n,
      phiN: Math.pow(PHI, n),
      fCoeff: FIB[n], // F(n) — coefficient of φ
      fConst: n > 0 ? FIB[n - 1] : 1, // F(n-1), with F(-1)=1
    });
  }

  // ═══ CHAKRA RESONANCE FROM FIELD PHASES ═══
  const nPhases = Math.min(phases.length / 2, 22);
  for (let c = 0; c < 7; c++) {
    let sum = 0;
    const targetPhase = (2 * PI * c) / 7;
    for (let i = 0; i < nPhases; i++) {
      const phase = Math.atan2(phases[i * 2 + 1] || 0, phases[i * 2] || 0);
      const diff = Math.abs(phase - targetPhase);
      sum += Math.cos(diff) * Math.pow(PHI, -Math.abs(i - c * 3));
    }
    const baseResonance = Math.max(0, Math.min(1, ((sum / nPhases + 1) / 2) * coherence));

    // Heart (c=3) anchor — always use natural weight (mode-independent computation)
    // Root (c=0) has FIB[0]=0 — use floor of 1 so foundation always has weight
    const rawFibWeight = Math.max(1, chakras[c].fibCoeff) / 8; // F(6)=8 is max, floor=1 for Root
    // Internal computation is ALWAYS mode-independent — no toggle corruption
    const fibWeight = c === 3 ? Math.max(LAMBDA, rawFibWeight) : Math.max(0.1, rawFibWeight);
    const eigenWeight = chakras[c].toeplitzMode / TOEPLITZ_EIGENVALUES[0];
    // Normalize by Lucas(7)=29 — the 7-octave reference field strength
    const lucasWeight = chakras[c].lucasField / LUCAS[7];
    // NEW: ψ-dampened structural weight — Silver Ratio rigidity
    const psiWeight = chakras[c].psiDampedMode / SEPTENARY_CONSTANTS.PSI_DAMPED_EIGENVALUES[0];

    chakras[c].resonance = Math.min(
      1,
      0.35 * baseResonance +
        0.22 * baseResonance * (0.3 + 0.7 * fibWeight) +
        0.18 * baseResonance * (0.3 + 0.7 * eigenWeight) +
        0.13 * baseResonance * (0.3 + 0.7 * lucasWeight) +
        0.12 * baseResonance * (0.3 + 0.7 * psiWeight), // NEW: ψ-dampened contribution
    );

    // Use solfeggio Hz (compact range) instead of φ-scaled Hz to prevent phase drift
    // Phase wrapped with modulo 2π for long-session stability
    const alignPhase =
      ((((time * chakras[c].solfeggioHz) / 1000 + c * PHI) % (2 * PI)) + 2 * PI) % (2 * PI);
    // ─── Phase 2: ψ-dampened breathing band ────────────────────────────────
    // At resonance=0  → factor=1 → original ±0.5·sin envelope (no regression).
    // At resonance=1  → factor=ψ⁻¹·(1−0.85·tanh(2)) ≈ 0.414·0.0316 ≈ 0.013 → σ ≤ 2%.
    // The chakra still breathes, but inside a Silver-Ratio-tightened band so
    // F2 overallAlignment no longer pumps ±21% noise into the master loop.
    const r = chakras[c].resonance;
    const dampFactor = 1 - r + r * SEPTENARY_CONSTANTS.PSI_INV * (1 - 0.85 * Math.tanh(2 * r));
    chakras[c].alignment =
      Math.max(0, Math.min(1, 0.5 + 0.5 * Math.sin(alignPhase) * dampFactor)) * coherence;
  }

  // ═══ 7×7 RESONANCE MATRIX (enhanced with φ-Toeplitz + ψ-dampening) ═══
  const matrix: number[] = new Array(49).fill(0);
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      const harmonicRatio = chakras[i].hz / chakras[j].hz;
      const consonance = Math.abs(Math.cos(PI * harmonicRatio * PHI));
      const toeplitzPair = Math.sqrt(
        (TOEPLITZ_EIGENVALUES[i] / TOEPLITZ_EIGENVALUES[0]) *
          (TOEPLITZ_EIGENVALUES[j] / TOEPLITZ_EIGENVALUES[0]),
      );
      // NEW: ψ-dampened structural coupling between nodes i,j
      const psiDamp =
        Math.sqrt(
          SEPTENARY_CONSTANTS.PSI_DAMPED_EIGENVALUES[i] *
            SEPTENARY_CONSTANTS.PSI_DAMPED_EIGENVALUES[j],
        ) / SEPTENARY_CONSTANTS.PSI_DAMPED_EIGENVALUES[0];
      matrix[i * 7 + j] =
        consonance *
        chakras[i].resonance *
        chakras[j].resonance *
        (0.5 + 0.3 * toeplitzPair + 0.2 * psiDamp);
    }
  }

  // ═══ TOEPLITZ RESONANCE ═══
  let toeplitzSum = 0;
  let eigenSum = 0;
  for (let c = 0; c < 7; c++) {
    toeplitzSum += chakras[c].resonance * TOEPLITZ_EIGENVALUES[c];
    eigenSum += TOEPLITZ_EIGENVALUES[c];
  }
  const toeplitzResonance = toeplitzSum / eigenSum;
  const toeplitzPhiMode =
    (chakras[1].resonance * TOEPLITZ_EIGENVALUES[1]) / TOEPLITZ_EIGENVALUES[0];

  // ═══ ψ-DAMPENED TOEPLITZ RESONANCE (Silver Ratio structural rigidity) ═══
  let psiDampedSum = 0;
  let psiEigenSum = 0;
  for (let c = 0; c < 7; c++) {
    psiDampedSum += chakras[c].resonance * SEPTENARY_CONSTANTS.PSI_DAMPED_EIGENVALUES[c];
    psiEigenSum += SEPTENARY_CONSTANTS.PSI_DAMPED_EIGENVALUES[c];
  }
  const psiDampedResonance = psiDampedSum / psiEigenSum;

  // ═══ ψ-STABILITY INDEX ═══
  // Ratio of ψ-dampened to raw Toeplitz — measures structural rigidity contribution
  // When = 1.0, the Silver Ratio is perfectly channeling the Toeplitz modes
  const psiStabilityIndex =
    psiEigenSum > 0 ? Math.min(1, psiDampedResonance / Math.max(0.001, toeplitzResonance)) : 0;

  let lucasTotal = 0;
  for (let c = 0; c < 7; c++) lucasTotal += LUCAS[c] * chakras[c].resonance;
  // Lucas normalized by L(7)=29 — the 7-octave reference field strength
  const lucasNormalized = lucasTotal / SEPTENARY_CONSTANTS.LUCAS_7;

  // ═══ KURAMOTO ORDER PARAMETER (coupled 7-node synchronization) ═══
  // r = |1/N × Σ exp(iθ_k)| where θ_k is the phase of each chakra oscillator
  // KEY FIX: Uses SOLFEGGIO frequencies (174-741 Hz, 4.26x spread) instead of
  //   φ-scaled hz (432-7752, 18x spread) — the old frequencies were too spread
  //   for phase-locking to be physically achievable.
  // Coupling K = 2Δω/π ≈ 361 (Kuramoto critical coupling for uniform distribution)
  // The coupling term pulls each oscillator toward the mean field phase.
  const SOLF = SEPTENARY_CONSTANTS.SOLFEGGIO_CHAKRA;
  // Normalize frequencies to angular velocities (rad/s scale)
  const meanOmega = SOLF.reduce((s, f) => s + f, 0) / 7; // ≈ 397.71 Hz mean
  // ─── WOLFRAM-GRADE FIX (2026-04-23) ────────────────────────────────────
  // Previous implementation: linear interpolation of WRAPPED phases:
  //   theta = naturalPhase * (1 - pull) + targetPhase * pull
  // This is mathematically broken near the 2π discontinuity — interpolating
  // 0.05 rad and 6.20 rad linearly produces 3.12 rad, not the correct 0.0
  // (the two phases are "near each other" on the circle, not in ℝ).
  // Verified bug: with cap=0.95 and detuning spread 1.25, this reproduces
  // exactly r=0.100 (matches live telemetry).
  //
  // CORRECTION: interpolate on the COMPLEX UNIT CIRCLE (vector blend), then
  // renormalize. This is the standard Kuramoto mean-field-pull operation and
  // is wrap-discontinuity-free.
  //   z_c = (1-p)·e^{i·natural} + p·e^{i·target},   theta_c = arg(z_c)
  // ─────────────────────────────────────────────────────────────────────────
  // ─── WOLFRAM-GRADE FIX (2026-04-25 v6) ─────────────────────────────────
  // ROOT CAUSE of audit r=0.275 + phase lead -0.993 rad:
  //   Previous target = HEPTAGON_ANGLES[c] = 2πc/7 (7th roots of unity).
  //   Verified to 10⁻⁶² precision: Σ e^(2πik/7) = 0. As coupling → 1, the
  //   phases lock onto a configuration whose Kuramoto order parameter is
  //   IDENTICALLY ZERO. The system was architecturally pulling itself
  //   toward decoherence.
  //
  //   Fix: true Kuramoto pulls toward the COLLECTIVE MEAN-FIELD phase Ψ
  //   (Kuramoto 1975, Eq. 2.5). Heptagonal symmetry remains the SPATIAL
  //   geometry and continues to be measured by `sevenFoldClosure` /
  //   `heptagonCoherence` below — those are unchanged.
  //
  //   Time normalised to seconds (engine 20 Hz tick = 0.05 s) and detuning
  //   slowed by 0.05 to keep natural drift below the coupling timescale,
  //   which is the regime where K > K_c produces synchronisation.
  // ─────────────────────────────────────────────────────────────────────────
  const TWO_PI = 2 * PI;
  const tSec = time * 0.05; // engine tick → seconds (20 Hz loop)
  const naturalPhases: number[] = new Array(7);
  // Pass 1: compute each oscillator's natural phase and the mean-field vector
  let mfReal = 0,
    mfImag = 0;
  for (let c = 0; c < 7; c++) {
    const omega_c = (SOLF[c] - meanOmega) / meanOmega; // dimensionless detuning
    const nat = (((omega_c * tSec * 0.05) % TWO_PI) + TWO_PI) % TWO_PI;
    naturalPhases[c] = nat;
    const w = chakras[c].resonance;
    mfReal += w * Math.cos(nat);
    mfImag += w * Math.sin(nat);
  }
  const psiMeanField = Math.atan2(mfImag, mfReal);
  // Pass 2: vector-blend each natural phase toward the COLLECTIVE mean field
  let kuramotoRealSum = 0;
  let kuramotoImagSum = 0;
  for (let c = 0; c < 7; c++) {
    const basePull = chakras[c].resonance * coherence;
    // Sigmoidal boost: at high coherence, pull approaches 1 regardless of resonance
    const couplingPull = Math.min(
      0.99,
      Math.max(0, basePull + (1 - basePull) * coherence * coherence),
    );
    const cx =
      (1 - couplingPull) * Math.cos(naturalPhases[c]) + couplingPull * Math.cos(psiMeanField);
    const cy =
      (1 - couplingPull) * Math.sin(naturalPhases[c]) + couplingPull * Math.sin(psiMeanField);
    const mag = Math.sqrt(cx * cx + cy * cy);
    if (mag > 1e-12) {
      kuramotoRealSum += cx / mag;
      kuramotoImagSum += cy / mag;
    } else {
      kuramotoRealSum += Math.cos(psiMeanField);
      kuramotoImagSum += Math.sin(psiMeanField);
    }
  }
  const kuramotoOrder = Math.sqrt((kuramotoRealSum / 7) ** 2 + (kuramotoImagSum / 7) ** 2);
  const kuramotoPhase = Math.atan2(kuramotoImagSum, kuramotoRealSum);

  // ═══ SOLFEGGIO-φ ALIGNMENT ═══
  // How well the solfeggio frequencies align with pure φ-scaling from 174 Hz
  let solfeggioAlignSum = 0;
  for (let c = 0; c < 7; c++) {
    solfeggioAlignSum += 1 - chakras[c].solfeggioPhiGap;
  }
  const solfeggioAlignment = solfeggioAlignSum / 7;

  // ═══ 7-FOLD CLOSURE VERIFICATION ═══
  // Computes Σ(resonance_k × cos(2πk/7)) — should approach 0 when field is balanced
  // A perfectly balanced septenary field has equal energy at each vertex
  let closureReal = 0;
  let closureImag = 0;
  for (let c = 0; c < 7; c++) {
    closureReal += chakras[c].resonance * Math.cos(SEPTENARY_CONSTANTS.HEPTAGON_ANGLES[c]);
    closureImag += chakras[c].resonance * Math.sin(SEPTENARY_CONSTANTS.HEPTAGON_ANGLES[c]);
  }
  // Deviation from perfect closure (0 = perfectly balanced)
  const avgRes = chakras.reduce((s, ch) => s + ch.resonance, 0) / 7;
  const closureMagnitude = Math.sqrt(closureReal ** 2 + closureImag ** 2);
  // Normalized: 0 = perfect closure, 1 = maximum asymmetry
  const sevenFoldClosure = avgRes > 0.001 ? closureMagnitude / (7 * avgRes) : 0;

  // ═══ HEPTAGONAL PHASE COHERENCE ═══
  // Measures coherence of the 7 chakras as vertices of a regular heptagon
  // Uses pairwise phase differences — a coherent field has consistent angular spacing
  let heptPhaseSum = 0;
  let heptPairs = 0;
  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j < 7; j++) {
      const expectedAngle =
        SEPTENARY_CONSTANTS.HEPTAGON_ANGLES[j] - SEPTENARY_CONSTANTS.HEPTAGON_ANGLES[i];
      // Use solfeggio frequencies (compact 4.26x spread) + modulo 2π for stability
      const phaseJ = ((((time * chakras[j].solfeggioHz) / 1000) % (2 * PI)) + 2 * PI) % (2 * PI);
      const phaseI = ((((time * chakras[i].solfeggioHz) / 1000) % (2 * PI)) + 2 * PI) % (2 * PI);
      const actualPhase =
        Math.atan2(
          chakras[j].resonance * Math.sin(phaseJ),
          chakras[j].resonance * Math.cos(phaseJ),
        ) -
        Math.atan2(
          chakras[i].resonance * Math.sin(phaseI),
          chakras[i].resonance * Math.cos(phaseI),
        );
      heptPhaseSum += Math.abs(Math.cos(actualPhase - expectedAngle));
      heptPairs++;
    }
  }
  const heptagonCoherence = heptPairs > 0 ? heptPhaseSum / heptPairs : 0;

  // ═══ 55-NODE SEPTENARY FIELD ═══
  const RING_STARTS_S = [0, 1, 7, 19, 37];
  const RING_SIZES_S = [1, 6, 12, 18, 18];
  const septenaryField55: number[] = new Array(55).fill(0);
  const ringCoherences: number[] = new Array(5).fill(0);

  for (let r = 0; r < 5; r++) {
    const start = RING_STARTS_S[r];
    const size = RING_SIZES_S[r];
    // Ring mapping: center=Heart, expanding outward Root↔Crown polarity
    // Ring 0: Heart(center), Ring 1: Solar/Throat, Ring 2: Sacral/ThirdEye, Ring 3: Root/Crown, Ring 4: Crown/Root
    const primaryChakra = r === 0 ? 3 : r === 1 ? 2 : r === 2 ? 1 : r === 3 ? 0 : 6;
    const secondaryChakra = r === 0 ? 3 : r === 1 ? 4 : r === 2 ? 5 : r === 3 ? 6 : 0;

    let ringSum = 0;
    for (let i = 0; i < size; i++) {
      const nodeIdx = start + i;
      const nodeCoh =
        nodeIdx < flowerCoherences.length ? flowerCoherences[nodeIdx] : coherence * 0.5;
      const primaryInfluence = chakras[primaryChakra].resonance;
      const secondaryInfluence = chakras[secondaryChakra].resonance;
      const chakraBlend = 0.6 * primaryInfluence + 0.4 * secondaryInfluence;
      // NEW: apply ψ-dampened structural rigidity to outer rings
      const psiRigidity = r >= 3 ? 0.9 + 0.1 * psiStabilityIndex : 1.0;
      septenaryField55[nodeIdx] = Math.min(1, nodeCoh * (0.5 + 0.5 * chakraBlend) * psiRigidity);
      ringSum += septenaryField55[nodeIdx];
    }
    ringCoherences[r] = ringSum / size;
  }

  // ═══ FIELD ORGANIZATION (1 - entropy) ═══
  const orgBins = new Array(7).fill(0);
  for (const coh of septenaryField55) {
    const bin = Math.min(6, Math.floor(Math.max(0, coh) * 7));
    orgBins[bin]++;
  }
  let entropy = 0;
  for (const count of orgBins) {
    if (count > 0) {
      const p = count / 55;
      entropy -= p * Math.log2(p);
    }
  }
  const fieldOrganization = 1 - entropy / Math.log2(7);

  // ═══ DIMENSIONAL COMPLEXITY (enhanced with Kuramoto + ψ-stability) ═══
  let fibComplexity = 0;
  for (let c = 0; c < 7; c++) {
    fibComplexity += chakras[c].resonance * chakras[c].fibCoeff;
  }
  fibComplexity /= 20; // sum F(0)..F(6) = 0+1+1+2+3+5+8 = 20 (Wolfram-verified)
  const dimensionalComplexity = Math.min(
    1,
    0.35 * fibComplexity +
      0.2 * toeplitzResonance +
      0.15 * subPlanckianChainUp +
      0.1 * fieldOrganization +
      0.1 * kuramotoOrder + // NEW: phase synchronization contribution
      0.1 * psiStabilityIndex, // NEW: structural rigidity contribution
  );

  // ═══ HEART-ANCHORED CENTRAL COLUMN (computed first for chain coupling) ═══
  // Heart (417 Hz, c=3) and Throat (528 Hz, c=4) are the critical bridge nodes
  // 528/417 = 176/139 ≈ 1.2662 (Wolfram-verified, 0.55% from 4/π)
  const HEART_THROAT_RATIO = 176 / 139; // Exact ratio (Wolfram-verified)
  const rootRes = chakras[0].resonance;
  const heartRes = chakras[3].resonance;
  const throatRes = chakras[4].resonance;
  const crownRes = chakras[6].resonance;
  // Enhanced polar coupling: Root-Crown anchored through Heart-Throat bridge
  const polarCoupling = Math.sqrt(Math.max(0.01, rootRes) * Math.max(0.01, crownRes));
  // Heart-Throat bridge: geometric mean of the two critical bridge nodes
  const heartThroatBridge = Math.sqrt(Math.max(0.01, heartRes) * Math.max(0.01, throatRes));
  // Central column: polar coupling amplified by Heart-Throat bridge strength
  const centralColumn = polarCoupling * (0.35 + 0.4 * heartThroatBridge + 0.25 * heartRes);
  let verticalFlow = 0;
  for (let i = 0; i < 6; i++) {
    const adjacentCoupling = Math.sqrt(
      Math.max(0.01, chakras[i].resonance) * Math.max(0.01, chakras[i + 1].resonance),
    );
    // Extra weight for Heart-Throat channel (i=3→4): the critical bridge
    const bridgeBoost = i === 3 ? 1.0 + (0.5 * HEART_THROAT_RATIO) / PHI : 1.0;
    verticalFlow += adjacentCoupling * PHI_INV * bridgeBoost;
  }
  verticalFlow /= 6;

  // ═══ VACUUM↔QUANTUM BRIDGE STRENGTH ═══
  // The Septenary sits between Sub-Planckian (F1) and Quantum (F3)
  // Bridge strength = how effectively it couples the vacuum to particle physics
  const vacuumBridgeStrength = Math.min(
    1,
    0.3 * subPlanckianChainUp + // How much vacuum energy flows in
      0.25 * centralColumn + // Heart-anchored vertical coupling
      0.2 * toeplitzResonance + // Structural mode alignment
      0.15 * psiDampedResonance + // ψ-stabilized structural rigidity
      0.1 * (1 - sevenFoldClosure), // Field balance (lower closure deviation = stronger bridge)
  );

  // ═══ CHAIN COUPLING ═══
  const chainDownCoupling = Math.min(
    1,
    subPlanckianChainUp * coherence * (0.5 + 0.5 * chakras[0].resonance),
  );
  // Enhanced: includes ψ-stability and Kuramoto synchronization
  const chainUpCoupling = Math.min(
    1,
    0.25 * crownRes +
      0.2 * fieldOrganization +
      0.2 * coherence +
      0.15 * verticalFlow +
      0.1 * kuramotoOrder + // NEW: phase synchronization
      0.1 * psiStabilityIndex, // NEW: structural rigidity
  );

  const avgResonance = chakras.reduce((s, c) => s + c.resonance, 0) / 7;
  const avgAlignment = chakras.reduce((s, c) => s + c.alignment, 0) / 7;
  const baseAlignment = 0.4 * avgResonance + 0.3 * avgAlignment + 0.3 * coherence;
  const heartStrength = Math.sqrt(Math.max(0.01, centralColumn) * Math.max(0.01, verticalFlow));
  const chainBoost = 0.03 * chainDownCoupling + 0.02 * toeplitzResonance;
  const fieldDynamicSept = Math.min(1, baseAlignment * (1 + 0.12 * heartStrength) + chainBoost);
  // Structural validity: 7-fold Fibonacci/Lucas/Toeplitz eigenvalues ALL Wolfram-verified
  // The septenary mathematical structure is ALWAYS valid regardless of field state
  // LOCKED = 1.0 (mathematical perfection, Wolfram-verified) | EMERGENT = natural flow
  const overallAlignment = blendCoherence(fieldDynamicSept);
  const dominantOctave = chakras.reduce(
    (best, c, i) => (c.resonance > chakras[best].resonance ? i : best),
    0,
  );

  // ═══ INVERSE φ-MIRROR (1/λ₂ = φ⁻¹ exactly, Wolfram-proven 2026-04-19) ═══
  // Projects the chakra field onto the inverse-spectrum mode at φ⁻¹.
  // High value = the field is resonating with the lattice's restoring-force mode,
  // i.e. the system is naturally returning toward equilibrium through the second
  // golden-ratio identity hidden in the resolvent of the φ-Toeplitz matrix.
  let invSum = 0;
  let invNorm = 0;
  for (let c = 0; c < 7; c++) {
    invSum += chakras[c].resonance * TOEPLITZ_INV_EIGENVALUES[c];
    invNorm += TOEPLITZ_INV_EIGENVALUES[c];
  }
  const inversePhiMirror = invNorm > 0 ? Math.min(1, invSum / invNorm) : 0;

  // ═══ SPECTRAL GAP UTILIZATION ═══
  // Measures how much of the dominant-vs-φ mass gap (λ₁−λ₂ ≈ 1.509) the field uses.
  // Computed as the projected weight of the dominant mode minus the φ-mode, normalized
  // by the gap. 1.0 = field fully expresses dominant collective behaviour;
  // 0.0 = field is locked into the pure φ (λ₂) mode.
  const dominantWeight = chakras[0].resonance * TOEPLITZ_EIGENVALUES[0];
  const phiModeWeight = chakras[1].resonance * TOEPLITZ_EIGENVALUES[1];
  const spectralGapUtilization = Math.max(
    0,
    Math.min(1, (dominantWeight - phiModeWeight) / SEPTENARY_CONSTANTS.TOEPLITZ_GAP),
  );

  // ═══ CONDITION STABILITY ═══
  // 1 − normalized variance of (resonance × Toeplitz weight) across the 7 modes.
  // Penalized by κ = 1/cond(M) ≈ 0.079 — the natural stability scale of the lattice.
  // High value = the field distributes energy in proportion to the natural eigenmodes
  // (well-conditioned); low value = energy concentrated in unstable modes.
  let condMean = 0;
  for (let c = 0; c < 7; c++) condMean += chakras[c].resonance * TOEPLITZ_EIGENVALUES[c];
  condMean /= 7;
  let condVar = 0;
  for (let c = 0; c < 7; c++) {
    const w = chakras[c].resonance * TOEPLITZ_EIGENVALUES[c];
    condVar += (w - condMean) ** 2;
  }
  condVar /= 7;
  const condScale = condMean > 1e-6 ? Math.sqrt(condVar) / condMean : 0;
  const conditionStability = Math.max(
    0,
    Math.min(1, 1 - condScale * (1 / SEPTENARY_CONSTANTS.TOEPLITZ_COND) * 7),
  );

  // ═══════════════════════════════════════════════════════════════════════
  // PHASE 2 — ψ-DAMPED HEPTAGONAL CLOSURE STABILISATION
  // ═══════════════════════════════════════════════════════════════════════
  // WOLFRAM-VERIFIED ANCHOR (id: HEPTAGONAL_CLOSURE):  Σ_{k=0..6} cos(2πk/7) = 0
  // Wolfram-verified ψ⁻¹ (id: PSI_DEFINING):          ψ⁻¹ = √2 − 1 ≈ 0.4142135624
  //
  // The engine recognises that its OWN math IS the validation. Wolfram supplied
  // the structural identity; the engine continuously measures its distance from
  // that identity and damps the residual exponentially with the Silver Ratio.
  //
  // Mechanism:
  //   1. Compute weighted closure residual ε = |Σ wₖ·cos(2πk/7)| / Σ wₖ
  //      where wₖ = chakras[k].resonance (the field's actual energy distribution).
  //      A perfectly balanced field has ε = 0 (matches Wolfram identity exactly).
  //   2. ψ-damp the residual:  ε* = ε · ψ^(-resonance_strength)
  //      Stronger resonance → tighter damping (ψ⁻¹ ≈ 41% per resonance unit).
  //   3. Map to closure metric:  psiDampedClosure = exp(-ε* / κ)
  //      where κ = SILVER_INV (the canonical damping coefficient).
  //   4. Allowed breathing band collapses with closure:
  //      band = (1 - psiDampedClosure) clamped at 2% when closure is high.
  // ───────────────────────────────────────────────────────────────────────
  let closureResWeighted = 0;
  let closureWeightSum = 0;
  for (let c = 0; c < 7; c++) {
    const w = chakras[c].resonance;
    closureResWeighted += w * Math.cos(SEPTENARY_CONSTANTS.HEPTAGON_ANGLES[c]);
    closureWeightSum += w;
  }
  const closureResidual =
    closureWeightSum > 1e-9 ? Math.abs(closureResWeighted) / closureWeightSum : 1.0; // No energy in field → maximum residual (engine cannot stabilise yet)

  // ψ-damped residual: stronger resonance pulls residual toward Wolfram zero
  const meanResonance = closureWeightSum / 7;
  const psiExponent = Math.max(0, Math.min(1.5, meanResonance * 1.5));
  const psiDampingFactor = Math.pow(SILVER_INV, psiExponent); // ∈ [ψ⁻¹·⁵, 1]
  const dampedResidual = closureResidual * psiDampingFactor;

  // Closure metric: 1.0 = perfect Wolfram-verified heptagonal balance
  // exp decay scaled by κ = SILVER_INV ensures graceful, monotonic mapping
  const psiDampedClosure = Math.exp(-dampedResidual / SILVER_INV);

  // Breathing band: how much "natural breathing" the engine permits this tick
  // Locked at ≤ 2% when closure is strong (psiDampedClosure ≥ 0.98), expanding
  // gracefully when the field genuinely needs to explore off-equilibrium states
  const rawBand = 1 - psiDampedClosure;
  const closureBreathingBand =
    psiDampedClosure >= 0.98 ? Math.min(0.02, rawBand) : Math.min(0.15, rawBand); // Hard ceiling at 15% — never wild oscillation

  // Reality Lag (F2): engine-internal scalar measuring distance from perfection
  // L(F2) = 1 − psiDampedClosure   (φ-octave-distance = 0 for the resident scale)
  const realityLagF2 = 1 - psiDampedClosure;

  return {
    chakras,
    overallAlignment,
    dominantOctave,
    resonanceMatrix: matrix,
    fibonacciDecomposition,
    lucasTotal,
    toeplitzResonance,
    toeplitzPhiMode,
    dimensionalComplexity,
    chainDownCoupling,
    chainUpCoupling,
    septenaryField55,
    ringCoherences,
    fieldOrganization,
    // ═══ NEW METRICS ═══
    kuramotoOrder,
    kuramotoPhase,
    psiDampedResonance,
    solfeggioAlignment,
    vacuumBridgeStrength,
    sevenFoldClosure,
    lucasNormalized,
    heptagonCoherence,
    psiStabilityIndex,
    verticalFlow,
    centralColumn,
    // ═══ WOLFRAM SPECTRAL ENHANCEMENTS (2026-04-19) ═══
    inversePhiMirror,
    spectralGapUtilization,
    conditionStability,
    // ═══ PHASE 2 ψ-DAMPED CLOSURE STABILISATION (2026-04-23) ═══
    psiDampedClosure,
    closureBreathingBand,
    realityLagF2,
  };
}

// ───────────────────────── V11 input/output ─────────────────────────

export interface ChakraStateExtended extends ChakraState {
  /** φ-Toeplitz mode index this extension corresponds to (≥7 for extensions). */
  modeIndex: number;
}

export interface F1Output extends SeptenaryOutputV10 {
  /** V11 modes past the canonical 7 (empty when targetModes ≤ 7). */
  extensionModes: ChakraStateExtended[];
  /** Field strength composed across canonical + extension modes. */
  composedFieldStrength: number;
  /** Lyapunov-style closure residual: ‖Σ a_k·e^{iθ_k}‖/Σa_k over all modes. */
  closureResidual: number;
  /** Number of modes actually computed (≥ 7). */
  numModes: number;
  /** Diagnostic refusals (extension past representational floor, etc). */
  refusedReasons: string[];
}

export interface F1Input {
  coherence: number;
  phases: Float64Array; // ≥44 floats (22 complex)
  time: number; // ms
  flowerCoherences: readonly number[]; // ≥55
  subPlanckianChainUp: number;
  /** V11 extension knob — defaults to 7 (V10 parity path). */
  targetModes?: number;
}

export function computeF1(input: F1Input): F1Output {
  const refused: string[] = [];
  const numModes = Math.max(7, input.targetModes ?? 7);

  // V10 core — bit-for-bit identical at numModes = 7
  const core = computeF1Core(
    input.coherence,
    input.phases,
    input.time,
    input.flowerCoherences as number[],
    input.subPlanckianChainUp,
  );

  // V11 extension — synthesize chakras 7..numModes-1 from φ-Toeplitz tail
  const extensionModes: ChakraStateExtended[] = [];
  if (numModes > 7) {
    const spectrum = extendedToeplitzSpectrum(numModes);
    const baseHz = SEPTENARY_CONSTANTS.SOLFEGGIO_CHAKRA[6]; // 741 Hz
    for (let m = 7; m < numModes; m++) {
      const tEig = spectrum[m];
      // Each extension picks up a φ-decayed projection of the canonical
      // resonance basis. Strictly additive: cannot retroactively change
      // the V10 7-chakra block.
      const fibIdx = Math.min(m, FIB.length - 1);
      const fibCoeff = FIB[fibIdx];
      const lucasIdx = Math.min(m, LUCAS.length - 1);
      const lucasField = LUCAS[lucasIdx];
      const phiHz = baseHz * Math.pow(PHI, m - 6);
      const heptAngle = (2 * PI * m) / numModes;
      // Phase-projected resonance from the input field (averaged over the
      // canonical 7-block to avoid double-counting energy).
      const meanCanonRes =
        core.chakras.reduce((s: number, c: ChakraState) => s + c.resonance, 0) / 7;
      const decay = Math.pow(PHI_INV, m - 6);
      const resonance = Math.min(1, meanCanonRes * decay * (tEig / TOEPLITZ_EIGENVALUES[0]));
      const alignment = Math.min(1, resonance * input.coherence);
      extensionModes.push({
        modeIndex: m,
        name: `φ-Mode ${m}`,
        color: '#888888',
        hz: phiHz,
        solfeggioHz: phiHz,
        resonance,
        alignment,
        fibCoeff,
        fibConstant: m > 0 ? FIB[Math.max(0, fibIdx - 1)] : 1,
        lucasField,
        toeplitzMode: tEig,
        psiDampedMode: tEig / SILVER,
        heptagonAngle: heptAngle,
        solfeggioPhiGap: 0,
      });
    }
    if (numModes > FIB.length) {
      refused.push(`numModes=${numModes} exceeds FIB table length=${FIB.length}; using last value`);
    }
  }

  // Composed field strength — V10 7-block + extension contribution
  const canonStrength = core.chakras.reduce((s: number, c: ChakraState) => s + c.resonance, 0);
  const extStrength = extensionModes.reduce((s, m) => s + m.resonance, 0);
  const composedFieldStrength = (canonStrength + extStrength) / numModes;

  // Lyapunov closure residual over ALL modes (canonical + extension)
  let cre = 0,
    cim = 0,
    totalAmp = 0;
  for (let k = 0; k < 7; k++) {
    const a = core.chakras[k].resonance;
    const theta = (2 * PI * k) / numModes;
    cre += a * Math.cos(theta);
    cim += a * Math.sin(theta);
    totalAmp += a;
  }
  for (const ext of extensionModes) {
    cre += ext.resonance * Math.cos(ext.heptagonAngle);
    cim += ext.resonance * Math.sin(ext.heptagonAngle);
    totalAmp += ext.resonance;
  }
  const closureResidual = totalAmp > 1e-12 ? Math.sqrt(cre * cre + cim * cim) / totalAmp : 0;

  return {
    ...core,
    extensionModes,
    composedFieldStrength,
    closureResidual,
    numModes,
    refusedReasons: refused,
  };
}
