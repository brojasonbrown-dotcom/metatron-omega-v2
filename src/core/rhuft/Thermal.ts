/**
 * RHUFT — THERMAL / CHARGE LAYER
 * ═══════════════════════════════
 * Temperature, polarisation and circulation as *derived* ladder quantities,
 * not tunable knobs.
 *
 * ① Ladder temperature.  A rung of characteristic length L(n) = ℓ_P·φⁿ has
 *    light-crossing time t(n) = L(n)/c and therefore a characteristic energy
 *    E(n) = ħ/t(n). The equipartition temperature of that single mode is
 *
 *        T(n) = E(n)/k_B = (ħ c)/(k_B ℓ_P) · φ⁻ⁿ = T_P·φ⁻ⁿ
 *
 *    so temperature descends the ladder in the exact inverse-φ geometry that
 *    length ascends it. This is a definition plus one substitution — Class A.
 *
 * ② Effective (occupancy-weighted) temperature.  A live field does not sit on
 *    one rung. With normalised mode energies pₙ the effective temperature is
 *    the p-weighted geometric mean of the rung temperatures,
 *
 *        log T_eff = Σ pₙ log T(n)
 *
 *    geometric because the ladder is multiplicative; an arithmetic mean would
 *    be dominated by the coldest rung and is the wrong average on a φ-scale.
 *
 * ③ Charge / magnetism coupling.  Polarisation P (static separation) and
 *    circulation M (rotational flow) are the conjugate pair of the same
 *    lattice: P is the mode-weighted first moment, M the mode-weighted
 *    circulation of the φ-shifted lag product. Their reciprocity
 *
 *        R = 2·|P·M| / (P² + M²)   ∈ [0,1]
 *
 *    is 1 exactly when the two are balanced — the frictionless condition —
 *    and collapses toward 0 when the field is all charge or all current.
 *    Thermal agitation opposes that balance, which the coupling number
 *
 *        χ = R · exp(−T_eff/T(n_ref))
 *
 *    reports directly: hot relative to its own rung ⇒ decoupled.
 *
 * Pure functions. No engine imports, no state.
 */

import { PHI, HBAR_J_S, BOLTZMANN_J_K, SPEED_OF_LIGHT_M_S, PLANCK_LENGTH_M } from '@/core/constants/WolframVerified';
import { ladderTemperature, PLANCK_TEMPERATURE_K } from './PhiLadder';

/** T_P computed the independent way (ħc/k_B ℓ_P) — cross-checks PhiLadder. */
export const PLANCK_TEMPERATURE_FROM_LENGTH_K =
  (HBAR_J_S * SPEED_OF_LIGHT_M_S) / (BOLTZMANN_J_K * PLANCK_LENGTH_M);

export interface ThermalReport {
  /** Occupancy-weighted effective temperature (K). */
  readonly tEff: number;
  /** Effective ladder rung implied by T_eff. */
  readonly nEff: number;
  /** Reference rung the field was projected onto. */
  readonly nRef: number;
  /** Temperature of the reference rung (K). */
  readonly tRef: number;
  /** Dimensionless thermal excess T_eff/T(n_ref). >1 ⇒ hotter than its rung. */
  readonly thermalExcess: number;
  /** Shannon spread of the occupancy over rungs, in rungs. */
  readonly spreadRungs: number;
}

/**
 * Effective temperature of a mode-amplitude vector projected onto the ladder
 * starting at rung `nRef`: mode k occupies rung nRef + k.
 */
export function thermalReport(modes: readonly number[] | Float64Array, nRef: number): ThermalReport {
  const M = modes.length;
  const tRef = ladderTemperature(nRef);
  if (M === 0) {
    return { tEff: tRef, nEff: nRef, nRef, tRef, thermalExcess: 1, spreadRungs: 0 };
  }
  let total = 0;
  for (let i = 0; i < M; i++) total += modes[i] * modes[i];
  if (!(total > 0)) {
    return { tEff: tRef, nEff: nRef, nRef, tRef, thermalExcess: 1, spreadRungs: 0 };
  }
  // log-domain (geometric) mean over rung temperatures + occupancy variance.
  let logT = 0, meanN = 0, meanN2 = 0;
  for (let i = 0; i < M; i++) {
    const p = (modes[i] * modes[i]) / total;
    if (p <= 0) continue;
    const n = nRef + i;
    logT += p * Math.log(ladderTemperature(n));
    meanN += p * n;
    meanN2 += p * n * n;
  }
  const tEff = Math.exp(logT);
  const nEff = Math.log(PLANCK_TEMPERATURE_K / tEff) / Math.log(PHI);
  const variance = Math.max(0, meanN2 - meanN * meanN);
  return {
    tEff,
    nEff,
    nRef,
    tRef,
    thermalExcess: tRef > 0 ? tEff / tRef : 1,
    spreadRungs: Math.sqrt(variance),
  };
}

