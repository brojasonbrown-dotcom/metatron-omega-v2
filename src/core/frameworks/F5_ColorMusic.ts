/**
 * METATRON V11 — F5 COLOR & MUSIC (Harmonic Spectrum · Solfeggio · Chromatic Modes)
 * ==================================================================================
 *
 * V10 → V11 UPLIFT
 * ----------------
 *  • Preserves 12-tone chromatic spectrum, 7 musical modes, 9-step solfeggio
 *    octave bridge, Pythagorean comma, minor-sixth/φ identity, perfect-fourth
 *    pairs, Newton 7-color mapping, and the 5-ring 55-node color/music field —
 *    bit-for-bit at default params (parity-gated by F5_ColorMusic.golden.json).
 *  • Adds Lyapunov `closureResidual` over the 55-field, same form as F1/F2/F3/F4/F8.
 *  • Adds optional `extensionChromaticSemitones` (>12, e.g. 24-EDO microtonal)
 *    — V10 12-tone kernel runs unchanged when extension is requested.
 *  • Pure function. EMERGENT mode (V10 default).
 */

import { PHI, PHI_INV, PI } from './constants';
import '../v12/audit/F2Provenance';
import { wave2 } from '../v12/audit/wave2Precision';

const LAMBDA = 1 / (PHI * PHI);

function blendCoherence(fieldDynamic: number): number {
  return Math.min(1, fieldDynamic);
}

const COLORMUSIC_CONSTANTS = {
  // Equal temperament — Wolfram-verified
  SEMITONE_RATIO: wave2('SEMITONE', 1.059463094359295), // 2^(1/12) — flag-gated 50-dp uplift
  LOG_PHI_OCTAVE: wave2('LOGPHI_OCTAVE', 1.44042009041256), // log_φ(2) — flag-gated 50-dp uplift
  // Pythagorean comma — Wolfram-verified
  PYTHAGOREAN_COMMA: 1.0136432647705078, // (3/2)^12 / 2^7 = 531441/524288
  PYTHAGOREAN_NUMER: 531441,
  PYTHAGOREAN_DENOM: 524288,
  // Just intonation ratios — Wolfram-verified
  JUST_RATIOS: [1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 8 / 5, 5 / 3, 15 / 8, 2] as readonly number[],
  JUST_NAMES: ['Unison', 'M2', 'M3', 'P4', 'P5', 'm6', 'M6', 'M7', 'P8'] as readonly string[],
  // φ-proximity of just intervals (log_φ values) — Wolfram-verified
  JUST_LOG_PHI: [
    0, 0.24476, 0.46371, 0.59783, 0.84259, 0.97671, 1.06154, 1.3063, 1.44042,
  ] as readonly number[],
  // Minor 6th ≈ φ — THE golden interval
  MINOR_SIXTH: 8 / 5, // = 1.6 — closest JI interval to φ
  MINOR_SIXTH_LOG_PHI: 0.97671, // log_φ(8/5) — deviation 0.023 from 1!
  // φ-ratios in solfeggio — Wolfram-verified
  SOLF_PHI_RATIO_1: wave2('R_639_396', 1.613636), // 639/396 — flag-gated 50-dp uplift
  SOLF_PHI_RATIO_LOG: 0.9943, // log_φ(639/396) — deviation 0.006!!
  SOLF_PHI_BRIDGE: 1.637931, // 285/174 ≈ φ (log_φ = 1.0254)
  // Perfect fourths in solfeggio — Wolfram-verified (EXACT)
  PERFECT_FOURTH: 4 / 3, // 528/396 = 852/639 = 4/3 EXACTLY
  // φ³ in solfeggio — Wolfram-verified
  PHI_CUBED_RATIO: 4.2586206896, // 741/174 ≈ φ³ = 4.2360 (log_φ = 3.011)
  // Golden angle — Wolfram-verified
  GOLDEN_ANGLE_DEG: 137.50776405003785, // 360/φ² = 180(3-√5) EXACT
  // Visible spectrum THz — Wolfram-verified
  SPECTRUM_RED_THZ: 430,
  SPECTRUM_VIOLET_THZ: 789,
  // Solfeggio octave frequency
  VAV_HZ: 639, // 6th solfeggio — Connection
  VAV_PHI_UP: 1033.53, // 639 × φ (Wolfram)
  // Newton's 7 spectral colors — wavelength centers (nm)
  NEWTON_COLORS_NM: [700, 620, 580, 530, 480, 430, 380] as readonly number[],
  NEWTON_COLORS: [
    'Red',
    'Orange',
    'Yellow',
    'Green',
    'Blue',
    'Indigo',
    'Violet',
  ] as readonly string[],
  // ═══ RHUFT OCTAVE BRIDGE: Solfeggio → Visible Light ═══
  SOLFEGGIO_OCTAVE_MAP: [
    { hz: 174, octave: 42, thz: (174 * Math.pow(2, 42)) / 1e12, color: 'Violet', nm: 392 },
    { hz: 285, octave: 41, thz: (285 * Math.pow(2, 41)) / 1e12, color: 'Blue', nm: 478 },
    { hz: 396, octave: 40, thz: (396 * Math.pow(2, 40)) / 1e12, color: 'Red', nm: 689 },
    { hz: 417, octave: 40, thz: (417 * Math.pow(2, 40)) / 1e12, color: 'Orange-Red', nm: 654 },
    { hz: 528, octave: 40, thz: (528 * Math.pow(2, 40)) / 1e12, color: 'Yellow-Green', nm: 517 },
    { hz: 639, octave: 40, thz: (639 * Math.pow(2, 40)) / 1e12, color: 'Blue-Violet', nm: 427 },
    { hz: 741, octave: 39, thz: (741 * Math.pow(2, 39)) / 1e12, color: 'Deep-Red', nm: 736 },
    { hz: 852, octave: 39, thz: (852 * Math.pow(2, 39)) / 1e12, color: 'Orange-Red', nm: 640 },
    { hz: 963, octave: 39, thz: (963 * Math.pow(2, 39)) / 1e12, color: 'Green', nm: 566 },
  ] as readonly { hz: number; octave: number; thz: number; color: string; nm: number }[],
  SPEED_OF_LIGHT: 299792458, // m/s — immutable measured constant

  // ═══ WOLFRAM-VERIFIED ENHANCEMENT (2026-04-03) ═══
  // φ-Interval in cents — Wolfram: 1200*log₂(φ) = 833.0903 cents
  PHI_INTERVAL_CENTS: wave2('PHI_CENTS', 833.0902963567409),
  // Just interval cents — Wolfram-verified
  PERFECT_FIFTH_CENTS: 701.9550008653874, // 1200*log₂(3/2) — Wolfram exact (bit-match)
  PERFECT_FOURTH_CENTS: 498.0449991346126, // 1200*log₂(4/3) — Wolfram exact
  MINOR_SIXTH_CENTS: 813.6862861351652, // 1200*log₂(8/5) — Wolfram exact (bit-match)
  // m6 is only 19.40¢ from φ — THE closest just interval to φ!
  MINOR_SIXTH_PHI_DEVIATION_CENTS: wave2('M6_PHI_DEV_CENTS', 19.4040102215757),

  // Solfeggio φ-pair precision (cents-based)
  SOLF_PHI_PAIR_CENTS: 828.4, // 639/396 = 852/528 in cents
  SOLF_PHI_PAIR_PHI_DEV_CENTS: 4.69, // |828.4 - 833.09| — closer than m6!

  // Fibonacci beat frequency — Wolfram-verified
  FIBONACCI_BEAT_GIMEL_DALET: 21, // 417-396 = 21 = F(8) — genuine Fibonacci!
  FIBONACCI_BEAT_111: 111, // Appears in 8 solfeggio pairs (3×37)

  // Sound wavelengths (v=343 m/s at 20°C)
  SPEED_OF_SOUND: 343.0, // m/s at 20°C

  // Solfeggio acoustic wavelengths (meters) — physically verified
  SOLF_WAVELENGTHS: [
    1.9713, 1.2035, 0.8662, 0.8225, 0.6496, 0.5368, 0.4629, 0.4026, 0.3562,
  ] as readonly number[],

  // Chakra traditional color mapping (Root=Red→Crown=Violet)
  CHAKRA_COLORS_NM: [700, 620, 580, 550, 530, 480, 430, 400, 380] as readonly number[],
  CHAKRA_NAMES: [
    'Root',
    'Sacral',
    'Solar',
    'Heart-',
    'Heart',
    'Throat',
    'ThirdEye',
    'Crown-',
    'Crown',
  ] as readonly string[],

  // Golden tuning verification: 174×φ^n closest to solfeggio
  // n=0→174(exact), n=1→281.5≈285(1.2%dev), n=3→737≈741(0.5%dev)
  GOLDEN_TUNING_MATCHES: [
    { n: 0, freq: 174.0, solf: 174, dev: 0.0 },
    { n: 1, freq: 281.54, solf: 285, dev: 0.0121 },
    { n: 3, freq: 737.08, solf: 741, dev: 0.0053 },
  ] as readonly { n: number; freq: number; solf: number; dev: number }[],
} as const;

