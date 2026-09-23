/**
 * Ω-DEPTH Section 4 — geometric algebra channels, Cl(3,0).
 *
 * Channel dimension 8, struct-of-arrays, one Float64Array per blade:
 *
 *   index : 0    1   2   3   4    5    6    7
 *   blade : 1    e1  e2  e3  e12  e23  e31  e123
 *
 * The geometric product table is derived exactly from bitmask blade algebra
 * (integer swap counting, e_i² = +1), never hand-typed, and each entry is a
 * signed index — no floating point enters the structure constants.
 *
 * Rollout is opt-in: at blade gain 0 a multivector collapses to its scalar
 * component and every consumer behaves bit-for-bit as the scalar path does.
 */

import { dcos, dsin } from '../core/dmath';

/** Bit masks and orientation signs for the eight canonical blades. */
const MASK = [0b000, 0b001, 0b010, 0b100, 0b011, 0b110, 0b101, 0b111];
/** e31 = e3 e1 = −(e1 e3): the only reversed-orientation basis choice. */
const ORIENT = [1, 1, 1, 1, 1, 1, -1, 1];

export const BLADES = 8;
export const BLADE_NAMES = ['1', 'e1', 'e2', 'e3', 'e12', 'e23', 'e31', 'e123'] as const;

function indexOfMask(m: number): number {
  for (let i = 0; i < BLADES; i++) if (MASK[i] === m) return i;
  throw new Error(`clifford: no blade for mask ${m}`);
}

/** (-1)^swaps for merging two canonical ascending products under e_i² = +1. */
function reorderSign(a: number, b: number): number {
  let sign = 1;
  // For each bit of b, count how many higher-order bits of a it must pass.
  for (let i = 0; i < 3; i++) {
    if (!(b & (1 << i))) continue;
    let above = 0;
    for (let j = i + 1; j < 3; j++) if (a & (1 << j)) above++;
    if (above & 1) sign = -sign;
  }
  return sign;
}

/** Signed product table: `TABLE[i][j] = {k, s}` meaning b_i b_j = s · b_k. */
export interface Structure {
  readonly k: number;
  readonly s: number;
}

function buildTable(): Structure[][] {
  const t: Structure[][] = [];
  for (let i = 0; i < BLADES; i++) {
    const row: Structure[] = [];
    for (let j = 0; j < BLADES; j++) {
      const a = MASK[i];
      const b = MASK[j];
      const s = reorderSign(a, b) * ORIENT[i] * ORIENT[j];
      const k = indexOfMask(a ^ b);
      row.push({ k, s: s * ORIENT[k] });
    }
    t.push(row);
  }
  return t;
}

export const TABLE: readonly (readonly Structure[])[] = buildTable();

/** Multivector as struct-of-arrays: one lane per blade, `n` sites each. */
export interface MultiVectorField {
  readonly n: number;
  /** BLADES lanes, each Float64Array(n). */
  readonly lanes: Float64Array[];
}

export function createMultiVectorField(n: number): MultiVectorField {
  const lanes: Float64Array[] = [];
  for (let b = 0; b < BLADES; b++) lanes.push(new Float64Array(n));
  return { n, lanes };
}

/** Geometric product of two 8-component multivectors, into `out` (length 8). */
export function geometricProduct(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  out: Float64Array,
): Float64Array {
  out.fill(0);
  for (let i = 0; i < BLADES; i++) {
    const ai = a[i];
    if (ai === 0) continue;
    const row = TABLE[i];
    for (let j = 0; j < BLADES; j++) {
      const bj = b[j];
      if (bj === 0) continue;
      const st = row[j];
      out[st.k] += st.s * ai * bj;
    }
  }
  return out;
}

/** Reverse (†): grades 2 and 3 flip sign. */
export function reverse(a: ArrayLike<number>, out: Float64Array): Float64Array {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  out[3] = a[3];
  out[4] = -a[4];
  out[5] = -a[5];
  out[6] = -a[6];
  out[7] = -a[7];
  return out;
}

/** ‖a‖ = sqrt(Σ a_i²) — the Euclidean magnitude of Cl(3,0) under this basis. */
export function magnitude(a: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < BLADES; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

/** Normalise in place; returns the previous magnitude (0 leaves `a` untouched). */
export function normalizeRotor(a: Float64Array): number {
  const m = magnitude(a);
  if (!(m > 0)) return 0;
  for (let i = 0; i < BLADES; i++) a[i] /= m;
  return m;
}

/**
 * Rotor for a rotation of `angle` radians in the plane of the unit bivector
 * given by (b12, b23, b31): R = cos(θ/2) − sin(θ/2)·B.
 */
export function rotorFromPlane(angle: number, b12: number, b23: number, b31: number): Float64Array {
  const n = Math.sqrt(b12 * b12 + b23 * b23 + b31 * b31);
  const r = new Float64Array(BLADES);
  const c = dcos(angle / 2);
  const s = n > 0 ? dsin(angle / 2) / n : 0;
  r[0] = c;
  r[4] = -s * b12;
  r[5] = -s * b23;
  r[6] = -s * b31;
  return r;
}

/** Sandwich product R x R† — the rotation of a multivector by a rotor. */
export function applyRotor(
  rotor: ArrayLike<number>,
  x: ArrayLike<number>,
  out: Float64Array,
  scratch: Float64Array = new Float64Array(BLADES),
  scratch2: Float64Array = new Float64Array(BLADES),
): Float64Array {
  geometricProduct(rotor, x, scratch);
  reverse(rotor, scratch2);
  return geometricProduct(scratch, scratch2, out);
}

/**
 * Blade gain: scales every non-scalar lane. At gain 0 the multivector is its
 * scalar part alone, so a build that never raises the gain is bit-identical to
 * the scalar-complex engine.
 */
export function applyBladeGain(a: Float64Array, gain: number): void {
  for (let i = 1; i < BLADES; i++) a[i] *= gain;
}
