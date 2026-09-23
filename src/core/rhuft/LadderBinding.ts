/**
 * RHUFT — LADDER BINDING
 * ══════════════════════
 * Stage 3: bind the nine RHUFT-F measurement rungs (O_0..O_8, a *surrogate*
 * ladder with node budgets 7…55) to real indices on the 301-rung physical
 * φ-ladder `L(n) = ℓ_P·φⁿ`.
 *
 * Nothing here is hand-placed. Each rung declares the measured physical
 * length its framework is about; the ladder index is RECOMPUTED from that
 * length with `rungOfLength`, and the closure record for the rounded index
 * comes straight from the Lucas oracle. The binding therefore inherits the
 * ladder's epistemic classes: only the Planck rung is Class A, everything
 * else is a Class-B anchor (a measured length, not a derivation).
 *
 * DEFECT FLOOR ("the |ψ|ⁿ floor")
 * ------------------------------
 * A rung with N nodes resolves the golden recursion to N terms, so the
 * smallest closure defect it can *mean* is φ^(−N); below that the operator
 * is reporting its own truncation, not the field. Machine precision adds a
 * second floor, √N·2⁻⁵², and the binding takes the larger of the two:
 *
 *     δ_floor(n) = max( φ^(−N_n),  √N_n · 2⁻⁵² )
 *
 * A residual under δ_floor is FLOOR-LIMITED: it must not be scored as a
 * perfect closure. Runtime consumers abstain (NaN) on such a rung rather
 * than feeding a spurious 1.0 into the Ω geometric mean — an unmeasurable
 * rung is neither a pass nor a failure.
 *
 * `defectMargin` reports the headroom in ladder rungs:
 *     margin = log_φ( residual / δ_floor )
 * so "4.1" means the measurement sits four φ-steps above its own floor.
 *
 * Pure module. Cached, no side effects.
 */

import { PHI } from '@/core/constants/WolframVerified';
import {
  ladderLength, ladderTime, ladderFrequency, ladderMass, ladderTemperature,
  rungOfLength, nearestStableRung, LADDER_MAX_N,
  type EpistemicClass,
} from './PhiLadder';
import { closureRecord, type ClosureRecord } from './LucasClosure';

const LN_PHI = Math.log(PHI);
const MACHINE_EPS = Number.EPSILON; // 2^-52

export interface ScaleAnchorSpec {
  readonly scale: number;
  readonly framework: string;
  readonly nodes: number;
  /** Measured characteristic length of the framework's domain (m). */
  readonly metres: number;
  readonly cls: EpistemicClass;
  readonly why: string;
}

/**
 * Characteristic length per RHUFT-F framework. Every value is a measured
 * physical quantity; none is chosen to make an index come out round.
 */
export const SCALE_ANCHORS: readonly ScaleAnchorSpec[] = Object.freeze([
  { scale: 0, framework: 'Septenary',      nodes: 7,  metres: 1.7,               cls: 'B', why: 'organismal / human scale — the septenary framework’s seven-fold body of reference' },
  { scale: 1, framework: 'Quantum',        nodes: 55, metres: 3.8615926744e-13,  cls: 'B', why: 'electron reduced Compton wavelength (CODATA 2022)' },
  { scale: 2, framework: 'Atomic',         nodes: 7,  metres: 5.29177210544e-11, cls: 'B', why: 'Bohr radius a₀ (CODATA 2022)' },
  { scale: 3, framework: 'Geometric',      nodes: 13, metres: 2.0e-9,            cls: 'B', why: 'B-DNA helix pitch — the smallest measured structure with 13-fold φ geometry' },
  { scale: 4, framework: 'Color/Music',    nodes: 9,  metres: 5.5e-7,            cls: 'B', why: 'mid-visible wavelength 550 nm — the octave the colour framework is defined on' },
  { scale: 5, framework: 'Hebrew',         nodes: 22, metres: 1.0e-5,            cls: 'B', why: 'eukaryotic cell diameter — 22-letter alphabet mapped to the cellular scale (conventional)' },
  { scale: 6, framework: 'Galactic',       nodes: 55, metres: 4.7e20,            cls: 'B', why: 'Milky Way disc radius' },
  { scale: 7, framework: 'Sub-Planckian',  nodes: 55, metres: 1.616255e-35,      cls: 'A', why: 'Planck length ℓ_P — ladder rung 0 by construction' },
  { scale: 8, framework: 'Hyper-Galactic', nodes: 55, metres: 4.4e26,            cls: 'B', why: 'observable-universe comoving radius' },
]);

