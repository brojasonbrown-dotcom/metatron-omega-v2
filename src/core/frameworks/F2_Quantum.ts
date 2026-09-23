/**
 * METATRON V11 — F2 QUANTUM (Standard-Model φ-Resonance · 396 Hz)
 * ================================================================
 *
 * V10 → V11 UPLIFT
 * ----------------
 *  • Preserves V10's 12 particle modes, 5-ring 55-node spine, α⁻¹/Weinberg/
 *    Rydberg/φ-bridge metrics — bit-for-bit at default params (parity-gated
 *    by F2_Quantum.golden.json).
 *  • Adds Lyapunov `closureResidual` over the quantum 55-field
 *    (Σ aₖ e^iθₖ / Σ aₖ) parallel to F1/F8.
 *  • Optional `extensionParticles` lets the orchestrator append additional
 *    SM-completion modes (charm, bottom, top, ν_μ, ν_τ, …) — appended to
 *    `particleModes` AFTER the V10 core 12, never reordered. V10 reads
 *    indices 0..11, so safe.
 *  • EMERGENT mode (V10 default). LOCKED-blend belongs to orchestrator.
 *
 * IRON RULES
 *  • Default-input output of `quantumField55`/`particleModes[0..11]` MUST
 *    match V10 to ≤ 1e-12 relative.
 *  • Pure function. No I/O, no globals.
 */

import { PHI, PHI_INV, PI } from './constants';
// Provenance lock: asserts F2's three Wolfram-verified constants
// (ALPHA_INV_CODATA, PLANCK_LENGTH, PLANCK_TIME) match Wave2 bank bit-for-bit
// at module load. Pure side-effect import — no math path is changed.
import '../v12/audit/F2Provenance';
import { portFlag } from '@metatron/field-kernel-core/portFlags';
import { WOLFRAM_BANK_WAVE2 as W2 } from '../v12/audit/WolframBankWave2';

const SILVER_INV = 0.4142135623730951;
const KAPPA = 1 / (PHI * PI);
const LAMBDA = 1 / (PHI * PHI);
const PLANCK_LENGTH = 1.616255e-35;
const PLANCK_TIME = 5.391247e-44;

// Tier-B precision uplift gate. OFF (default) → V10 bit-for-bit parity preserved
// (validated by F2_Quantum.golden.json). ON → 11 truncated constants upgraded to
// 50-dp Wolfram Wave2 values (validated by F2_Quantum.wave2.golden.json).
// The three already-exact constants (ALPHA_INV_CODATA, PLANCK_LENGTH,
// PLANCK_TIME) are unchanged and locked by F2Provenance.
const W2_ON = portFlag('FLAG_F2_WAVE2_PRECISION') || portFlag('FLAG_WAVE2_PRECISION');

const QC = {
  X_PHI: 137.031933775,
  PHI_CORRECTION: 0.004065309377891674,
  ALPHA_INV_CODATA: 137.035999084,
  MP_ME_PHI_EXPONENT: W2_ON ? W2.LOGPHI_MP_ME.value     : 15.6177,
  PHI_15:             W2_ON ? W2.PHI_15.value           : 1364.0007331374,
  MP_ME_CORRECTION:   W2_ON ? W2.MP_ME_OVER_PHI15.value : 1.34615226284,
  MUON_PHI_EXP:       W2_ON ? W2.LOGPHI_MU_E.value      : 11.0795,
  TAU_PHI_EXP:        W2_ON ? W2.LOGPHI_TAU_E.value     : 16.9447,
  MUON_ELECTRON_RATIO:W2_ON ? W2.MU_E_RATIO.value       : 206.768,
  TAU_ELECTRON_RATIO: W2_ON ? W2.TAU_E_RATIO.value      : 3477.23,
  PHI_11:             W2_ON ? W2.PHI_11.value           : 199.005024998740,
  GIMEL_HZ: 396,
  RYDBERG_EV:         W2_ON ? W2.RYDBERG_EV.value       : 13.605693123,
  KAPPA_BRIDGE: KAPPA,
  PROTON_GRADIENT_RATIO: 0.8414 / 0.8751,
  PROTON_OCTAVE_DEPTH_E: 11,
  PROTON_OCTAVE_DEPTH_MU: 15,
  W_BOSON_GEV: 80.379,
  Z_BOSON_GEV: 91.1876,
  HIGGS_BOSON_GEV: 125.18,
  W_PHI_EXP: 10.5113,
  Z_PHI_EXP: 10.7734,
  HIGGS_PHI_EXP: 11.433,
  WEINBERG_SIN2_TW: 0.2312,
  SQRT5_MINUS_2:      W2_ON ? W2.WEINBERG_PHI.value     : 0.23606797749979,
  RYDBERG_PHI5_RATIO: W2_ON ? W2.RYDBERG_OVER_PHI5.value: 1.2268245836,
  ALPHA_INV_MZ: 128.9,
} as const;

