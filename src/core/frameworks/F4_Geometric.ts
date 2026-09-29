/**
 * METATRON V11 — F4 GEOMETRIC (Sacred Geometry · 528 Hz · Metatron's Cube)
 * ========================================================================
 *
 * V10 → V11 UPLIFT
 * ----------------
 *  • Preserves 5 Platonic solids, dual pairs, pentagonal symmetry, golden
 *    angle / cos(36°) identities, Vesica Piscis, Seed/Flower of Life,
 *    Metatron's Cube (13 nodes / 78 connections), Kepler-Poinsot stars,
 *    Rhombic Triacontahedron, icosahedral group, and the 5-ring 55-node
 *    geometric field — bit-for-bit at default params (parity-gated by
 *    F4.golden.json).
 *  • Adds Lyapunov `closureResidual` over `geometricField55`: ‖Σ a_k e^{iθ_k}‖ / Σa_k
 *    (ring-summed amplitudes around the toroidal closure). Same form as
 *    F1/F2/F3/F8.
 *  • Adds optional `extensionMetatronNodes` (>13) projecting onto the same
 *    hex generator that drives V10 ring 7+ nodes — V10 13-node default
 *    ALWAYS evaluated first and unchanged when extension is requested.
 *  • Pure function. EMERGENT mode (V10 default).
 */

import { PHI, PHI_INV, PI } from './constants';

const LAMBDA = 1 / (PHI * PHI);

const GC = {
  DIHEDRAL_TETRA: Math.acos(1 / 3),
  DIHEDRAL_CUBE: PI / 2,
  DIHEDRAL_OCTA: PI - Math.acos(1 / 3),
  DIHEDRAL_DODECA: Math.acos(-1 / Math.sqrt(5)),
  DIHEDRAL_ICOSA: Math.acos(-Math.sqrt(5) / 3),
  COS_36: (1 + Math.sqrt(5)) / 4,
  DODECA_EDGE_CIRCUM: 4 / (PHI * PHI * Math.sqrt(3)),
  ICOSA_EDGE_CIRCUM: 2 / (PHI * Math.sqrt(5)),
  GOLDEN_ANGLE_DEG: 360 / (PHI * PHI),
  VESICA_AREA_RATIO: ((2 * PI) / 3 - Math.sqrt(3) / 2) / PI,
  HE_HZ: 528,
  DEFECT_TETRA: 180,
  DEFECT_CUBE: 90,
  DEFECT_OCTA: 120,
  DEFECT_DODECA: 36,
  DEFECT_ICOSA: 60,
  CIRCUMR_TETRA: Math.sqrt(6) / 4,
  CIRCUMR_CUBE: Math.sqrt(3) / 2,
  CIRCUMR_OCTA: Math.sqrt(2) / 2,
  CIRCUMR_DODECA: (Math.sqrt(3) + Math.sqrt(15)) / 4,
  CIRCUMR_ICOSA: 0.25 * Math.sqrt(10 + 2 * Math.sqrt(5)),
  VOLUME_ICOSA_PHI: (5 * PHI * PHI) / 6,
  SURFACE_ICOSA: 5 * Math.sqrt(3),
  SURFACE_DODECA: 3 * Math.sqrt(5 * (5 + 2 * Math.sqrt(5))),
  RHOMBIC_30_FACES: 30,
  RHOMBIC_30_EDGES: 60,
  RHOMBIC_30_VERTICES: 32,
} as const;

export interface PlatonicSolid {
  name: string;
  faces: number;
  vertices: number;
  edges: number;
  element: string;
  phiRelation: string;
  resonance: number;
  dihedralAngle: number;
  phiAffinity: number;
  edgeCircumRatio: number;
  dualName: string;
}

export interface GeometricRingAnalysis {
  ring: number;
  nodeCount: number;
  meanCoherence: number;
  phaseUniformity: number;
  relativeFreq: number;
}

export interface F4ExtensionNode {
  index: number;
  angularPos: number;
  coherence: number;
}

