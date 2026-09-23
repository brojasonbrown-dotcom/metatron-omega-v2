/**
 * Ω-ACTIVATE Layer A — the sensory drive edge.
 *
 * Before this module nothing ever called `SensoryGateway.ingest()`. The whole
 * downstream chain was live and correct — `tickMemory` already runs
 * `consumeAllForMemory() → injectPsiFused() → percepts.upsert() → bind()` —
 * but with no producer the percept registry, the vision field, the cross-modal
 * binding and the arousal scalar were structurally complete and permanently
 * zero.
 *
 * This driver owns the producer side, and nothing else:
 *
 *   A2  IMUFrontend      (377 Hz) ─┐
 *   A3  AudioFrontend    (233 Hz) ─┼─▶ gateway.ingest(feature, modality, tick)
 *   A4  Video/Screen     ( 89 Hz) ─┤       (A5: video decode + cortex already
 *   A4  VisionEmbed      (φ-slow) ─┘        run inside sensoryFrame.worker)
 *
 * Design rules:
 *   • Every channel is opt-in. Nothing is enabled implicitly, no permission is
 *     requested until the operator asks for that specific channel.
 *   • A build with zero devices attached behaves exactly as before: the driver
 *     starts, publishes an all-idle snapshot, and never touches the gateway.
 *   • The tick reference is shared: one clock, read from the live Ω snapshot,
 *     so every atom is stamped with the engine tick that was current when the
 *     frame was sensed.
 *   • Nothing raw is retained. Audio becomes mel/MFCC/chroma bands, video
 *     becomes a 32×32 luma-derived cortex feature plus an embedding, IMU
 *     becomes a 14-dim kinematic feature. Only derived atoms enter the gateway.
 */

import { getOmegaRuntime, type OmegaState } from './omegaRuntime';
import { getMemoryRuntime } from './memoryRuntime';
import type { SensoryGateway } from '@/core/sensory/SensoryGateway';

export type SensoryChannelId = 'imu' | 'audio' | 'camera' | 'screen' | 'vision';

export type ChannelState = 'idle' | 'starting' | 'live' | 'error' | 'unsupported';

export interface ChannelSnapshot {
  id: SensoryChannelId;
  /** Human label for the deck. */
  label: string;
  /** Nominal feature rate of this channel, Hz. */
  nominalHz: number;
  state: ChannelState;
  /** Last error message, if the channel refused or died. */
  error: string | null;
  /** Atoms attributable to this channel's modality (from the gateway). */
  atoms: number;
  /** Channel this one requires to be live first, if any. */
  requires: SensoryChannelId | null;
}

export interface SensorySnapshot {
  version: number;
  /** Engine tick the frames are being stamped with. */
  tick: number;
  channels: ChannelSnapshot[];
  /** Any channel live at all. */
  anyLive: boolean;
  /** Total ingests the driver has caused since start. */
  totalIngests: number;
  atoms: number;
  uniqueRatio: number;
  /** Live arousal from the last cortex event, or null when nothing sensed yet. */
  arousal: number | null;
}

interface ChannelSpec {
  id: SensoryChannelId;
  label: string;
  nominalHz: number;
  modality: 'imu' | 'audio' | 'video' | 'vision-embed';
  requires: SensoryChannelId | null;
}

/**
 * The channel table. Pure data, exported so the gate battery can assert the
 * dependency graph without touching any browser API.
 */
export const CHANNEL_SPECS: readonly ChannelSpec[] = [
  { id: 'imu', label: 'Inertial (device motion)', nominalHz: 377, modality: 'imu', requires: null },
  { id: 'audio', label: 'Audio (mel · MFCC · chroma)', nominalHz: 233, modality: 'audio', requires: null },
  { id: 'camera', label: 'Camera (video cortex)', nominalHz: 89, modality: 'video', requires: null },
  { id: 'screen', label: 'Screen (video cortex)', nominalHz: 89, modality: 'video', requires: null },
  { id: 'vision', label: 'Vision embedding (semantic)', nominalHz: 21, modality: 'vision-embed', requires: 'camera' },
] as const;