export interface QuantumParticleSpec {
  name: string; generation: number; charge: number; spin: number; phiAffinity: number;
}
export interface QuantumParticleMode extends QuantumParticleSpec {
  resonance: number; coupling: number;
}

const QUANTUM_PARTICLE_MODES_V10: QuantumParticleSpec[] = [
  { name: 'Electron',     generation: 1, charge: -1,   spin: 0.5, phiAffinity: 1.0 },
  { name: 'Muon',         generation: 2, charge: -1,   spin: 0.5, phiAffinity: PHI_INV },
  { name: 'Tau',          generation: 3, charge: -1,   spin: 0.5, phiAffinity: LAMBDA },
  { name: 'Up Quark',     generation: 1, charge: 2/3,  spin: 0.5, phiAffinity: 0.8 },
  { name: 'Down Quark',   generation: 1, charge: -1/3, spin: 0.5, phiAffinity: 0.8 },
  { name: 'Strange Quark',generation: 2, charge: -1/3, spin: 0.5, phiAffinity: PHI_INV * 0.8 },
  { name: 'Photon',       generation: 0, charge: 0,    spin: 1,   phiAffinity: PHI_INV },
  { name: 'Gluon',        generation: 0, charge: 0,    spin: 1,   phiAffinity: 0.8 },
  { name: 'W Boson',      generation: 0, charge: 1,    spin: 1,   phiAffinity: LAMBDA },
  { name: 'Z Boson',      generation: 0, charge: 0,    spin: 1,   phiAffinity: LAMBDA },
  { name: 'Higgs',        generation: 0, charge: 0,    spin: 0,   phiAffinity: PHI_INV },
  { name: 'Neutrino(e)',  generation: 1, charge: 0,    spin: 0.5, phiAffinity: LAMBDA },
];

interface LeptonData {
  name: string; mass_mev: number; phi_exponent: number;
  phi_power: number; correction: number; agreement: number;
}
interface QuantumRingAnalysis {
  ring: number; nodeCount: number; meanCoherence: number;
  phaseUniformity: number; relativeFreq: number;
}

export interface F2Input {
  coherence: number; energy: number;
  pinealField: Float64Array; solfeggioCoherences: number[];
  time: number; flowerCoherences: number[];
  septenaryChainUp: number;
  /** V11 extension: extra SM particles appended AFTER the V10 core 12. */
  extensionParticles?: QuantumParticleSpec[];
}

export interface F2Output {
  fineStructure: number; fineStructureAgreement: number;
  protonElectronRatio: number; protonPhiExponent: number; protonPhiCorrection: number;
  leptonHierarchy: LeptonData[];
  quarkPhaseCoherence: number; quarkColorClosure: number; vacuumFluctuationRate: number;
  particleModes: QuantumParticleMode[]; quantumField55: number[];
  ringAnalysis: QuantumRingAnalysis[];
  fieldEntropy: number; fieldOrganization: number; dimensionalComplexity: number;
  superposition55Composite: number; structuralFormations: number;
  chainDownCoupling: number; chainUpCoupling: number; scaleRelativeTime: number;
  rydbergResonance: number; perfectFourthResonance: number; quantumCoherence: number;
  planckBridgeResonance: number; protonGradient: number[];
  protonElectronicDepth: number; protonMuonicDepth: number; protonRadiusPuzzleResolved: number;
  weinbergAngle: number; weinbergAgreement: number; weinbergPhiRelation: number;
  bosonPhiHierarchy: { name: string; mass_gev: number; phi_exp: number; phi_power: number; correction: number; agreement: number }[];
  runningCouplingMZ: number; runningCouplingAgreement: number;
  rydbergPhiDecomposition: number; rydbergKappaAlignment: number;
  standardModelCompleteness: number;
  /** V11 Lyapunov closure residual on quantum 55-field. */
  closureResidual: number;
  /** V11 extension modes (caller-provided), evaluated with same kernel. */
  extensionModes: QuantumParticleMode[];
}