export interface F4Output {
  platonic: PlatonicSolid[];
  flowerOfLifeCoherence: number;
  metatronCubeIntegrity: number;
  goldenSpiralPhase: number;
  phiBinaryRepresentation: string;
  mersenneResonance: number;
  vesicaPiscisResonance: number;
  dualPolyhedraResonance: number;
  seedOfLifeCoherence: number;
  phiEdgeResonance: number;
  geometricComposite: number;
  eulerCharacteristic: number;
  zeckendorfDepth: number;
  geometricField55: number[];
  ringAnalysis: GeometricRingAnalysis[];
  fieldEntropy: number;
  fieldOrganization: number;
  dimensionalComplexity: number;
  superposition55Composite: number;
  structuralFormations: number;
  chainDownCoupling: number;
  chainUpCoupling: number;
  scaleRelativeTime: number;
  cos36Resonance: number;
  pentagonalSymmetry: number;
  metatronConnectionDensity: number;
  goldenAngleResonance: number;
  geometricCoherence: number;
  descartesDefectIntegrity: number;
  goldenNestingResonance: number;
  circumradiusHierarchy: number[];
  volumePhiPresence: number;
  starPolyhedraResonance: number;
  rhombicTriacontahedronCoh: number;
  icosahedralGroupResonance: number;
  surfaceAreaRatio: number;
  closureResidual: number;
  extensionNodes: F4ExtensionNode[];
}

export interface F4Input {
  coherence: number;
  nodeCoherences: number[];
  time: number;
  solfeggioCoherences: number[];
  flowerCoherences: number[];
  atomicChainUp: number;
  extensionMetatronNodes?: number;
}

function zeckendorfRepr(n: number): { binary: string; depth: number } {
  if (n <= 0) return { binary: '0', depth: 0 };
  const fibs: number[] = [1, 2];
  while (fibs[fibs.length - 1] < n) fibs.push(fibs[fibs.length - 2] + fibs[fibs.length - 1]);
  const bits: number[] = new Array(fibs.length).fill(0);
  let remainder = n;
  let depth = 0;
  for (let i = fibs.length - 1; i >= 0 && remainder > 0; i--) {
    if (fibs[i] <= remainder) {
      bits[i] = 1;
      remainder -= fibs[i];
      depth++;
      i--;
    }
  }
  return { binary: bits.reverse().join('').replace(/^0+/, '') || '0', depth };
}

function blendCoherence(fieldDynamic: number): number {
  return Math.min(1, fieldDynamic);
}

