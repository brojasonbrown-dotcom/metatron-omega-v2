/**
 * localUpdateRegistry — Phase 5 · Step 3.
 *
 * Central bootstrap for the nine RHUFT-F canonical local updates
 * (U_0..U_8). Mirrors the shape of `registry.ts` on the measurement
 * side: an ordered `RHUFTF_LOCAL_UPDATE_SHAPES` ladder, a flag-respecting
 * `registerAllRhuftfLocalUpdates()`, a bypass `…Forced` sibling for
 * offline scripts, and an `activeRhuftfLocalUpdates()` snapshot helper.
 *
 * Registration remains opt-in per-scale via
 * `FLAG_RHUFTF_LOCAL_UPDATE_<n>` (default OFF). With all flags off the
 * `localUpdateRegistry` in `@metatron/field-kernel-core` stays empty and
 * `CanonicalUpdateBank` (Step 4) is a no-op — the runtime is
 * byte-identical to end-of-Phase-4.
 *
 * Node counts MUST match `RHUFTF_SCALE_SHAPES` in `./registry.ts` so
 * every U_n reads and writes the ShadowStateTape slice for the same
 * scale without truncation or padding.
 */

import type { ScaleShape } from '../ShadowStateTape';
import type { LocalUpdate } from '@metatron/field-kernel-core';
import { listLocalUpdates } from '@metatron/field-kernel-core';

import {
  registerF1SeptenaryLocalUpdate,
  registerF1SeptenaryLocalUpdateForced,
} from './F1SeptenaryLocalUpdate';
import {
  registerF2QuantumLocalUpdate,
  registerF2QuantumLocalUpdateForced,
} from './F2QuantumLocalUpdate';
import {
  registerF3AtomicLocalUpdate,
  registerF3AtomicLocalUpdateForced,
} from './F3AtomicLocalUpdate';
import {
  registerF4GeometricLocalUpdate,
  registerF4GeometricLocalUpdateForced,
} from './F4GeometricLocalUpdate';
import {
  registerF5ColorMusicLocalUpdate,
  registerF5ColorMusicLocalUpdateForced,
} from './F5ColorMusicLocalUpdate';
import {
  registerF6HebrewLocalUpdate,
  registerF6HebrewLocalUpdateForced,
} from './F6HebrewLocalUpdate';
import {
  registerF7GalacticLocalUpdate,
  registerF7GalacticLocalUpdateForced,
} from './F7GalacticLocalUpdate';
import {
  registerF8SubPlanckianLocalUpdate,
  registerF8SubPlanckianLocalUpdateForced,
} from './F8SubPlanckianLocalUpdate';
import {
  registerF9HyperGalacticLocalUpdate,
  registerF9HyperGalacticLocalUpdateForced,
} from './F9HyperGalacticLocalUpdate';

/**
 * Canonical per-scale shape ladder for local updates. Node counts are
 * a byte-for-byte mirror of `RHUFTF_SCALE_SHAPES` — a truth-suite check
 * in `scripts/phase5Step3LocalUpdateRegistry.ts` enforces the invariant.
 */
export const RHUFTF_LOCAL_UPDATE_SHAPES: readonly ScaleShape[] = Object.freeze([
  { scale: 0, nodes: 7 },
  { scale: 1, nodes: 55 },
  { scale: 2, nodes: 7 },
  { scale: 3, nodes: 13 },
  { scale: 4, nodes: 9 },
  { scale: 5, nodes: 22 },
  { scale: 6, nodes: 55 },
  { scale: 7, nodes: 55 },
  { scale: 8, nodes: 55 },
]);

export function rhuftfLocalUpdateShapes(): readonly ScaleShape[] {
  return RHUFTF_LOCAL_UPDATE_SHAPES;
}

/**
 * Flag-respecting bulk register. Returns the ordered set of scale
 * indices whose `FLAG_RHUFTF_LOCAL_UPDATE_<n>` is on. Idempotent — the
 * per-scale registrations overwrite same-scale entries in the field-
 * kernel-core registry (see `registerLocalUpdate` contract).
 */
export function registerAllRhuftfLocalUpdates(): readonly number[] {
  const activated: number[] = [];
  if (registerF1SeptenaryLocalUpdate()) activated.push(0);
  if (registerF2QuantumLocalUpdate()) activated.push(1);
  if (registerF3AtomicLocalUpdate()) activated.push(2);
  if (registerF4GeometricLocalUpdate()) activated.push(3);
  if (registerF5ColorMusicLocalUpdate()) activated.push(4);
  if (registerF6HebrewLocalUpdate()) activated.push(5);
  if (registerF7GalacticLocalUpdate()) activated.push(6);
  if (registerF8SubPlanckianLocalUpdate()) activated.push(7);
  if (registerF9HyperGalacticLocalUpdate()) activated.push(8);
  return activated;
}

/**
 * Bypasses every `FLAG_RHUFTF_LOCAL_UPDATE_<n>`; intended for offline
 * scripts (Step-4 CanonicalUpdateBank truth suite, Step-5 parity suite,
 * Step-6 cross-runtime harness). Never call from client-facing code.
 */
export function registerAllRhuftfLocalUpdatesForced(): readonly number[] {
  registerF1SeptenaryLocalUpdateForced();
  registerF2QuantumLocalUpdateForced();
  registerF3AtomicLocalUpdateForced();
  registerF4GeometricLocalUpdateForced();
  registerF5ColorMusicLocalUpdateForced();
  registerF6HebrewLocalUpdateForced();
  registerF7GalacticLocalUpdateForced();
  registerF8SubPlanckianLocalUpdateForced();
  registerF9HyperGalacticLocalUpdateForced();
  return [0, 1, 2, 3, 4, 5, 6, 7, 8];
}

/** Read-only snapshot for the CanonicalUpdateBank / panel helpers. */
export function activeRhuftfLocalUpdates(): readonly LocalUpdate[] {
  return listLocalUpdates();
}