export function specFor(id: SensoryChannelId): ChannelSpec {
  const s = CHANNEL_SPECS.find((c) => c.id === id);
  if (!s) throw new Error(`sensory: unknown channel ${id}`);
  return s;
}

/**
 * Resolve whether a channel may be enabled right now.
 * Pure — takes the current live set, returns either ok or the reason it can't.
 */
export function canEnable(
  id: SensoryChannelId,
  live: ReadonlySet<SensoryChannelId>,
): { ok: true } | { ok: false; reason: string } {
  const spec = specFor(id);
  if (live.has(id)) return { ok: false, reason: `${id}: already live` };
  if (spec.requires && !live.has(spec.requires)) {
    return { ok: false, reason: `${id}: requires ${spec.requires} to be live first` };
  }
  return { ok: true };
}

/** Channels that must be torn down when `id` stops (dependents first). */
export function dependentsOf(id: SensoryChannelId): SensoryChannelId[] {
  return CHANNEL_SPECS.filter((c) => c.requires === id).map((c) => c.id);
}

type AnyFrontend = {
  isRunning(): boolean;
  setTickRef(ref: { v: number }): void;
  stop(): void;
};

class SensoryDriver {
  private unsub: (() => void) | null = null;
  private readonly tickRef = { v: 0 };
  private readonly states = new Map<SensoryChannelId, ChannelState>();
  private readonly errors = new Map<SensoryChannelId, string | null>();
  private readonly frontends = new Map<SensoryChannelId, AnyFrontend>();
  private listeners = new Set<() => void>();
  private snapshot: SensorySnapshot;
  private version = 0;
  private started = false;

  constructor() {
    for (const c of CHANNEL_SPECS) {
      this.states.set(c.id, 'idle');
      this.errors.set(c.id, null);
    }
    this.snapshot = this.build();
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  /** Attach the shared tick clock. Enables nothing; requests no permission. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const omega = getOmegaRuntime();
    this.unsub = omega.subscribe((s: OmegaState) => {
      const t = s.snapshot?.tick;
      if (typeof t === 'number' && Number.isFinite(t)) this.tickRef.v = t;
    });
    const t0 = omega.get().snapshot?.tick;
    if (typeof t0 === 'number' && Number.isFinite(t0)) this.tickRef.v = t0;
    this.publish();
  }

  /** Stop every channel and detach the clock. */
  stop(): void {
    for (const id of [...this.frontends.keys()]) this.disable(id);
    this.unsub?.();
    this.unsub = null;
    this.started = false;
    this.publish();
  }

  // ── external store ─────────────────────────────────────────────────────

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };

  getSnapshot = (): SensorySnapshot => this.snapshot;

  // ── channels ───────────────────────────────────────────────────────────

  isLive(id: SensoryChannelId): boolean {
    return this.states.get(id) === 'live';
  }

  private liveSet(): Set<SensoryChannelId> {
    const s = new Set<SensoryChannelId>();
    for (const c of CHANNEL_SPECS) if (this.isLive(c.id)) s.add(c.id);
    return s;
  }

  private gateway(): SensoryGateway {
    return getMemoryRuntime().store.sensory;
  }