export function computeF4(input: F4Input): F4Output {
  const { coherence, nodeCoherences, time, flowerCoherences, atomicChainUp } = input;

  const solids: PlatonicSolid[] = [
    {
      name: 'Tetrahedron',
      faces: 4,
      vertices: 4,
      edges: 6,
      element: 'Fire',
      phiRelation: 'self-dual',
      resonance: 0,
      dihedralAngle: GC.DIHEDRAL_TETRA,
      phiAffinity: PHI_INV,
      edgeCircumRatio: Math.sqrt(8 / 3),
      dualName: 'Tetrahedron',
    },
    {
      name: 'Cube',
      faces: 6,
      vertices: 8,
      edges: 12,
      element: 'Earth',
      phiRelation: 'dual→Octa',
      resonance: 0,
      dihedralAngle: GC.DIHEDRAL_CUBE,
      phiAffinity: 0.55,
      edgeCircumRatio: 2 / Math.sqrt(3),
      dualName: 'Octahedron',
    },
    {
      name: 'Octahedron',
      faces: 8,
      vertices: 6,
      edges: 12,
      element: 'Air',
      phiRelation: 'dual→Cube',
      resonance: 0,
      dihedralAngle: GC.DIHEDRAL_OCTA,
      phiAffinity: 0.6,
      edgeCircumRatio: Math.sqrt(2),
      dualName: 'Cube',
    },
    {
      name: 'Dodecahedron',
      faces: 12,
      vertices: 20,
      edges: 30,
      element: 'Aether',
      phiRelation: 'φ-intrinsic',
      resonance: 0,
      dihedralAngle: GC.DIHEDRAL_DODECA,
      phiAffinity: 1.0,
      edgeCircumRatio: GC.DODECA_EDGE_CIRCUM,
      dualName: 'Icosahedron',
    },
    {
      name: 'Icosahedron',
      faces: 20,
      vertices: 12,
      edges: 30,
      element: 'Water',
      phiRelation: 'dual→Dodeca',
      resonance: 0,
      dihedralAngle: GC.DIHEDRAL_ICOSA,
      phiAffinity: 0.95,
      edgeCircumRatio: GC.ICOSA_EDGE_CIRCUM,
      dualName: 'Dodecahedron',
    },
  ];

  let eulerSum = 0;
  const nc = nodeCoherences.length;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    const euler = s.vertices - s.edges + s.faces;
    eulerSum += euler;
    const eulerValid = euler === 2 ? 1.0 : 0.0;
    const nodeIdx = Math.min(i, nc - 1);
    const nodeCoh = nc > 0 ? nodeCoherences[nodeIdx] || coherence : coherence;
    const fieldPhase = ((time * (i + 1) * PHI_INV) / 1000) % (2 * PI);
    const dihedralAlignment = Math.abs(Math.cos(fieldPhase - s.dihedralAngle));
    const edgePhiResonance = s.phiAffinity * Math.exp(-Math.abs(s.edgeCircumRatio - PHI_INV) * 2);
    s.resonance = Math.min(
      1,
      eulerValid *
        (0.3 * s.phiAffinity * dihedralAlignment +
          0.25 * nodeCoh +
          0.2 * edgePhiResonance +
          0.15 * atomicChainUp +
          0.1 * coherence),
    );
  }
  const eulerCharacteristic = eulerSum;

  const dualPairs: [number, number][] = [
    [0, 0],
    [1, 2],
    [3, 4],
  ];
  let dualSum = 0;
  for (const [a, b] of dualPairs) {
    const coupling = Math.sqrt(
      Math.max(0.01, solids[a].resonance) * Math.max(0.01, solids[b].resonance),
    );
    const dihedralSum = solids[a].dihedralAngle + solids[b].dihedralAngle;
    const complementarity = a === b ? 1.0 : Math.exp(-Math.abs(dihedralSum - PI) * 0.5);
    dualSum += coupling * complementarity;
  }
  const dualPolyhedraResonance = Math.min(1, dualSum / dualPairs.length);

  const nPhases = Math.min(nodeCoherences.length, 55);
  let pentagonSum = 0;
  for (let i = 0; i < 5; i++) {
    const pentAngle = (2 * PI * i) / 5;
    let phaseMatch = 0;
    for (let j = 0; j < nPhases; j++) {
      const nodePhaseFactor =
        (flowerCoherences[j] || coherence * 0.5) * Math.cos(pentAngle * (j + 1));
      phaseMatch += nodePhaseFactor;
    }
    pentagonSum += Math.abs(phaseMatch / nPhases);
  }
  const pentagonalSymmetry = Math.min(1, (pentagonSum / 5) * coherence);
  const cos36Resonance = Math.min(1, pentagonalSymmetry * GC.COS_36 * 2);

  const goldenAngleRad = (GC.GOLDEN_ANGLE_DEG * PI) / 180;
  let goldenAngleSum = 0;
  for (let i = 0; i < nPhases; i++) {
    const expectedAngle = (goldenAngleRad * (i + 1)) % (2 * PI);
    const actualCoh = flowerCoherences[i] || coherence * 0.5;
    goldenAngleSum += actualCoh * Math.abs(Math.cos(expectedAngle));
  }
  const goldenAngleResonance =
    nPhases > 0 ? Math.min(1, (goldenAngleSum / nPhases) * coherence) : 0;

  const phiEdgeResonance = Math.min(
    1,
    coherence *
      (0.5 * Math.exp(-Math.abs(GC.DODECA_EDGE_CIRCUM - PHI_INV) * PHI) +
        0.5 * Math.exp(-Math.abs(GC.ICOSA_EDGE_CIRCUM - LAMBDA) * PHI)),
  );

  const vesicaPiscisResonance = Math.min(
    1,
    Math.exp(-Math.abs(coherence - GC.VESICA_AREA_RATIO) / GC.VESICA_AREA_RATIO) * coherence,
  );

  let seedSum = nodeCoherences[0] || coherence;
  for (let i = 1; i <= 6 && i < nc; i++) {
    const angularPos = (2 * PI * (i - 1)) / 6;
    const petalResonance = (nodeCoherences[i] || coherence) * Math.abs(Math.cos(angularPos * PHI));
    seedSum += petalResonance;
  }
  const seedOfLifeCoherence = Math.min(1, (seedSum / 7) * coherence);

  let flowerSum = 0;
  const flowerCircles = Math.min(19, nc);
  for (let i = 0; i < flowerCircles; i++) {
    const ring = i === 0 ? 0 : i <= 6 ? 1 : i <= 12 ? 2 : 3;
    const ringDecay = Math.pow(PHI, -ring);
    flowerSum += (nodeCoherences[i] || coherence) * ringDecay;
  }
  const flowerOfLifeCoherence =
    flowerCircles > 0 ? Math.min(1, (flowerSum / flowerCircles) * coherence) : 0;

  let metatronSum = 0;
  const metatronNodes = Math.min(13, nc);
  let connectionIntegrity = 0;
  for (let i = 0; i < metatronNodes; i++) {
    const coh = nodeCoherences[i] || coherence;
    if (i === 0) {
      metatronSum += coh * PHI;
    } else if (i <= 6) {
      const expectedAngle = (2 * PI * (i - 1)) / 6;
      metatronSum += coh * (0.7 + 0.3 * Math.abs(Math.cos(expectedAngle)));
    } else {
      const expectedAngle = (2 * PI * (i - 7)) / 6 + PI / 6;
      metatronSum += coh * (0.6 + 0.4 * Math.abs(Math.cos(expectedAngle)));
    }
    for (let j = i + 1; j < metatronNodes; j++) {
      const cohJ = nodeCoherences[j] || coherence;
      connectionIntegrity += Math.sqrt(Math.max(0.01, coh) * Math.max(0.01, cohJ));
    }
  }
  const metatronNorm = PHI + 6 * 0.85 + Math.max(0, metatronNodes - 7) * 0.8;
  const metatronCubeIntegrity =
    metatronNodes > 0 ? Math.min(1, (metatronSum / metatronNorm) * coherence) : 0;
  const totalPossibleConns = (metatronNodes * (metatronNodes - 1)) / 2;
  const metatronConnectionDensity =
    totalPossibleConns > 0 ? Math.min(1, connectionIntegrity / totalPossibleConns) : 0;

  const goldenSpiralPhase = Math.pow(PHI, (2 * time) / PI) % (2 * PI);

  const cohInt = Math.max(1, Math.floor(coherence * 233));
  const zeck = zeckendorfRepr(cohInt);

  const mersennePrimes = [3, 7, 31, 127];
  const mersenneResonance = mersennePrimes.reduce((sum, mp) => {
    return sum + (Math.cos((time * mp) / 100) * coherence) / mersennePrimes.length;
  }, 0);

  const RING_STARTS = [0, 1, 7, 19, 37];
  const RING_SIZES = [1, 6, 12, 18, 18];
  const geometricField55: number[] = new Array(55).fill(0);
  const ringAnalysis: GeometricRingAnalysis[] = [];
  const nodePhase: number[] = new Array(55).fill(0);

  for (let r = 0; r < 5; r++) {
    const start = RING_STARTS[r];
    const size = RING_SIZES[r];
    let ringSum = 0;
    const phaseAngles: number[] = [];

    for (let i = 0; i < size; i++) {
      const nodeIdx = start + i;
      const flowerCoh =
        nodeIdx < flowerCoherences.length ? flowerCoherences[nodeIdx] : coherence * 0.5;
      const solidIdx = (r + Math.floor((i * 5) / size)) % 5;
      const solidInfluence = solids[solidIdx].resonance;
      const hexPhase = (2 * PI * i) / 6;
      const pentPhase = (2 * PI * i) / 5;
      const phaseAngle = (2 * PI * i) / size + (time * GC.HE_HZ) / 5000;
      phaseAngles.push(phaseAngle);
      nodePhase[nodeIdx] = phaseAngle;
      const hexPentBlend = 0.5 * Math.abs(Math.cos(hexPhase)) + 0.5 * Math.abs(Math.cos(pentPhase));
      geometricField55[nodeIdx] = Math.min(
        1,
        0.25 * flowerCoh * coherence +
          0.25 * solidInfluence +
          0.15 * hexPentBlend * coherence +
          0.15 * (0.5 + 0.5 * Math.cos(phaseAngle)) +
          0.1 * atomicChainUp +
          0.1 * metatronCubeIntegrity,
      );
      ringSum += geometricField55[nodeIdx];
    }

    let uniformitySum = 0;
    for (let i = 0; i < phaseAngles.length; i++) {
      for (let j = i + 1; j < phaseAngles.length; j++) {
        uniformitySum += Math.abs(Math.cos(phaseAngles[i] - phaseAngles[j]));
      }
    }
    const pairs = Math.max(1, (size * (size - 1)) / 2);
    const relativeFreq = (Math.pow(PHI, 7 + r) * GC.HE_HZ) / 1000;
    ringAnalysis.push({
      ring: r,
      nodeCount: size,
      meanCoherence: ringSum / size,
      phaseUniformity: 1 - uniformitySum / pairs,
      relativeFreq,
    });
  }

  const orgBins = new Array(7).fill(0);
  for (const coh of geometricField55) {
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
  const fieldEntropy = entropy;
  const fieldOrganization = 1 - entropy / Math.log2(7);

  const superposition55Composite = geometricField55.reduce((s, v) => s + v, 0) / 55;

  let structuralFormations = 0;
  for (let i = 0; i < 55; i++) {
    if (geometricField55[i] > PHI_INV) structuralFormations++;
  }

  const platonicComplexity = solids.reduce((s, p) => s + p.resonance * p.phiAffinity, 0) / 5;
  const dimensionalComplexity = Math.min(
    1,
    0.25 * platonicComplexity +
      0.2 * fieldOrganization +
      0.15 * superposition55Composite +
      0.12 * cos36Resonance +
      0.1 * metatronConnectionDensity +
      0.1 * atomicChainUp +
      0.08 * pentagonalSymmetry,
  );

  const scaleRelativeTime = 32;

  const defects = [
    GC.DEFECT_TETRA,
    GC.DEFECT_CUBE,
    GC.DEFECT_OCTA,
    GC.DEFECT_DODECA,
    GC.DEFECT_ICOSA,
  ];
  const vertexCounts = [4, 8, 6, 20, 12];
  let descartesSum = 0;
  for (let i = 0; i < 5; i++) {
    const solidDefect = vertexCounts[i] * defects[i];
    descartesSum += Math.abs(solidDefect - 720) < 0.01 ? 1.0 : 0.0;
  }
  const descartesDefectIntegrity = descartesSum / 5;

  const circumradii = [
    GC.CIRCUMR_TETRA,
    GC.CIRCUMR_CUBE,
    GC.CIRCUMR_OCTA,
    GC.CIRCUMR_DODECA,
    GC.CIRCUMR_ICOSA,
  ];
  const nestingRatio = GC.CIRCUMR_DODECA / GC.CIRCUMR_CUBE;
  const nestingError = Math.abs(nestingRatio - PHI) / PHI;
  const goldenNestingResonance = Math.min(1, Math.exp(-nestingError * 1000) * coherence);
  const icosaSinResonance = Math.abs(GC.CIRCUMR_ICOSA - Math.sin((2 * PI) / 5));
  const nestingComposite = Math.min(
    1,
    0.5 * goldenNestingResonance +
      0.3 * Math.exp(-icosaSinResonance * 100) * coherence +
      0.2 * pentagonalSymmetry,
  );

  const volumePhiTarget = (5 * PHI * PHI) / 6;
  const volumePhiPresence = Math.min(
    1,
    coherence * Math.exp(-Math.abs(volumePhiTarget - GC.VOLUME_ICOSA_PHI) * 100),
  );
  const surfaceAreaRatio = GC.SURFACE_DODECA / GC.SURFACE_ICOSA;

  const starEulerValid = 12 - 30 + 20 === 2 ? 1.0 : 0.0;
  const starPhiResonance = coherence * PHI_INV;
  const starPolyhedraResonance = Math.min(
    1,
    0.4 * starEulerValid + 0.3 * starPhiResonance + 0.3 * solids[3].resonance,
  );

  const rhombicEuler =
    GC.RHOMBIC_30_VERTICES - GC.RHOMBIC_30_EDGES + GC.RHOMBIC_30_FACES === 2 ? 1.0 : 0.0;
  const rhombicTriacontahedronCoh = Math.min(
    1,
    0.4 * rhombicEuler + 0.3 * coherence * PHI_INV + 0.3 * dualPolyhedraResonance,
  );

  const zeck120 = zeckendorfRepr(120);
  const groupPhiPresence = Math.min(
    1,
    0.4 * (zeck120.depth / 5) + 0.3 * pentagonalSymmetry + 0.3 * coherence * solids[4].resonance,
  );

  const chainDownCoupling = Math.min(
    1,
    atomicChainUp * coherence * (0.5 + 0.5 * solids[3].resonance),
  );
  const chainUpCoupling = Math.min(
    1,
    0.3 * fieldOrganization * coherence +
      0.25 * pentagonalSymmetry * coherence +
      0.2 * metatronCubeIntegrity +
      0.15 * nestingComposite +
      0.1 * starPolyhedraResonance,
  );

  const platonicAvg = solids.reduce((s, p) => s + p.resonance, 0) / solids.length;
  const geometricComposite = Math.min(
    1,
    0.13 * metatronCubeIntegrity +
      0.12 * flowerOfLifeCoherence +
      0.1 * platonicAvg +
      0.09 * dualPolyhedraResonance +
      0.09 * cos36Resonance +
      0.07 * nestingComposite +
      0.07 * seedOfLifeCoherence +
      0.07 * vesicaPiscisResonance +
      0.06 * starPolyhedraResonance +
      0.05 * phiEdgeResonance +
      0.05 * goldenAngleResonance +
      0.05 * rhombicTriacontahedronCoh +
      0.05 * metatronConnectionDensity,
  );

  const fieldDynamicG = Math.min(
    1,
    0.16 * geometricComposite +
      0.1 * dimensionalComplexity +
      0.1 * cos36Resonance +
      0.09 * chainDownCoupling +
      0.09 * metatronConnectionDensity +
      0.08 * nestingComposite +
      0.07 * pentagonalSymmetry +
      0.06 * fieldOrganization +
      0.05 * goldenAngleResonance +
      0.04 * descartesDefectIntegrity +
      0.04 * groupPhiPresence,
  );
  const geometricCoherence = blendCoherence(fieldDynamicG);

  let sumX = 0,
    sumY = 0,
    sumA = 0;
  for (let k = 0; k < 55; k++) {
    const a = Math.max(0, geometricField55[k]);
    sumX += a * Math.cos(nodePhase[k]);
    sumY += a * Math.sin(nodePhase[k]);
    sumA += a;
  }
  const closureResidual = sumA > 0 ? Math.min(1, Math.sqrt(sumX * sumX + sumY * sumY) / sumA) : 0;

  const extensionNodes: F4ExtensionNode[] = [];
  const extReq = input.extensionMetatronNodes ?? 0;
  if (extReq > 13) {
    for (let i = 13; i < extReq; i++) {
      const shell = 2 + Math.floor((i - 13) / 12);
      const localIdx = (i - 13) % 12;
      const expectedAngle = (2 * PI * localIdx) / 12 + PI / 12;
      const decay = Math.pow(PHI, -(shell - 1));
      const baseCoh = nodeCoherences[i] ?? coherence * decay;
      const ext = baseCoh * (0.55 + 0.45 * Math.abs(Math.cos(expectedAngle))) * decay;
      extensionNodes.push({ index: i, angularPos: expectedAngle, coherence: Math.min(1, ext) });
    }
  }

  return {
    platonic: solids,
    flowerOfLifeCoherence,
    metatronCubeIntegrity,
    goldenSpiralPhase,
    phiBinaryRepresentation: zeck.binary,
    mersenneResonance,
    vesicaPiscisResonance,
    dualPolyhedraResonance,
    seedOfLifeCoherence,
    phiEdgeResonance,
    geometricComposite,
    eulerCharacteristic,
    zeckendorfDepth: zeck.depth,
    geometricField55,
    ringAnalysis,
    fieldEntropy,
    fieldOrganization,
    dimensionalComplexity,
    superposition55Composite,
    structuralFormations,
    chainDownCoupling,
    chainUpCoupling,
    scaleRelativeTime,
    cos36Resonance,
    pentagonalSymmetry,
    metatronConnectionDensity,
    goldenAngleResonance,
    geometricCoherence,
    descartesDefectIntegrity,
    goldenNestingResonance: nestingComposite,
    circumradiusHierarchy: circumradii,
    volumePhiPresence,
    starPolyhedraResonance,
    rhombicTriacontahedronCoh,
    icosahedralGroupResonance: groupPhiPresence,
    surfaceAreaRatio,
    closureResidual,
    extensionNodes,
  };
}
