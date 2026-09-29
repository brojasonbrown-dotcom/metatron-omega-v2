/**
 * L1 — the one constants source.
 *
 * Every >=8-digit float in METATRON Omega derives from PHI here, computed by a
 * single canonical composition so results are bit-reproducible across engines.
 *
 * Canonical composition rule (fixed, do not "optimise"):
 *   phiPow(n) === dpow(PHI, n)   [core/dmath, exact binary exponentiation]
 * Math.pow is implementation-approximated by the ECMAScript spec and genuinely
 * differs between V8 and JavaScriptCore, so it cannot appear on any path that
 * reaches state. dpow's integer path is pure multiplication and division, i.e.
 * bit-identical on every conforming engine.
 *
 * Epistemic labels per BRAINMAP section 0.
 */

import { dexp, dpow } from './dmath';

/** [MATH] golden ratio, float64-nearest. */
export const PHI = (1 + Math.sqrt(5)) / 2;
/** [MATH] phi^-1 = phi - 1. */
export const PHI_INV = PHI - 1;

/** Canonical phi power. All derived constants must route through this. */
export function phiPow(n: number): number {
  return dpow(PHI, n);
}

/**
 * [MATH] phi^-7 stamped from the 60-digit decimal expansion.
 * No float64 composition of PHI reproduces this value exactly
 * (Math.pow gives ...633018, repeated multiply ...633011); the true value is
 * 0.0344418537486330266596288467532955303640193374749172077608320951683860166...
 */
export const PHI_INV_7 = 0.03444185374863302665962884675329553;

/** [MATH] closure coupling kappa = 1/(phi*pi); kappa*phi*pi = 1 exactly (Wolfram cert C6). */
export const KAPPA = 1 / (PHI * Math.PI);

/** [MATH] memory kernel lambda = phi^-2; roots exactly {1, -phi^-2}. */
export const LAMBDA_MEMORY = phiPow(-2);

/** [DEFINED] always-on max-norm clamp (Law L8). */
export const CLAMP_MAX = phiPow(4);

/**
 * The nine-term cell coefficients (BRAINMAP section 2.4).
 * z+ = clamp[ a z + b G + g P + d R + e (Pi - z) + zt (zhat - z) + eta U + mu V + xi S ]
 */
export const CELL = {
  alpha: phiPow(-2), // self / recurrence
  beta: phiPow(-5), // geometric drive G
  gamma: phiPow(-3), // phase term P
  delta: phiPow(-3), // resonance term R
  epsilon: phiPow(-8), // Pi (closure) pull
  zeta: phiPow(-3), // zhat (prediction) pull
  eta: phiPow(-5), // external input U
  mu: phiPow(-5), // web / cross-rung V
  xi: phiPow(-5), // sensory S
} as const;

/**
 * [MATH] Jury contraction certificate for the homogeneous part:
 *   g = |alpha| + |beta| + 2|epsilon| + |zeta| = 0.7507764050037855 < 1
 *
 * Re-blessed with the deterministic φ ladder (dpowi, exact binary
 * exponentiation). The true value is
 *   0.75077640500378546463487396283702776...
 * so the new constant is nearer the truth than the old Math.pow value
 * (3.54e-17 vs 6.46e-17 absolute) as well as being engine-independent.
 */
export const JURY_GAIN =
  Math.abs(CELL.alpha) + Math.abs(CELL.beta) + 2 * Math.abs(CELL.epsilon) + Math.abs(CELL.zeta);

/** Frozen reference value of the certificate (bit-parity target with the Python oracle). */
export const JURY_GAIN_REFERENCE = 0.7507764050037855;

/** [DEFINED] golden delay used by the coherence measure, ticks. */
export const COHERENCE_DELAY = 233;
/** [DEFINED] ignition threshold: up-crossing of phi^-2. */
export const IGNITION_THRESHOLD = phiPow(-2);

/** [DEFINED] checkpoint cadence, ticks (Fibonacci). */
export const CHECKPOINT_PERIOD = 144;

/** [DEFINED] spectral signature width per tick (13 modes). */
export const SIGNATURE_MODES = 13;

/** Corridor regimes (Law L7). */
export const CORRIDOR = {
  stable: phiPow(-1),
  stress: 0.7 * phiPow(-1),
  hysteresis: phiPow(-8),
  gateScales: [1, phiPow(-1), phiPow(-2)] as const,
} as const;