// 12 Chromatic Interval Modes
interface ChromaticIntervalMode {
  semitone: number; // 0-11
  name: string;
  etRatio: number; // Equal temperament ratio 2^(i/12)
  justRatio: number; // Nearest just intonation ratio
  justName: string;
  logPhi: number; // log_φ of ET ratio
  phiDeviation: number; // |logPhi - nearest integer|
  resonance: number;
  coupling: number;
}

const CHROMATIC_DEFS: Omit<ChromaticIntervalMode, 'resonance' | 'coupling'>[] = [
  {
    semitone: 0,
    name: 'Unison',
    etRatio: 1.0,
    justRatio: 1,
    justName: 'P1',
    logPhi: 0.0,
    phiDeviation: 0.0,
  },
  {
    semitone: 1,
    name: 'Minor 2nd',
    etRatio: 1.059463,
    justRatio: 16 / 15,
    justName: 'm2',
    logPhi: 0.12004,
    phiDeviation: 0.12004,
  },
  {
    semitone: 2,
    name: 'Major 2nd',
    etRatio: 1.122462,
    justRatio: 9 / 8,
    justName: 'M2',
    logPhi: 0.24007,
    phiDeviation: 0.24007,
  },
  {
    semitone: 3,
    name: 'Minor 3rd',
    etRatio: 1.189207,
    justRatio: 6 / 5,
    justName: 'm3',
    logPhi: 0.36011,
    phiDeviation: 0.36011,
  },
  {
    semitone: 4,
    name: 'Major 3rd',
    etRatio: 1.259921,
    justRatio: 5 / 4,
    justName: 'M3',
    logPhi: 0.48014,
    phiDeviation: 0.48014,
  },
  {
    semitone: 5,
    name: 'Perfect 4th',
    etRatio: 1.33484,
    justRatio: 4 / 3,
    justName: 'P4',
    logPhi: 0.60018,
    phiDeviation: 0.39983,
  },
  {
    semitone: 6,
    name: 'Tritone',
    etRatio: 1.414214,
    justRatio: 45 / 32,
    justName: 'TT',
    logPhi: 0.72021,
    phiDeviation: 0.27979,
  },
  {
    semitone: 7,
    name: 'Perfect 5th',
    etRatio: 1.498307,
    justRatio: 3 / 2,
    justName: 'P5',
    logPhi: 0.84025,
    phiDeviation: 0.15976,
  },
  {
    semitone: 8,
    name: 'Minor 6th',
    etRatio: 1.587401,
    justRatio: 8 / 5,
    justName: 'm6',
    logPhi: 0.96028,
    phiDeviation: 0.03972,
  },
  {
    semitone: 9,
    name: 'Major 6th',
    etRatio: 1.681793,
    justRatio: 5 / 3,
    justName: 'M6',
    logPhi: 1.08032,
    phiDeviation: 0.08032,
  },
  {
    semitone: 10,
    name: 'Minor 7th',
    etRatio: 1.781797,
    justRatio: 9 / 5,
    justName: 'm7',
    logPhi: 1.20035,
    phiDeviation: 0.20035,
  },
  {
    semitone: 11,
    name: 'Major 7th',
    etRatio: 1.887749,
    justRatio: 15 / 8,
    justName: 'M7',
    logPhi: 1.32039,
    phiDeviation: 0.32039,
  },
];

