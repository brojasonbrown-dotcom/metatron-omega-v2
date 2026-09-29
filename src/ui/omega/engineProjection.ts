/**
 * Ω-WAKE S1 — one truth for engine state.
 *
 * The chat snapshot (`buildEngineSnapshot`) reads the legacy `EngineCtx`, while
 * the real engine lives in the Ω worker. Before this module the two channels
 * disagreed: the registry saw a live worker, the snapshot reported
 * `running=false, tick=0, field.state="fallback"`.
 *
 * This is the pure projection Ω snapshot → legacy engine fields. It invents
 * nothing: anything the Ω host does not measure stays `null`, so the model can
 * still say "I don't have that" honestly.
 */

import type { HostSnapshot } from '@/core/omega/omegaProtocol';
import type { EngineCapabilities } from '@/core/bus/protocol';
import type { ConnectionState } from '@/core/bus/EngineBus';
import { PHI_INV, OMEGA_C } from '@/core/constants/WolframVerified';

export interface EngineProjection {
  running: boolean;
  tick: number;
  fps: number;
  coherence: number;
  energy: number;
  fieldState: ConnectionState | 'fallback';
  fieldCapabilities: EngineCapabilities | null;
  /** The Ω host has no `FieldSnapshot` counterpart — never fabricate one. */
  fieldSnapshot: null;
  /** True while the shim is describing the inert placeholder, not the worker. */
  forcedFallback: boolean;
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/**
 * Project the Ω runtime state onto the legacy engine fields.
 *
 * `snapshot === null` means the worker has never emitted — that is a genuine
 * fallback, and reporting it as such is the honest answer.
 */
export function projectEngineState(
  snapshot: HostSnapshot | null,
  running: boolean,
): EngineProjection {
  if (!snapshot) {
    return {
      running: false,
      tick: 0,
      fps: 0,
      coherence: PHI_INV,
      energy: OMEGA_C,
      fieldState: 'fallback',
      fieldCapabilities: null,
      fieldSnapshot: null,
      forcedFallback: true,
    };
  }

  const live = running || snapshot.running;
  return {
    running: live,
    tick: num(snapshot.tick, 0),
    // The host measures ticks per second directly; that IS the engine's fps.
    fps: num(snapshot.tickRate, 0),
    // Warm-only mean — cold rungs report 0 coherence and must not be averaged
    // in as if they were a measurement.
    coherence: num(snapshot.coherenceWarm, num(snapshot.coherence, PHI_INV)),
    energy: num(snapshot.energy, OMEGA_C),
    // A built host is an open channel even while halted; only "never built"
    // is a fallback.
    fieldState: 'open',
    fieldCapabilities: {
      kind: 'wasm-fallback',
      protocol: 'omega/1',
      version: `${snapshot.profile}:${snapshot.seed}`,
      maxModeByPrecision: { f64: snapshot.rungs.length, f128: 0, dec50: 0 },
      gpu: 'none',
      simd: 'none',
    } as EngineCapabilities,
    fieldSnapshot: null,
    forcedFallback: false,
  };
}
