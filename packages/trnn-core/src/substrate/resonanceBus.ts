/**
 * resonanceBus — Ω-REAL P4: the abstention-aware fusion law, stated once.
 *
 * Every scoring surface in the machine (memory recall, moment weaving, panel
 * readouts) was fusing channels with its own ad-hoc arithmetic. This module is
 * the single normative statement of the law, so a number shown anywhere can be
 * audited against one definition.
 *
 * LAW
 * ---
 *   R = ( Π_{i ∈ active} v_i  ·  γ )^{1/(k+1)}
 *
 *   active  = channels with a FINITE value in [0,1]; k = |active|
 *   abstain = non-finite value → removed from BOTH product and exponent.
 *             Abstention is not a zero and not a pass.
 *   veto    = a MEASURED zero forces R = 0 exactly. A dead channel cannot be
 *             averaged away by healthy neighbours.
 *   γ       = exp( −(phaseDev / κ)² )   phase-closure factor, itself a channel:
 *             measured → joins the product and adds 1 to the exponent (hence
 *             k+1); unmeasured → abstains, exponent is 1/k.
 *   gate    = when live coherence C is MEASURED and sits below COHERENCE_GATE
 *             (φ⁻²), the field is not trustworthy enough to speak: the whole
 *             fusion abstains (NaN, `gated: true`) rather than emitting a
 *             confident-looking small number.
 *
 * Numerics: the product is taken in log space through the deterministic bank
 * (`dlog`/`dexp`), so the result is bit-reproducible across engines and cannot
 * underflow for long channel lists.
 *
 * Epistemics: RESONANCE_FLOOR is Class C (empirical, no φ-closed form). It is
 * reported as a flag on the result and never folded into the value.
 */

import { dcos, dexp, dlog, dsin } from '../core/dmath';
import { COHERENCE_GATE } from './coherenceKernel';
import { PHI_INV } from '../core/constants';
import { RESONANCE_FLOOR } from './phiSubstrate';

/** κ for the phase-closure factor. Class C: a width, not a proved constant. */
export const KAPPA_PHASE = PHI_INV;

export interface BusChannel {
  readonly id: string;
  /** value in [0,1]; any non-finite value abstains. */
  readonly value: number;
}

export interface BusFusionOptions {
  /**
   * Circular phase deviation in radians (≥ 0). Finite → γ is measured.
   * Non-finite / undefined → γ abstains.
   */
  readonly phaseDev?: number;
  /** Width of the γ Gaussian. Class C tunable, default φ⁻¹. */
  readonly kappa?: number;
  /** Live coherence C ∈ [0,1]; non-finite → no gate is applied. */
  readonly coherence?: number;
  /** Gate threshold; default φ⁻² from the innovation kernel. */
  readonly coherenceGate?: number;
}

export interface BusFusionReport {
  /** Fused resonance ∈ [0,1]; NaN when everything abstained or the gate fired. */
  readonly value: number;
  /** Channels as they entered the bus (γ appended when measured). */
  readonly channels: readonly BusChannel[];
  /** Number of channels that entered the product (γ included). */
  readonly counted: number;
  readonly abstained: number;
  /** γ actually used, or NaN when it abstained. */
  readonly gamma: number;
  /** Weakest measured channel — the thing holding the score down. */
  readonly vetoId: string | null;
  readonly vetoValue: number;
  /** A measured zero was present: the value is a hard 0, not a small mean. */
  readonly dead: boolean;
  /** Coherence gate fired: the field was too incoherent to be believed. */
  readonly gated: boolean;
  /** value < RESONANCE_FLOOR (Class C empirical floor). */
  readonly subFloor: boolean;
}

const BLANK: BusFusionReport = {
  value: NaN,
  channels: [],
  counted: 0,
  abstained: 0,
  gamma: NaN,
  vetoId: null,
  vetoValue: NaN,
  dead: false,
  gated: false,
  subFloor: false,
};

/** Clamp into [0,1]; non-finite input abstains (stays NaN). */
export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Phase-closure factor γ = exp(−(dev/κ)²).
 * dev = 0 → 1 (perfect closure); dev = κ → e⁻¹; dev = ∞ → 0 (measured total
 * scatter, a veto); dev = NaN → NaN (abstain).
 */