export interface ScaleBinding {
  readonly scale: number;
  readonly framework: string;
  readonly nodes: number;
  /** Continuous ladder index n = log_φ(L/ℓ_P). */
  readonly rung: number;
  /** Rounded, clamped integer index used for the closure record. */
  readonly rungIndex: number;
  /** Nearest Lucas-stable rung, and the distance to it. */
  readonly stableRung: number;
  readonly stableDistance: number;
  readonly closure: ClosureRecord;
  /** Physical quantities at the bound rung. */
  readonly length: number;
  readonly time: number;
  readonly frequency: number;
  readonly mass: number;
  readonly temperature: number;
  /** δ_floor for this rung's node budget. */
  readonly defectFloor: number;
  /** φ^(−N) truncation component. */
  readonly truncationFloor: number;
  /** √N·2⁻⁵² machine component. */
  readonly machineFloor: number;
  readonly cls: EpistemicClass;
  readonly why: string;
}

function bind(a: ScaleAnchorSpec): ScaleBinding {
  const rung = rungOfLength(a.metres);
  const rungIndex = Math.max(0, Math.min(LADDER_MAX_N, Math.round(rung)));
  const stableRung = nearestStableRung(rungIndex);
  const truncationFloor = Math.exp(-a.nodes * LN_PHI);
  const machineFloor = Math.sqrt(a.nodes) * MACHINE_EPS;
  return Object.freeze({
    scale: a.scale,
    framework: a.framework,
    nodes: a.nodes,
    rung,
    rungIndex,
    stableRung,
    stableDistance: Math.abs(rungIndex - stableRung),
    closure: closureRecord(rungIndex),
    length: ladderLength(rungIndex),
    time: ladderTime(rungIndex),
    frequency: ladderFrequency(rungIndex),
    mass: ladderMass(rungIndex),
    temperature: ladderTemperature(rungIndex),
    defectFloor: Math.max(truncationFloor, machineFloor),
    truncationFloor,
    machineFloor,
    cls: a.cls,
    why: a.why,
  });
}

let _bindings: readonly ScaleBinding[] | null = null;
let _byScale: ReadonlyMap<number, ScaleBinding> | null = null;

export function scaleBindings(): readonly ScaleBinding[] {
  if (!_bindings) {
    _bindings = Object.freeze(SCALE_ANCHORS.map(bind));
    const m = new Map<number, ScaleBinding>();
    for (const b of _bindings) m.set(b.scale, b);
    _byScale = m;
  }
  return _bindings;
}

export function scaleBinding(scale: number): ScaleBinding | undefined {
  scaleBindings();
  return _byScale!.get(scale);
}

export interface DefectVerdict {
  /** The floor applied. */
  readonly floor: number;
  /** log_φ(residual / floor) — headroom in ladder rungs. NaN when unusable. */
  readonly margin: number;
  /** True when the residual sits at or under the floor (unmeasurable). */
  readonly floorLimited: boolean;
  /**
   * The residual the caller should believe: the measurement when it is above
   * the floor, the floor itself when it is not.
   */
  readonly effective: number;
}

/** Apply a rung's defect floor to a measured residual. */
export function applyDefectFloor(scale: number, residual: number): DefectVerdict {
  const b = scaleBinding(scale);
  const floor = b?.defectFloor ?? MACHINE_EPS;
  if (!Number.isFinite(residual)) {
    return { floor, margin: NaN, floorLimited: false, effective: NaN };
  }
  const r = Math.abs(residual);
  const limited = r <= floor;
  return {
    floor,
    margin: r > 0 ? Math.log(r / floor) / LN_PHI : -Infinity,
    floorLimited: limited,
    effective: limited ? floor : r,
  };
}

/**
 * Score gate for Ω: a rung whose closure residual is floor-limited ABSTAINS
 * (returns NaN) instead of contributing a spurious perfect score.
 */
export function gatedScore(scale: number, score: number, residual: number): number {
  const v = applyDefectFloor(scale, residual);
  if (v.floorLimited) return NaN;
  return score;
}

// ───────────────────────── self-check ─────────────────────────

export interface BindingProof {
  readonly monotoneRungs: boolean;
  readonly planckAtZero: boolean;
  readonly floorsPositive: boolean;
  readonly valid: boolean;
  readonly spread: readonly [number, number];
}

export function proveBindings(): BindingProof {
  const bs = scaleBindings();
  const planck = bs.find((b) => b.scale === 7)!;
  const planckAtZero = Math.abs(planck.rung) < 0.01;
  const floorsPositive = bs.every((b) => b.defectFloor > 0 && b.defectFloor < 1);
  const sorted = [...bs].sort((a, b) => a.rung - b.rung);
  let monotoneRungs = true;
  for (let i = 1; i < sorted.length; i++) {
    if (!(sorted[i].rung > sorted[i - 1].rung)) { monotoneRungs = false; break; }
  }
  return {
    monotoneRungs,
    planckAtZero,
    floorsPositive,
    valid: monotoneRungs && planckAtZero && floorsPositive,
    spread: [sorted[0].rung, sorted[sorted.length - 1].rung],
  };
}

export const BINDING_PROOF: BindingProof = Object.freeze(proveBindings());
