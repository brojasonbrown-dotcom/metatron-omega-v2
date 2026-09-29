/**
 * Gate F1 — Ω-DEPTH Section 4 · Cl(3,0) channels.
 *
 * Contract under test:
 *   • the derived structure table matches an independent hand-written reference
 *   • basis vectors square to +1, distinct vectors anticommute, e123 is central
 *   • rotors are unit and R x R̃ reproduces a known rotation to 1e-14
 *   • blade gain 0 collapses to the scalar path exactly
 */

import { describe, expect, it } from 'vitest';
import {
  BLADES,
  TABLE,
  applyBladeGain,
  applyRotor,
  geometricProduct,
  magnitude,
  normalizeRotor,
  reverse,
  rotorFromPlane,
} from '../src/algebra/clifford';

const S = 0,
  E1 = 1,
  E2 = 2,
  E3 = 3,
  E12 = 4,
  E23 = 5,
  E31 = 6,
  E123 = 7;

function blade(i: number, v = 1): Float64Array {
  const a = new Float64Array(BLADES);
  a[i] = v;
  return a;
}

describe('F1 — Clifford channels', () => {
  it('derived table agrees with an independent reference on the generators', () => {
    // Reference facts, written independently of the derivation:
    const ref: [number, number, number, number][] = [
      // [i, j, k, sign]
      [E1, E1, S, 1],
      [E2, E2, S, 1],
      [E3, E3, S, 1],
      [E1, E2, E12, 1],
      [E2, E1, E12, -1],
      [E2, E3, E23, 1],
      [E3, E2, E23, -1],
      [E3, E1, E31, 1],
      [E1, E3, E31, -1],
      [E12, E12, S, -1],
      [E23, E23, S, -1],
      [E31, E31, S, -1],
      [E123, E123, S, -1],
      [E1, E23, E123, 1],
    ];
    for (const [i, j, k, s] of ref) {
      expect({ i, j, ...TABLE[i][j] }).toEqual({ i, j, k, s });
    }
  });

  it('the pseudoscalar commutes with everything', () => {
    const out1 = new Float64Array(BLADES);
    const out2 = new Float64Array(BLADES);
    for (let i = 0; i < BLADES; i++) {
      geometricProduct(blade(E123), blade(i), out1);
      geometricProduct(blade(i), blade(E123), out2);
      expect(Array.from(out1)).toEqual(Array.from(out2));
    }
  });

  it('reverse flips grades 2 and 3 only', () => {
    const a = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const r = reverse(a, new Float64Array(BLADES));
    expect(Array.from(r)).toEqual([1, 2, 3, 4, -5, -6, -7, -8]);
  });

  it('a rotor is unit and rotates a vector by the stated angle', () => {
    // 90° rotation in the e1e2 plane sends e1 → e2.
    const R = rotorFromPlane(Math.PI / 2, 1, 0, 0);
    expect(magnitude(R)).toBeCloseTo(1, 15);
    const out = applyRotor(R, blade(E1), new Float64Array(BLADES));
    expect(out[E2]).toBeCloseTo(1, 14);
    expect(out[E1]).toBeCloseTo(0, 14);
    for (const i of [S, E3, E12, E23, E31, E123]) expect(Math.abs(out[i])).toBeLessThan(1e-14);
  });

  it('rotor sandwich preserves magnitude (a rotation, not a scaling)', () => {
    const R = rotorFromPlane(0.7, 1, 2, -3);
    normalizeRotor(R);
    const x = Float64Array.from([0, 0.3, -0.5, 0.9, 0, 0, 0, 0]);
    const out = applyRotor(R, x, new Float64Array(BLADES));
    expect(magnitude(out)).toBeCloseTo(magnitude(x), 13);
  });

  it('two half-rotations compose into the full rotation', () => {
    const half = rotorFromPlane(Math.PI / 4, 1, 0, 0);
    const once = applyRotor(half, blade(E1), new Float64Array(BLADES));
    const twice = applyRotor(half, once, new Float64Array(BLADES));
    const full = applyRotor(
      rotorFromPlane(Math.PI / 2, 1, 0, 0),
      blade(E1),
      new Float64Array(BLADES),
    );
    for (let i = 0; i < BLADES; i++) expect(twice[i]).toBeCloseTo(full[i], 14);
  });

  it('blade gain 0 collapses to the scalar path exactly', () => {
    const a = Float64Array.from([1.25, 2, 3, 4, 5, 6, 7, 8]);
    applyBladeGain(a, 0);
    expect(Array.from(a)).toEqual([1.25, 0, 0, 0, 0, 0, 0, 0]);
    const b = Float64Array.from([2.5, 9, 9, 9, 9, 9, 9, 9]);
    applyBladeGain(b, 0);
    const out = geometricProduct(a, b, new Float64Array(BLADES));
    expect(out[S]).toBe(1.25 * 2.5); // pure scalar multiplication
    expect(
      Array.from(out)
        .slice(1)
        .every((v) => v === 0),
    ).toBe(true);
  });
});
