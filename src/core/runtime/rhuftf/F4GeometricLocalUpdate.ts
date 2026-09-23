/**
 * F4GeometricLocalUpdate — Phase 5 · Step 2 (n = 3, U_3).
 *
 * Isotropic relaxation toward the uniform equilibrium ψ*_i = ‖ψ‖/√N on
 * N = 13 geometric modes. See `docs/v13_rebuild/scales/n3_stability.md`.
 * Gated by FLAG_RHUFTF_LOCAL_UPDATE_3 (default OFF).
 */

import { portFlag, registerLocalUpdate } from '@metatron/field-kernel-core';
import type {
  FieldStateN,
  LocalUpdate,
  LocalUpdateContext,
  LocalUpdateReport,
} from '@metatron/field-kernel-core';
import { buildUnitTemplate, relaxTowardsTemplate } from './localUpdateKernel';

const NODES = 13;
const U_PHI = buildUnitTemplate(NODES, () => 1);

export class F4GeometricLocalUpdate implements LocalUpdate {
  readonly scale = 3;
  readonly name = 'F4_Geometric';
  step(state: FieldStateN, ctx: LocalUpdateContext, out: FieldStateN): LocalUpdateReport {
    return relaxTowardsTemplate(state, ctx, out, U_PHI);
  }
}

export function registerF4GeometricLocalUpdate(): boolean {
  if (!portFlag('FLAG_RHUFTF_LOCAL_UPDATE_3')) return false;
  registerLocalUpdate(new F4GeometricLocalUpdate());
  return true;
}

export function registerF4GeometricLocalUpdateForced(): void {
  registerLocalUpdate(new F4GeometricLocalUpdate());
}
