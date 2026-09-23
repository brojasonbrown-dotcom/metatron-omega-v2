/**
 * ShadowStateTape — Phase 2 · Step 2.
 *
 * RHUFT-F Layer 1 shadow populator. Owns one `FieldStateN` per scale in the
 * ladder and lets callers push per-tick amplitudes into it. NEVER writes
 * into any live physics buffer; NEVER mutates the kernel's `prev` cache.
 *
 * Guarded by `FLAG_RHUFTF_STATE_TUPLE` (default OFF). When the flag is off:
 *   - `create()` returns a null-object tape whose `ingest()` is a no-op and
 *     `snapshot()` returns an empty array.
 *   - Zero allocations, zero copies on the tick path.
 *
 * Wiring policy: this module is a **utility** used by the metric bank and
 * offline scripts. It does not subscribe to any event bus itself — callers
 * decide when to ingest. Keeps it deterministic across Node + browser.
 */

import type { FieldStateN } from '@metatron/field-kernel-core';
import { createFieldStateN, copyFieldStateN, portFlag } from '@metatron/field-kernel-core';

export interface ScaleShape {
  readonly scale: number;
  readonly nodes: number;
}

export interface TickIngress {
  readonly scale: number;
  /** Live amplitudes for this scale on this tick. Copied — not aliased. */
  readonly amplitudes: Float64Array;
  /** Frozen canonical predictor output (Phase-6 splits this further). */
  readonly psiHat?: Float64Array;
}

export interface ShadowStateTape {
  readonly enabled: boolean;
  ingest(input: TickIngress): void;
  /** Read-only per-scale snapshot for measurement/Lyapunov. */
  snapshot(): readonly FieldStateN[];
  /** Previous-tick snapshot (for inertia / temporal coherence). */
  previousSnapshot(): readonly FieldStateN[];
  advanceTick(): void;
}

class NullTape implements ShadowStateTape {
  readonly enabled = false;
  ingest(): void { /* no-op */ }
  snapshot(): readonly FieldStateN[] { return []; }
  previousSnapshot(): readonly FieldStateN[] { return []; }
  advanceTick(): void { /* no-op */ }
}

class LiveTape implements ShadowStateTape {
  readonly enabled = true;
  private readonly byScale = new Map<number, FieldStateN>();
  private readonly prevByScale = new Map<number, FieldStateN>();

  constructor(shapes: readonly ScaleShape[]) {
    for (const s of shapes) {
      this.byScale.set(s.scale, createFieldStateN(s.scale, s.nodes));
      this.prevByScale.set(s.scale, createFieldStateN(s.scale, s.nodes));
    }
  }

  ingest(input: TickIngress): void {
    const dst = this.byScale.get(input.scale);
    if (!dst) return; // unknown scale; skip silently — never allocate on hot path.
    const amps = input.amplitudes;
    const n = Math.min(dst.psi.length, amps.length);
    // Explicit copy: never alias the kernel's owned buffer.
    for (let i = 0; i < n; i++) dst.psi[i] = amps[i];
    if (input.psiHat) {
      const m = Math.min(dst.psiHat.length, input.psiHat.length);
      for (let i = 0; i < m; i++) dst.psiHat[i] = input.psiHat[i];
    }
  }

  snapshot(): readonly FieldStateN[] {
    return Array.from(this.byScale.values());
  }

  previousSnapshot(): readonly FieldStateN[] {
    return Array.from(this.prevByScale.values());
  }

  advanceTick(): void {
    for (const [scale, curr] of this.byScale) {
      const prev = this.prevByScale.get(scale);
      if (prev) copyFieldStateN(prev, curr);
    }
  }
}

export function createShadowStateTape(shapes: readonly ScaleShape[]): ShadowStateTape {
  if (!portFlag('FLAG_RHUFTF_STATE_TUPLE')) return new NullTape();
  return new LiveTape(shapes);
}

/**
 * Force-enabled variant used by offline scripts (freeze test, cross-runtime
 * parity) that must exercise the tape regardless of environment flags.
 */
export function createShadowStateTapeForced(shapes: readonly ScaleShape[]): ShadowStateTape {
  return new LiveTape(shapes);
}
