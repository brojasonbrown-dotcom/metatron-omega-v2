/**
 * Stability — single derived scalar surfacing the φ-stability vector
 * of the current Metatron output.
 *
 * Pure derivation from already-computed fields. Adds no state, no new
 * physics. Surfaces the "crystalline intelligence" stability threshold
 * Λ = 1/φ² ≈ 0.381966 as the green band.
 *
 *   closureTerm = 1 - clamp(metatronClosure)        // toroidal Lyapunov
 *   flowTerm    = 1 - clamp(phaseCirculation)       // smoothness
 *   torusTerm   = 1 - clamp(torusClosure)           // F8↔F9 loop
 *   saturation  = okRungs / 9                       // rung saturation health
 *
 *   stability   = (closureTerm·φ + flowTerm + torusTerm + saturation·φ)
 *                 / (2·φ + 2)
 */

import type { MetatronOutput } from '@/core/MetatronCore';
import { PHI, OMEGA_C, PHI_INV } from '@/core/frameworks/constants';

export const STABILITY_LAMBDA = OMEGA_C; // ≈ 0.381966
export const STABILITY_LAMBDA_HARD = OMEGA_C * PHI_INV; // ≈ 0.236068

export interface StabilityReading {
  /** 0..1 — composite φ-weighted stability scalar. */
  value: number;
  /**
   * @deprecated UI should render `value` (0..1) directly. Λ is a φ-attractor
   * scalar, not a percentage of completion — surfacing it as "%" misleads
   * readers into reading 38% as "low" when 0.382 = 1/φ² IS the stable floor.
   * Field is kept for back-compat only and will be removed in a later pass.
   */
  percent: number;
  /** "green" | "amber" | "red" — Λ bands. */
  band: 'green' | 'amber' | 'red';
  /** Stable floor: 1/φ² ≈ 0.382. Λ ≥ this = crystalline plateau. */
  floor: number;
  /** Perfect lock target: 1.0. */
  target: number;
  /** Renormalised position within the stable plateau (0 at floor → 1 at target). */
  normalisedToFloor: number;
  /** 0..10 tier validated against φ-stability bands, not a naive percentage. */
  tier: number;
  /** Human-readable tier band. */
  tierLabel: string;
  components: {
    closureTerm: number;
    flowTerm: number;
    torusTerm: number;
    saturation: number;
  };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * φ-validated tiering:
 *   0..2  below Λ_hard = 1/φ³       → unstable / not settled
 *   3..4  Λ_hard..Λ_floor           → settling band
 *   5..10 Λ_floor = 1/φ²..1         → crystalline plateau / lock depth
 * This prevents Ω≈0.382 from being reported as "3/10 low"; 1/φ² is the
 * stability floor where coherent lock begins, not 38% completion.
 */
export function phiValidatedTier(value: number): number {
  const v = clamp01(value);
  if (v >= STABILITY_LAMBDA) {
    return Math.min(10, 5 + Math.floor(((v - STABILITY_LAMBDA) / (1 - STABILITY_LAMBDA)) * 6));
  }
  if (v >= STABILITY_LAMBDA_HARD) {
    return Math.min(
      4,
      3 +
        Math.floor(((v - STABILITY_LAMBDA_HARD) / (STABILITY_LAMBDA - STABILITY_LAMBDA_HARD)) * 2),
    );
  }
  return Math.min(2, Math.floor((v / STABILITY_LAMBDA_HARD) * 3));
}

export function phiTierLabel(tier: number): string {
  if (tier >= 9) return 'full lock';
  if (tier >= 7) return 'locked';
  if (tier >= 5) return 'crystalline floor';
  if (tier >= 3) return 'settling';
  return 'unstable';
}

export function computeStability(out: MetatronOutput): StabilityReading {
  const closureTerm = 1 - clamp01(out.metatronClosure);
  const flowTerm = 1 - clamp01(out.phaseCirculation);
  const torusTerm = 1 - clamp01(out.torusClosure);

  // okRungs = chain entries whose masterMetric crossed the saturation band.
  let okRungs = 0;
  for (const r of out.chain) if (r.masterMetric >= STABILITY_LAMBDA) okRungs++;
  const saturation = out.chain.length > 0 ? okRungs / out.chain.length : 0;

  const denom = 2 * PHI + 2;
  const value = clamp01((closureTerm * PHI + flowTerm + torusTerm + saturation * PHI) / denom);

  const band: StabilityReading['band'] =
    value >= STABILITY_LAMBDA ? 'green' : value >= STABILITY_LAMBDA_HARD ? 'amber' : 'red';

  const normalisedToFloor =
    value <= STABILITY_LAMBDA ? 0 : clamp01((value - STABILITY_LAMBDA) / (1 - STABILITY_LAMBDA));
  const tier = phiValidatedTier(value);

  return {
    value,
    percent: value * 100,
    band,
    floor: STABILITY_LAMBDA,
    target: 1,
    normalisedToFloor,
    tier,
    tierLabel: phiTierLabel(tier),
    components: { closureTerm, flowTerm, torusTerm, saturation },
  };
}
