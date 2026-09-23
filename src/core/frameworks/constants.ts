/**
 * METATRON V11 — UNIFIED FRAMEWORK CONSTANT BANK
 * ===============================================
 *
 * Single source of truth for every numeric constant consumed by F1..F9.
 * Every value pulls from `src/core/constants/WolframVerified.ts` (60-digit
 * verified) and is exposed in BOTH float64 (fast-path) and BigDecimal
 * (extended-precision) form so framework modules can request the precision
 * their current M-rung needs without re-typing literals.
 *
 * IRON RULES
 * ----------
 *  - NO inline numeric literals in any framework module — pull from here.
 *  - NO ceiling embedded in this file. Mode counts come from
 *    `governor.computeMaxM()` at runtime; this file only holds *anchors*
 *    (canonical V10 minimums) which the φ-ladder extends past.
 *  - NO regression: every V10 anchor is preserved as a *minimum*, never a
 *    maximum.
 */

import Decimal from 'decimal.js';
import {
  PHI, PHI_BD, PHI_INV, PHI_INV_BD, PHI_SQ, PHI_SQ_BD,
  PSI, PSI_BD, PSI_INV, PSI_INV_BD,
  PI, PI_BD, KAPPA, KAPPA_BD, OMEGA_C, OMEGA_C_BD,
  SPEED_OF_LIGHT_M_S, PLANCK_J_HZ, PLANCK_LENGTH_M,
  // F4 geometric constant bank (Phase F4-α)
  F4_DIHEDRAL_TETRA, F4_DIHEDRAL_TETRA_BD,
  F4_DIHEDRAL_CUBE, F4_DIHEDRAL_CUBE_BD,
  F4_DIHEDRAL_OCTA, F4_DIHEDRAL_OCTA_BD,
  F4_DIHEDRAL_DODECA, F4_DIHEDRAL_DODECA_BD,
  F4_DIHEDRAL_ICOSA, F4_DIHEDRAL_ICOSA_BD,
  F4_COS36, F4_COS36_BD,
  F4_COS_PI8, F4_COS_PI8_BD,
  F4_DODECA_EDGE_CIRCUM, F4_DODECA_EDGE_CIRCUM_BD,
  F4_ICOSA_EDGE_CIRCUM, F4_ICOSA_EDGE_CIRCUM_BD,
  F4_GOLDEN_ANGLE_DEG, F4_GOLDEN_ANGLE_DEG_BD,
  F4_VESICA_AREA_RATIO, F4_VESICA_AREA_RATIO_BD,
  F4_CIRCUMR_TETRA, F4_CIRCUMR_CUBE, F4_CIRCUMR_OCTA,
  F4_CIRCUMR_DODECA, F4_CIRCUMR_ICOSA,
  F4_VOLUME_ICOSA_PHI, F4_VOLUME_ICOSA_PHI_BD,
  F4_SURFACE_ICOSA, F4_SURFACE_DODECA,
  F4_HE_HZ,
  F4_DEFECT_TETRA, F4_DEFECT_CUBE, F4_DEFECT_OCTA,
  F4_DEFECT_DODECA, F4_DEFECT_ICOSA,
  F4_RHOMBIC_30_FACES, F4_RHOMBIC_30_EDGES, F4_RHOMBIC_30_VERTICES,
} from '@/core/constants/WolframVerified';
import {
  SILVER_RATIO, SILVER_GRID_SPOKES, silverGridWeights,
} from '@/core/constants/Chapter47';

// ───────────────────────── re-exports (single import surface) ─────────────────────────

export {
  PHI, PHI_BD, PHI_INV, PHI_INV_BD, PHI_SQ, PHI_SQ_BD,
  PSI, PSI_BD, PSI_INV, PSI_INV_BD,
  PI, PI_BD, KAPPA, KAPPA_BD, OMEGA_C, OMEGA_C_BD,
  SPEED_OF_LIGHT_M_S, PLANCK_J_HZ, PLANCK_LENGTH_M,
  // F4 geometric bank
  F4_DIHEDRAL_TETRA, F4_DIHEDRAL_TETRA_BD,
  F4_DIHEDRAL_CUBE, F4_DIHEDRAL_CUBE_BD,
  F4_DIHEDRAL_OCTA, F4_DIHEDRAL_OCTA_BD,
  F4_DIHEDRAL_DODECA, F4_DIHEDRAL_DODECA_BD,
  F4_DIHEDRAL_ICOSA, F4_DIHEDRAL_ICOSA_BD,
  F4_COS36, F4_COS36_BD,
  F4_COS_PI8, F4_COS_PI8_BD,
  F4_DODECA_EDGE_CIRCUM, F4_DODECA_EDGE_CIRCUM_BD,
  F4_ICOSA_EDGE_CIRCUM, F4_ICOSA_EDGE_CIRCUM_BD,
  F4_GOLDEN_ANGLE_DEG, F4_GOLDEN_ANGLE_DEG_BD,
  F4_VESICA_AREA_RATIO, F4_VESICA_AREA_RATIO_BD,
  F4_CIRCUMR_TETRA, F4_CIRCUMR_CUBE, F4_CIRCUMR_OCTA,
  F4_CIRCUMR_DODECA, F4_CIRCUMR_ICOSA,
  F4_VOLUME_ICOSA_PHI, F4_VOLUME_ICOSA_PHI_BD,
  F4_SURFACE_ICOSA, F4_SURFACE_DODECA,
  F4_HE_HZ,
  F4_DEFECT_TETRA, F4_DEFECT_CUBE, F4_DEFECT_OCTA,
  F4_DEFECT_DODECA, F4_DEFECT_ICOSA,
  F4_RHOMBIC_30_FACES, F4_RHOMBIC_30_EDGES, F4_RHOMBIC_30_VERTICES,
  // Silver ratio family (re-exported for F4-β)
  SILVER_RATIO, SILVER_GRID_SPOKES, silverGridWeights,
};

