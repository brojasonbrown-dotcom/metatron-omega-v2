/**
 * Ω-READY R4 — one tier law, fail-closed.
 *
 * Two tier notions existed on the two sides and they did not agree:
 *   • Ω learn tiers T0..T3 — what compute is actually available.
 *   • Host RUMF trust T0..T5 — how durable/trusted a memory is.
 * A dashboard that shows one and a policy gate that enforces the other is how a
 * system reports full coherence while being unstable. This module is the single
 * place the two are reconciled, and it reconciles them conservatively:
 *
 *   1. Evidence that was never measured cannot raise trust. A cold rung, an
 *      empty substrate and a NaN coherence are all treated as "unknown", which
 *      is treated as "no", never as "fine".
 *   2. Trust is capped by the weakest input, not averaged over inputs.
 *   3. Every refusal carries the reason that caused it, so a UI can show why a
 *      tier was withheld instead of implying warmth.
 */

import {
  BN_ONE,
  bnFromNumber,
  mergeSubstrates,
  trustScoreMultiplier,
  type BigNum128,
  type TrustLevel,
} from './bn128';

/** Live readings the gate judges. All optional: absent ⇒ unknown ⇒ refused. */
export interface GateInputs {
  /** Warm-only field coherence in [0,1]; NaN/undefined when nothing is warm. */
  readonly coherenceWarm?: number;
  /** Warm rungs vs total rungs — a partial ladder cannot certify. */
  readonly warmRungs?: number;
  readonly totalRungs?: number;
  /** L0 frames actually held. Zero means the substrate is empty. */
  readonly tapeFrames?: number;
  /** Distinct consolidated patterns (L3). */
  readonly patterns?: number;
  /** Sealed evidence records available for audit. */
  readonly sealedFindings?: number;
  /** Whether the evidence chain verified on its last check. */
  readonly chainVerified?: boolean;
}

export interface GateDecision {
  /** Admitted trust level — the ONLY value a caller may act on. */
  readonly trust: TrustLevel;
  /** Host retrieval multiplier for that trust level. */
  readonly multiplier: BigNum128;
  /** Merged substrate coherence, BigNum128, or 0n when unmeasured. */
  readonly merged: BigNum128;
  /** True only when every requirement for the admitted level was measured. */
  readonly measured: boolean;
  /** Every reason a higher tier was refused, in evaluation order. */
  readonly refusals: readonly string[];
}

const MIN_TAPE_FRAMES = 89; // F11 — one full tape window
const MIN_PATTERNS = 21; // F8
const MIN_FINDINGS = 8;

function unit(x: number | undefined): number | null {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1 ? x : null;
}

/**
 * Decide the admissible trust level. Monotone in every input: improving a
 * reading can never lower the decision, and a missing reading never raises it.
 */
export function decideTier(inp: GateInputs): GateDecision {
  const refusals: string[] = [];

  const coh = unit(inp.coherenceWarm);
  if (coh === null) refusals.push('field coherence is not measured (no warm rung)');

  const total = inp.totalRungs ?? 0;
  const warm = inp.warmRungs ?? 0;
  const ladderFraction = total > 0 ? warm / total : 0;
  if (total === 0) refusals.push('ladder size unknown');
  else if (warm < total) refusals.push(`ladder partially warm (${warm}/${total})`);

  const frames = inp.tapeFrames ?? 0;
  if (frames === 0) refusals.push('memory substrate holds no tape frames');
  else if (frames < MIN_TAPE_FRAMES)
    refusals.push(`tape below one window (${frames}/${MIN_TAPE_FRAMES})`);

  const patterns = inp.patterns ?? 0;
  if (patterns < MIN_PATTERNS)
    refusals.push(`too few consolidated patterns (${patterns}/${MIN_PATTERNS})`);

  const findings = inp.sealedFindings ?? 0;
  if (findings < MIN_FINDINGS)
    refusals.push(`too little sealed evidence (${findings}/${MIN_FINDINGS})`);

  if (inp.chainVerified === false) refusals.push('evidence chain failed verification');
  else if (inp.chainVerified === undefined) refusals.push('evidence chain not verified');

  // The merge takes the three substrate readings we can actually measure.
  // Anything unmeasured enters as zero, and the geometric mean then collapses to
  // zero — the fail-closed behaviour we want, stated once here.
  const merged = mergeSubstrates({
    brain: coh === null ? 0n : bnFromNumber(coh),
    metatron: bnFromNumber(Math.min(1, ladderFraction)),
    rumf: frames === 0 ? 0n : bnFromNumber(Math.min(1, frames / MIN_TAPE_FRAMES)),
  });

  // Tier ladder. Each step needs everything below it plus its own evidence.
  let trust: TrustLevel = 'T0';
  const chainOk = inp.chainVerified === true;
  const mergedUnit = Number(merged) / Number(BN_ONE);

  if (coh !== null && frames > 0) trust = 'T1';
  if (trust === 'T1' && frames >= MIN_TAPE_FRAMES && patterns >= MIN_PATTERNS) trust = 'T2';
  if (trust === 'T2' && chainOk && findings >= MIN_FINDINGS) trust = 'T3';
  if (trust === 'T3' && warm === total && total > 0 && mergedUnit >= 0.5) trust = 'T4';
  if (trust === 'T4' && mergedUnit >= 0.8 && coh !== null && coh >= 0.9) trust = 'T5';

  return {
    trust,
    multiplier: trustScoreMultiplier(trust),
    merged,
    measured: refusals.length === 0,
    refusals,
  };
}

/** Fail-closed admission: does the current state clear a required level? */
export function admits(inp: GateInputs, required: TrustLevel): boolean {
  return Number(decideTier(inp).trust.slice(1)) >= Number(required.slice(1));
}

/** One-line human explanation — what a deck should render, verbatim. */
export function explain(d: GateDecision): string {
  if (d.measured) return `trust ${d.trust} — all inputs measured`;
  return `trust ${d.trust} — withheld: ${d.refusals.join('; ')}`;
}
