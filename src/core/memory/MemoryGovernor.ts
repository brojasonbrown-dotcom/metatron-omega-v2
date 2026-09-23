/**
 * MemoryGovernor — derives per-layer caps from the sovereign ResourceGovernor.
 *
 * Ω-DEPTH Section 1: the budget is now `workingFraction` (0.70) of a *measured*
 * ceiling where one exists, carries its provenance, and sheds the lowest-value
 * layers first under live pressure instead of guessing.
 *
 * v3 shares (sensory-aware + fractal pool, sums to 1.0):
 *   L-S sensory  0.20    audio + video + imu dedup tables
 *   L0 tape      0.22    continuous Ψ ring buffer
 *   L-F fractal  0.08    nested child-field slot pool (Section 2)
 *   L1 hebbian   0.20
 *   L2 episodic  0.12
 *   L3 semantic  0.08
 *   L4 pathway   0.05
 *   L5 journal   0.03
 *   L6 reflect   0.02    (no bytes — counted in episodic)
 */

import { getGovernorSync } from '@/core/runtime/governorSingleton';
import { PHI } from '@/core/constants/WolframVerified';
import { atomBytes } from '@/core/sensory/SensoryAtom';
import { getCachedEnvelope, type RamProvenance } from '@/core/runtime/HardwareEnvelope';

export interface MemoryCaps {
  maxPatterns: number;
  maxHebbianEntries: number;
  maxPathwayEdges: number;
  maxJournalRecords: number;
  maxTapeFrames: number;
  maxEpisodes: number;
  maxSensoryAtoms: number;
  /** Bytes reserved for the nested child-field pool (Section 2). */
  fractalPoolBytes: number;
  /** Working budget actually distributed across the layers. */
  ramBytes: number;
  /** Ceiling the working budget was taken from. */
  ceilingBytes: number;
  /** Where the ceiling came from — never 'measured' unless a probe ran. */
  provenance: RamProvenance;
  /** Live pressure that produced these caps (0 when unknown). */
  pressure: number;
  /** Shed level: 0 nominal, 1 trimming, 2 freezing new child fields. */
  shedLevel: 0 | 1 | 2;
  /** True while pressure forbids allocating new nested child fields. */
  fractalFrozen: boolean;
  /** Human-readable record of every trim applied, in order. */
  trims: readonly string[];
}

const FALLBACK_RAM_BYTES = 256 * 1024 * 1024;

/** Fraction of the ceiling the brain is allowed to hold at once. */
export const WORKING_FRACTION = 0.70;

const PHI_INV = 1 / PHI;
/** Start trimming above φ⁻¹ of the working budget. */
export const PRESSURE_TRIM = PHI_INV;
/** Freeze new child fields above 1 − φ⁻³. */
export const PRESSURE_FREEZE = 1 - PHI_INV * PHI_INV * PHI_INV;

const SHARE = {
  sensory: 0.20,
  tape:    0.22,
  fractal: 0.08,
  hebbian: 0.20,
  episodic:0.12,
  patterns:0.08,
  pathway: 0.05,
  journal: 0.03,
  // reflective: 0.02 reserved, no bytes (uses episodic)
};

const BYTES_PER_PATTERN = 12 * 1024;
const BYTES_PER_HEBBIAN = 16;
const BYTES_PER_EDGE = 48;
const BYTES_PER_JOURNAL = 1024;
const BYTES_PER_TAPE_FRAME = 288;            // 40-mode top-K f32 frame
const BYTES_PER_EPISODE = 2 * 1024;          // ~2 KB full top-K episode
const BYTES_PER_SENSORY = atomBytes(32);     // 32-mode top-K atom

export interface CapsInput {
  /** Override the ceiling (tests / synthetic envelopes). */
  ceilingBytes?: number;
  provenance?: RamProvenance;
  /** Bytes currently held by the memory layers, if measured. */
  usedBytes?: number;
  /** Direct pressure override; wins over usedBytes when provided. */
  pressure?: number;
}

/** Pressure = held bytes / working budget, clamped to [0, 4]. */
export function memoryPressure(usedBytes: number, budgetBytes: number): number {
  if (!(budgetBytes > 0) || !Number.isFinite(usedBytes) || usedBytes < 0) return 0;
  return Math.min(4, usedBytes / budgetBytes);
}

function shedLevelFor(pressure: number): 0 | 1 | 2 {
  if (pressure > PRESSURE_FREEZE) return 2;
  if (pressure > PRESSURE_TRIM) return 1;
  return 0;
}

export function computeMemoryCaps(input: CapsInput = {}): MemoryCaps {
  const snap = getGovernorSync();
  const env = getCachedEnvelope();
  const declared = snap?.gov.settings.ramBytes;
  const ceiling =
    input.ceilingBytes ??
    (typeof declared === 'number' && declared > 0 ? declared : env?.ramBytes ?? FALLBACK_RAM_BYTES);
  const provenance: RamProvenance = input.provenance ?? env?.ramProvenance ?? 'fallback';

  const ram = Math.max(64 * 1024 * 1024, ceiling * WORKING_FRACTION);
  const pressure = input.pressure ?? memoryPressure(input.usedBytes ?? 0, ram);
  const level = shedLevelFor(pressure);

  // Deterministic shed ladder — lowest-value layers first, tape and sensory
  // floors are never touched, freed share is left as headroom (not reassigned).
  const share = { ...SHARE };
  const trims: string[] = [];
  if (level >= 1) {
    for (const k of ['journal', 'pathway', 'patterns'] as const) {
      share[k] *= PHI_INV;
      trims.push(`${k} ×φ⁻¹ @ pressure ${pressure.toFixed(3)}`);
    }
  }
  if (level >= 2) {
    for (const k of ['journal', 'pathway', 'patterns', 'episodic'] as const) {
      share[k] *= PHI_INV;
      trims.push(`${k} ×φ⁻¹ (freeze band) @ pressure ${pressure.toFixed(3)}`);
    }
    trims.push('fractal pool frozen — no new child fields');
  }

  return {
    ramBytes: ram,
    ceilingBytes: ceiling,
    provenance,
    pressure,
    shedLevel: level,
    fractalFrozen: level >= 2,
    trims,
    fractalPoolBytes:   Math.max(0, Math.floor(ram * share.fractal)),
    maxSensoryAtoms:    Math.max(64,  Math.floor((ram * share.sensory)  / BYTES_PER_SENSORY)),
    maxTapeFrames:      Math.max(1024,Math.floor((ram * share.tape)     / BYTES_PER_TAPE_FRAME)),
    maxHebbianEntries:  Math.max(64,  Math.floor((ram * share.hebbian)  / BYTES_PER_HEBBIAN)),
    maxEpisodes:        Math.max(64,  Math.floor((ram * share.episodic) / BYTES_PER_EPISODE)),
    maxPatterns:        Math.max(8,   Math.floor((ram * share.patterns) / BYTES_PER_PATTERN)),
    maxPathwayEdges:    Math.max(32,  Math.floor((ram * share.pathway)  / BYTES_PER_EDGE)),
    maxJournalRecords:  Math.max(16,  Math.floor((ram * share.journal)  / BYTES_PER_JOURNAL)),
  };
}

/** Deterministic LRU step counter helper (φ-scaled). */
export function lruScore(lastSeen: number, salience: number): number {
  return lastSeen + salience * PHI;
}