/** Silver-ratio mode amplitude: δ_S^(-|k|). Octagonal/quasi-crystal basis. */
export function silverAmp(k: number): number {
  return Math.pow(1 / SILVER_RATIO, Math.abs(k));
}
export function silverAmpBd(k: number): Decimal {
  return new Decimal(1).div(PSI_BD).pow(Math.abs(k));
}

// ───────────────────────── Fibonacci spine ─────────────────────────
//
// V10 hardcoded F(0)..F(11) as the ring-radius anchors. V11 generates
// on demand to any k — F(k) grows like φ^k/√5 so the only ceiling is
// representation precision (Number.MAX_SAFE_INTEGER at k≈78, BigInt
// unbounded). We expose both forms.

export const FIB_F64: readonly number[] = (() => {
  const out: number[] = [0, 1];
  for (let k = 2; k <= 78; k++) out.push(out[k - 1] + out[k - 2]);
  return out;
})();

const _fibBig: bigint[] = [0n, 1n];
export function fibBig(k: number): bigint {
  if (k < 0) throw new RangeError(`fibBig: k=${k} < 0`);
  while (_fibBig.length <= k) {
    _fibBig.push(_fibBig[_fibBig.length - 1] + _fibBig[_fibBig.length - 2]);
  }
  return _fibBig[k];
}

/** φ-rung weight: φ^(-|k|). The canonical mode-amplitude basis. */
export function phiAmp(k: number): number {
  return Math.pow(PHI_INV, Math.abs(k));
}
export function phiAmpBd(k: number): Decimal {
  return PHI_INV_BD.pow(Math.abs(k));
}

// ───────────────────────── Solfeggio anchors (F5/F6/MesoTori) ─────────────────────────
//
// V10 hardcoded the 9 Solfeggio frequencies (174..963 Hz). V11 keeps these
// as the canonical minimum and exposes the natural extensions via the φ
// ladder (Solfeggio·φ^k) and the just-intonation overtone series.

export const SOLFEGGIO_HZ: readonly number[] = [
  174, 285, 396, 417, 528, 639, 741, 852, 963,
] as const;

/** k-th φ-extension above the highest Solfeggio anchor (k≥0). */
export function solfeggioPhiExt(k: number): number {
  return SOLFEGGIO_HZ[SOLFEGGIO_HZ.length - 1] * Math.pow(PHI, k + 1);
}

// ───────────────────────── Engine carrier ─────────────────────────
//
// V10's 144 Hz tick was a UI-loop convenience, not a computational
// invariant. V11 carrier is governed; this constant only exposes the
// V10 default for parity tests.

export const V10_CARRIER_HZ = 144;

// ───────────────────────── Tolerance bands ─────────────────────────
//
// Parity harness reads these. f64 tolerance is 4 ULP relative; bd
// tolerance is 10^-(prec-5) so termination noise stays below the gate.

export const PARITY_TOL_F64_REL = 4 * 2.220446049250313e-16;
export function parityTolBd(precision: number): Decimal {
  return new Decimal(10).pow(-(precision - 5));
}

// ───────────────────────── Self-check ─────────────────────────

(function selfCheck() {
  // φ ladder identity: φ² = φ + 1 must hold to ULP in both modes.
  if (Math.abs(PHI_SQ - (PHI + 1)) > 1e-15) {
    throw new Error('frameworks/constants: PHI ladder broken (f64)');
  }
  const drift = PHI_SQ_BD.minus(PHI_BD.plus(1)).abs();
  if (drift.gt('1e-55')) {
    throw new Error(`frameworks/constants: PHI ladder broken (bd) drift=${drift}`);
  }
  // Fibonacci closed form sanity: F(20) = 6765
  if (FIB_F64[20] !== 6765) throw new Error('frameworks/constants: FIB_F64 broken');
  if (fibBig(40) !== 102334155n) throw new Error('frameworks/constants: fibBig broken');
})();
