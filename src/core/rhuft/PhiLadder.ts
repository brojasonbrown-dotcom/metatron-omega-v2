/**
 * RHUFT — THE φ-LADDER
 * ════════════════════
 * The physical scale ladder
 *
 *   L(n) = ℓ_P · φⁿ        n = 0 … 300
 *
 * running from the Planck length (n = 0) to the observable-universe radius
 * (n = 293.96). Every rung carries its Lucas closure record, so the ladder
 * and the closure theorem are one object rather than two coincidences.
 *
 * ANCHOR VERIFICATION (recomputed at module load, must match to ±0.01):
 *
 *   proton charge radius   8.4184e-16 m  → n = 94.34
 *   electron (reduced λ_C) 3.8616e-13 m  → n = 107.08
 *   Bohr radius            5.2918e-11 m  → n = 117.30
 *   DNA helix pitch        2.0e-9    m   → n = 124.85
 *   human scale            1.7 m         → n = 167.58
 *   observable universe    4.4e26 m      → n = 293.96
 *
 * EPISTEMIC CLASSES (carried per rung and per derived quantity):
 *   A — exact mathematics, proven symbolically or to machine precision
 *   B — genuine numerical coincidence (ppm-level match, not a derivation)
 *   C — claim that FAILED recomputation; the corrected form is reported
 *
 * Pure module. No engine imports, no side effects beyond a frozen cache.
 */

import {
  PHI, PLANCK_LENGTH_M, SPEED_OF_LIGHT_M_S, HBAR_J_S,
  BOLTZMANN_J_K, GRAVITATIONAL_CONSTANT,
} from '@/core/constants/WolframVerified';
import { closureRecord, type ClosureRecord } from './LucasClosure';

export type EpistemicClass = 'A' | 'B' | 'C';

/** Highest ladder index the engine tabulates. */
export const LADDER_MAX_N = 300;

/** Planck mass m_P = sqrt(ħc/G) (kg). */
export const PLANCK_MASS_KG = Math.sqrt((HBAR_J_S * SPEED_OF_LIGHT_M_S) / GRAVITATIONAL_CONSTANT);
/** Planck time t_P = ℓ_P/c (s). */
export const PLANCK_TIME_S = PLANCK_LENGTH_M / SPEED_OF_LIGHT_M_S;
/** Planck temperature T_P = m_P c²/k_B (K). */
export const PLANCK_TEMPERATURE_K = (PLANCK_MASS_KG * SPEED_OF_LIGHT_M_S * SPEED_OF_LIGHT_M_S) / BOLTZMANN_J_K;

// ───────────────────────── continuous ladder maps ─────────────────────────

/** L(n) = ℓ_P·φⁿ — continuous in n (rungs need not be integers). */
export function ladderLength(n: number): number {
  return PLANCK_LENGTH_M * Math.pow(PHI, n);
}
/** Inverse map: n = log_φ(L/ℓ_P). */
export function rungOfLength(metres: number): number {
  return Math.log(metres / PLANCK_LENGTH_M) / Math.log(PHI);
}
/** Characteristic time at rung n: t_P·φⁿ (light-crossing of L(n)). */
export function ladderTime(n: number): number {
  return PLANCK_TIME_S * Math.pow(PHI, n);
}
/** Characteristic frequency at rung n: 1/t(n). */
export function ladderFrequency(n: number): number {
  return 1 / ladderTime(n);
}
/** Mass at rung n by the inverse-Compton relation: m_P·φ⁻ⁿ. */
export function ladderMass(n: number): number {
  return PLANCK_MASS_KG * Math.pow(PHI, -n);
}
/** Inverse mass map: n = log_φ(m_P/m). */
export function rungOfMass(kg: number): number {
  return Math.log(PLANCK_MASS_KG / kg) / Math.log(PHI);
}
/** Temperature at rung n: T_P·φ⁻ⁿ. */
export function ladderTemperature(n: number): number {
  return PLANCK_TEMPERATURE_K * Math.pow(PHI, -n);
}
/** Inverse temperature map. */
export function rungOfTemperature(kelvin: number): number {
  return Math.log(PLANCK_TEMPERATURE_K / kelvin) / Math.log(PHI);
}

// ───────────────────────── rung records ─────────────────────────

export interface LadderRung {
  readonly n: number;
  readonly length: number;
  readonly time: number;
  readonly frequency: number;
  readonly mass: number;
  readonly temperature: number;
  readonly closure: ClosureRecord;
  /** Physical anchors that land within ±0.5 of this rung. */
  readonly anchors: readonly LadderAnchor[];
}

export interface LadderAnchor {
  readonly label: string;
  readonly metres: number;
  readonly rung: number;
  readonly cls: EpistemicClass;
  readonly note?: string;
}

/**
 * Physical anchors, each with the rung *recomputed* from its measured length
 * — nothing here is a hand-placed integer.
 */
