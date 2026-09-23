/**
 * METATRON V11 — F3 ATOMIC (Periodic Table · 417 Hz · Bohr/Aufbau)
 * ==================================================================
 *
 * V10 → V11 UPLIFT
 * ----------------
 *  • Preserves 7 Bohr orbits, 7 period modes, ψ-dampened shells, noble-gas
 *    closure, magic-number φ-alignment, 5-ring 55-node atomic field —
 *    bit-for-bit at default params (parity-gated by F3_Atomic.golden.json).
 *  • Adds Lyapunov `closureResidual` over the atomic 55-field, parallel to
 *    F1/F2/F8.
 *  • Optional `extensionShells` extends Bohr orbits beyond n=7 using the
 *    SAME formulas (radius = n²a₀(1+φ⁻ⁿ/2), energy = -R/n²(1-φ⁻ⁿ/4)). The
 *    V10 7-orbit stack is unchanged — extensions appended.
 *  • Pure function. EMERGENT mode (V10 default).
 */

import { PHI, PHI_INV, PI } from './constants';
import '../v12/audit/F2Provenance';

const SILVER = 2.414213562373095;
const SILVER_INV = 0.4142135623730951;
const LAMBDA = 1 / (PHI * PHI);
const LUCAS = [2, 1, 3, 4, 7, 11, 18, 29, 47, 76, 123, 199, 322, 521, 843, 1364];

const AC = {
  BOHR_RADIUS: 5.29177210903e-11,
  RYDBERG_EV: 13.598,
  RYDBERG_LOG_PHI: 5.424,
  SHELL_CAPACITIES: [2, 8, 18, 32, 50, 72, 98] as readonly number[],
  NOBLE_GAS_Z: [2, 10, 18, 36, 54, 86, 118] as readonly number[],
  SUBSHELL_CAPACITIES: [2, 6, 10, 14] as readonly number[],
  NUCLEAR_MAGIC: [2, 8, 20, 28, 50, 82, 126] as readonly number[],
  DALET_HZ: 417,
  PSI: SILVER, PSI_INV: SILVER_INV,
  GEOMETRIC_PROJECTION_GAP: Math.abs(528 * Math.pow(PHI, -0.5) - 417) / 417,
  MAGIC_PHI_EXPONENTS: [1.4404, 4.3213, 6.2254, 6.9246, 8.1295, 9.1575, 10.0502] as readonly number[],
  NOBLE_GAS_RATIOS: [5.0, 1.8, 2.0, 1.5, 1.593, 1.372] as readonly number[],
  SHELL_PHASE_LEAD: PHI / 2,
  AUFBAU_ORDER: [
    [1,0],[2,0],[2,1],[3,0],[3,1],[4,0],[3,2],[4,1],[5,0],[4,2],
    [5,1],[6,0],[4,3],[5,2],[6,1],[7,0],[5,3],[6,2],[7,1],
  ] as readonly (readonly number[])[],
  PSI_SHELL_CORRECTIONS: Array.from({ length: 16 }, (_, n) =>
    (1 + Math.pow(PHI, -(n + 1)) / 2) / SILVER) as number[],
} as const;

interface AtomicElementMode {
  period: number; capacity: number; shellType: string; nobleGas: string;
  nobleGasZ: number; ionizationTrend: number; resonance: number; coupling: number;
}
const PERIOD_DEFINITIONS: Omit<AtomicElementMode, 'resonance' | 'coupling'>[] = [
  { period: 1, capacity: 2,  shellType: '1s',     nobleGas: 'He', nobleGasZ: 2,   ionizationTrend: 1.0 },
  { period: 2, capacity: 8,  shellType: '2s2p',   nobleGas: 'Ne', nobleGasZ: 10,  ionizationTrend: 0.88 },
  { period: 3, capacity: 8,  shellType: '3s3p',   nobleGas: 'Ar', nobleGasZ: 18,  ionizationTrend: 0.64 },
  { period: 4, capacity: 18, shellType: '4s3d4p', nobleGas: 'Kr', nobleGasZ: 36,  ionizationTrend: 0.57 },
  { period: 5, capacity: 18, shellType: '5s4d5p', nobleGas: 'Xe', nobleGasZ: 54,  ionizationTrend: 0.50 },
  { period: 6, capacity: 32, shellType: '6s4f5d6p', nobleGas: 'Rn', nobleGasZ: 86, ionizationTrend: 0.43 },
  { period: 7, capacity: 32, shellType: '7s5f6d7p', nobleGas: 'Og', nobleGasZ: 118, ionizationTrend: 0.38 },
];

