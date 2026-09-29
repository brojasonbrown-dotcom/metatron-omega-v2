/**
 * Chapter 47 — Unified Equation runtime composer.
 * ============================================================================
 * Snaps three sovereign knobs at once:
 *   1. Worker pool        → 12-spoke Silver Grid (governor.cpuThreads = 12)
 *   2. Resolution         → F(17) = 1597 φ-modes
 *   3. Coherence floor    → 1/φ² = 0.381966 (clamped on the MetatronInput)
 *
 * Idempotent + reversible. `revertChapter47()` restores prior snapshot.
 *
 * The floor is held in module-local state and read via `chapter47CoherenceFloor()`
 * — the engine tick clamps `MetatronInput.coherence` to that floor when active.
 * Pure additive: when not engaged, returns 0 (no clamp).
 */
import {
  CHAPTER_47,
  PHI_FLOOR_INV_SQ,
  F17_RESOLUTION,
  SILVER_GRID_SPOKES,
} from '@/core/constants/Chapter47';
import { getGovernor } from './governorSingleton';

interface Chapter47Snapshot {
  cpuThreads: number;
  resolution: 'auto' | number;
}

let active = false;
let snapshot: Chapter47Snapshot | null = null;
let floor = 0;

export function isChapter47Active(): boolean {
  return active;
}

/** Clamp value used by the engine tick — 0 when Ch.47 is disengaged. */
export function chapter47CoherenceFloor(): number {
  return floor;
}

/**
 * Apply the live Ch.47 coherence floor. No-op when disengaged (floor = 0),
 * otherwise lifts c into [floor, 1]. This is what the engine tick calls so
 * the crystalline plateau actually reaches the φ-ladder kernel — without
 * this clamp the `floor` value was set by `applyChapter47` and then ignored
 * by every consumer (H4 bug, fixed in Section 4).
 */
export function clampCoherence(c: number): number {
  if (!active || floor <= 0) return c;
  if (!Number.isFinite(c)) return floor;
  return c < floor ? floor : c > 1 ? 1 : c;
}

export interface Chapter47Hooks {
  /** Current resolution (so we can restore it). */
  getResolution: () => 'auto' | number;
  /** Engine resolution setter (same one ResolutionPanel uses). */
  setResolution: (r: 'auto' | number) => void;
}

/** Engage Ch.47 — set workers/resolution/floor. Returns the new snapshot. */
export async function applyChapter47(hooks: Chapter47Hooks): Promise<typeof CHAPTER_47> {
  if (active) return CHAPTER_47;
  const { gov } = await getGovernor();
  snapshot = {
    cpuThreads: gov.settings.cpuThreads,
    resolution: hooks.getResolution(),
  };
  // Coupling is on by default → setting cpuThreads will snap ramBytes via ρ*.
  gov.update({ cpuThreads: SILVER_GRID_SPOKES });
  hooks.setResolution(F17_RESOLUTION);
  floor = PHI_FLOOR_INV_SQ;
  active = true;
  return CHAPTER_47;
}

/** Disengage Ch.47 — restore previous worker count and resolution. */
export async function revertChapter47(hooks: Chapter47Hooks): Promise<void> {
  if (!active || !snapshot) return;
  const { gov } = await getGovernor();
  gov.update({ cpuThreads: snapshot.cpuThreads });
  hooks.setResolution(snapshot.resolution);
  floor = 0;
  snapshot = null;
  active = false;
}
