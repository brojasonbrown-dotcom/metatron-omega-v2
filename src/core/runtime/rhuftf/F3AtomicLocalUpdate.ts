/**
 * F3AtomicLocalUpdate — Phase 5 · Step 2 (n = 2, U_2).
 *
 * Relaxation toward the atomic shell ladder ψ*_i ∝ φ^(-i/2) on N = 7
 * shells. See `docs/v13_rebuild/scales/n2_stability.md`. Gated by
 * FLAG_RHUFTF_LOCAL_UPDATE_2 (default OFF).
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
const U_PHI = buildUnitTemplate(NODES, (i) => Math.pow(1 / PHI, i / 2));

export class F3AtomicLocalUpdate implements LocalUpdate {
  readonly scale = 2;
  readonly name = 'F3_Atomic';
  step(state: FieldStateN, ctx: LocalUpdateContext, out: FieldStateN): LocalUpdateReport {
    return relaxTowardsTemplate(state, ctx, out, U_PHI);
  }
}

export function registerF3AtomicLocalUpdate(): boolean {
  if (!portFlag('FLAG_RHUFTF_LOCAL_UPDATE_2')) return false;
  registerLocalUpdate(new F3AtomicLocalUpdate());
  return true;
}

export function registerF3AtomicLocalUpdateForced(): void {
  registerLocalUpdate(new F3AtomicLocalUpdate());
}