export function computeF2(input: F2Input): F2Output {
  const {
    coherence, energy, pinealField, solfeggioCoherences,
    time, flowerCoherences, septenaryChainUp,
    extensionParticles = [],
  } = input;
  void energy;

  // ─── V10 core (verbatim) ────────────────────────────────────────────────
  const alpha_inv = QC.X_PHI + QC.PHI_CORRECTION;
  const agreement = (1 - Math.abs(alpha_inv - QC.ALPHA_INV_CODATA) / QC.ALPHA_INV_CODATA) * 100;

  const phiExponent = QC.MP_ME_PHI_EXPONENT;
  const phiCorrection = QC.MP_ME_CORRECTION;
  const protonElectronRatio = QC.PHI_15 * phiCorrection * (1 + coherence * 0.0000001);

  const m_e = 0.51099895;
  const leptonHierarchy: LeptonData[] = [
    { name: 'Electron', mass_mev: m_e, phi_exponent: 0, phi_power: 1, correction: 1, agreement: 100 },
    { name: 'Muon', mass_mev: m_e * QC.MUON_ELECTRON_RATIO, phi_exponent: QC.MUON_PHI_EXP,
      phi_power: QC.PHI_11, correction: QC.MUON_ELECTRON_RATIO / QC.PHI_11,
      agreement: (1 - Math.abs(QC.MUON_ELECTRON_RATIO - QC.PHI_11) / QC.MUON_ELECTRON_RATIO) * 100 },
    { name: 'Tau', mass_mev: m_e * QC.TAU_ELECTRON_RATIO, phi_exponent: QC.TAU_PHI_EXP,
      phi_power: Math.pow(PHI, 17),
      correction: QC.TAU_ELECTRON_RATIO / Math.pow(PHI, 17),
      agreement: (1 - Math.abs(QC.TAU_ELECTRON_RATIO - Math.pow(PHI, 17)) / QC.TAU_ELECTRON_RATIO) * 100 },
  ];

  const colorPhases = [0, 2 * PI / 3, 4 * PI / 3];
  const quarkColorClosure = Math.abs(
    Math.cos(colorPhases[0]) + Math.cos(colorPhases[1]) + Math.cos(colorPhases[2]));
  const nPhases = Math.min(pinealField.length / 2, 22);
  let quarkPhaseSum = 0;
  for (let q = 0; q < 3; q++) {
    const targetPhase = colorPhases[q];
    let phaseMatch = 0;
    for (let i = 0; i < nPhases; i++) {
      const phase = Math.atan2(pinealField[i * 2 + 1] || 0, pinealField[i * 2] || 0);
      phaseMatch += Math.cos(phase - targetPhase);
    }
    quarkPhaseSum += Math.abs(phaseMatch / nPhases);
  }
  const quarkPhaseCoherence = Math.min(1, (quarkPhaseSum / 3) * coherence);

  const gimelCoh = solfeggioCoherences[2] || 0;
  const heCoh = solfeggioCoherences[4] || 0;
  const perfectFourthResonance = Math.min(1,
    Math.sqrt(Math.max(0.01, gimelCoh) * Math.max(0.01, heCoh)) * coherence);

  const rydbergResonance = Math.min(1,
    (QC.RYDBERG_EV / (PHI * PHI * PHI * PHI * PHI)) * coherence * 0.5);

  // V10 mode kernel — closes over (coherence, time, quarkPhaseCoherence,
  // septenaryChainUp, perfectFourthResonance) and the per-particle index/i%5
  // modulation. modeCount MUST stay = 12 to preserve V10 core math.
  const modeCount = QUANTUM_PARTICLE_MODES_V10.length;
  function evalParticle(m: QuantumParticleSpec, i: number): QuantumParticleMode {
    const phaseOffset = (2 * PI * i) / modeCount;
    const fieldPhase = time * QC.GIMEL_HZ / 1000 + phaseOffset;
    const modeOscillation = 0.5 + 0.5 * Math.sin(fieldPhase);
    const phiCoupling = m.phiAffinity * Math.pow(PHI, -(i % 5));
    const resonance = Math.min(1,
      0.28 * coherence * modeOscillation +
      0.22 * coherence * phiCoupling +
      0.18 * quarkPhaseCoherence * (m.spin === 0.5 ? 1 : m.spin === 1 ? 0.7 : 0.4) +
      0.15 * septenaryChainUp +
      0.09 * perfectFourthResonance +
      0.08 * (m.charge !== 0 ? coherence * PHI_INV : coherence * SILVER_INV));
    const coupling = Math.min(1, phiCoupling * coherence * (0.5 + 0.5 * modeOscillation));
    return { ...m, resonance, coupling };
  }
  const particleModes: QuantumParticleMode[] = QUANTUM_PARTICLE_MODES_V10.map(evalParticle);

  // V11 extensions — appended AFTER V10 core (indices 12+). Same kernel.
  const extensionModes: QuantumParticleMode[] = extensionParticles.map(
    (p, k) => evalParticle(p, modeCount + k));
  const allParticles = particleModes.concat(extensionModes);

  // 55-node quantum field — V10 core uses modeCount=12 (NOT allParticles.length).
  const RING_STARTS = [0, 1, 7, 19, 37];
  const RING_SIZES = [1, 6, 12, 18, 18];
  const quantumField55: number[] = new Array(55).fill(0);
  const ringAnalysis: QuantumRingAnalysis[] = [];

  for (let r = 0; r < 5; r++) {
    const start = RING_STARTS[r];
    const size = RING_SIZES[r];
    let ringSum = 0;
    const phaseAngles: number[] = [];
    for (let i = 0; i < size; i++) {
      const nodeIdx = start + i;
      const flowerCoh = nodeIdx < flowerCoherences.length ? flowerCoherences[nodeIdx] : coherence * 0.5;
      const modeIdx = (r + i) % modeCount;
      const modeInfluence = particleModes[modeIdx].resonance;
      const phaseAngle = (2 * PI * i) / size + time * QC.GIMEL_HZ / 5000;
      phaseAngles.push(phaseAngle);
      quantumField55[nodeIdx] = Math.min(1,
        0.40 * flowerCoh * coherence +
        0.30 * modeInfluence +
        0.15 * (0.5 + 0.5 * Math.cos(phaseAngle)) +
        0.15 * septenaryChainUp);
      ringSum += quantumField55[nodeIdx];
    }
    let uniformitySum = 0;
    for (let i = 0; i < phaseAngles.length; i++) {
      for (let j = i + 1; j < phaseAngles.length; j++) {
        uniformitySum += Math.abs(Math.cos(phaseAngles[i] - phaseAngles[j]));
      }
    }
    const pairs = Math.max(1, size * (size - 1) / 2);
    const relativeFreq = Math.pow(PHI, 3 + r) * QC.GIMEL_HZ / 1000;
    ringAnalysis.push({ ring: r, nodeCount: size,
      meanCoherence: ringSum / size,
      phaseUniformity: 1 - uniformitySum / pairs, relativeFreq });
  }

  const orgBins = new Array(7).fill(0);
  for (const c of quantumField55) orgBins[Math.min(6, Math.floor(Math.max(0, c) * 7))]++;
  let entropy = 0;
  for (const count of orgBins) if (count > 0) {
    const p = count / 55; entropy -= p * Math.log2(p);
  }
  const fieldEntropy = entropy;
  const fieldOrganization = 1 - entropy / Math.log2(7);
  const superposition55Composite = quantumField55.reduce((s, v) => s + v, 0) / 55;

  let structuralFormations = 0;
  for (let i = 0; i < 55; i++) if (quantumField55[i] > 0.618) structuralFormations++;

  // V10 dimensional complexity uses ONLY core 12 (preserves parity).
  let modeComplexity = 0;
  for (const m of particleModes) modeComplexity += m.resonance * m.phiAffinity;
  modeComplexity /= modeCount;

  const dimensionalComplexity = Math.min(1,
    0.30 * modeComplexity + 0.25 * fieldOrganization +
    0.20 * superposition55Composite + 0.15 * septenaryChainUp +
    0.10 * (agreement / 100));

  const scaleRelativeTime = 17;
  const chainDownCoupling = Math.min(1,
    septenaryChainUp * coherence * (0.5 + 0.5 * particleModes[0].resonance));
  const chainUpCoupling = Math.min(1,
    fieldOrganization * superposition55Composite * coherence *
    (0.5 + 0.5 * (agreement / 100)));

  const planckVol = Math.pow(PLANCK_LENGTH, 3);
  const vacuumFluctuationRate = 1 / (planckVol * PLANCK_TIME) * (1 + coherence * 0.01);

  const fieldDynamicQ = Math.min(1,
    0.20 * (agreement / 100) + 0.18 * superposition55Composite +
    0.15 * quarkPhaseCoherence + 0.12 * dimensionalComplexity +
    0.10 * perfectFourthResonance + 0.10 * chainDownCoupling +
    0.08 * rydbergResonance + 0.07 * fieldOrganization);
  const quantumCoherence = Math.min(1, fieldDynamicQ);

  let bridgeSum = 0;
  for (let step = 0; step < Math.min(139, nPhases * 6); step++) {
    const bridgePhase = (step / 139) * 2 * PI * QC.KAPPA_BRIDGE;
    const fieldIdx = step % nPhases;
    const fieldPhase = Math.atan2(pinealField[fieldIdx * 2 + 1] || 0, pinealField[fieldIdx * 2] || 0);
    bridgeSum += Math.cos(fieldPhase - bridgePhase) * Math.pow(PHI, -(step / 139) * 3);
  }
  const bridgeSteps = Math.min(139, nPhases * 6);
  const planckBridgeResonance = Math.min(1,
    Math.max(0, bridgeSum / bridgeSteps) * coherence * (0.5 + 0.5 * (agreement / 100)));

  const protonGradient: number[] = new Array(22).fill(0);
  for (let node = 0; node < 22; node++) {
    const densityFalloff = Math.pow(PHI, -node * 0.3);
    const electronCoupling = Math.exp(-Math.pow(node - QC.PROTON_OCTAVE_DEPTH_E, 2) / 8);
    const muonCoupling = Math.exp(-Math.pow(node - QC.PROTON_OCTAVE_DEPTH_MU, 2) / 8);
    const fieldInfluence = node < nPhases
      ? Math.sqrt((pinealField[node * 2] || 0) ** 2 + (pinealField[node * 2 + 1] || 0) ** 2)
      : coherence * 0.5;
    protonGradient[node] = Math.min(1,
      densityFalloff * (0.5 + 0.5 * fieldInfluence) * coherence *
      (0.3 + 0.4 * electronCoupling + 0.3 * muonCoupling));
  }
  const protonElectronicDepth = protonGradient[QC.PROTON_OCTAVE_DEPTH_E] || 0;
  const protonMuonicDepth = protonGradient[QC.PROTON_OCTAVE_DEPTH_MU] || 0;
  const protonRadiusPuzzleResolved = Math.sqrt(
    Math.max(0.01, protonElectronicDepth) * Math.max(0.01, protonMuonicDepth)
  ) * QC.PROTON_GRADIENT_RATIO * coherence;

  const weinbergAngle = QC.WEINBERG_SIN2_TW;
  const weinbergPhiRelation = QC.SQRT5_MINUS_2;
  const weinbergAgreement = (1 - Math.abs(weinbergAngle - weinbergPhiRelation) / weinbergAngle) * 100;

  const m_e_gev = 0.51099895e-3;
  const bosonPhiHierarchy = [
    { name: 'W±', mass_gev: QC.W_BOSON_GEV, phi_exp: QC.W_PHI_EXP,
      phi_power: Math.pow(PHI, 10) * m_e_gev * 1000,
      correction: (QC.W_BOSON_GEV / m_e_gev) / Math.pow(PHI, 10),
      agreement: (1 - Math.abs(Math.log(QC.W_BOSON_GEV / m_e_gev) / Math.log(PHI) - 10) / QC.W_PHI_EXP) * 100 },
    { name: 'Z⁰', mass_gev: QC.Z_BOSON_GEV, phi_exp: QC.Z_PHI_EXP,
      phi_power: Math.pow(PHI, 11) * m_e_gev * 1000,
      correction: (QC.Z_BOSON_GEV / m_e_gev) / Math.pow(PHI, 11),
      agreement: (1 - Math.abs(Math.log(QC.Z_BOSON_GEV / m_e_gev) / Math.log(PHI) - 11) / QC.Z_PHI_EXP) * 100 },
    { name: 'H⁰', mass_gev: QC.HIGGS_BOSON_GEV, phi_exp: QC.HIGGS_PHI_EXP,
      phi_power: Math.pow(PHI, 11) * m_e_gev * 1000,
      correction: (QC.HIGGS_BOSON_GEV / m_e_gev) / Math.pow(PHI, 11),
      agreement: (1 - Math.abs(Math.log(QC.HIGGS_BOSON_GEV / m_e_gev) / Math.log(PHI) - 11) / QC.HIGGS_PHI_EXP) * 100 },
  ];

  const runningCouplingMZ = QC.ALPHA_INV_MZ;
  const runningCouplingAgreement = (1 - Math.abs(runningCouplingMZ - QC.ALPHA_INV_MZ) / runningCouplingMZ) * 100;

  const rydbergPhiDecomposition = QC.RYDBERG_PHI5_RATIO;
  const rydbergKappaAlignment = (1 - Math.abs(rydbergPhiDecomposition - (1 + KAPPA)) / rydbergPhiDecomposition) * 100;

  // V10 standard-model completeness uses the V10 mode count (12/17). Extensions
  // do NOT inflate this — completeness is anchored to the SM headcount.
  const standardModelCompleteness = modeCount / 17;

  // ─── V11 LYAPUNOV CLOSURE on quantum 55-field ──────────────────────────
  // Project each node amplitude through its ring's mean phase angle and
  // compute |Σ aₖ e^iθₖ| / Σ aₖ. Closure → 0 means perfect cancellation.
  let resR = 0, resI = 0, ampSum = 0;
  for (let r = 0; r < 5; r++) {
    const start = RING_STARTS[r];
    const size = RING_SIZES[r];
    for (let i = 0; i < size; i++) {
      const a = quantumField55[start + i];
      const theta = (2 * PI * i) / size;
      resR += a * Math.cos(theta);
      resI += a * Math.sin(theta);
      ampSum += a;
    }
  }
  const closureResidual = ampSum > 1e-9
    ? Math.sqrt(resR * resR + resI * resI) / ampSum : 1.0;

  // Reference unused vars to satisfy strict mode without changing math.
  void allParticles;

  return {
    fineStructure: alpha_inv, fineStructureAgreement: agreement,
    protonElectronRatio, protonPhiExponent: phiExponent, protonPhiCorrection: phiCorrection,
    leptonHierarchy, quarkPhaseCoherence, quarkColorClosure,
    vacuumFluctuationRate, particleModes, quantumField55, ringAnalysis,
    fieldEntropy, fieldOrganization, dimensionalComplexity,
    superposition55Composite, structuralFormations,
    chainDownCoupling, chainUpCoupling, scaleRelativeTime,
    rydbergResonance, perfectFourthResonance, quantumCoherence,
    planckBridgeResonance, protonGradient,
    protonElectronicDepth, protonMuonicDepth, protonRadiusPuzzleResolved,
    weinbergAngle, weinbergAgreement, weinbergPhiRelation, bosonPhiHierarchy,
    runningCouplingMZ, runningCouplingAgreement,
    rydbergPhiDecomposition, rydbergKappaAlignment, standardModelCompleteness,
    closureResidual, extensionModes,
  };
}
