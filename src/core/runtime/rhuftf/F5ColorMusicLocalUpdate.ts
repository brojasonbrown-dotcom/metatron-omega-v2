/**
 * F5ColorMusicLocalUpdate — Phase 5 · Step 2 (n = 4, U_4).
 *
 * Relaxation toward ψ*_i ∝ √((i+1)/1) — the equal-tempered √(f_i/f_0)
 * envelope on N = 9 harmonics. See `docs/v13_rebuild/scales/n4_stability.md`.
 * Gated by FLAG_RHUFTF_LOCAL_UPDATE_4 (default OFF).
 */

import { portFlag, registerLocalUpdate } from '@metatron/field-kernel-core';
import type {
  FieldStateN,
  LocalUpdate,
  LocalUpdateContext,
  LocalUpdateReport,
} from '@metatron/field-kernel-core';
import { buildUnitTemplate, relaxTowardsTemplate } from './localUpdateKernel';

const NODES = 9;
const U_PHI = buildUnitTemplate(NODES, (i) => Math.sqrt(i + 1));

export class F5ColorMusicLocalUpdate implements LocalUpdate {
  readonly scale = 4;
  readonly name = 'F5_ColorMusic';
  step(state: FieldStateN, ctx: LocalUpdateContext, out: FieldStateN): LocalUpdateReport {
    return relaxTowardsTemplate(state, ctx, out, U_PHI);
  }
}

export function registerF5ColorMusicLocalUpdate(): boolean {
  if (!portFlag('FLAG_RHUFTF_LOCAL_UPDATE_4')) return false;
  registerLocalUpdate(new F5ColorMusicLocalUpdate());
  return true;
}

export function registerF5ColorMusicLocalUpdateForced(): void {
  registerLocalUpdate(new F5ColorMusicLocalUpdate());
}
