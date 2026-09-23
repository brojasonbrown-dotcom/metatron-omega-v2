/**
 * Ω-P4 — worker protocol.
 *
 * Structured-clone-safe messages only: no class instances, no functions, no
 * typed-array views into engine-owned buffers. The UI receives values it can
 * render directly, each one traceable to an engine field.
 */

import type {
  SenseView,
  MemoryView,
  MindReport,
  SearchTrace,
  LearnRun,
  TierMap,
  EngineDescription,
  FieldFrame,
  SpectralView,
  RungScanReport,
  WebView,
  FootprintCheck,
  HardwareProbe,
  HostSnapshot,
  ProfileId,
  ProfileVerdict,
} from "@metatron/trnn-core";

export interface WireVerdict {
  selected: ProfileId;
  targetHz: number;
  headroom: number;
  maxHz: number;
  degraded: boolean;
  memoryConstrained: boolean;
  table: ProfileVerdict[];
}

export interface WireProfile {
  id: ProfileId;
  tier: number;
  rungs: number;
  modes: number;
  note: string;
  /** Nodes carried by each rung, rank 0 → rungs-1 (Fibonacci by law). */
  nodes: number[];
  /** Σ nodes across the ladder — the substrate's true node count. */
  totalNodes: number;
  /** Bytes the build allocates (typed arrays), from the exact cost model. */
  bytes: number;
}

export type OmegaCommand =
  | { type: "probe"; targetHz?: number }
  | { type: "build"; profile: ProfileId; seed?: string }
  | { type: "start" }
  | { type: "stop" }
  | { type: "setHz"; hz: number }
  | { type: "checkpoint" }
  | { type: "describe" }
  | { type: "field"; rank: number; maxSamples?: number }
  | { type: "web"; tail?: number }
  | { type: "spectral"; rank: number }
  | { type: "scan"; rank: number }
  | { type: "sense" }
  | { type: "memory" }
  | { type: "mind" }
  | { type: "reflect"; k?: number }
  | { type: "learn"; iterations?: number; nodes?: number }
  | { type: "tiers"; sidecarUrl?: string; hostedUrl?: string }
  | { type: "senseDeclare"; id: string; modality: SenseModality; nodes?: number; gain?: number }
  | { type: "sensePush"; id: string; text?: string; data?: number[]; width?: number; height?: number }
  | { type: "senseMute"; id: string }
  | { type: "senseGain"; gain: number }
  | { type: "dispose" };

export type SenseModality = "scalar" | "text" | "grid" | "audio";

export type OmegaEvent =
  | { type: "probed"; probe: HardwareProbe; verdict: WireVerdict; profiles: WireProfile[] }
  | { type: "built"; profile: ProfileId; seed: string; footprint: FootprintCheck; snapshot: HostSnapshot }
  | { type: "snapshot"; snapshot: HostSnapshot }
  | { type: "running"; running: boolean }
  | { type: "checkpointed"; tick: number }
  | { type: "described"; description: EngineDescription }
  | { type: "field"; frame: FieldFrame }
  | { type: "web"; view: WebView }
  | { type: "spectral"; view: SpectralView }
  | { type: "scan"; rank: number; report: RungScanReport | null }
  | { type: "sense"; view: SenseView }
  | { type: "memory"; view: MemoryView }
  | { type: "mind"; report: MindReport }
  | { type: "reflect"; trace: SearchTrace }
  | { type: "learn"; run: LearnRun }
  | { type: "learning"; busy: boolean }
  | { type: "tiers"; map: TierMap }
  | { type: "error"; message: string };

export type {
  HardwareProbe,
  HostSnapshot,
  ProfileId,
  ProfileVerdict,
  FootprintCheck,
  EngineDescription,
  FieldFrame,
  SpectralView,
  RungScanReport,
  WebView,
  SenseView,
  MemoryView,
  MindReport,
  SearchTrace,
  LearnRun,
  TierMap,
};