export interface ChargeReport {
  /** Polarisation: normalised mode-weighted first moment ∈ [−1, 1]. */
  readonly P: number;
  /** Circulation: normalised φ-lag circulation ∈ [−1, 1]. */
  readonly M: number;
  /** Reciprocity 2|PM|/(P²+M²) ∈ [0,1]; 1 ⇔ balanced (frictionless). */
  readonly reciprocity: number;
  /** χ = reciprocity · exp(−T_eff/T_ref) ∈ [0,1]. */
  readonly coupling: number;
  /** Dominant handedness of the circulation. */
  readonly handedness: 'left' | 'right' | 'neutral';
}

/**
 * Polarisation / circulation pair and their thermal coupling.
 * `thermalExcess` comes from `thermalReport`; pass 1 for the isothermal case.
 */
export function chargeReport(
  modes: readonly number[] | Float64Array,
  thermalExcess: number,
): ChargeReport {
  const N = modes.length;
  if (N < 2) return { P: 0, M: 0, reciprocity: 0, coupling: 0, handedness: 'neutral' };

  let total = 0;
  for (let i = 0; i < N; i++) total += modes[i] * modes[i];
  if (!(total > 0)) return { P: 0, M: 0, reciprocity: 0, coupling: 0, handedness: 'neutral' };

  // Polarisation: signed first moment about the lattice centre, normalised so
  // a fully one-sided field reads ±1.
  const centre = (N - 1) / 2;
  let moment = 0;
  for (let i = 0; i < N; i++) moment += (modes[i] * modes[i]) * (i - centre);
  const P = Math.max(-1, Math.min(1, moment / (total * (centre || 1))));

  // Circulation: golden-lag antisymmetric product Σ (ψᵢ ψᵢ₊ℓ − ψᵢ₊ℓ ψᵢ₊2ℓ),
  // ℓ = round(N/φ²) — the φ-conjugate lag, which is the shift that makes the
  // lattice's own quasi-period visible.
  const lag = Math.max(1, Math.round(N / (PHI * PHI)));
  let circ = 0;
  for (let i = 0; i + 2 * lag < N; i++) {
    circ += modes[i] * modes[i + lag] - modes[i + lag] * modes[i + 2 * lag];
  }
  const Mv = Math.max(-1, Math.min(1, circ / total));

  const denom = P * P + Mv * Mv;
  const reciprocity = denom > 0 ? Math.min(1, (2 * Math.abs(P * Mv)) / denom) : 0;
  const coupling = reciprocity * Math.exp(-Math.max(0, thermalExcess));
  const handedness = Math.abs(Mv) < 1e-9 ? 'neutral' : Mv > 0 ? 'right' : 'left';
  return { P, M: Mv, reciprocity, coupling, handedness };
}

// ───────────────────────── self-check ─────────────────────────

const drift = Math.abs(PLANCK_TEMPERATURE_FROM_LENGTH_K - PLANCK_TEMPERATURE_K) / PLANCK_TEMPERATURE_K;
// The two routes (m_P = √(ħc/G) vs ℓ_P) disagree only by the rounding of the
// stored CODATA values themselves — ℓ_P is tabulated to 7 significant digits
// while G carries a 2.2e-5 relative uncertainty. Anything beyond ~1e-4 would
// mean a genuine constant-bank error, so that is where the gate sits.
if (!(drift < 1e-4)) {
  throw new Error(`Thermal: Planck temperature routes disagree, relative drift ${drift}`);
}
/** Relative disagreement between the two independent T_P derivations. */
export const PLANCK_TEMPERATURE_CROSSCHECK = drift;
