/**
 * fieldContext — the bridge from live engine telemetry to memory resonance.
 *
 * Recall must be able to ask "is this memory resonant with what the machine is
 * doing RIGHT NOW". That question is only answerable while a field is
 * streaming. When nothing streams, this module returns `undefined` rather than
 * a neutral-looking stand-in: the resonance channel must ABSTAIN, not score.
 *
 * Dominant rung is elected by ENERGY, not by coherence. A dead rung can hold
 * a perfect coherence reading (an all-but-zero field is trivially coherent),
 * so electing on coherence would hand the ladder to silence.
 */

import type { HostSnapshot } from '@metatron/trnn-core';
import type { FieldContext } from '@/core/memory/Resonance';

export interface DominantRung {
  readonly n: number;
  readonly closure: number;
  readonly coherence: number;
  readonly energy: number;
}

/** Rung carrying the most energy; null when nothing is streaming. */
export function dominantRung(snap: HostSnapshot | null | undefined): DominantRung | null {
  if (!snap || !snap.running || !snap.rungs || snap.rungs.length === 0) return null;
  let best: DominantRung | null = null;
  for (const r of snap.rungs) {
    const energy = Number.isFinite(r.energy) ? r.energy : 0;
    if (energy <= 0) continue;
    if (!best || energy > best.energy) {
      best = { n: r.n, closure: r.closureQuality, coherence: r.coherence, energy };
    }
  }
  return best;
}

/**
 * Build the resonance context for the live field.
 * Returns undefined when the engine is not streaming — callers must then run
 * the text-only cascade, which is byte-identical to the pre-resonance ranking.
 */
export function fieldContextFrom(
  snap: HostSnapshot | null | undefined,
  now = Date.now(),
): FieldContext | undefined {
  const rung = dominantRung(snap);
  if (!rung || !snap) return undefined;
  return {
    // Warm-only mean: rungs still filling their coherence ring report 0, and
    // feeding those zeros into resonance ranking biases every score downward.
    coherence: Number.isFinite(snap.coherenceWarm) ? snap.coherenceWarm : NaN,
    closure: Number.isFinite(rung.closure) ? rung.closure : NaN,
    rung: rung.n,
    vector: null, // field↔corpus vector bridge lives in VisionFieldIndex
    now,
  };
}

/** Rung to stamp on newly captured material; -1 when the field is offline. */
export function captureRung(snap: HostSnapshot | null | undefined): number {
  return dominantRung(snap)?.n ?? -1;
}
