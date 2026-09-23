/**
 * Ω-P4 — client-side runtime handle.
 *
 * A single lazily-created worker, a versioned immutable state object, and a
 * plain subscribe API. React never sits on the tick path: the worker emits at
 * its own adaptive bus rate and each event replaces the state object once.
 */

import type {
  SenseView,
  MemoryView,
  MindReport,
  SearchTrace,
  LearnRun,
  TierMap,
  SenseModality,
  EngineDescription,
  FieldFrame,
  SpectralView,
  RungScanReport,
  WebView,
  HardwareProbe,
  HostSnapshot,
  OmegaCommand,
  OmegaEvent,
  ProfileId,
  WireProfile,
  WireVerdict,
} from "@/core/omega/omegaProtocol";

export interface OmegaState {
  supported: boolean;
  status: string;
  error: string | null;
  probing: boolean;
  probe: HardwareProbe | null;
  verdict: WireVerdict | null;
  profiles: WireProfile[];
  profile: ProfileId | null;
  seed: string;
  running: boolean;
  snapshot: HostSnapshot | null;
  footprintRatio: number | null;
  lastCheckpoint: number | null;
  /** Static topology, pushed by the worker on every build. */
  description: EngineDescription | null;
  /** Latest pulled field frame (FIELD deck), null until requested. */
  frame: FieldFrame | null;
  /** Latest pulled ledger view (WEB deck). */
  web: WebView | null;
  /** Latest measured spectral report (SPECTRAL deck). */
  spectral: SpectralView | null;
  /** Latest six-section toroid scan (TOROID deck). */
  scan: RungScanReport | null;
  /** Ω-P6 sensory plane view (SENSE deck). */
  sense: SenseView | null;
  /** Ω-P6 braid memory view (SENSE deck). */
  braid: MemoryView | null;
  /** Ω-P7 cognition report (MIND deck). */
  mind: MindReport | null;
  /** Nearest concepts to the live observation (MIND deck). */
  reflection: SearchTrace | null;
  /** Ω-P8 held-out battery result (LEARN deck). */
  learn: LearnRun | null;
  /** True while the battery is running — the tick loop is paused. */
  learning: boolean;
  /** Ω-P8 measured execution tiers (LEARN deck). */
  tiers: TierMap | null;
  version: number;
}

type Listener = (s: OmegaState) => void;

const initial: OmegaState = {
  supported: typeof Worker !== "undefined",
  status: "IDLE — no engine built",
  error: null,
  probing: false,
  probe: null,
  verdict: null,
  profiles: [],
  profile: null,
  seed: "metatron-omega",
  running: false,
  snapshot: null,
  footprintRatio: null,
  lastCheckpoint: null,
  description: null,
  frame: null,
  web: null,
  spectral: null,
  scan: null,
  sense: null,
  braid: null,
  mind: null,
  reflection: null,
  learn: null,
  learning: false,
  tiers: null,
  version: 0,
};

class OmegaRuntime {
  private state: OmegaState = initial;
  private listeners = new Set<Listener>();
  private worker: Worker | null = null;

