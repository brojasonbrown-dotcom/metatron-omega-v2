/**
 * Analysis / synthesis over the toroidal mode basis, CGS2-orthonormalized.
 *
 * Classical Gram-Schmidt applied twice (CGS2) is backward stable to machine
 * precision, so the basis is orthonormal to ~1e-16 and analysis is the exact
 * inverse of synthesis on the spanned subspace: roundtrip error < 1e-12 (G2).
 */

import { createField, inner, type CField } from '../core/complex';
import { buildModes, modeLadder, type ModeSpec } from './eigenmodes';
import type { Lattice } from './lattice';

export interface ModeBasis {
  readonly specs: readonly ModeSpec[];
  /** Orthonormal vectors, same order as specs. */
  readonly vectors: readonly CField[];
  readonly n: number;
}

function scaleInto(dst: CField, src: CField, kr: number, ki: number): void {
  for (let i = 0; i < dst.n; i++) {
    dst.re[i] = kr * src.re[i] - ki * src.im[i];
    dst.im[i] = kr * src.im[i] + ki * src.re[i];
  }
}

function subtractProjection(v: CField, b: CField): void {
  const c = inner(b, v); // <b|v>
  for (let i = 0; i < v.n; i++) {
    v.re[i] -= c.re * b.re[i] - c.im * b.im[i];
    v.im[i] -= c.re * b.im[i] + c.im * b.re[i];
  }
}

/** Build an orthonormal mode basis for a lattice (CGS2). */
export function buildBasis(lattice: Lattice, count?: number): ModeBasis {
  const specs = modeLadder(count);
  const raw = buildModes(lattice, specs);
  const basis: CField[] = [];
  for (const v of raw) {
    const w = { re: Float64Array.from(v.re), im: Float64Array.from(v.im), n: v.n };
    for (let pass = 0; pass < 2; pass++) for (const b of basis) subtractProjection(w, b);
    const norm = Math.sqrt(inner(w, w).re);
    if (!(norm > 1e-10)) continue; // degenerate mode — dropped, never faked
    scaleInto(w, w, 1 / norm, 0);
    basis.push(w);
  }
  return { specs: specs.slice(0, basis.length), vectors: basis, n: lattice.n };
}

/** coefficients c_k = <b_k | psi>. Writes into `out` (length 2*K, re/im interleaved). */
export function analyze(basis: ModeBasis, psi: CField, out: Float64Array): Float64Array {
  for (let k = 0; k < basis.vectors.length; k++) {
    const c = inner(basis.vectors[k], psi);
    out[2 * k] = c.re;
    out[2 * k + 1] = c.im;
  }
  return out;
}

/** psi = sum_k c_k b_k. */
export function synthesize(basis: ModeBasis, coeffs: Float64Array, out: CField): CField {
  out.re.fill(0);
  out.im.fill(0);
  for (let k = 0; k < basis.vectors.length; k++) {
    const cr = coeffs[2 * k];
    const ci = coeffs[2 * k + 1];
    const b = basis.vectors[k];
    for (let i = 0; i < out.n; i++) {
      out.re[i] += cr * b.re[i] - ci * b.im[i];
      out.im[i] += cr * b.im[i] + ci * b.re[i];
    }
  }
  return out;
}

/** phi-weighted modal energy signature, one value per mode. */
export function signature(basis: ModeBasis, coeffs: Float64Array, out: Float64Array): Float64Array {
  for (let k = 0; k < basis.vectors.length; k++) {
    const cr = coeffs[2 * k];
    const ci = coeffs[2 * k + 1];
    out[k] = basis.specs[k].weight * (cr * cr + ci * ci);
  }
  return out;
}

/** Convenience: allocate a coefficient buffer for a basis. */
export function coeffBuffer(basis: ModeBasis): Float64Array {
  return new Float64Array(2 * basis.vectors.length);
}

/** Projection of psi onto the basis subspace (used as the geometric drive G). */
export function project(basis: ModeBasis, psi: CField, scratch: Float64Array, out: CField): CField {
  analyze(basis, psi, scratch);
  return synthesize(basis, scratch, out);
}

export function newField(n: number): CField {
  return createField(n);
}
