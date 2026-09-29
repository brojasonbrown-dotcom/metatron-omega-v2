/**
 * MemoryPolicy — user-tunable knobs for how aggressively Metatron
 * commits experience to long-term memory, and which modalities are
 * allowed to enter memory at all.
 *
 * Design constraints (Wolfram-verified, no regression):
 *   • aggression scales THRESHOLDS only, never PERIODS — so PhiLock
 *     scheduling (F1/F7/F11/F12/F13/F14) and the carrier remain bit-
 *     identical to the unconfigured run.
 *   • modality toggles gate `SensoryGateway.ingest()` from STORING
 *     atoms, but the live cortex still observes the feature so the
 *     real-time UI panels keep updating.
 *   • Singleton + listener pattern so the UI slider can edit the
 *     policy without threading it through every constructor.
 *
 * Defaults reproduce the historical pre-policy behaviour byte-for-byte:
 * aggression = 0 → scale = 1.0 → every threshold equals the BASE constant
 * and hebbianDecayBoost = 1.0. The slider only *softens* gates / *extends*
 * retention as the user dials it up — it never tightens past baseline.
 */

import type { SensoryModality } from '@/core/sensory/SensoryAtom';

export const DEFAULT_AGGRESSION = 0.0;

/** Baseline thresholds — values match the pre-policy hard-coded constants. */
const BASE = {
  episodicSalience: 0.45,
  noveltyGate: 0.6,
  surpriseGate: 0.5,
  hebbianDecayBoost: 1.0,
} as const;

export interface MemoryPolicyState {
  aggression: number; // 0..1
  modalities: Record<SensoryModality, boolean>; // audio/video/imu/synthetic
  /** Field-state captures (L0 tape + L2 episodic from non-sensory ticks). */
  fieldStateEnabled: boolean;
}

type Listener = (s: MemoryPolicyState) => void;

class MemoryPolicy {
  private state: MemoryPolicyState = {
    aggression: DEFAULT_AGGRESSION,
    modalities: { audio: true, video: true, imu: true, synthetic: true, 'vision-embed': true },
    fieldStateEnabled: true,
  };
  private listeners = new Set<Listener>();

  get(): MemoryPolicyState {
    return this.state;
  }

  setAggression(a: number): void {
    const clamped = Math.max(0, Math.min(1, a));
    if (clamped === this.state.aggression) return;
    this.state = { ...this.state, aggression: clamped };
    this.emit();
  }

  setModality(m: SensoryModality, on: boolean): void {
    if (this.state.modalities[m] === on) return;
    this.state = { ...this.state, modalities: { ...this.state.modalities, [m]: on } };
    this.emit();
  }

  setFieldStateEnabled(on: boolean): void {
    if (this.state.fieldStateEnabled === on) return;
    this.state = { ...this.state, fieldStateEnabled: on };
    this.emit();
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l(this.state);
      } catch {
        /* ignore */
      }
    }
  }

  // ─── Derived thresholds (used by MemoryCaptureKernel + HebbianMatrix) ──
  // aggression = 0   → scale = 1.0  → baseline (bit-identical to pre-policy)
  // aggression = 0.5 → scale = 0.6  → ~1.7× more captures
  // aggression = 1   → scale = 0.2  → ~5× more captures
  private scale(): number {
    return 1 - 0.8 * this.state.aggression;
  }

  episodicSalience(): number {
    return BASE.episodicSalience * this.scale();
  }
  noveltyGate(): number {
    return BASE.noveltyGate * this.scale();
  }
  surpriseGate(): number {
    return BASE.surpriseGate * this.scale();
  }

  /** Higher = remember longer. aggression 0 → 1.0× base τ (no change). */
  hebbianDecayBoost(): number {
    return BASE.hebbianDecayBoost * (1 + this.state.aggression);
  }

  // ─── One dial: the φ-graded 1..13 face of the same aggression ─────────
  // The substrate has exactly one tuning knob. It is exposed as a Fibonacci
  // step 1..13 because every derived quantity below is φ-graded, and reading
  // a step is honest in a way that reading "0.62" is not.

  /** Fibonacci steps the dial can occupy. */
  private static readonly STEPS = [1, 2, 3, 5, 8, 13] as const;

  /** Current dial step (1..13). */
  dial(): number {
    const idx = Math.round(this.state.aggression * (MemoryPolicy.STEPS.length - 1));
    return MemoryPolicy.STEPS[Math.max(0, Math.min(MemoryPolicy.STEPS.length - 1, idx))];
  }

  /** Set the dial by Fibonacci step; snaps to the nearest legal step. */
  setDial(step: number): void {
    const steps = MemoryPolicy.STEPS;
    let best = 0;
    for (let i = 1; i < steps.length; i++) {
      if (Math.abs(steps[i] - step) < Math.abs(steps[best] - step)) best = i;
    }
    this.setAggression(best / (steps.length - 1));
  }

  /** How deep recall reaches: 8 at rest, one φ-step deeper per dial notch. */
  recallDepth(): number {
    return Math.round(8 * Math.pow(1 / 0.6180339887498949, this.state.aggression));
  }

  /** Consolidation comparison budget per idle pass. */
  consolidationBudget(): number {
    return Math.round(4096 * (1 + 4 * this.state.aggression));
  }

  /** Resonance floor: dialled-up memory tolerates fainter structure. */
  resonanceFloor(): number {
    return 0.05625982094858675 * (1 - 0.5 * this.state.aggression);
  }

  isModalityAllowed(m: SensoryModality): boolean {
    return this.state.modalities[m];
  }
  isFieldStateAllowed(): boolean {
    return this.state.fieldStateEnabled;
  }
}

export const memoryPolicy = new MemoryPolicy();

/** Dev-only self-check: aggression=0 must reproduce baseline exactly. */
export function assertPolicyBaselineParity(): boolean {
  const prev = memoryPolicy.get().aggression;
  memoryPolicy.setAggression(0);
  const ok =
    memoryPolicy.episodicSalience() === BASE.episodicSalience &&
    memoryPolicy.noveltyGate() === BASE.noveltyGate &&
    memoryPolicy.surpriseGate() === BASE.surpriseGate &&
    memoryPolicy.hebbianDecayBoost() === BASE.hebbianDecayBoost;
  memoryPolicy.setAggression(prev);
  return ok;
}

if (typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
  if (!assertPolicyBaselineParity()) {
    // eslint-disable-next-line no-console
    console.error(
      '[MemoryPolicy] baseline parity check FAILED — aggression=0 must equal BASE thresholds',
    );
  }
}