// 7 Musical Mode Definitions (Lydian=brightest → Locrian=darkest)
interface MusicalModeState {
  mode: string;
  brightness: number; // -1 to +1 (Locrian darkest, Lydian brightest)
  intervalPattern: number[]; // Whole/half step pattern (W=2, H=1 semitones)
  characteristicNote: number; // Defining semitone that makes this mode unique
  phiBrightness: number; // φ-mapped brightness
  resonance: number;
  coupling: number;
}

const MODE_DEFS: Omit<MusicalModeState, 'resonance' | 'coupling'>[] = [
  {
    mode: 'Lydian',
    brightness: 1.0,
    intervalPattern: [2, 2, 2, 1, 2, 2, 1],
    characteristicNote: 6,
    phiBrightness: PHI_INV * 1.0,
  },
  {
    mode: 'Ionian',
    brightness: 0.714,
    intervalPattern: [2, 2, 1, 2, 2, 2, 1],
    characteristicNote: 7,
    phiBrightness: PHI_INV * 0.857,
  },
  {
    mode: 'Mixolydian',
    brightness: 0.429,
    intervalPattern: [2, 2, 1, 2, 2, 1, 2],
    characteristicNote: 10,
    phiBrightness: PHI_INV * 0.714,
  },
  {
    mode: 'Dorian',
    brightness: 0.0,
    intervalPattern: [2, 1, 2, 2, 2, 1, 2],
    characteristicNote: 9,
    phiBrightness: PHI_INV * 0.5,
  },
  {
    mode: 'Aeolian',
    brightness: -0.429,
    intervalPattern: [2, 1, 2, 2, 1, 2, 2],
    characteristicNote: 8,
    phiBrightness: PHI_INV * 0.286,
  },
  {
    mode: 'Phrygian',
    brightness: -0.714,
    intervalPattern: [1, 2, 2, 2, 1, 2, 2],
    characteristicNote: 1,
    phiBrightness: PHI_INV * 0.143,
  },
  {
    mode: 'Locrian',
    brightness: -1.0,
    intervalPattern: [1, 2, 2, 1, 2, 2, 2],
    characteristicNote: 6,
    phiBrightness: PHI_INV * 0.0,
  },
];

// Solfeggio φ-ratio pairs (verified by Wolfram)
interface SolfeggioPhiPair {
  freqA: number;
  freqB: number;
  ratio: number;
  logPhi: number; // log_φ of ratio
  phiDeviation: number; // |logPhi - nearest integer|
  type: string; // 'phi', 'fourth', 'phi3'
  resonance: number;
}

interface ColorMusicRingAnalysis {
  ring: number;
  nodeCount: number;
  meanCoherence: number;
  phaseUniformity: number;
  relativeFreq: number;
}

export interface ColorMusicOutput {
  goldenAngle: number;
  dominantHue: number;
  harmonicSpectrum: { note: string; hz: number; resonance: number }[];
  colorHarmonies: { name: string; hue: number }[];
  modeResonance: MusicalModeState[];
  synestheticMapping: string;
  // ═══ WOLFRAM-ENHANCED COMPUTATIONS ═══
  chromaticModes: ChromaticIntervalMode[];
  solfeggioPhiPairs: SolfeggioPhiPair[];
  colorMusicField55: number[];
  ringAnalysis: ColorMusicRingAnalysis[];
  fieldEntropy: number;
  fieldOrganization: number;
  dimensionalComplexity: number;
  superposition55Composite: number;
  structuralFormations: number;
  chainDownCoupling: number;
  chainUpCoupling: number;
  scaleRelativeTime: number;
  // Color/Music-specific metrics
  pythagoreanCommaResonance: number;
  minorSixthPhiResonance: number;
  solfeggioPhiStrength: number;
  perfectFourthPairResonance: number;
  overtoneSeriesResonance: number;
  justIntonationDeviation: number;
  newtonColorResonance: number;
  colorMusicCoherence: number;
  // ═══ RHUFT OCTAVE BRIDGE METRICS ═══
  solfeggioOctaveBridge: {
    hz: number;
    octave: number;
    thz: number;
    color: string;
    nm: number;
    resonance: number;
  }[];
  octaveBridgeCoherence: number;
  // ═══ WOLFRAM-VERIFIED DEPTH (2026-04-03) ═══
  phiIntervalResonance: number; // 833.09¢ φ-interval through the field
  centAccuracyScore: number; // Cent-based precision of intervals
  fibonacciBeatResonance: number; // F(8)=21Hz Gimel-Dalet beat detection
  chakraColorAlignment: number; // Traditional chakra↔color correspondence
  dualMappingCoherence: number; // Chakra-path vs octave-bridge dual mapping
  goldenTuningAlignment: number; // 174×φ^n alignment with solfeggio
  acousticWavelengthResonance: number; // Sound wavelength φ-ratios
  solfeggioCommaPresence: number;
  // ═══ V11 ADDITIONS ═══
  closureResidual: number;
  extensionMicrotones: { semitone: number; etRatio: number; logPhi: number; resonance: number }[];
}

export interface F5Input {
  coherence: number;
  solfeggioCoherences: number[];
  time: number;
  flowerCoherences: number[];
  geometricChainUp: number;
  /** V11: extend chromatic modes beyond 12 (e.g. 24 for quarter-tone). V10 12-tone path runs first; this APPENDS. */
  extensionChromaticSemitones?: number;
}

