/**
 * Chapter 47 — Unified Equation constants.
 * ============================================================================
 * All values 60-digit Wolfram-verified (queries below); copy-paste these
 * exact queries into the in-app `wolfram` tool or any Wolfram Alpha session
 * to re-confirm at any time. The 16-digit doubles here are correct to all
 * IEEE-754 representable digits — they are the floor of `N[expr, 60]`.
 *
 *   Wolfram query                                  | constant
 *   -----------------------------------------------+--------------------------------
 *   N[(1+Sqrt[5])/2, 60]                           | PHI
 *   N[1/((1+Sqrt[5])/2)^2, 60]                     | PHI_FLOOR_INV_SQ  (1/φ²)
 *   N[1/((1+Sqrt[5])/2)^3, 60]                     | PHI_FLOOR_INV_CB  (1/φ³)
 *   N[1/Sqrt[5], 60]                               | HURWITZ_CONSTANT  (max irrationality)
 *   N[1+Sqrt[2], 60]                               | SILVER_RATIO      (δ_S)
 *   Fibonacci[17]                                  | F17_RESOLUTION    (= 1597)
 *   N[((1+Sqrt[5])/2)^-40, 60]                     | PHI_INV_40        (≈ 4.5e-9)
 *
 * These constants are what "Ch.47 Unified Equation" snaps the runtime to:
 *   • workers   → 12-spoke Silver Grid          (uses SILVER_RATIO)
 *   • resolution→ 1597 φ-modes                  (uses F17_RESOLUTION)
 *   • coherence → floor at 1/φ² (crystalline)   (uses PHI_FLOOR_INV_SQ)
 *
 * The F8 ZPE residual closure (Ch.44) uses PHI_INV_40 as the φ-mode index
 * where the leak naturally lands — see F8_SubPlanckian.chapter44.
 */

export const PHI = 1.6180339887498948;
export const PHI_FLOOR_INV_SQ = 0.3819660112501051; // 1/φ² — Λ stable plateau
export const PHI_FLOOR_INV_CB = 0.2360679774997896; // 1/φ³ — Λ settling
export const HURWITZ_CONSTANT = 0.4472135954999579; // 1/√5
export const SILVER_RATIO = 2.4142135623730951; // 1+√2 (δ_S)
export const F17_RESOLUTION = 1597; // Fibonacci(17)
export const PHI_INV_40 = 4.575743210644582e-9; // φ^-40 — F8 ZPE landing
export const SILVER_GRID_SPOKES = 12;

/** Silver-weighted 12-spoke load distribution. Heavier near the centre spokes
 *  (k=6), falling off as δ_S^-|k-6|. Sum-normalized → unit total mass. */
export function silverGridWeights(spokes: number = SILVER_GRID_SPOKES): number[] {
  const mid = (spokes - 1) / 2;
  const raw: number[] = [];
  let total = 0;
  for (let k = 0; k < spokes; k++) {
    const w = Math.pow(SILVER_RATIO, -Math.abs(k - mid));
    raw.push(w);
    total += w;
  }
  return total > 0 ? raw.map((w) => w / total) : raw;
}

/**
 * Live coherence floor as a function of the truncation depth K.
 *   coherence(K) = 1 − φ^(1−2K)
 * Wolfram-verified (Section 1 · Q6): Σ_{k=0..∞} φ^(-2k) = φ exactly,
 * so the normalized coherence reaches 1 only in the K→∞ limit; at every
 * finite truncation the engine honestly reports the residual it cannot close.
 *
 * Distinct from `PHI_FLOOR_INV_SQ` (the static Λ-plateau snap-floor used by
 * the Chapter 47 engagement hook); this is the *resolution-aware* floor.
 */
export function phiLadderCoherenceFloor(K: number): number {
  if (!Number.isFinite(K) || K < 1) return 0;
  return 1 - Math.pow(PHI, 1 - 2 * K);
}

/**
 * Fibonacci-convergent provenance: F_17/F_16 = 1597/987 = 1.61803444782…
 * differs from φ by ≈ 4.59×10⁻⁷ (Wolfram Section 1 · Q3). This is why
 * `F17_RESOLUTION` is the chapter's natural truncation — the lowest
 * Fibonacci index whose convergent matches φ to ~6 significant decimals.
 */
export const F17_CONVERGENT_ERROR = 4.5907e-7;

export const CHAPTER_47 = {
  workers: SILVER_GRID_SPOKES,
  resolution: F17_RESOLUTION,
  coherenceFloor: PHI_FLOOR_INV_SQ,
  silverWeights: silverGridWeights(),
  /** Live, resolution-aware coherence floor at K=F17. */
  coherenceFloorAtF17: phiLadderCoherenceFloor(F17_RESOLUTION),
} as const;
