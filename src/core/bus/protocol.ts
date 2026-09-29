/**
 * METATRON V11 — ENGINE BUS PROTOCOL
 * ===================================
 *
 * Shared TypeScript contract between the web client (this repo) and the
 * native Rust engine daemon (sibling repo, Phase 2b+). Mirrors what the
 * Rust `bus` crate will emit/consume. Single source of truth for both
 * sides — when the Rust side ships, this file is regenerated from the
 * Rust types via a one-shot `ts-rs` export and diffed.
 *
 * Transport: WebSocket at ws://127.0.0.1:7777 by default.
 * Wire format: length-prefixed JSON-RPC 2.0.
 *
 * No mock numerics. All snapshots reflect actual engine state — the
 * fallback engine is honest about its M ceiling and labels itself.
 */

export const ENGINE_WS_DEFAULT_URL = 'ws://127.0.0.1:7777';
export const PROTOCOL_VERSION = '11.1.0';

// ───────────────────────── Engine identity ─────────────────────────

export type PrecisionMode = 'f64' | 'f128' | 'dec50';
export type EngineKind = 'native' | 'wasm-fallback' | 'offline';

export interface EngineCapabilities {
  /** Engine implementation kind. */
  readonly kind: EngineKind;
  /** Protocol version the engine speaks. */
  readonly protocol: string;
  /** Engine build version. */
  readonly version: string;
  /** Highest M (φ-mode index) the engine will attempt at each precision. */
  readonly maxModeByPrecision: Record<PrecisionMode, number>;
  /** GPU backend if any. */
  readonly gpu: 'none' | 'wgpu' | 'cuda' | 'metal' | 'vulkan';
  /** CPU SIMD set actually used at runtime. */
  readonly simd: 'none' | 'sse2' | 'avx2' | 'avx512' | 'neon' | 'wasm-simd';
  /** Logical CPU count seen by the engine. */
  readonly cpuThreads: number;
  /** Realistic peak ops/s the engine self-benched at startup. */
  readonly peakOpsPerSecond: number;
  /** Whether Wolfram verification is wired in this build. */
  readonly wolframVerified: boolean;
}

// ───────────────────────── Field state snapshots ─────────────────────────

export interface DriverInfo {
  readonly id: string;
  readonly kind: 'empirical' | 'synthetic';
  readonly source: string;
  /** Welford running variance, used by the NodeGrower gate. */
  readonly variance: number;
  /** Mode index this driver currently feeds. */
  readonly modeIndex: number;
}

export interface ScalerSnapshot {
  /** Current φ-mode count actually evaluated this tick (OUTWARD modes only, k=1..M). */
  readonly currentM: number;
  /** Honest ceiling discovered for this device + precision (outward modes only). */
  readonly honestCeiling: number;
  /**
   * Total lattice ceiling including the inward conjugate spiral and the k=0
   * axis: honestCeiling + inwardDepth + 1. The actual evaluated-nodes count
   * (`runtime.nodesTotal`) must satisfy nodesTotal ≤ honestCeilingTotal.
   * Optional for back-compat with old wire snapshots.
   */
  readonly honestCeilingTotal?: number;
  /** [0,1] — how much of the per-tick budget the engine used. */
  readonly utilisation: number;
  /** [0,1] — headroom remaining before ULP collapse. */
  readonly headroom: number;
  /** Promote / hold / demote suggestion from the controller. */
  readonly decision: 'promote' | 'hold' | 'demote';
  /**
   * Which invariant is currently binding the honest ceiling. Additive telemetry
   * so the UI can show *why* the ceiling is where it is instead of hiding it.
   *   ram       — banded-Gram bytes exceed governor.ramBytes
   *   precision — φ⁻ᴹ would fall below ULP at chosen digits (dec50/dec500/f64)
   *   planck    — carrier × φᴹ would exceed Planck ceiling
   *   boot      — cold-start bootMode ceiling (legacy=89, fast=6765) not yet lifted
   *   headroom  — none of the above; ceiling is the aspirational compute cap
   */
  readonly ceilingSource?: 'ram' | 'precision' | 'planck' | 'boot' | 'headroom';
}