  get(): OmegaState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<OmegaState>): void {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
    for (const l of this.listeners) l(this.state);
  }

  private ensureWorker(): Worker | null {
    if (typeof Worker === "undefined") return null;
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("@/core/omega/omega.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (ev: MessageEvent<OmegaEvent>) => this.onEvent(ev.data);
    this.worker.onerror = (e) =>
      this.set({ error: e.message || "worker failed", status: "ERROR" });
    return this.worker;
  }

  private send(cmd: OmegaCommand): void {
    this.ensureWorker()?.postMessage(cmd);
  }

  private onEvent(e: OmegaEvent): void {
    switch (e.type) {
      case "probed":
        this.set({
          probing: false,
          probe: e.probe,
          verdict: e.verdict,
          profiles: e.profiles,
          status: `PROBED — governor selects ${e.verdict.selected}${e.verdict.degraded ? " (degraded)" : ""}`,
        });
        break;
      case "built":
        this.set({
          profile: e.profile,
          seed: e.seed,
          snapshot: e.snapshot,
          footprintRatio: e.footprint.ratio,
          status: `BUILT — ${e.profile} · ${e.snapshot.totalNodes} nodes`,
        });
        break;
      case "snapshot":
        this.set({ snapshot: e.snapshot, running: e.snapshot.running });
        break;
      case "running":
        this.set({ running: e.running, status: e.running ? "RUNNING" : "HALTED" });
        break;
      case "checkpointed":
        this.set({ lastCheckpoint: e.tick });
        break;
      case "described":
        this.set({ description: e.description });
        break;
      case "field":
        this.set({ frame: e.frame });
        break;
      case "web":
        this.set({ web: e.view });
        break;
      case "scan":
        this.set({ scan: e.report });
        break;
      case "spectral":
        this.set({ spectral: e.view });
        break;
      case "sense":
        this.set({ sense: e.view });
        break;
      case "memory":
        this.set({ braid: e.view });
        break;
      case "mind":
        this.set({ mind: e.report });
        break;
      case "reflect":
        this.set({ reflection: e.trace });
        break;
      case "learn":
        this.set({ learn: e.run });
        break;
      case "learning":
        this.set({ learning: e.busy });
        break;
      case "tiers":
        this.set({ tiers: e.map });
        break;
      case "error":
        this.set({ error: e.message, status: "ERROR" });
        break;
    }
  }

  probe(targetHz = 64): void {
    this.set({ probing: true, error: null, status: "PROBING — timing the real engine" });
    this.send({ type: "probe", targetHz });
  }

  build(profile: ProfileId, seed = this.state.seed): void {
    this.set({ status: `BUILDING ${profile}…`, error: null });
    this.send({ type: "build", profile, seed });
  }

  start(): void {
    this.send({ type: "start" });
  }

  stop(): void {
    this.send({ type: "stop" });
  }

  setHz(hz: number): void {
    this.send({ type: "setHz", hz });
  }

  checkpoint(): void {
    this.send({ type: "checkpoint" });
  }

  describe(): void {
    this.send({ type: "describe" });
  }

  requestField(rank: number, maxSamples = 610): void {
    this.send({ type: "field", rank, maxSamples });
  }

  requestWeb(tail = 24): void {
    this.send({ type: "web", tail });
  }

  requestSpectral(rank: number): void {
    this.send({ type: "spectral", rank });
  }

  /** N1 — pull the six-section sensory scan of one toroid. */
  requestScan(rank: number): void {
    this.send({ type: "scan", rank });
  }

  requestSense(): void {
    this.send({ type: "sense" });
  }

  requestBraid(): void {
    this.send({ type: "memory" });
  }

  requestMind(): void {
    this.send({ type: "mind" });
  }

  requestReflection(k = 5): void {
    this.send({ type: "reflect", k });
  }

  runBattery(iterations?: number, nodes?: number): void {
    this.set({ learning: true, error: null });
    this.send({ type: "learn", iterations, nodes });
  }

  probeTiers(sidecarUrl?: string, hostedUrl?: string): void {
    this.send({ type: "tiers", sidecarUrl, hostedUrl });
  }

  declareChannel(id: string, modality: SenseModality, nodes?: number, gain = 1): void {
    this.send({ type: "senseDeclare", id, modality, nodes, gain });
  }

  pushText(id: string, text: string): void {
    this.send({ type: "sensePush", id, text });
  }

  pushScalars(id: string, data: number[]): void {
    this.send({ type: "sensePush", id, data });
  }

  muteChannel(id: string): void {
    this.send({ type: "senseMute", id });
  }

  setSenseGain(gain: number): void {
    this.send({ type: "senseGain", gain });
  }

  dispose(): void {
    this.send({ type: "dispose" });
    this.worker?.terminate();
    this.worker = null;
    this.set({ running: false, status: "DISPOSED" });
  }
}

let singleton: OmegaRuntime | null = null;

export function getOmegaRuntime(): OmegaRuntime {
  if (!singleton) singleton = new OmegaRuntime();
  return singleton;
}

export type { OmegaRuntime };