interface BohrOrbit {
  n: number; radius_m: number; energy_ev: number;
  phiCorrection: number; shellCapacity: number; angularMomentumStates: number;
  lucasField: number; psiDampedCorrection: number;
}
interface AtomicRingAnalysis {
  ring: number; nodeCount: number; meanCoherence: number;
  phaseUniformity: number; relativeFreq: number;
}

export interface F3Input {
  coherence: number; nodeAmps: Float64Array; solfeggioCoherences: number[];
  time: number; flowerCoherences: number[]; quantumChainUp: number;
  /** V11 extension: extra Bohr orbits beyond n=7. Caller passes count. */
  extensionShells?: number;
}

export interface F3Output {
  hydrogenCorrection: number; bohrOrbits: BohrOrbit[];
  periodicResonance: number; shellHarmonics: number[];
  periodModes: AtomicElementMode[]; atomicField55: number[];
  ringAnalysis: AtomicRingAnalysis[];
  fieldEntropy: number; fieldOrganization: number; dimensionalComplexity: number;
  superposition55Composite: number; structuralFormations: number;
  chainDownCoupling: number; chainUpCoupling: number; scaleRelativeTime: number;
  nobleGasResonance: number; nuclearMagicResonance: number;
  phiSquaredIdentity: number; rydbergPhiDecomposition: number;
  subshellCoherence: number[]; ionizationGradient: number; atomicCoherence: number;
  magicPhiAlignment: number; geometricProjection: number;
  psiShellStability: number; aufbauCompleteness: number;
  nobleGasPhiRatio: number; shellPhaseLead: number; trialityClosure: number;
  /** V11 Lyapunov closure residual on atomic 55-field. */
  closureResidual: number;
  /** V11 extension Bohr orbits for n>7 (empty by default). */
  extensionOrbits: BohrOrbit[];
}

