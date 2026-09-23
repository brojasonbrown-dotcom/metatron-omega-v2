/**
 * F1SeptenaryLocalUpdate — Phase 5 · Step 2 (n = 0, U_0).
 *
 * Canonical relaxation toward the septenary φ-ladder equilibrium
 *   ψ*_i ∝ φ^(-i), i ∈ {0..6}, ‖ψ*‖₂ = 1
 * per `docs/v13_rebuild/scales/n0_stability.md`. Gated by
 * FLAG_RHUFTF_LOCAL_UPDATE_0 (default OFF).
 */

import { PHI, portFlag, registerLocalUpdate } from '@metatron/field-kernel-core';
import type {
  FieldStateN,
  LocalUpdate,
  LocalUpdateContext,
  LocalUpdateReport,
} from '@metatron/field-kernel-core';
import { buildUnitTemplate, relaxTowardsTemplate } from './localUpdateKernel';

const NODES = 7;
const U_PHI = buildUnitTemplate(NODES, (i) => Math.pow(1 / PHI, i));

export class F1SeptenaryLocalUpdate implements LocalUpdate {
  readonly scale = 0;
  readonly name = 'F1_Septenary';
  step(state: FieldStateN, ctx: LocalUpdateContext, out: FieldStateN): LocalUpdateReport {
    return relaxTowardsTemplate(state, ctx, out, U_PHI);
  }
}

export function registerF1SeptenaryLocalUpdate(): boolean {
  if (!portFlag('FLAG_RHUFTF_LOCAL_UPDATE_0')) return false;
  registerLocalUpdate(new F1SeptenaryLocalUpdate());
  return true;
}

export function registerF1SeptenaryLocalUpdateForced(): void {
  registerLocalUpdate(new F1SeptenaryLocalUpdate());
}