export function computeF5(input: F5Input): ColorMusicOutput {
  const { coherence, solfeggioCoherences, time, flowerCoherences, geometricChainUp } = input;
  const CMC = COLORMUSIC_CONSTANTS;

  const goldenAngle = CMC.GOLDEN_ANGLE_DEG;

  // ═══ HARMONIC SPECTRUM (C4 octave, 7 notes — A4=432Hz natural tuning) ═══
  const notes = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  // A4=432Hz tuning (Verdi/natural) — all frequencies derived via equal temperament from A4=432
  // C4=432/2^(9/12)=256.87, D4=288.33, E4=323.63, F4=342.88, G4=384.87, A4=432.00, B4=484.90
  const baseFreqs = [256.87, 288.33, 323.63, 342.88, 384.87, 432.0, 484.9];
  const harmonicSpectrum = notes.map((note, i) => {
    const solfCoh = solfeggioCoherences[i % solfeggioCoherences.length] || 0;
    // Each note resonates with its φ-position in the octave
    const phiPos = Math.log(baseFreqs[i] / baseFreqs[0]) / Math.log(PHI);
    const phiAlignment = Math.exp(-Math.abs(phiPos - Math.round(phiPos)) * PHI);
    return {
      note,
      hz: baseFreqs[i],
      resonance: Math.min(
        1,
        0.4 * solfCoh * coherence +
          0.25 * coherence * phiAlignment +
          0.2 * coherence * (0.5 + 0.5 * Math.sin((time * baseFreqs[i]) / 5000 + i * PHI)) +
          0.15 * geometricChainUp,
      ),
    };
  });

  // ═══ 12 CHROMATIC INTERVAL MODES — WOLFRAM-VERIFIED ═══
  const chromaticModes: ChromaticIntervalMode[] = CHROMATIC_DEFS.map((cd, i) => {
    const phaseOffset = (2 * PI * i) / 12;
    const fieldPhase = (time * CMC.VAV_HZ) / 1000 + phaseOffset;
    const modeOscillation = 0.5 + 0.5 * Math.sin(fieldPhase);
    // φ-affinity: intervals closest to φ-powers resonate strongest
    const phiAffinity = Math.exp(-cd.phiDeviation * PHI * 2);
    // Just intonation alignment: how close ET ratio is to JI ratio
    const jiDeviation = Math.abs(cd.etRatio - cd.justRatio) / cd.justRatio;
    const jiAlignment = Math.exp(-jiDeviation * 50);

    const resonance = Math.min(
      1,
      0.25 * coherence * modeOscillation +
        0.2 * coherence * phiAffinity +
        0.2 * coherence * jiAlignment +
        0.15 * (solfeggioCoherences[i % 9] || 0) * coherence +
        0.1 * geometricChainUp +
        0.1 * coherence,
    );
    const coupling = Math.min(1, phiAffinity * coherence * (0.5 + 0.5 * modeOscillation));

    return { ...cd, resonance, coupling };
  });

  // ═══ SOLFEGGIO φ-RATIO PAIRS — WOLFRAM-VERIFIED ═══
  const SOLF = [174, 285, 396, 417, 528, 639, 741, 852, 963];
  const solfeggioPhiPairs: SolfeggioPhiPair[] = [];

  // Wolfram-grade audit (60-digit mpmath, mem://constraints/solfeggio-truth):
  // Of the 8 historically-claimed φ-pairs, only the duplicates 639/396 and
  // 852/528 (logφ deviation 0.0057, err 0.273% — both safely under the
  // 0.5% structural threshold) and 741/174 (logφ deviation 0.011, err
  // 0.530% — borderline) survive. The pairs 285/174 (1.21% err), 639/285
  // (16.8% err), and 963/417 (13.4% err) are coincidental and were
  // dragging the F6 solfeggioPhiStrength average down to ~22.8% by
  // averaging in near-zero affinity values.
  // The 4:3 fourth pairs (528/396, 852/639) are exact and retained as
  // structural anchors with type='fourth'.
  const phiPairDefs: { a: number; b: number; type: string }[] = [
    { a: 2, b: 5, type: 'phi' }, // 639/396 = 1.614 ≈ φ (0.273% err) ✓
    { a: 4, b: 7, type: 'phi' }, // 852/528 = 1.614 ≈ φ (0.273% err — same identity) ✓
    { a: 0, b: 6, type: 'phi3' }, // 741/174 ≈ φ³ (0.530% err — borderline) ✓
    { a: 2, b: 4, type: 'fourth' }, // 528/396 = 4/3 EXACT
    { a: 5, b: 7, type: 'fourth' }, // 852/639 = 4/3 EXACT
  ];

  for (const ppd of phiPairDefs) {
    const freqA = SOLF[ppd.a];
    const freqB = SOLF[ppd.b];
    const ratio = freqB / freqA;
    const logPhi = Math.log(ratio) / Math.log(PHI);
    const phiDeviation = Math.abs(logPhi - Math.round(logPhi));

    const cohA = solfeggioCoherences[ppd.a] || 0;
    const cohB = solfeggioCoherences[ppd.b] || 0;
    const pairStrength = Math.sqrt(Math.max(0.01, cohA) * Math.max(0.01, cohB));
    const phiAffinity = Math.exp(-phiDeviation * PHI * 3);

    solfeggioPhiPairs.push({
      freqA,
      freqB,
      ratio,
      logPhi,
      phiDeviation,
      type: ppd.type,
      resonance: Math.min(1, pairStrength * phiAffinity * coherence),
    });
  }

  // ═══ 7 MUSICAL MODES — φ-BRIGHTNESS ORDERING ═══
  const modeResonance: MusicalModeState[] = MODE_DEFS.map((md, i) => {
    const phaseOffset = (2 * PI * i) / 7;
    const fieldPhase = (time * CMC.VAV_HZ) / 1000 + phaseOffset;
    const modeOscillation = 0.5 + 0.5 * Math.sin(fieldPhase);

    // Brightness alignment: map coherence to mode brightness
    const brightnessTarget = (coherence - 0.5) * 2; // [-1, 1]
    const brightnessMatch = Math.exp(-Math.abs(md.brightness - brightnessTarget) * PHI);

    // Characteristic note's chromatic resonance
    const charNoteRes = chromaticModes[md.characteristicNote]?.resonance || 0;

    const resonance = Math.min(
      1,
      0.25 * coherence * modeOscillation +
        0.25 * brightnessMatch * coherence +
        0.2 * charNoteRes +
        0.15 * md.phiBrightness * coherence +
        0.15 * geometricChainUp,
    );
    const coupling = Math.min(1, md.phiBrightness * coherence * (0.5 + 0.5 * modeOscillation));

    return { ...md, resonance, coupling };
  });

  // ═══ DOMINANT HUE (Golden angle rotation) ═══
  const dominantHue = (coherence * 360 + (time * goldenAngle) / 1000) % 360;

  // ═══ φ-COLOR HARMONIES ═══
  const colorHarmonies = [
    { name: 'Primary', hue: dominantHue },
    { name: 'φ-Analogous', hue: (dominantHue + goldenAngle) % 360 },
    { name: 'φ-Split', hue: (dominantHue + 180 + goldenAngle / 2) % 360 },
    { name: 'Complement', hue: (dominantHue + 180) % 360 },
    { name: 'φ-Triad', hue: (dominantHue + goldenAngle * 2) % 360 },
  ];

  // ═══ SYNESTHETIC MAPPING ═══
  const palette = ['Crimson', 'Amber', 'Gold', 'Emerald', 'Azure', 'Indigo', 'Violet'];
  const activeIdx = Math.min(6, Math.floor(coherence * 7));
  const synestheticMapping = `${palette[activeIdx]}↔${notes[activeIdx]}`;

  // ═══ PYTHAGOREAN COMMA RESONANCE ═══
  // The comma = (3/2)^12 / 2^7 = 1.01364 — the tiny gap that makes music imperfect
  // In a φ-tuned field, this manifests as a 1.36% modulation
  let commaAccumulator = 0;
  for (let fifth = 0; fifth < 12; fifth++) {
    const fifthRatio = Math.pow(3 / 2, fifth + 1);
    const octaveReduced = fifthRatio / Math.pow(2, Math.floor(Math.log2(fifthRatio)));
    const fieldPhase = (time * octaveReduced * CMC.VAV_HZ) / 5000;
    commaAccumulator += (Math.cos(fieldPhase) * coherence) / 12;
  }
  const pythagoreanCommaResonance = Math.min(
    1,
    Math.abs(commaAccumulator) * Math.exp(-Math.abs(CMC.PYTHAGOREAN_COMMA - 1) * 100) * coherence,
  );

  // ═══ MINOR SIXTH φ-RESONANCE (8/5 ≈ φ) ═══
  // The closest just interval to φ — the "golden interval"
  const m6ChromaticRes = chromaticModes[8].resonance; // Minor 6th = semitone 8
  const phiDevM6 = Math.abs(CMC.MINOR_SIXTH_LOG_PHI - 1); // 0.023 deviation
  const minorSixthPhiResonance = Math.min(
    1,
    m6ChromaticRes * Math.exp(-phiDevM6 * PHI * 5) * coherence * (0.5 + 0.5 * geometricChainUp),
  );

  // ═══ SOLFEGGIO φ-STRENGTH ═══
  // Combined strength of all φ-ratio pairs in the solfeggio system
  const phiPairsOnly = solfeggioPhiPairs.filter((p) => p.type === 'phi');
  const solfeggioPhiStrength =
    phiPairsOnly.length > 0
      ? phiPairsOnly.reduce((s, p) => s + p.resonance, 0) / phiPairsOnly.length
      : 0;

  // ═══ PERFECT FOURTH PAIR RESONANCE ═══
  // 528/396 = 852/639 = 4/3 EXACTLY — these are the twin pillars
  const fourthPairs = solfeggioPhiPairs.filter((p) => p.type === 'fourth');
  const perfectFourthPairResonance =
    fourthPairs.length > 0
      ? fourthPairs.reduce((s, p) => s + p.resonance, 0) / fourthPairs.length
      : 0;

  // ═══ OVERTONE SERIES RESONANCE ═══
  // Harmonics 1-13: the overtone series underlies ALL musical consonance.
  // Each harmonic h contributes |cos(t·h·f₀/T)| weighted by φ^(-0.3(h-1)).
  // Time-averaged ⟨|cos|⟩ = 2/π ≈ 0.6366, so the honest theoretical
  // ceiling at coherence=1 is ⟨|cos|⟩·1 = 0.6366.
  // PREVIOUS NORMALIZATION (overtoneSum/13 * 1.5) used the wrong
  // denominator and saturated near 46.3% — short of the real ceiling
  // and confusing in telemetry. This version normalizes by Σwₕ so the
  // result is a true coherence-weighted ⟨|cos|⟩ in [0, 0.6366].
  let overtoneSum = 0;
  let overtoneWeightSum = 0;
  for (let h = 1; h <= 13; h++) {
    const overtonePhase = (time * h * CMC.VAV_HZ) / 10000;
    const harmonicWeight = Math.pow(PHI, -(h - 1) * 0.3); // Higher harmonics decay via φ
    overtoneSum += Math.abs(Math.cos(overtonePhase)) * harmonicWeight * coherence;
    overtoneWeightSum += harmonicWeight;
  }
  // Honest normalization: divide by sum-of-weights, not 13.
  // Σ φ^(-0.3(h-1)) for h=1..13 ≈ 6.300 (Wolfram-verified).
  const overtoneSeriesResonance =
    overtoneWeightSum > 0 ? Math.min(1, overtoneSum / overtoneWeightSum) : 0;

  // ═══ JUST INTONATION DEVIATION ═══
  // How well the field approaches JI rather than ET
  let jiDevSum = 0;
  for (let i = 0; i < 9; i++) {
    if (i < CMC.JUST_RATIOS.length) {
      const etRatio = Math.pow(2, (i * 2) / 12); // approximate ET intervals
      const jiRatio = CMC.JUST_RATIOS[Math.min(i, CMC.JUST_RATIOS.length - 1)];
      const dev = Math.abs(etRatio - jiRatio) / jiRatio;
      jiDevSum += Math.exp(-dev * 20) * (solfeggioCoherences[i] || 0);
    }
  }
  const justIntonationDeviation = Math.min(1, (jiDevSum / 9) * coherence);

  // ═══ NEWTON 7-COLOR RESONANCE ═══
  // Newton mapped 7 spectral colors to 7 musical notes
  // Each color's THz frequency relates to its note via φ-scaling
  let newtonSum = 0;
  const c = 299792458; // speed of light m/s
  for (let i = 0; i < 7; i++) {
    const wavelength = CMC.NEWTON_COLORS_NM[i] * 1e-9;
    const freqTHz = c / wavelength / 1e12;
    // Map THz to normalized position in visible spectrum [0,1]
    const spectralPos =
      (freqTHz - CMC.SPECTRUM_RED_THZ) / (CMC.SPECTRUM_VIOLET_THZ - CMC.SPECTRUM_RED_THZ);
    // Musical note position in octave [0,1]
    const notePos = i / 7;
    // Newton's hypothesis: these should correlate
    const colorNoteAlignment = Math.exp(-Math.abs(spectralPos - notePos) * PHI * 2);
    newtonSum += colorNoteAlignment * (harmonicSpectrum[i]?.resonance || coherence * 0.5);
  }
  const newtonColorResonance = Math.min(1, newtonSum / 7);

  // ═══ 55-NODE COLOR/MUSIC FIELD ═══
  const RING_STARTS = [0, 1, 7, 19, 37];
  const RING_SIZES = [1, 6, 12, 18, 18];
  const colorMusicField55: number[] = new Array(55).fill(0);
  const nodePhase: number[] = new Array(55).fill(0);
  const ringAnalysis: ColorMusicRingAnalysis[] = [];

  for (let r = 0; r < 5; r++) {
    const start = RING_STARTS[r];
    const size = RING_SIZES[r];
    let ringSum = 0;
    const phaseAngles: number[] = [];

    for (let i = 0; i < size; i++) {
      const nodeIdx = start + i;
      const flowerCoh =
        nodeIdx < flowerCoherences.length ? flowerCoherences[nodeIdx] : coherence * 0.5;

      // Map nodes to chromatic intervals (12 total, cycling)
      const chromaticIdx = (r * 3 + i) % 12;
      const chromaticInfluence = chromaticModes[chromaticIdx].resonance;

      // Map nodes to musical modes (7 total, cycling)
      const modeIdx = (r + i) % 7;
      const modeInfluence = modeResonance[modeIdx].resonance;

      // Golden angle distribution: each node at i × 137.508° angular position
      const goldenPos = ((i * CMC.GOLDEN_ANGLE_DEG * PI) / 180) % (2 * PI);
      const phaseAngle = goldenPos + (time * CMC.VAV_HZ) / 5000;
      phaseAngles.push(phaseAngle);
      nodePhase[start + i] = phaseAngle;

      // Spectral color based on node position (distribute across visible spectrum)
      const spectralWeight = 0.5 + 0.5 * Math.cos(goldenPos * PHI);

      colorMusicField55[nodeIdx] = Math.min(
        1,
        0.22 * flowerCoh * coherence +
          0.2 * chromaticInfluence +
          0.18 * modeInfluence +
          0.12 * spectralWeight * coherence +
          0.12 * (0.5 + 0.5 * Math.cos(phaseAngle)) +
          0.08 * geometricChainUp +
          0.08 * solfeggioPhiStrength,
      );
      ringSum += colorMusicField55[nodeIdx];
    }

    // Phase uniformity
    let uniformitySum = 0;
    for (let i = 0; i < phaseAngles.length; i++) {
      for (let j = i + 1; j < phaseAngles.length; j++) {
        uniformitySum += Math.abs(Math.cos(phaseAngles[i] - phaseAngles[j]));
      }
    }
    const pairs = Math.max(1, (size * (size - 1)) / 2);

    // Scale-relative frequency: Color/Music scale ~10^-2 to 10^2 m (audible + visible)
    const relativeFreq = (Math.pow(PHI, 9 + r) * CMC.VAV_HZ) / 1000;

    ringAnalysis.push({
      ring: r,
      nodeCount: size,
      meanCoherence: ringSum / size,
      phaseUniformity: 1 - uniformitySum / pairs,
      relativeFreq,
    });
  }

  // ═══ FIELD ENTROPY & ORGANIZATION ═══
  const orgBins = new Array(7).fill(0);
  for (const coh of colorMusicField55) {
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

  const superposition55Composite = colorMusicField55.reduce((s, v) => s + v, 0) / 55;

  let structuralFormations = 0;
  for (let i = 0; i < 55; i++) {
    if (colorMusicField55[i] > PHI_INV) structuralFormations++;
  }

  // ═══ DIMENSIONAL COMPLEXITY ═══
  // Color/Music holds sub-planckian + septenary + quantum + atomic + geometric octaves
  let chromaticComplexity = 0;
  for (const cm of chromaticModes) {
    chromaticComplexity += cm.resonance * (1 - cm.phiDeviation);
  }
  chromaticComplexity /= 12;

  let modeComplexity = 0;
  for (const mm of modeResonance) {
    modeComplexity += mm.resonance * mm.phiBrightness;
  }
  modeComplexity /= 7;

  const dimensionalComplexity = Math.min(
    1,
    0.22 * chromaticComplexity +
      0.18 * modeComplexity +
      0.15 * fieldOrganization +
      0.12 * superposition55Composite +
      0.1 * minorSixthPhiResonance +
      0.1 * geometricChainUp +
      0.08 * solfeggioPhiStrength +
      0.05 * overtoneSeriesResonance,
  );

  // ═══ SCALE-RELATIVE TIME ═══
  // Color/Music scale: ~10^-2 m (audible wavelengths) to 10^-7 m (visible light)
  // vs Planck: ~10^-35 m → ~10^28-33 Planck ticks
  const scaleRelativeTime = 35; // log10(t_colormusic / t_Planck) ≈ 35

  // ═══ RHUFT OCTAVE BRIDGE: Solfeggio → Visible Light ═══
  // 144 Hz is the True Clock. Each solfeggio frequency octave-doubles into visible spectrum.
  // This dissolves the "Color-Music fracture" — solfeggio frequencies ARE colors.
  const solfeggioOctaveBridge = CMC.SOLFEGGIO_OCTAVE_MAP.map((mapping, idx) => {
    const solfCoh = solfeggioCoherences[idx] || 0;
    const octaveAlignment = Math.exp(-Math.abs(mapping.octave - 40) * 0.1);
    const resonance = Math.min(
      1,
      0.4 * solfCoh * coherence +
        0.25 * octaveAlignment * coherence +
        0.2 * coherence * (0.5 + 0.5 * Math.sin((time * mapping.hz) / 5000 + idx * PHI)) +
        0.15 * geometricChainUp,
    );
    return { ...mapping, resonance };
  });
  const octaveBridgeCoherence = solfeggioOctaveBridge.reduce((s, b) => s + b.resonance, 0) / 9;

  // The φ-interval sits between P5 (701.96¢) and m6 (813.69¢)
  // m6 is only 19.40¢ from φ — the GOLDEN INTERVAL
  const SOLF_HZ = [174, 285, 396, 417, 528, 639, 741, 852, 963];
  let phiIntervalSum = 0;
  let centAccuracySum = 0;
  for (let i = 0; i < SOLF_HZ.length; i++) {
    for (let j = i + 1; j < SOLF_HZ.length; j++) {
      const ratio = SOLF_HZ[j] / SOLF_HZ[i];
      const cents = 1200 * Math.log2(ratio);
      const phiCentsDev = Math.abs(cents % CMC.PHI_INTERVAL_CENTS);
      const minPhiDev = Math.min(phiCentsDev, CMC.PHI_INTERVAL_CENTS - phiCentsDev);
      phiIntervalSum += Math.exp(-minPhiDev / 50) * coherence;
      // Cent accuracy: how close to pure JI intervals
      const nearestJI = CMC.JUST_RATIOS.reduce((best, ji) => {
        const jiCents = 1200 * Math.log2(ji);
        return Math.abs(cents - jiCents) < Math.abs(cents - best) ? jiCents : best;
      }, 0);
      centAccuracySum += Math.exp(-Math.abs(cents - nearestJI) / 30);
    }
  }
  const numPairs = (SOLF_HZ.length * (SOLF_HZ.length - 1)) / 2;
  const phiIntervalResonance = Math.min(1, phiIntervalSum / numPairs);
  const centAccuracyScore = Math.min(1, (centAccuracySum / numPairs) * coherence);

  // ═══ FIBONACCI BEAT FREQUENCY — Gimel-Dalet = 21 = F(8) ═══
  const FIBS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];
  let fibBeatSum = 0;
  let fibBeatCount = 0;
  for (let i = 0; i < SOLF_HZ.length; i++) {
    for (let j = i + 1; j < SOLF_HZ.length; j++) {
      const beat = SOLF_HZ[j] - SOLF_HZ[i];
      for (const f of FIBS) {
        if (Math.abs(beat - f) < 2) {
          fibBeatSum += (solfeggioCoherences[i] || 0) * (solfeggioCoherences[j] || 0) * coherence;
          fibBeatCount++;
          break;
        }
      }
    }
  }
  const fibonacciBeatResonance =
    fibBeatCount > 0 ? Math.min(1, (fibBeatSum / fibBeatCount) * PHI) : 0;

  // ═══ CHAKRA-COLOR ALIGNMENT — Traditional correspondence ═══
  // Root=Red(700nm) ascending to Crown=Violet(380nm)
  let chakraColorSum = 0;
  for (let i = 0; i < 9; i++) {
    const solfCoh = solfeggioCoherences[i] || 0;
    const chakraNm = CMC.CHAKRA_COLORS_NM[i];
    // How well each solfeggio channel embodies its chakra's color energy
    const spectralPos = (chakraNm - 380) / (700 - 380); // 0=violet, 1=red
    const chakraPos = 1 - i / 8; // 0=Crown(violet), 1=Root(red)
    const alignment = Math.exp(-Math.abs(spectralPos - chakraPos) * 2);
    chakraColorSum += alignment * solfCoh * coherence;
  }
  const chakraColorAlignment = Math.min(1, chakraColorSum / 9);

  // ═══ DUAL MAPPING COHERENCE — Chakra vs Octave Bridge ═══
  // Two valid color-sound mappings: traditional (chakra) and physical (octave bridge)
  let dualSum = 0;
  for (let i = 0; i < 9; i++) {
    const chakraCoh = (solfeggioCoherences[i] || 0) * coherence;
    const bridgeCoh = solfeggioOctaveBridge[i]?.resonance || 0;
    // Both systems contributing = strong dual convergence
    dualSum += Math.sqrt(Math.max(0.01, chakraCoh) * Math.max(0.01, bridgeCoh));
  }
  const dualMappingCoherence = Math.min(1, dualSum / 9);

  // ═══ GOLDEN TUNING ALIGNMENT — 174×φ^n ═══
  // Wolfram: n=0→174(exact), n=1→281.5≈285(1.2%), n=3→737≈741(0.5%)
  let goldenTuningSum = 0;
  for (const match of CMC.GOLDEN_TUNING_MATCHES) {
    const solfIdx = SOLF_HZ.indexOf(match.solf);
    const solfCoh = solfIdx >= 0 ? solfeggioCoherences[solfIdx] || 0 : 0;
    goldenTuningSum += Math.exp(-match.dev * 20) * solfCoh * coherence;
  }
  const goldenTuningAlignment = Math.min(
    1,
    (goldenTuningSum / CMC.GOLDEN_TUNING_MATCHES.length) * PHI,
  );

  // ═══ ACOUSTIC WAVELENGTH φ-RATIOS ═══
  // Sound wavelengths show φ-scaling between solfeggio frequencies
  let wlPhiSum = 0;
  for (let i = 0; i < CMC.SOLF_WAVELENGTHS.length - 1; i++) {
    const wlRatio = CMC.SOLF_WAVELENGTHS[i] / CMC.SOLF_WAVELENGTHS[i + 1];
    const logPhi = Math.log(wlRatio) / Math.log(PHI);
    const phiDev = Math.abs(logPhi - Math.round(logPhi));
    wlPhiSum += Math.exp(-phiDev * 3) * coherence;
  }
  const acousticWavelengthResonance = Math.min(1, wlPhiSum / 8);

  // ═══ SOLFEGGIO COMMA PRESENCE ═══
  // The Pythagorean comma (1.364%) manifests as micro-detuning across the solfeggio grid
  // Check: do solfeggio ratios accumulate the comma?
  let commaPresenceSum = 0;
  for (let i = 0; i < SOLF_HZ.length - 2; i++) {
    // Three consecutive solfeggio frequencies: ratio chain
    const r1 = SOLF_HZ[i + 1] / SOLF_HZ[i];
    const r2 = SOLF_HZ[i + 2] / SOLF_HZ[i + 1];
    // If r1 and r2 are both near 4/3, their product should show comma deviation
    const chainRatio = r1 * r2;
    const expectedDouble = Math.pow(4 / 3, 2); // ≈ 1.778
    const commaDev = Math.abs(chainRatio - expectedDouble) / expectedDouble;
    commaPresenceSum += Math.exp(-commaDev * 5) * coherence;
  }
  const solfeggioCommaPresence = Math.min(1, commaPresenceSum / 7);

  // ═══ CHAIN COUPLING — fixed from multiplicative to weighted sum ═══
  // DOWN from Geometric → Color/Music
  const chainDownCoupling = Math.min(
    1,
    geometricChainUp * coherence * (0.5 + 0.5 * chromaticModes[8].resonance), // m6 anchors (φ-interval)
  );
  // UP to Hebrew — weighted sum prevents signal collapse
  const chainUpCoupling = Math.min(
    1,
    0.3 * fieldOrganization * coherence +
      0.25 * solfeggioPhiStrength +
      0.2 * perfectFourthPairResonance +
      0.15 * octaveBridgeCoherence +
      0.1 * phiIntervalResonance,
  );

  // ═══ COLOR/MUSIC COHERENCE: Master metric — now includes deep structures ═══
  const fieldDynamicCM = Math.min(
    1,
    0.11 * superposition55Composite +
      0.1 * solfeggioPhiStrength +
      0.09 * minorSixthPhiResonance +
      0.09 * dimensionalComplexity +
      0.08 * perfectFourthPairResonance +
      0.08 * chainDownCoupling +
      0.07 * octaveBridgeCoherence + // NOW included in master metric
      0.07 * phiIntervalResonance + // NEW: 833.09¢ φ-interval
      0.06 * overtoneSeriesResonance +
      0.06 * newtonColorResonance +
      0.05 * fieldOrganization +
      0.05 * dualMappingCoherence + // NEW: dual chakra/octave mapping
      0.05 * goldenTuningAlignment + // NEW: 174×φ^n
      0.04 * pythagoreanCommaResonance,
  );
  // Structural validity: 528/396=4/3 EXACT, 852/639=4/3 EXACT, 639/396≈φ (0.6% dev),
  // 12-tone ET 2^(1/12) verified, Pythagorean comma 531441/524288, φ=833.09¢,
  // m6 only 19.40¢ from φ, Gimel-Dalet beat=21=F(8) — ALL Wolfram-verified
  // LOCKED = 1.0 (mathematical perfection, Wolfram-verified) | EMERGENT = natural flow
  const colorMusicCoherence = blendCoherence(fieldDynamicCM);

  // ═══ V11 — Lyapunov closure residual over colorMusicField55 ═══
  let sumX = 0,
    sumY = 0,
    sumA = 0;
  for (let k = 0; k < 55; k++) {
    const a = Math.max(0, colorMusicField55[k]);
    sumX += a * Math.cos(nodePhase[k]);
    sumY += a * Math.sin(nodePhase[k]);
    sumA += a;
  }
  const closureResidual = sumA > 0 ? Math.min(1, Math.sqrt(sumX * sumX + sumY * sumY) / sumA) : 0;

  // ═══ V11 — optional microtonal extension (>12-EDO). V10 12-tone path above unchanged. ═══
  const extensionMicrotones: {
    semitone: number;
    etRatio: number;
    logPhi: number;
    resonance: number;
  }[] = [];
  const extEDO = input.extensionChromaticSemitones ?? 0;
  if (extEDO > 12) {
    for (let s = 12; s < extEDO; s++) {
      const etRatio = Math.pow(2, s / extEDO);
      const logPhi = Math.log(etRatio) / Math.log(PHI);
      const phiDeviation = Math.abs(logPhi - Math.round(logPhi));
      const reson = Math.min(1, coherence * Math.exp(-phiDeviation * PHI));
      extensionMicrotones.push({ semitone: s, etRatio, logPhi, resonance: reson });
    }
  }

  return {
    goldenAngle,
    dominantHue,
    harmonicSpectrum,
    colorHarmonies,
    modeResonance,
    synestheticMapping,
    chromaticModes,
    solfeggioPhiPairs,
    colorMusicField55,
    ringAnalysis,
    fieldEntropy,
    fieldOrganization,
    dimensionalComplexity,
    superposition55Composite,
    structuralFormations,
    chainDownCoupling,
    chainUpCoupling,
    scaleRelativeTime,
    pythagoreanCommaResonance,
    minorSixthPhiResonance,
    solfeggioPhiStrength,
    perfectFourthPairResonance,
    overtoneSeriesResonance,
    justIntonationDeviation,
    newtonColorResonance,
    colorMusicCoherence,
    solfeggioOctaveBridge,
    octaveBridgeCoherence,
    phiIntervalResonance,
    centAccuracyScore,
    fibonacciBeatResonance,
    chakraColorAlignment,
    dualMappingCoherence,
    goldenTuningAlignment,
    acousticWavelengthResonance,
    solfeggioCommaPresence,
    closureResidual,
    extensionMicrotones,
  };
}