// ───────────────────────────────────────────────────────────────────────────
// S2 — Ω-MAX additions. Every one of these is inert at its default value: a
// build that does not opt in reproduces the S0 oracle hashes bit-for-bit.
// ───────────────────────────────────────────────────────────────────────────

/**
 * [MATH] Input-to-State Stability.
 *
 * The Jury certificate above bounds only the homogeneous part. The driven
 * terms (gamma P, delta R, eta U, mu V, xi S) inject energy every tick, so the
 * honest bound on a driven run is the ISS gain:
 *
 *   ‖z‖∞  ≤  ( Σ_i |k_i| ‖term_i‖∞ ) / (1 − g)      with g = JURY_GAIN
 *
 * Every driven term is itself bounded by the clamp, so the worst case an
 * admissible build can reach is ISS_GAIN · CLAMP_MAX. When that is below
 * CLAMP_MAX the clamp is provably unreachable — the clamp becomes a fault
 * detector rather than a control surface, which is exactly what S4 asserts.
 */
export const ISS_INPUT_SUM =
  Math.abs(CELL.gamma) +
  Math.abs(CELL.delta) +
  Math.abs(CELL.eta) +
  Math.abs(CELL.mu) +
  Math.abs(CELL.xi);

/** ISS gain: state amplification of a unit-bounded drive. */
export const ISS_GAIN = ISS_INPUT_SUM / (1 - JURY_GAIN);

/** Worst reachable max-norm for drives bounded by 1 — the ISS envelope. */
export const ISS_ENVELOPE = ISS_GAIN;

/** Bound each driven term must respect for the envelope to hold, given CLAMP_MAX. */
export const ISS_DRIVE_BOUND = CLAMP_MAX;

/**
 * Per-rung coherence delay.
 *
 * A single 233-tick window across eighteen φ-scaled rung clocks measures a
 * different physical interval on every rung, and it also dominates the memory
 * footprint (the ring holds delay+1 full complex frames — see the S1 cost
 * model). The ladder below is the Fibonacci spine; rank 0 is the fastest rung
 * and the delay lengthens with rank, so each rung measures the same number of
 * its OWN periods.
 */
export const COHERENCE_DELAY_LADDER = [
  13, 21, 34, 55, 89, 144, 233, 233, 233, 377, 377, 610, 610, 987, 987, 1597, 1597, 2584,
] as const;

export type CoherenceClock = 'uniform' | 'fibonacci';

/**
 * Delay for a rung. `uniform` (the default everywhere) returns the historical
 * constant, so opting out is exact.
 */
export function coherenceDelayForRank(rank: number, clock: CoherenceClock = 'uniform'): number {
  if (clock === 'uniform') return COHERENCE_DELAY;
  const i = Math.max(0, Math.min(COHERENCE_DELAY_LADDER.length - 1, Math.trunc(rank)));
  return COHERENCE_DELAY_LADDER[i];
}

/**
 * Environment coefficients — measurement operators on the substrate, not
 * physics claims. Both are identity at their defaults.
 *
 *   thermal:  λ_eff = λ · exp(−T / T_REF)   ⇒ T = 0 leaves λ untouched, and
 *             λ_eff ≤ λ always, so the Jury gain can only shrink.
 *   magnetic: the (p,q) mode pair picks up a phase offset B · B_SCALE.
 *             B = 0 leaves every mode phase untouched.
 */
export const ENV = {
  /** Reference temperature of the decoherence map, in the field's own units. */
  temperatureRef: phiPow(3),
  /** Radians of mode-phase bias per unit of magnetic bias. */
  magneticScale: phiPow(-3),
  /** Quantum-reference-frame attenuation exponent divisor (φ^(−n/qrfDivisor)). */
  qrfDivisor: 89,
} as const;

/** λ_eff(T) — monotone decreasing, equals LAMBDA_MEMORY at T = 0. */
export function thermalLambda(temperature: number, lambda: number = LAMBDA_MEMORY): number {
  const t = temperature > 0 ? temperature : 0;
  return t === 0 ? lambda : lambda * dexp(-t / ENV.temperatureRef);
}

/** Mode phase bias in radians — exactly 0 at B = 0. */
export function magneticPhase(bias: number): number {
  return bias === 0 ? 0 : bias * ENV.magneticScale;
}

/** QRF attenuation for a rung index n — 1 at n = 0, monotone decreasing. */
export function qrfAttenuation(n: number): number {
  return n === 0 ? 1 : phiPow(-n / ENV.qrfDivisor);
}