export interface QualiaVectorWire {
  readonly C: number;
  readonly N: number;
  readonly S: number;
  readonly V: number;
  readonly I: number;
  /** Golden-delay self-overlap |⟨Ψ(t)|Ψ(t−φτ)⟩|² (V13 self-measurement layer). */
  readonly Cphi?: number;
  /** C_φ ≥ 1/φ² on this tick. */
  readonly ignited?: boolean;
  /** Ignition up-crossings in the rolling window. */
  readonly ignitions?: number;
  /** Ignition up-crossings per tick. */
  readonly ignitionRate?: number;
}

export interface SpiralRangeWire {
  readonly kMin: number;
  readonly kMax: number;
}

export interface RuntimeSnapshot {
  /**
   * OUTWARD field nodes evaluated this tick (k=1..currentM). Aligned with
   * `scaler.currentM` and `scaler.honestCeiling` so the canonical coherence
   * accounting (nodesEvaluated ≤ honestCeiling) holds. The inward conjugate
   * spiral and the k=0 axis are NOT compromised — they are still evaluated
   * every tick and reported separately via `nodesInward`, `nodesAxis`,
   * `nodesTotal`.
   */
  readonly nodesEvaluated: number;
  /** Inward conjugate modes evaluated this tick (k=−inward..−1). */
  readonly nodesInward?: number;
  /** Axis mode evaluated this tick (k=0). */
  readonly nodesAxis?: number;
  /** Total lattice nodes evaluated this tick = nodesEvaluated + nodesAxis + nodesInward. */
  readonly nodesTotal?: number;
  /**
   * V11 native daemon — nodes currently resident in materialized shards
   * (RAM-cached, ready to compute without re-derivation). Always ≥ nodesTotal.
   */
  readonly nodesMaterialized?: number;
  /**
   * V11 native daemon — virtual/addressable bank capacity. Represents the
   * potential lattice the engine can address mathematically, NOT what is
   * computed or in RAM. `Number.POSITIVE_INFINITY` means truly unbounded.
   */
  readonly nodesPotential?: number;
  /** Worker lanes allocated by the current governor settings. */
  readonly activeWorkers: number;
  /** True when real Web Workers (or OS threads in the daemon) executed the shards. */
  readonly workerBacked: boolean;
  /** Deterministic relaxation passes per node per tick. */
  readonly computePressure: number;
  /** Slowest shard wall time for the latest tick. */
  readonly tickMs: number;
  /** Estimated local numeric operations per second for this tick. */
  readonly effectiveOps: number;
  /** Effective ops divided by the startup local hardware self-bench. */
  readonly pressureUtilisation: number;
  /** V11 native daemon — fraction of allocated workers actively busy this tick [0,1]. */
  readonly workerUtilisation?: number;
}

