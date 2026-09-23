/**
 * Ω-READY R8 — the `IMetatron` facade.
 *
 * The host today runs two engines: Engine A (a cognitive orchestrator) and
 * Engine B (a field engine). Ω replaces both, but a transplant that requires the
 * host to be rewritten around Ω's internals is not a transplant. So Ω exposes
 * ONE narrow interface — everything the host needs, nothing about how Ω works —
 * and the host swaps its two engines for one implementation of it.
 *
 * The contract is deliberately small and total:
 *   • every call is synchronous and pure with respect to injected time,
 *   • every answer carries its own trust level and refusal reasons,
 *   • nothing throws for "not ready": an unready engine ABSTAINS, in the return
 *     value, where the caller can see it. Silence and confident-looking zeros are
 *     both worse than an explicit abstention.
 */

import type { CborValue, Hlc } from './contract';
import { INTEROP_VERSION } from './contract';
import type { TrustLevel, BigNum128 } from './bn128';
import { decideTier, explain, type GateInputs, type GateDecision } from './tierGate';
import type { EvidenceEnvelope, FactDraft } from './evidence';
import type { Drawer, OmegaRoom } from './rumf';

/** What the host asks for when it wants a ranked answer. */
export interface MetatronQuery {
  readonly text?: string;
  /** Optional field cue — 28-element complex field, real parts first. */
  readonly cue?: Float64Array;
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly topK?: number;
}

export interface MetatronAnswerItem {
  readonly key: string;
  readonly score: number;
  readonly resonance: number | null;
  readonly payload: CborValue;
}

export interface MetatronAnswer {
  readonly version: typeof INTEROP_VERSION;
  /** Empty when the engine abstained — never a fabricated ranking. */
  readonly items: readonly MetatronAnswerItem[];
  readonly abstained: boolean;
  readonly reason: string | null;
  readonly trust: TrustLevel;
  readonly merged: BigNum128;
}

export interface MetatronHealth {
  readonly version: typeof INTEROP_VERSION;
  readonly decision: GateDecision;
  readonly explanation: string;
  readonly ticks: number;
}

/**
 * The single seam between Ω and the host. Engine A and Engine B both collapse
 * into this.
 */
export interface IMetatron {
  /** Advance the field by one tick. `now` is injected for reproducibility. */
  step(now: number): void;
  /** Feed one sensory frame. */
  observe(modality: string, feature: Float32Array, tick: number): void;
  /** Ranked recall, or an explicit abstention. */
  query(q: MetatronQuery): MetatronAnswer;
  /** Turn something Ω learned into a host-chainable fact. */
  emit(draft: FactDraft, now: number): EvidenceEnvelope;
  /** Export one memory item as a RUMF drawer. */
  exportTo(layer: OmegaRoom, item: CborValue, context: CborValue, now: number): Drawer;
  /** Current gate decision and why. */
  health(): MetatronHealth;
  /** The engine's HLC — the host merges its own clock against this. */
  clock(): Hlc;
}

/** Build the abstention an unready engine must return. */
export function abstain(inputs: GateInputs, reason?: string): MetatronAnswer {
  const decision = decideTier(inputs);
  return {
    version: INTEROP_VERSION,
    items: [],
    abstained: true,
    reason: reason ?? explain(decision),
    trust: decision.trust,
    merged: decision.merged,
  };
}

/** Build an answer, refusing to report items when the gate withholds trust. */
export function answer(
  items: readonly MetatronAnswerItem[],
  inputs: GateInputs,
  minTrust: TrustLevel = 'T1',
): MetatronAnswer {
  const decision = decideTier(inputs);
  if (Number(decision.trust.slice(1)) < Number(minTrust.slice(1))) {
    return abstain(inputs, `trust ${decision.trust} below required ${minTrust}: ${decision.refusals.join('; ')}`);
  }
  return {
    version: INTEROP_VERSION,
    items,
    abstained: false,
    reason: null,
    trust: decision.trust,
    merged: decision.merged,
  };
}

export function health(inputs: GateInputs, ticks: number): MetatronHealth {
  const decision = decideTier(inputs);
  return { version: INTEROP_VERSION, decision, explanation: explain(decision), ticks };
}
