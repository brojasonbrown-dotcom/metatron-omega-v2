/**
 * F6HebrewLocalUpdate — Phase 5 · Step 2 (n = 5, U_5).
 *
 * Max-entropy uniform relaxation across N = 22 Hebrew letters
 * (ψ*_i = ‖ψ‖/√N). See `docs/v13_rebuild/scales/n5_stability.md`.
 * Gated by FLAG_RHUFTF_LOCAL_UPDATE_5 (default OFF).
 */

import { portFlag, registerLocalUpdate } from '@metatron/field-kernel-core';
import type {
  FieldStateN,
  LocalUpdate,
  LocalUpdateContext,
  LocalUpdateReport,
} from '@metatron/field-kernel-core';
import { buildUnitTemplate, relaxTowardsTemplate } from './localUpdateKernel';

const NODES = 22;
const U_PHI = buildUnitTemplate(NODES, () => 1);

export class F6HebrewLocalUpdate implements LocalUpdate {
  readonly scale = 5;
  readonly name = 'F6_Hebrew';
  step(state: FieldStateN, ctx: LocalUpdateContext, out: FieldStateN): LocalUpdateReport {
    return relaxTowardsTemplate(state, ctx, out, U_PHI);
  }
}

export function registerF6HebrewLocalUpdate(): boolean {
  if (!portFlag('FLAG_RHUFTF_LOCAL_UPDATE_5')) return false;
  registerLocalUpdate(new F6HebrewLocalUpdate());
  return true;
}

export function registerF6HebrewLocalUpdateForced(): void {
  registerLocalUpdate(new F6HebrewLocalUpdate());
}