  /**
   * Enable one channel. Resolves true on success; on any refusal the channel
   * lands in `error` with the reason and the rest of the driver is untouched.
   */
  async enable(id: SensoryChannelId): Promise<boolean> {
    if (typeof window === 'undefined') {
      this.setState(id, 'unsupported', 'browser only');
      return false;
    }
    if (!this.started) this.start();
    const gate = canEnable(id, this.liveSet());
    if (!gate.ok) {
      this.fail(id, gate.reason);
      return false;
    }
    this.setState(id, 'starting', null);
    try {
      const fe = await this.spawn(id);
      fe.setTickRef(this.tickRef);
      this.frontends.set(id, fe);
      this.setState(id, 'live', null);
      return true;
    } catch (err) {
      this.fail(id, err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  /** Stop one channel and everything that depends on it. */
  disable(id: SensoryChannelId): void {
    for (const dep of dependentsOf(id)) {
      if (this.frontends.has(dep)) this.disable(dep);
    }
    const fe = this.frontends.get(id);
    if (fe) {
      try { fe.stop(); } catch { /* teardown must never throw upward */ }
      this.frontends.delete(id);
    }
    this.setState(id, 'idle', null);
  }

  /** Convenience for the deck's per-channel switch. */
  async toggle(id: SensoryChannelId): Promise<void> {
    if (this.isLive(id) || this.states.get(id) === 'starting') this.disable(id);
    else await this.enable(id);
  }

  private async spawn(id: SensoryChannelId): Promise<AnyFrontend> {
    const gateway = this.gateway();
    switch (id) {
      case 'imu': {
        const { IMUFrontend } = await import('@/core/sensory/IMUFrontend');
        const fe = new IMUFrontend();
        fe.setTickRef(this.tickRef);
        await fe.enable(gateway);
        return fe as unknown as AnyFrontend;
      }
      case 'audio': {
        const { AudioFrontend } = await import('@/core/sensory/AudioFrontend');
        const fe = new AudioFrontend();
        fe.setTickRef(this.tickRef);
        await fe.enable(gateway);
        return fe;
      }
      case 'camera': {
        const { VideoFrontend } = await import('@/core/sensory/VideoFrontend');
        const fe = new VideoFrontend();
        fe.setTickRef(this.tickRef);
        await fe.enable(gateway);
        return fe;
      }
      case 'screen': {
        const { ScreenFrontend } = await import('@/core/sensory/ScreenFrontend');
        const fe = new ScreenFrontend();
        fe.setTickRef(this.tickRef);
        await fe.enable(gateway);
        return fe;
      }
      case 'vision': {
        const { VisionEmbedFrontend } = await import('@/core/sensory/VisionEmbedFrontend');
        const cam = this.frontends.get('camera');
        if (!cam) throw new Error('vision: camera channel is not live');
        const fe = new VisionEmbedFrontend();
        fe.setTickRef(this.tickRef);
        const { VideoFrontend } = await import('@/core/sensory/VideoFrontend');
        if (!(cam instanceof VideoFrontend)) throw new Error('vision: camera source unavailable');
        await fe.enable(cam, gateway);
        return fe;
      }
    }
  }

  // ── snapshot ───────────────────────────────────────────────────────────

  private setState(id: SensoryChannelId, state: ChannelState, error: string | null): void {
    this.states.set(id, state);
    this.errors.set(id, error);
    this.publish();
  }

  private fail(id: SensoryChannelId, reason: string): void {
    this.setState(id, 'error', reason);
  }

  /** Recompute the published snapshot from live gateway stats. */
  refresh(): void {
    this.publish();
  }

  private build(): SensorySnapshot {
    let atoms = 0;
    let totalIngests = 0;
    let uniqueRatio = 0;
    let arousal: number | null = null;
    let perModality: Record<string, number> = {};
    try {
      const g = this.gateway();
      const st = g.stats();
      atoms = st.atoms;
      totalIngests = st.totalIngests;
      uniqueRatio = st.uniqueRatio;
      perModality = st.perModality as unknown as Record<string, number>;
      const a = g.peekLastInjection()?.cortex.arousal;
      arousal = typeof a === 'number' && Number.isFinite(a) ? a : null;
    } catch {
      // Memory runtime not constructed yet (SSR / early boot): stay all-zero.
    }
    const channels: ChannelSnapshot[] = CHANNEL_SPECS.map((c) => ({
      id: c.id,
      label: c.label,
      nominalHz: c.nominalHz,
      state: this.states.get(c.id) ?? 'idle',
      error: this.errors.get(c.id) ?? null,
      atoms: perModality[c.modality] ?? 0,
      requires: c.requires,
    }));
    return {
      version: ++this.version,
      tick: this.tickRef.v,
      channels,
      anyLive: channels.some((c) => c.state === 'live'),
      totalIngests,
      atoms,
      uniqueRatio,
      arousal,
    };
  }

  private publish(): void {
    this.snapshot = this.build();
    for (const fn of this.listeners) fn();
  }
}

let singleton: SensoryDriver | null = null;

export function getSensoryDriver(): SensoryDriver {
  if (!singleton) singleton = new SensoryDriver();
  return singleton;
}

export type { SensoryDriver };