export function computeF3(input: F3Input): F3Output {
  const {
    coherence, nodeAmps, solfeggioCoherences, time, flowerCoherences, quantumChainUp,
    extensionShells = 0,
  } = input;

  // Build core 7-shell stack — bit-for-bit V10
  const bohrOrbits: BohrOrbit[] = [];
  for (let n = 1; n <= 7; n++) {
    const phiCorrection = 1 + Math.pow(PHI, -n) / 2;
    bohrOrbits.push({
      n, radius_m: (n * n * AC.BOHR_RADIUS) * phiCorrection,
      energy_ev: -AC.RYDBERG_EV / (n * n) * (1 - Math.pow(PHI, -n) / 4),
      phiCorrection, shellCapacity: 2 * n * n,
      angularMomentumStates: n * n,
      lucasField: LUCAS[n],
      psiDampedCorrection: AC.PSI_SHELL_CORRECTIONS[n - 1],
    });
  }
  // V11 extension orbits (n>7) — same formulas
  const extensionOrbits: BohrOrbit[] = [];
  for (let k = 0; k < extensionShells; k++) {
    const n = 8 + k;
    const phiCorrection = 1 + Math.pow(PHI, -n) / 2;
    extensionOrbits.push({
      n, radius_m: (n * n * AC.BOHR_RADIUS) * phiCorrection,
      energy_ev: -AC.RYDBERG_EV / (n * n) * (1 - Math.pow(PHI, -n) / 4),
      phiCorrection, shellCapacity: 2 * n * n,
      angularMomentumStates: n * n,
      lucasField: LUCAS[Math.min(n, LUCAS.length - 1)],
      psiDampedCorrection: AC.PSI_SHELL_CORRECTIONS[Math.min(n - 1, AC.PSI_SHELL_CORRECTIONS.length - 1)],
    });
  }

  const hydrogenCorrection = 1 + LAMBDA;

  const periodModes: AtomicElementMode[] = PERIOD_DEFINITIONS.map((pd, i) => {
    const phaseOffset = (2 * PI * i) / 7;
    const fieldPhase = time * AC.DALET_HZ / 1000 + phaseOffset + AC.SHELL_PHASE_LEAD;
    const modeOscillation = 0.5 + 0.5 * Math.sin(fieldPhase);
    const capacityWeight = Math.log2(pd.capacity + 1) / Math.log2(33);
    const phiIdentityFactor = (bohrOrbits[i].phiCorrection - 1) * 2;
    const psiWeight = bohrOrbits[i].psiDampedCorrection;
    const resonance = Math.min(1,
      0.22 * coherence * modeOscillation +
      0.18 * coherence * capacityWeight +
      0.16 * pd.ionizationTrend * coherence +
      0.14 * quantumChainUp * (0.5 + 0.5 * phiIdentityFactor) +
      0.10 * coherence * (bohrOrbits[i].lucasField / 29) +
      0.10 * (solfeggioCoherences[3] || 0) * coherence +
      0.10 * coherence * psiWeight);
    const coupling = Math.min(1, capacityWeight * coherence * (0.5 + 0.5 * modeOscillation));
    return { ...pd, resonance, coupling };
  });

  const shellHarmonics: number[] = [];
  const nNodes = Math.min(nodeAmps.length / 2, 22);
  let nodeIdx = 0;
  for (let s = 0; s < 7; s++) {
    const nodesPerShell = Math.max(1, Math.floor(nNodes / 7));
    let shellSum = 0; let shellCount = 0;
    for (let i = 0; i < nodesPerShell && nodeIdx < nNodes; i++, nodeIdx++) {
      const amp = Math.sqrt(
        (nodeAmps[nodeIdx * 2] || 0) ** 2 + (nodeAmps[nodeIdx * 2 + 1] || 0) ** 2);
      shellSum += amp; shellCount++;
    }
    const rawHarmonic = shellCount > 0 ? shellSum / shellCount : 0;
    shellHarmonics.push(Math.min(1, rawHarmonic * coherence * (0.5 + 0.5 * periodModes[s].resonance)));
  }

  const subshellCoherence: number[] = AC.SUBSHELL_CAPACITIES.map((cap, l) => {
    const periodsUsing = l === 0 ? 7 : l === 1 ? 6 : l === 2 ? 4 : 2;
    let subshellSum = 0;
    for (let p = 0; p < periodsUsing; p++) subshellSum += periodModes[Math.min(6, p + l)].resonance;
    return Math.min(1, (subshellSum / periodsUsing) * coherence * (0.5 + 0.5 * cap / 14));
  });

  let nobleGasSum = 0;
  for (let i = 0; i < 7; i++) {
    nobleGasSum += periodModes[i].resonance * (1 - 1 / (AC.NOBLE_GAS_Z[i] + 1));
  }
  const nobleGasResonance = Math.min(1, nobleGasSum / 7);

  let nobleGasPhiSum = 0;
  for (let i = 0; i < AC.NOBLE_GAS_RATIOS.length; i++) {
    const ratio = AC.NOBLE_GAS_RATIOS[i];
    const nearest = Math.round(Math.log(ratio) / Math.log(PHI));
    const phiPower = Math.pow(PHI, nearest);
    nobleGasPhiSum += 1 - Math.abs(ratio - phiPower) / Math.max(ratio, phiPower);
  }
  const nobleGasPhiRatio = nobleGasPhiSum / AC.NOBLE_GAS_RATIOS.length;

  let magicSum = 0; let magicPhiSum = 0;
  for (let i = 0; i < AC.NUCLEAR_MAGIC.length; i++) {
    const magicZ = AC.NUCLEAR_MAGIC[i];
    let periodIdx = 0;
    for (let p = 0; p < AC.NOBLE_GAS_Z.length; p++) {
      if (magicZ <= AC.NOBLE_GAS_Z[p]) { periodIdx = p; break; }
    }
    magicSum += periodModes[Math.min(6, periodIdx)].resonance * Math.pow(PHI, -(i * 0.5));
    const nearestInt = Math.round(AC.MAGIC_PHI_EXPONENTS[i]);
    const phiPower = Math.pow(PHI, nearestInt);
    magicPhiSum += 1 - Math.abs(magicZ - phiPower) / Math.max(magicZ, phiPower);
  }
  const nuclearMagicResonance = Math.min(1, magicSum / 4);
  const magicPhiAlignment = magicPhiSum / AC.NUCLEAR_MAGIC.length;
  const geometricProjection = 1 - AC.GEOMETRIC_PROJECTION_GAP;

  let psiConvergence = 0;
  for (let n = 0; n < 7; n++) psiConvergence += periodModes[n].resonance * AC.PSI_SHELL_CORRECTIONS[n];
  const psiShellStability = Math.min(1, psiConvergence / (7 * AC.PSI_INV) * coherence);

  let aufbauCorrect = 0;
  const aufbauLen = Math.min(AC.AUFBAU_ORDER.length, 19);
  for (let i = 0; i < aufbauLen; i++) {
    const [n, l] = AC.AUFBAU_ORDER[i];
    if (i === 0 || (n + l) >= (AC.AUFBAU_ORDER[i - 1][0] + AC.AUFBAU_ORDER[i - 1][1])) aufbauCorrect++;
  }
  const aufbauCompleteness = (aufbauCorrect / aufbauLen) * coherence;

  let phaseLeadSum = 0;
  for (let n = 0; n < 7; n++) {
    const shellPhase = time * AC.DALET_HZ / 1000 + n * AC.SHELL_PHASE_LEAD;
    phaseLeadSum += Math.abs(Math.cos(shellPhase)) * periodModes[n].resonance;
  }
  const shellPhaseLead = Math.min(1, phaseLeadSum / 7);

  let trialitySum = 0;
  const trialityAngles = [0, 2 * PI / 3, 4 * PI / 3];
  for (const angle of trialityAngles) {
    let phaseMatch = 0;
    for (let i = 0; i < nNodes; i++) {
      const phase = Math.atan2(nodeAmps[i * 2 + 1] || 0, nodeAmps[i * 2] || 0);
      phaseMatch += Math.cos(phase - angle);
    }
    trialitySum += Math.abs(phaseMatch / nNodes);
  }
  const phiSquaredIdentity = Math.min(1, (trialitySum / 3) * coherence);
  const trialityClosure = phiSquaredIdentity;

  const rydbergFractional = AC.RYDBERG_LOG_PHI - Math.floor(AC.RYDBERG_LOG_PHI);
  const rydbergPhiDecomposition = Math.min(1,
    coherence * (0.5 + 0.5 * Math.cos(2 * PI * rydbergFractional * PHI)));

  let gradientAccuracy = 0;
  for (let i = 0; i < 6; i++) {
    if (periodModes[i].ionizationTrend > periodModes[i + 1].ionizationTrend) gradientAccuracy++;
  }
  const ionizationGradient = Math.min(1, (gradientAccuracy / 6) * coherence);

  const RING_STARTS = [0, 1, 7, 19, 37];
  const RING_SIZES = [1, 6, 12, 18, 18];
  const atomicField55: number[] = new Array(55).fill(0);
  const ringAnalysis: AtomicRingAnalysis[] = [];

  for (let r = 0; r < 5; r++) {
    const start = RING_STARTS[r]; const size = RING_SIZES[r];
    let ringSum = 0; const phaseAngles: number[] = [];
    for (let i = 0; i < size; i++) {
      const nodeIdx2 = start + i;
      const flowerCoh = nodeIdx2 < flowerCoherences.length ? flowerCoherences[nodeIdx2] : coherence * 0.5;
      const periodIdx = (r + Math.floor(i * 7 / size)) % 7;
      const periodInfluence = periodModes[periodIdx].resonance;
      const subshellIdx = Math.floor(i * 4 / size) % 4;
      const subshellInfluence = subshellCoherence[subshellIdx];
      const phaseAngle = (2 * PI * i) / size + time * AC.DALET_HZ / 5000 + r * AC.SHELL_PHASE_LEAD;
      phaseAngles.push(phaseAngle);
      const psiRigidity = r >= 3 ? (0.92 + 0.08 * psiShellStability) : 1.0;
      atomicField55[nodeIdx2] = Math.min(1,
        (0.28 * flowerCoh * coherence +
         0.22 * periodInfluence +
         0.15 * subshellInfluence +
         0.13 * (0.5 + 0.5 * Math.cos(phaseAngle)) +
         0.12 * quantumChainUp +
         0.10 * geometricProjection * coherence) * psiRigidity);
      ringSum += atomicField55[nodeIdx2];
    }
    let uniformitySum = 0;
    for (let i = 0; i < phaseAngles.length; i++) {
      for (let j = i + 1; j < phaseAngles.length; j++) {
        uniformitySum += Math.abs(Math.cos(phaseAngles[i] - phaseAngles[j]));
      }
    }
    const pairs = Math.max(1, size * (size - 1) / 2);
    const relativeFreq = Math.pow(PHI, 5 + r) * AC.DALET_HZ / 1000;
    ringAnalysis.push({ ring: r, nodeCount: size,
      meanCoherence: ringSum / size,
      phaseUniformity: 1 - uniformitySum / pairs, relativeFreq });
  }

  const orgBins = new Array(7).fill(0);
  for (const c of atomicField55) orgBins[Math.min(6, Math.floor(Math.max(0, c) * 7))]++;
  let entropy = 0;
  for (const count of orgBins) if (count > 0) {
    const p = count / 55; entropy -= p * Math.log2(p);
  }
  const fieldEntropy = entropy;
  const fieldOrganization = 1 - entropy / Math.log2(7);
  const superposition55Composite = atomicField55.reduce((s, v) => s + v, 0) / 55;

  let structuralFormations = 0;
  for (let i = 0; i < 55; i++) if (atomicField55[i] > PHI_INV) structuralFormations++;

  let periodComplexity = 0;
  for (const pm of periodModes) periodComplexity += pm.resonance * (pm.capacity / 32);
  periodComplexity /= 7;

  const dimensionalComplexity = Math.min(1,
    0.20 * periodComplexity + 0.15 * fieldOrganization +
    0.12 * superposition55Composite + 0.12 * nobleGasResonance +
    0.10 * nuclearMagicResonance + 0.10 * quantumChainUp +
    0.08 * magicPhiAlignment + 0.08 * psiShellStability +
    0.05 * ionizationGradient);

  const scaleRelativeTime = 25;
  const chainDownCoupling = Math.min(1,
    quantumChainUp * coherence * (0.5 + 0.5 * periodModes[0].resonance));
  const avgSubshell = subshellCoherence.reduce((a, b) => a + b, 0) / 4;
  const chainUpCoupling = Math.min(1,
    0.25 * fieldOrganization + 0.25 * nobleGasResonance + 0.20 * coherence +
    0.15 * avgSubshell + 0.15 * psiShellStability);

  const periodicResonance = shellHarmonics.reduce((s, v) => s + v, 0) / shellHarmonics.length;

  const fieldDynamicA = Math.min(1,
    0.15 * periodicResonance + 0.13 * superposition55Composite +
    0.12 * nobleGasResonance + 0.10 * dimensionalComplexity +
    0.09 * nuclearMagicResonance + 0.09 * chainDownCoupling +
    0.08 * phiSquaredIdentity + 0.07 * rydbergPhiDecomposition +
    0.06 * ionizationGradient + 0.06 * magicPhiAlignment +
    0.05 * psiShellStability);
  const atomicCoherence = Math.min(1, fieldDynamicA);

  // ─── V11 LYAPUNOV CLOSURE on atomic 55-field ───────────────────────────
  let resR = 0, resI = 0, ampSum = 0;
  for (let r = 0; r < 5; r++) {
    const start = RING_STARTS[r]; const size = RING_SIZES[r];
    for (let i = 0; i < size; i++) {
      const a = atomicField55[start + i];
      const theta = (2 * PI * i) / size;
      resR += a * Math.cos(theta);
      resI += a * Math.sin(theta);
      ampSum += a;
    }
  }
  const closureResidual = ampSum > 1e-9
    ? Math.sqrt(resR * resR + resI * resI) / ampSum : 1.0;

  return {
    hydrogenCorrection, bohrOrbits, periodicResonance, shellHarmonics,
    periodModes, atomicField55, ringAnalysis,
    fieldEntropy, fieldOrganization, dimensionalComplexity,
    superposition55Composite, structuralFormations,
    chainDownCoupling, chainUpCoupling, scaleRelativeTime,
    nobleGasResonance, nuclearMagicResonance, phiSquaredIdentity,
    rydbergPhiDecomposition, subshellCoherence, ionizationGradient, atomicCoherence,
    magicPhiAlignment, geometricProjection, psiShellStability,
    aufbauCompleteness, nobleGasPhiRatio, shellPhaseLead, trialityClosure,
    closureResidual, extensionOrbits,
  };
}
