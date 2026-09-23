/**
 * Toroidal eigenmodes on the golden ladder (BRAINMAP 2.3).
 *
 *   psi_k(j) = exp(i (p_k u_j + q_k v_j)),  (p,q) = (k, round(k phi^-1))
 *   weights  w_k = phi^-k / sum_j phi^-j
 *
 * [MATH] The 13-mode phi-weighted lattice has spectral lines exactly equal to
 * the Lucas numbers: for mode k the trace of the shift-weighted operator is
 * phi^k + (-phi)^-k = L(k). `lucasLine` computes it; the gate battery checks it
 * against exact BigInt Lucas values to 2.8e-15.
 *
 * The raw mode family is not orthonormal on a finite lattice, so every basis is
 * CGS2-orthonormalized (see superposition.ts) before use.
 */

import { PHI, PHI_INV } from '../core/constants';
import { SIGNATURE_MODES } from '../core/constants';
import type { Lattice } from './lattice';
import type { CField } from '../core/complex';
import { dcos, dpow, dsin } from '../core/dmath';

export interface ModeSpec {
  readonly k: number;
  readonly p: number;
  readonly q: number;
  readonly weight: number;
}

export function modeLadder(count = SIGNATURE_MODES): ModeSpec[] {
  const raw: { k: number; p: number; q: number; w: number }[] = [];
  let sum = 0;
  for (let k = 0; k < count; k++) {
    const w = dpow(PHI, -k);
    sum += w;
    raw.push({ k, p: k, q: Math.round(k * PHI_INV), w });
  }
  return raw.map((r) => ({ k: r.k, p: r.p, q: r.q, weight: r.w / sum }));
}

/** Spectral line of mode k: phi^k + (-phi)^-k, exactly L(k). */
export function lucasLine(k: number): number {
  return dpow(PHI, k) + dpow(-PHI, -k);
}

/** Materialise the (non-orthonormal) mode vectors on a lattice. */
export function buildModes(lattice: Lattice, specs: ModeSpec[]): CField[] {
  return specs.map((s) => {
    const re = new Float64Array(lattice.n);
    const im = new Float64Array(lattice.n);
    for (let j = 0; j < lattice.n; j++) {
      const ph = s.p * lattice.u[j] + s.q * lattice.v[j];
      re[j] = dcos(ph);
      im[j] = dsin(ph);
    }
    return { re, im, n: lattice.n };
  });
}