export function phaseClosureGamma(phaseDev: number, kappa = KAPPA_PHASE): number {
  if (Number.isNaN(phaseDev) || !Number.isFinite(kappa) || kappa <= 0) return NaN;
  // A deviation of +∞ is a MEASURED total scatter, not an abstention: the
  // phases carry no closure at all, so γ is a hard zero and vetoes.
  if (!Number.isFinite(phaseDev)) return 0;
  const z = Math.abs(phaseDev) / kappa;
  if (z >= 40) return 0; // exp(−1600) underflows to 0 anyway
  return dexp(-(z * z));
}

/**
 * Circular deviation of a phase set: sqrt(−2·ln R̄) — the standard circular
 * standard deviation, 0 for a perfectly locked set, growing without bound as
 * the phases scatter. Fewer than 2 phases abstains.
 */
export function circularPhaseDev(phases: ArrayLike<number>): number {
  const n = phases.length;
  if (n < 2) return NaN;
  let sx = 0,
    sy = 0,
    m = 0;
  for (let i = 0; i < n; i++) {
    const p = phases[i];
    if (!Number.isFinite(p)) continue;
    sx += dcos(p);
    sy += dsin(p);
    m++;
  }
  if (m < 2) return NaN;
  const r = Math.sqrt(sx * sx + sy * sy) / m;
  if (r <= 1e-12) return Number.POSITIVE_INFINITY; // fully scattered
  if (r >= 1) return 0;
  return Math.sqrt(-2 * dlog(r));
}

/**
 * Fuse channels under the law. Pure, allocation-light, order-stable: channels
 * are consumed in the order given so the log-sum is bit-reproducible.
 */
export function fuseResonance(
  channels: readonly BusChannel[],
  opts: BusFusionOptions = {},
): BusFusionReport {
  const gate = opts.coherenceGate ?? COHERENCE_GATE;
  const c = opts.coherence;
  const gated = Number.isFinite(c) && (c as number) < gate;

  const gamma = phaseClosureGamma(opts.phaseDev ?? NaN, opts.kappa ?? KAPPA_PHASE);
  const all: BusChannel[] = channels.map((ch) => ({ id: ch.id, value: clamp01(ch.value) }));
  if (Number.isFinite(gamma)) all.push({ id: 'gamma', value: gamma });

  let logSum = 0;
  let counted = 0;
  let abstained = 0;
  let vetoId: string | null = null;
  let vetoValue = Number.POSITIVE_INFINITY;
  let dead = false;

  for (const ch of all) {
    if (!Number.isFinite(ch.value)) {
      abstained++;
      continue;
    }
    counted++;
    if (ch.value < vetoValue) {
      vetoValue = ch.value;
      vetoId = ch.id;
    }
    if (ch.value <= 0) {
      dead = true;
      continue;
    }
    logSum += dlog(ch.value);
  }

  if (gated) {
    return { ...BLANK, channels: all, counted: 0, abstained: all.length, gamma, gated: true };
  }
  if (counted === 0) return { ...BLANK, channels: all, abstained, gamma };

  const value = dead ? 0 : dexp(logSum / counted);
  return {
    value,
    channels: all,
    counted,
    abstained,
    gamma,
    vetoId,
    vetoValue: Number.isFinite(vetoValue) ? vetoValue : NaN,
    dead,
    gated: false,
    subFloor: value < RESONANCE_FLOOR,
  };
}

/**
 * φ-weighted blend of a text/prior score with a measured resonance.
 *
 * The prior keeps weight 1 and the resonance weight φ⁻¹, so evidence the
 * machine can read from the live field can lift or damp a stored score without
 * ever overriding it. An unmeasured resonance returns the prior untouched —
 * the engine being offline must not change any ranking.
 */
export function blendWithResonance(prior: number, resonance: number): number {
  if (!Number.isFinite(prior)) return NaN;
  if (!Number.isFinite(resonance)) return prior;
  const w = PHI_INV / (1 + PHI_INV);
  const p = Math.max(prior, 0);
  if (p <= 0) return 0;
  const r = Math.max(resonance, 1e-9);
  return dexp((1 - w) * dlog(p) + w * dlog(r));
}
