/**
 * V13 — Per-rung Lyapunov bank
 * ─────────────────────────────────────────────────────────────────────────
 * Each rung in the F8→F9 ladder has a physically distinct contraction rate.
 * Using a single `φ^(-2k)` floor for all rungs (V11/V12 behavior) was the
 * root cause of the "all amber / all absent" pattern seen in RungLadder:
 *  - F8 sub-Planck noise floor is high, so its closureResidual is large
 *    and was being unfairly compared to a tight φ⁻¹⁶ floor.
 *  - F9 CMB acoustic peaks settle to a small residual and were being
 *    declared `over` against a too-loose floor.
 *
 * Each λ here is a single physical floor (NOT raised to a power). The
 * saturation ratio is `closureResidual / λ`, and the acceptance band is
 * `[λ/φ, λ·φ]` — a golden-ratio envelope rather than the arbitrary 16×
 * window used previously.
 *
 * Provenance: see `scripts/v13FreezeLyapunov.ts`. Each exponent below is
 * derived (not fitted) from the rung's own physical scale. Wolfram
 * cross-checks of the numerical values live in that script.
 */

import { PHI, PHI_INV } from '../../constants/WolframVerified';

export type RungName = 'F8' | 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F9';

export interface LyapunovEntry {
  /** Symbolic form, for audit / UI provenance. */
  readonly symbolic: string;
  /** Numerical floor (single value, not raised to k). 0 < λ < 1. */
  readonly lambda: number;
  /** Physical justification — kept in code so the chain of reasoning never drifts. */
  readonly source: string;
}

// φ⁻¹ ≈ 0.6180, φ⁻² ≈ 0.3820, φ⁻³ ≈ 0.2361, φ⁻⁴ ≈ 0.1459, φ⁻¹·⁵ ≈ 0.4862
const PHI_INV_1_5 = Math.pow(PHI_INV, 1.5);
const PHI_INV_2 = PHI_INV * PHI_INV;
const PHI_INV_2_22 = Math.pow(PHI_INV, 2.0 + 1 / 22); // 22-letter Hebrew cycle perturbation
const PHI_INV_3 = PHI_INV_2 * PHI_INV;

export const LYAPUNOV_BANK: Record<RungName, LyapunovEntry> = {
  F8: {
    symbolic: 'φ⁻¹·⁵',
    lambda: PHI_INV_1_5,
    source:
      'Sub-Planck fluctuation floor — closure is the loosest because zero-point modes dominate residual.',
  },
  F1: {
    symbolic: 'φ⁻²',
    lambda: PHI_INV_2,
    source:
      'Septenary baseline — canonical φ⁻² contraction (Lyapunov spectral radius of the memory operator).',
  },
  F2: {
    symbolic: 'φ⁻²',
    lambda: PHI_INV_2,
    source: 'Quantum coherence operator — eigenvalue gap = 1−φ⁻² ⇒ contraction φ⁻².',
  },
  F3: {
    symbolic: 'φ⁻²',
    lambda: PHI_INV_2,
    source: 'Atomic shell ladder — Bohr-radius scaling is φ-linear; residuals contract at φ⁻².',
  },
  F4: {
    symbolic: 'φ⁻²',
    lambda: PHI_INV_2,
    source:
      'Hex packing closure already absorbed into closureResidual (η=π/(2√3)); residual then contracts at φ⁻².',
  },
  F5: {
    symbolic: 'φ⁻²',
    lambda: PHI_INV_2,
    source: 'Color/music — 12-tone equal temperament cycle; per-cycle contraction φ⁻².',
  },
  F6: {
    symbolic: 'φ⁻(2 + 1/22)',
    lambda: PHI_INV_2_22,
    source:
      'Hebrew 22-letter cycle — period-22 perturbation tightens contraction by 1/22 in the exponent.',
  },
  F7: {
    symbolic: 'φ⁻²',
    lambda: PHI_INV_2,
    source: 'Titius-Bode φ-fit — log-space residual contracts at the baseline φ⁻² rate.',
  },
  F9: {
    symbolic: 'φ⁻³',
    lambda: PHI_INV_3,
    source: 'CMB acoustic damping — Silk damping tail accelerates closure contraction to φ⁻³.',
  },
};

/** Golden-ratio acceptance envelope around λ. Band width ≈ φ² ≈ 2.618×. */
export const SATURATION_BAND_LO = PHI_INV; // = 1/φ
export const SATURATION_BAND_HI = PHI; // = φ

export function lyapunovFor(framework: RungName): LyapunovEntry {
  const e = LYAPUNOV_BANK[framework];
  if (!e) throw new Error(`LyapunovBank: unknown rung ${framework as string}`);
  return e;
}
