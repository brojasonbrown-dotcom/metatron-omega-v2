/**
 * F2QuantumLocalUpdate — Phase 5 · Step 2 (n = 1, U_1).
 *
 * Relaxation toward the quantum envelope ψ*_i ∝ φ^(-i/(N-1)) on N = 55
 * modes. See `docs/v13_rebuild/scales/n1_stability.md`. Gated by
 * FLAG_RHUFTF_LOCAL_UPDATE_1 (default OFF).
 */

import { PHI, portFlag, registerLocalUpdate } from '@metatron/field-kernel-core';
import type {
  FieldStateN,
  LocalUpdate,
  LocalUpdateContext,
  LocalUpdateReport,
} from '@metatron/field-kernel-core';
import { buildUnitTemplate, relaxTowardsTemplate } from './localUpdateKernel';

const NODES = 55;
const U_PHI = buildUnitTemplate(NODES, (i) => Math.pow(1 / PHI, i / (NODES - 1)));

export class F2QuantumLocalUpdate implements LocalUpdate {
  readonly scale = 1;
  readonly name = 'F2_Quantum';
  step(state: FieldStateN, ctx: LocalUpdateContext, out: FieldStateN): LocalUpdateReport {
    return relaxTowardsTemplate(state, ctx, out, U_PHI);
  }
}

export function registerF2QuantumLocalUpdate(): boolean {
  if (!portFlag('FLAG_RHUFTF_LOCAL_UPDATE_1')) return false;
  registerLocalUpdate(new F2QuantumLocalUpdate());
  return true;
}

export function registerF2QuantumLocalUpdateForced(): void {
  registerLocalUpdate(new F2QuantumLocalUpdate());
}
