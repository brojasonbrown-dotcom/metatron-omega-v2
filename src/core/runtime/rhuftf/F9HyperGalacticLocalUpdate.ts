/**
 * F9HyperGalacticLocalUpdate — Phase 5 · Step 2 (n = 8, U_8).
 *
 * Relaxation toward the first DCT-II cosine mode:
 *   ψ*_i ∝ cos(π·(i + ½)/N),  N = 55.
 * The DCT-II basis is orthonormal; the k=0 mode is the natural
 * low-frequency envelope for the hyper-galactic scale. See
 * `docs/v13_rebuild/scales/n8_stability.md`. Gated by
 * FLAG_RHUFTF_LOCAL_UPDATE_8 (default OFF).
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
const U_PHI = buildUnitTemplate(NODES, (i) => Math.cos((Math.PI * (i + 0.5)) / NODES));

export class F9HyperGalacticLocalUpdate implements LocalUpdate {
  readonly scale = 8;
  readonly name = 'F9_HyperGalactic';
  step(state: FieldStateN, ctx: LocalUpdateContext, out: FieldStateN): LocalUpdateReport {
    return relaxTowardsTemplate(state, ctx, out, U_PHI);
  }
}

export function registerF9HyperGalacticLocalUpdate(): boolean {
  if (!portFlag('FLAG_RHUFTF_LOCAL_UPDATE_8')) return false;
  registerLocalUpdate(new F9HyperGalacticLocalUpdate());
  return true;
}

export function registerF9HyperGalacticLocalUpdateForced(): void {
  registerLocalUpdate(new F9HyperGalacticLocalUpdate());
}
