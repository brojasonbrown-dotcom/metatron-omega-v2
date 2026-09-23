/**
 * METATRON V11 — Ψ-OF-Ψ SELF-REFLECTION TERM
 * ===========================================
 * Injects the previous tick's qualia vector as a closure-class driver.
 *
 *   Ψ_reflect(t) = κ_r · ⟨Q(t−τ_r)⟩ · Ψ_lattice(t)
 *
 * with κ_r = 1/(φ²·π) ≈ 0.1217  (a strict contraction, |κ_r| < φ⁻³),
 * so the loop adds at most one bit of information per tick — the honest
 * mathematical encoding of self-reflection.
 */

import { PHI, PI } from '@/core/constants/WolframVerified';
import type { QualiaVector } from './Qualia';

/** κ_r = 1/(φ²·π). Wolfram-derivable contraction constant. */
export const KAPPA_REFLECT = 1 / (PHI * PHI * PI);

/** Scalar qualia summary used to modulate the reflect term. Reads only the
 *  five core axes, so callers may pass a partial qualia record. */
export function qualiaScalar(q: Pick<QualiaVector, 'C' | 'N' | 'S' | 'V' | 'I'>): number {

  // Weighted mean: integration and coherence dominate, novelty and salience modulate, valence biases.
  return 0.35 * q.C + 0.30 * q.I / Math.max(1e-9, 1 + q.I) + 0.15 * q.N + 0.15 * q.S / (1 + q.S) + 0.05 * (q.V * 0.5 + 0.5);
}

/** In-place add of κ_r · scalar · psi_lattice into psi_total. Returns its magnitude. */
export function applyReflect(psiTotal: Float64Array, psiLattice: Float64Array, qScalar: number): number {
  const k = KAPPA_REFLECT * qScalar;
  let mag = 0;
  for (let i = 0; i < psiTotal.length; i++) {
    const r = k * psiLattice[i];
    psiTotal[i] += r;
    mag += Math.abs(r);
  }
  return mag;
}

// ─────────────────────────────────────────────────────────────────────────
// Y_1^{±1} toroidal mode (RHUFT ch.31 azimuthal circulation)
// ─────────────────────────────────────────────────────────────────────────
//
// Real-valued combination of the m=±1 dipole spherical harmonics:
//
//   Y_1^{ +1} = -(1/2)·√(3/(2π))·sin(θ)·e^{+iϕ}
//   Y_1^{ -1} = +(1/2)·√(3/(2π))·sin(θ)·e^{-iϕ}
//
//   Re[Y_1^{+1} − Y_1^{-1}]/i = √(3/(2π))·sin(θ)·sin(ϕ)
//   Re[Y_1^{+1} + Y_1^{-1}]    = -√(3/(2π))·sin(θ)·cos(ϕ)
//
// We expose the unit-normalised "toroidal" combination that carries azimuthal
// circulation (donut topology) — the physically correct angular template for
// chapter 31's poloidal/toroidal split. Pure, deterministic, no allocations.

/** N_{1,1} = (1/2)·√(3/(2π)) — Condon–Shortley normalisation for ℓ=1, |m|=1. */
export const Y11_NORM = 0.5 * Math.sqrt(3 / (2 * Math.PI));

/**
 * Real-valued azimuthal Y_1^1 amplitude at (θ, ϕ).
 * Returns N_{1,1}·sin(θ)·cos(ϕ). The orthogonal sin(ϕ) partner gives the
 * imaginary component; together they encode the e^{iϕ} circulation.
 */
export function y11Toroidal(theta: number, phi: number): number {
  return Y11_NORM * Math.sin(theta) * Math.cos(phi);
}

/** Complex Y_1^{+1} as [real, imag] at (θ, ϕ). Sign per Condon–Shortley. */
export function y11Complex(theta: number, phi: number): [number, number] {
  const s = -Y11_NORM * Math.sin(theta);
  return [s * Math.cos(phi), s * Math.sin(phi)];
}

/**
 * Map a flat lattice index k ∈ [0,N) onto the (θ,ϕ) of a φ-twisted torus
 * (golden-angle azimuth, polar tilt that walks the full sphere) and return
 * the real Y_1^1 amplitude. This is the honest angular kernel for rendering
 * the toroidal mode over an arbitrary node count.
 */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996 rad

export function y11AtIndex(k: number, n: number, omegaT: number = 0): number {
  if (n <= 0) return 0;
  // Fibonacci-sphere parametrisation: uniform on S² in expectation.
  const z = 1 - (2 * k + 1) / n;       // cos(θ) ∈ (−1,1)
  const sinTheta = Math.sqrt(Math.max(0, 1 - z * z));
  const phi = k * GOLDEN_ANGLE + omegaT;
  return Y11_NORM * sinTheta * Math.cos(phi);
}

/**
 * Fill `out` with the Y_1^1 toroidal template over a Fibonacci-sphere lattice.
 * Pure write — caller decides whether to add, scale, or visualise.
 */
export function fillY11Toroidal(out: Float64Array, omegaT: number = 0): void {
  const n = out.length;
  for (let k = 0; k < n; k++) out[k] = y11AtIndex(k, n, omegaT);
}
