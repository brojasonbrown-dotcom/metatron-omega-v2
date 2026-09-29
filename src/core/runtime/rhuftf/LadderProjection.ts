/**
 * LadderProjection — Phase 6 · Step 1.
 *
 * Invertible projection Π between a flat Ψ vector (owned by
 * `MasterUpdateController`, `dim = D`) and the nine-scale canonical
 * ladder of `FieldStateN` buffers (owned by `ShadowStateTape` and
 * `CanonicalUpdateBank`).
 *
 * Design: **block-cyclic scatter** across scales.
 *
 *   scatter[i] = { scale: i mod S, node: floor(i / S) }   for i ∈ [0, D)
 *
 * where `S` is the number of scales in the ladder. With
 * `RHUFTF_LOCAL_UPDATE_SHAPES` (S = 9, per-scale nodes ≥ 7) and the
 * controller's default D = 40, each scale receives 4–5 Ψ indices; every
 * scatter target sits well inside its scale's node budget. The map is
 * pure, deterministic, allocation-flat, and independent of tick / RNG.
 *
 * Invariants (enforced by `scripts/phase6Step1ProjectionTruth.ts`):
 *   • scatter is INJECTIVE: no two Ψ indices target the same ladder slot.
 *   • Π⁻¹ ∘ Π = identity on Ψ, bit-exactly (no float ops involved — pure
 *     copy through Float64Array indexing).
 *   • Π on a Ψ never overwrites more than D ladder slots; unmapped slots
 *     are left untouched (caller decides the padding — equilibrium seed
 *     for meaningful U_n step, or zero for a truth-suite baseline).
 *   • Π/Π⁻¹ never allocate on the hot path (the scatter table is built
 *     once at construction).
 *
 * Delegation semantics (used in Step 2):
 *   • forward:   Π(psi, ladder)              — Ψ ⇒ ladder mapped slots
 *   • pullback:  Π⁻¹(ladder, psiOut)         — mapped slots ⇒ Ψ_out
 *   • zeroDelta: `psiOut := psiIn` whenever the ladder is untouched
 *     between forward and pullback (this is the strict round-trip case).
 *
 * IMPORTANT: This module is pure. It imports nothing from the controller,
 * the metric bank, or the physics tape. With `FLAG_RHUFTF_CONTROLLER_DELEGATE`
 * default OFF in Step 2, no runtime path executes any code here — the
 * module is dead weight in production bundles until the flag flips.
 */

import type { FieldStateN } from '@metatron/field-kernel-core';
import { RHUFTF_LOCAL_UPDATE_SHAPES } from './localUpdateRegistry';
import type { ScaleShape } from '../ShadowStateTape';

export interface ScatterEntry {
  readonly psiIndex: number;
  readonly scale: number;
  readonly node: number;
}

export class LadderProjection {
  readonly psiDim: number;
  readonly shapes: readonly ScaleShape[];
  private readonly table: ReadonlyArray<ScatterEntry>;
  /** scale → { psi node capacity, count of scatter targets on this scale }. */
  private readonly perScaleCount: ReadonlyMap<number, number>;

  /**
   * @param psiDim  Length of the flat Ψ vector.
   * @param shapes  Ordered ladder — defaults to `RHUFTF_LOCAL_UPDATE_SHAPES`.
   * @throws        When any scatter target would exceed its scale's node
   *                budget (would only happen if D ≫ Σnodes; guarded so
   *                callers get a hard error, never silent truncation).
   */
  constructor(psiDim: number, shapes: readonly ScaleShape[] = RHUFTF_LOCAL_UPDATE_SHAPES) {
    if (!(psiDim > 0)) throw new Error('LadderProjection: psiDim must be > 0');
    if (shapes.length === 0) throw new Error('LadderProjection: shapes cannot be empty');
    this.psiDim = psiDim | 0;
    this.shapes = shapes;

    const S = shapes.length;
    const nodesByScale = new Map<number, number>();
    for (const s of shapes) nodesByScale.set(s.scale, s.nodes);

    const table: ScatterEntry[] = new Array(this.psiDim);
    const perScale = new Map<number, number>();
    for (let i = 0; i < this.psiDim; i++) {
      const scale = shapes[i % S].scale; // round-robin by index, not literal scale id
      const node = Math.floor(i / S);
      const cap = nodesByScale.get(scale) ?? 0;
      if (node >= cap) {
        throw new Error(
          `LadderProjection: scatter target (scale=${scale}, node=${node}) ` +
            `exceeds capacity ${cap}. Reduce psiDim or widen the ladder shape.`,
        );
      }
      table[i] = Object.freeze({ psiIndex: i, scale, node });
      perScale.set(scale, (perScale.get(scale) ?? 0) + 1);
    }
    this.table = Object.freeze(table);
    this.perScaleCount = perScale;
  }

  /** Read-only view of the scatter table (audit / truth-suite use). */
  scatter(): ReadonlyArray<ScatterEntry> {
    return this.table;
  }

  /** How many Ψ indices land on a given scale. */
  countOnScale(scale: number): number {
    return this.perScaleCount.get(scale) ?? 0;
  }

  /**
   * Forward projection Π: write Ψ into the mapped ladder slots.
   * Unmapped slots are LEFT UNTOUCHED. Caller owns the padding policy.
   *
   * @param psi     Source Ψ (length must equal `psiDim`).
   * @param ladder  Ordered per-scale `FieldStateN` buffers. Any scale
   *                referenced by the scatter table MUST be present.
   */
  forward(psi: Readonly<Float64Array>, ladder: readonly FieldStateN[]): void {
    if (psi.length !== this.psiDim) {
      throw new Error(
        `LadderProjection.forward: psi length ${psi.length} != psiDim ${this.psiDim}`,
      );
    }
    const byScale = indexLadder(ladder);
    for (let i = 0; i < this.psiDim; i++) {
      const e = this.table[i];
      const st = byScale.get(e.scale);
      if (!st)
        throw new Error(`LadderProjection.forward: missing ladder entry for scale ${e.scale}`);
      st.psi[e.node] = psi[i];
    }
  }

  /**
   * Pullback Π⁻¹: read the mapped ladder slots into Ψ_out.
   * `psiOut` is written in full at the mapped positions; positions that
   * are not scatter targets (there are none when scatter covers [0, D))
   * would be left untouched — but our scatter table is exhaustive over
   * [0, D), so `psiOut` is fully specified on return.
   */
  pullback(ladder: readonly FieldStateN[], psiOut: Float64Array): void {
    if (psiOut.length !== this.psiDim) {
      throw new Error(
        `LadderProjection.pullback: psiOut length ${psiOut.length} != psiDim ${this.psiDim}`,
      );
    }
    const byScale = indexLadder(ladder);
    for (let i = 0; i < this.psiDim; i++) {
      const e = this.table[i];
      const st = byScale.get(e.scale);
      if (!st)
        throw new Error(`LadderProjection.pullback: missing ladder entry for scale ${e.scale}`);
      psiOut[i] = st.psi[e.node];
    }
  }
}

function indexLadder(ladder: readonly FieldStateN[]): Map<number, FieldStateN> {
  const m = new Map<number, FieldStateN>();
  for (const st of ladder) m.set(st.scale, st);
  return m;
}
