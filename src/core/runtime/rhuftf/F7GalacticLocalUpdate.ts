/**
 * F7GalacticLocalUpdate — Phase 5 · Step 2 (n = 6, U_6).
 *
 * Bounded spiral surrogate: uniform relaxation on N = 55 nodes. The
 * canonical spiral operator is deferred to Phase 6; the uniform template
 * is the dissipative bounded envelope that guarantees non-divergence
 * while preserving ψ-norm at equilibrium. See
 * `docs/v13_rebuild/scales/n6_stability.md`. Gated by
 * FLAG_RHUFTF_LOCAL_UPDATE_6 (default OFF).
 */

import { portFlag, registerLocalUpdate } from '@metatron/field-kernel-core';
import type {
  FieldStateN,
  LocalUpdate,
  LocalUpdateContext,
  LocalUpdateReport,
} from '@metatron/field-kernel-core';
import { buildUnitTemplate, relaxTowardsTemplate } from './localUpdateKernel';

const NODES = 55;
const U_PHI = buildUnitTemplate(NODES, () => 1);

export class F7GalacticLocalUpdate implements LocalUpdate {
  readonly scale = 6;
  readonly name = 'F7_Galactic';
  step(state: FieldStateN, ctx: LocalUpdateContext, out: FieldStateN): LocalUpdateReport {
    return relaxTowardsTemplate(state, ctx, out, U_PHI);
  }
}

export function registerF7GalacticLocalUpdate(): boolean {
  if (!portFlag('FLAG_RHUFTF_LOCAL_UPDATE_6')) return false;
  registerLocalUpdate(new F7GalacticLocalUpdate());
  return true;
}

export function registerF7GalacticLocalUpdateForced(): void {
  registerLocalUpdate(new F7GalacticLocalUpdate());
}