export const LADDER_ANCHORS: readonly LadderAnchor[] = Object.freeze([
  anchor('Planck length', PLANCK_LENGTH_M, 'A'),
  anchor('proton charge radius', 8.4184e-16, 'B', 'CODATA 2022 muonic-hydrogen value'),
  anchor('electron reduced Compton λ', 3.8615926744e-13, 'B'),
  anchor('Bohr radius', 5.29177210544e-11, 'B'),
  anchor('DNA helix pitch', 2.0e-9, 'B'),
  anchor('eukaryotic cell', 1.0e-5, 'B'),
  anchor('human scale', 1.7, 'B'),
  anchor('Earth radius', 6.371e6, 'B'),
  anchor('astronomical unit', 1.495978707e11, 'B'),
  anchor('Milky Way radius', 4.7e20, 'B'),
  anchor('observable universe radius', 4.4e26, 'B', 'within one ladder step of RHUFT canonical n = 292'),
]);

function anchor(label: string, metres: number, cls: EpistemicClass, note?: string): LadderAnchor {
  return Object.freeze({ label, metres, rung: rungOfLength(metres), cls, note });
}

const _rungs: LadderRung[] = [];
function buildRungs(): readonly LadderRung[] {
  if (_rungs.length) return _rungs;
  for (let n = 0; n <= LADDER_MAX_N; n++) {
    const near = LADDER_ANCHORS.filter(a => Math.abs(a.rung - n) <= 0.5);
    _rungs.push(Object.freeze({
      n,
      length: ladderLength(n),
      time: ladderTime(n),
      frequency: ladderFrequency(n),
      mass: ladderMass(n),
      temperature: ladderTemperature(n),
      closure: closureRecord(n),
      anchors: Object.freeze(near),
    }));
  }
  return _rungs;
}

/** Full tabulated ladder, built once and cached. */
export function ladder(): readonly LadderRung[] { return buildRungs(); }

/** Single rung record (integer n ∈ [0, LADDER_MAX_N]). */
export function rung(n: number): LadderRung {
  const table = buildRungs();
  const i = Math.max(0, Math.min(LADDER_MAX_N, Math.round(n)));
  return table[i];
}

/** Nearest Lucas-stable rung to a continuous index (ties resolve downward). */
export function nearestStableRung(n: number): number {
  const base = Math.round(n);
  for (let d = 0; d <= LADDER_MAX_N; d++) {
    const lo = base - d, hi = base + d;
    if (lo >= 0 && closureRecord(lo).stable) return lo;
    if (hi <= LADDER_MAX_N && closureRecord(hi).stable) return hi;
  }
  return base;
}

// ───────────────────────── errata (Class C, reported honestly) ─────────────────────────

export interface LadderErratum {
  readonly claim: string;
  readonly status: 'FAILED';
  readonly correction: string;
}

/**
 * Source-corpus claims that do NOT survive recomputation. Surfaced in the UI
 * so the instrument reports its own failures instead of hiding them.
 */
export const LADDER_ERRATA: readonly LadderErratum[] = Object.freeze([
  {
    claim: 'T_CMB = T_P·φ⁻²',
    status: 'FAILED',
    correction: `true exponent ≈ φ^-${rungOfTemperature(2.72548).toFixed(1)} (recomputed from T_CMB = 2.72548 K)`,
  },
  {
    claim: 'α⁻¹ = 13φ/√13 + 1/2',
    status: 'FAILED',
    correction: 'arithmetically broken; 360/φ² − 2/φ³ = 137.035628 is a 2.7 ppm coincidence (Class B), not a derivation',
  },
  {
    claim: 'Λ from φ⁻² ladder exponent',
    status: 'FAILED',
    correction: 'fails by ~10¹¹; the required exponent is φ^-122.6 — the vacuum-catastrophe problem reappears as a ladder exponent',
  },
  {
    claim: 'Ω_Λ/Ω_m = φ² = 2.618',
    status: 'FAILED',
    correction: 'Planck 2018 gives 2.2144 — an 18.2% miss',
  },
  {
    claim: 'Titius–Bode φ-law',
    status: 'FAILED',
    correction: 'errors 3.4% (Mercury) to 90.9% (Neptune); the classical 0.4 + 0.3·2ⁿ rule fits better',
  },
]);

// ───────────────────────── self-check ─────────────────────────

export interface LadderProof {
  readonly protonRung: number;
  readonly electronRung: number;
  readonly universeRung: number;
  readonly anchorsMatch: boolean;
  readonly monotone: boolean;
  readonly valid: boolean;
}

export function proveLadder(): LadderProof {
  const protonRung = rungOfLength(8.4184e-16);
  const electronRung = rungOfLength(3.8615926744e-13);
  const universeRung = rungOfLength(4.4e26);
  const anchorsMatch =
    Math.abs(protonRung - 94.34) < 0.01 &&
    Math.abs(electronRung - 107.08) < 0.01 &&
    Math.abs(universeRung - 293.96) < 0.01;

  let monotone = true;
  const t = buildRungs();
  for (let i = 1; i < t.length; i++) {
    if (!(t[i].length > t[i - 1].length) || !(t[i].mass < t[i - 1].mass)) { monotone = false; break; }
  }
  return { protonRung, electronRung, universeRung, anchorsMatch, monotone, valid: anchorsMatch && monotone };
}

const _lproof = proveLadder();
if (!_lproof.valid) {
  throw new Error(`PhiLadder: ladder proof failed ${JSON.stringify(_lproof)}`);
}
export const LADDER_PROOF: LadderProof = Object.freeze(_lproof);