export interface FieldSnapshot {
  /** Wall-clock micros at the time this snapshot was taken. */
  readonly tUs: number;
  /** Coherence C(t) = |⟨Ψ(t)|Ψ(t−φτ)⟩|² . Threshold λ = 1/φ². */
  readonly coherence: number;
  /** Energy proxy ⟨Ψ|Ψ⟩. */
  readonly energy: number;
  /** Ψ_lattice/memory/closure/reflect magnitudes for sanity. */
  readonly term1Magnitude: number;
  readonly term2Magnitude: number;
  readonly term3Magnitude: number;
  /** Ψ_reflect magnitude — added in V11 (Ψ-of-Ψ). Optional for old clients. */
  readonly term4Magnitude?: number;
  readonly precision: PrecisionMode;
  readonly scaler: ScalerSnapshot;
  readonly drivers: ReadonlyArray<DriverInfo>;
  /** True if Ψ_closure flux satisfies the 13-node Metatron boundary. */
  readonly metatronClosed: boolean;
  /** Live qualia vector — added in V11. */
  readonly qualia?: QualiaVectorWire;
  /** Active spiral range — added in V11. */
  readonly spiral?: SpiralRangeWire;
  /** Active carrier in Hz — added in V11. */
  readonly carrierHz?: number;
  /** Active working digits — added in V11. */
  readonly workingDigits?: number;
  /** Live local compute utilization — added in V11 Phase 2c. */
  readonly runtime?: RuntimeSnapshot;
  /** First 22 complex field slots (44 floats), sampled from the live worker amplitudes. */
  readonly pinealAmplitudes?: readonly number[];
  /** EMA-smoothed sustained tick frequency (Hz) — added Phase 2d. */
  readonly sustainedHz?: number;
  /** True when the φ-phase is locked: engine holds M, suppresses auto-promote/demote. */
  readonly phaseLocked?: boolean;
  /** |coherence − Ω_c| where Ω_c = 1/φ² ≈ 0.381966 — distance from crystalline target. */
  readonly phaseDriftResidual?: number;
  /** EMA of phaseDriftResidual — proves whether phase-lock is actually pulling Ω toward Ω_c. */
  readonly phaseDriftEMA?: number;
  /** Wave H2 — live framework chain metrics (F1..F9 chainUp + closure). */
  readonly frameworks?: {
    readonly f1: number;
    readonly f2: number;
    readonly f3: number;
    readonly f4: number;
    readonly f5: number;
    readonly f6: number;
    readonly f7: number;
    readonly f8: number;
    readonly f9: number;
    readonly closure: number;
    readonly opsCount: number;
    readonly elapsedMs: number;
    /** True when the side-band framework worker has not completed recently. */
    readonly stale?: boolean;
    /** Age of the latest completed framework packet. */
    readonly staleMs?: number;
    /** Wave H4 — per-carrier aggregate chainUp lanes (empty when carrier stack OFF). */
    readonly carriers?: readonly number[];
    readonly carrierHz?: readonly number[];
  };
  /**
   * Phase 7 · Step 3 — daemon-side RHUFT-F canonical bank snapshot.
   *
   * Present ONLY when the daemon runs with `FLAG_RHUFTF_DAEMON_BANK` ON
   * *and* the wrapped controller's CANONICAL branch fired this tick.
   * Structurally identical to `CanonicalUpdateSnapshot` in
   * `src/core/runtime/CanonicalUpdateBank.ts` — inlined here so the
   * wire protocol stays standalone (no dependency on runtime types).
   * Old clients ignore this field verbatim (protocol bumped 11.0.0 →
   * 11.1.0 as an ADDITIVE change).
   */
  readonly rhuftf?: {
    readonly tick: number;
    readonly perScale: ReadonlyArray<{
      readonly scale: number;
      readonly name: string;
      readonly admitted: boolean;
      readonly psiDelta: number;
      readonly energyContribution: number;
      readonly gamma: number;
    }>;
    readonly totalEnergyContribution: number;
    readonly deltaEnergy: number;
  };

  /**
   * Crystalline Phase-Lock Loop diagnostics — added Phase 15.
   *
   * The stabiliser is a **pure additive read layer**: it never mutates the
   * wave field or the worker kernel. It publishes the Kuramoto order
   * parameter R computed directly from `pinealAmplitudes`, a Fibonacci-EMA
   * cascade smoothing of `coherence`, and a `crystalLock` boolean that flips
   * true once the stabilised coherence sits inside a φ⁻⁵ band around the
   * active target for `LOCK_HOLD_TICKS` consecutive ticks. Old clients
   * ignore this field verbatim.
   */
  readonly stabilizer?: {
    readonly orderR: number;
    readonly stabilizedCoherence: number;
    readonly target: number;
    readonly targetKind: 'crystalline' | 'golden' | 'unity';
    readonly targetDelta: number;
    readonly crystalLock: boolean;
    readonly lockStreak: number;
    readonly absorbed: number;
  };
}

// ───────────────────────── RPC surface ─────────────────────────

export type RpcMethod =
  | 'engine.hello'
  | 'engine.capabilities'
  | 'field.snapshot'
  | 'field.subscribe'
  | 'field.setPrecision'
  | 'field.setTargetM'
  | 'field.start'
  | 'field.stop'
  | 'verify.identity'
  | 'verify.runAll';

export interface RpcRequest<P = unknown> {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly method: RpcMethod;
  readonly params?: P;
}

export interface RpcSuccess<R = unknown> {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly result: R;
}

export interface RpcError {
  readonly jsonrpc: '2.0';
  readonly id: number;
  readonly error: { readonly code: number; readonly message: string };
}

export type RpcResponse<R = unknown> = RpcSuccess<R> | RpcError;

export interface FieldSubscriptionEvent {
  readonly jsonrpc: '2.0';
  readonly method: 'field.snapshot.event';
  readonly params: FieldSnapshot;
}

export const isRpcError = <R>(r: RpcResponse<R>): r is RpcError =>
  (r as RpcError).error !== undefined;
