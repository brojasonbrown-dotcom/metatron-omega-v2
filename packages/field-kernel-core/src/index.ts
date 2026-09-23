/**
 * @metatron/field-kernel-core — Phase 1 · Step 3.
 *
 * Canonical location for:
 *   • port kill-switch registry (`portFlag`, `PORT_FLAGS`, `FlagKey`)
 *   • SIMD-friendly `fastCos` / `vCos` polynomial cosine kernel
 *   • φ-ladder shard physics: `runShardKernel`, `phiPow`, `amplitudeAt`,
 *     `nAdd`, `nValue`, and the PHI/KAPPA constants.
 *
 * Browser and Node daemon MUST import physics from here — no parallel
 * hand-rolled kernels. `src/core/runtime/fieldKernelCore.ts` is now a
 * pure re-export shim preserving every historical import path.
 */

export const FIELD_KERNEL_CORE_VERSION = '0.0.5-phase5.step1' as const;

export {
  portFlag,
  PORT_FLAGS,
  portFlagBaseline,
  portFlagOverride,
  setPortFlagOverride,
  clearPortFlagOverrides,
  allFlagKeys,
} from './portFlags';
export type { FlagKey } from './portFlags';

export { fastCos, vCos } from './cos';

export {
  PHI,
  PHI_INV,
  LN_PHI,
  KAPPA,
  KAPPA_REFLECT,
  phiPow,
  amplitudeAt,
  nAdd,
  nValue,
  runShardKernel,
} from './kernel';
export type { ShardKernelInput, ShardKernelOutput } from './kernel';

// Phase 2 · Step 1 — structured state tuple (RHUFT-F Layer 1).
export { createFieldStateN, cloneFieldStateN, copyFieldStateN } from './state';
export type { FieldStateN } from './state';

// Phase 2 · Step 3 — measurement operators (RHUFT-F Layer 4).
export {
  measureDrift,
  measureTemporalCoherence,
  measureClosure,
  measureInformationDensity,
  measureBurden,
  measureInertia,
} from './measurement';

// Phase 2 · Step 4 — Lyapunov candidate (RHUFT-F Layer 7).
export {
  lyapunovEnergy,
  DEFAULT_LYAPUNOV_WEIGHTS,
  LYAPUNOV_WEIGHTS_VERSION,
} from './lyapunov';
export type { LyapunovWeights, GraphSnapshot } from './lyapunov';

// Phase 5 · Step 1 — canonical local-update interface (RHUFT-F U_n).
export {
  registerLocalUpdate,
  unregisterLocalUpdate,
  getLocalUpdate,
  listLocalUpdates,
} from './localUpdate';
export type {
  LocalUpdate,
  LocalUpdateContext,
  LocalUpdateReport,
} from './localUpdate';
