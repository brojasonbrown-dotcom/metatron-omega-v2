/**
 * F8SubPlanckianLocalUpdate — Phase 5 · Step 2 (n = 7, U_7).
 *
 * Null update: ψ_{t+1} = ψ_t. The sub-Planckian scale is a ground-state
 * fixed point in the current spec — no local drift, every configuration
 * is an equilibrium. See `docs/v13_rebuild/scales/n7_stability.md`.
 * Gated by FLAG_RHUFTF_LOCAL_UPDATE_7 (default OFF).
 */

import { portFlag, registerLocalUpdate } from '@metatron/field-kernel-core';
import type {
  FieldStateN,
  LocalUpdate,
  LocalUpdateContext,
  LocalUpdateReport,
} from '@metatron/field-kernel-core';
import { nullUpdate } from './localUpdateKernel';

const NODES = 55;

export class F8SubPlanckianLocalUpdate implements LocalUpdate {
  readonly scale = 7;
  readonly name = 'F8_SubPlanckian';
  step(state: FieldStateN, ctx: LocalUpdateContext, out: FieldStateN): LocalUpdateReport {
    return nullUpdate(state, ctx, out, NODES);
  }
}

export function registerF8SubPlanckianLocalUpdate(): boolean {
  if (!portFlag('FLAG_RHUFTF_LOCAL_UPDATE_7')) return false;
  registerLocalUpdate(new F8SubPlanckianLocalUpdate());
  return true;
}

export function registerF8SubPlanckianLocalUpdateForced(): void {
  registerLocalUpdate(new F8SubPlanckianLocalUpdate());
}
