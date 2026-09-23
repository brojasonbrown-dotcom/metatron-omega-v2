/**
 * METATRON V11 — Chat module shared types.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  /** Optional structured tool results rendered inline. */
  toolResults?: ToolResult[];
  /** Model that produced this assistant message. */
  model?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /** Unsent composer text, persisted so a reload never drops a typed prompt. */
  draft?: string;
}

// (V13: ChatMode removed — a single agentic contract serves every model.)

/**
 * Model IDs are routed by prefix:
 *   `moonshot/*` → agentic native tool-loop (/api/kimi)
 *   everything else → streaming chat (/api/chat)
 * The Moonshot suffix is passed through to the upstream API unchanged.
 */
export type ChatModel = string;

export const DEFAULT_MODEL: ChatModel = "google/gemini-3.6-flash";

export interface ModelOption {
  id: ChatModel;
  label: string;
  group: "Lovable AI (agentic)" | "Kimi (agentic)" | "OpenAI (agentic)" | "Google" | "OpenAI";
  hint?: string;
}

/** Canonical Moonshot model IDs — verified live from api.moonshot.ai/v1/models. */
export const AVAILABLE_MODELS: ModelOption[] = [
  // ── Lovable AI Gateway (no external key needed · native tool loop) ───────
  { id: "google/gemini-3.6-flash",     label: "Gemini 3.6 Flash",     group: "Lovable AI (agentic)", hint: "Default · fast reasoning + native tools" },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro",     group: "Lovable AI (agentic)", hint: "Deepest reasoning" },
  { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", group: "Lovable AI (agentic)", hint: "High-volume / cheapest" },
  // ── Kimi / Moonshot (verified) ───────────────────────────────────────────
  { id: "moonshot/kimi-k3",                          label: "Kimi K3",                    group: "Kimi (agentic)", hint: "Frontier reasoning + native tools · 1M ctx" },
  { id: "moonshot/kimi-k2.7-code",                   label: "Kimi K2.7 Code",             group: "Kimi (agentic)", hint: "Coding-tuned · 256K ctx" },
  { id: "moonshot/kimi-k2.7-code-highspeed",         label: "Kimi K2.7 Code (highspeed)", group: "Kimi (agentic)", hint: "Fast coding endpoint" },
  { id: "moonshot/kimi-k2.6",                        label: "Kimi K2.6",                  group: "Kimi (agentic)" },
  { id: "moonshot/kimi-k2.5",                        label: "Kimi K2.5",                  group: "Kimi (agentic)" },
  { id: "moonshot/moonshot-v1-auto",                 label: "Moonshot V1 (auto route)",   group: "Kimi (agentic)" },
  { id: "moonshot/moonshot-v1-128k",                 label: "Moonshot V1 128k",           group: "Kimi (agentic)" },
  { id: "moonshot/moonshot-v1-32k",                  label: "Moonshot V1 32k",            group: "Kimi (agentic)" },
  { id: "moonshot/moonshot-v1-8k",                   label: "Moonshot V1 8k",             group: "Kimi (agentic)" },
  { id: "moonshot/moonshot-v1-128k-vision-preview",  label: "Moonshot V1 128k Vision",    group: "Kimi (agentic)" },
  { id: "moonshot/moonshot-v1-32k-vision-preview",   label: "Moonshot V1 32k Vision",     group: "Kimi (agentic)" },
  // ── OpenAI direct (agentic tool-loop via OPENAI_API_KEY) ─────────────────
  { id: "openai/gpt-5",       label: "GPT-5",        group: "OpenAI (agentic)", hint: "Direct via OPENAI_API_KEY" },
  { id: "openai/gpt-5-mini",  label: "GPT-5 Mini",   group: "OpenAI (agentic)", hint: "Faster / cheaper tool loops" },
  { id: "openai/gpt-5-nano",  label: "GPT-5 Nano",   group: "OpenAI (agentic)", hint: "High-volume tool calls" },
  // ── Google (streaming, no native tools) ─────────────────────────────────
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash (preview)", group: "Google" },
  { id: "google/gemini-2.5-pro",   label: "Gemini 2.5 Pro",             group: "Google" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash",           group: "Google" },
];

/** Fast membership test — used by chatSettings to purge stale IDs. */
export const AVAILABLE_MODEL_IDS: ReadonlySet<string> = new Set(AVAILABLE_MODELS.map((m) => m.id));


// ─── Engine snapshot fed to the LLM each turn ──────────────────────────────

export interface EngineSnapshot {
  tick: number;
  running: boolean;
  fps: number;
  coherence: number;
  /** Raw driver-coherence slider input (top-level alias of master.driverCoherence). */
  driverInputCoherence?: number;
  energy: number;
  /** UI resolution intent only; not runtime truth. */
  uiControls: {
    requestedResolution: "auto" | number;
  };
  /** Actual native/fallback field engine telemetry from the current tick. */
  field: {
    state: string;
    implementation: string;
    version: string | null;
    protocol: string | null;
    actualNodesEvaluated: number | null;
    /** Inward conjugate modes evaluated this tick (k=−inward..−1). */
    nodesInward: number | null;
    /** Axis mode evaluated this tick (k=0). 1 or 0. */
    nodesAxis: number | null;
    /** Total lattice nodes actually computed this tick (outward + axis + inward). */
    nodesTotal: number | null;
    currentM: number | null;
    honestCeiling: number | null;
    /** Total lattice ceiling (outward + axis + inward) — matches nodesTotal. */
    honestCeilingTotal: number | null;
    activeWorkers: number | null;
    workerBacked: boolean | null;
    computePressure: number | null;
    tickMs: number | null;
    effectiveOps: number | null;
    pressureUtilisation: number | null;
    carrierHz: number | null;
    workingDigits: number | null;
    precision: string | null;
    spiral: { kMin: number; kMax: number } | null;
    runtimeCoherence: number | null;
    runtimeEnergy: number | null;
    driversSample: { id: string; kind: string; source: string; variance: number; modeIndex: number }[];
  };
  /** Additive chapter residuals and per-rung saturation from the real V11 output. */
  residuals: {
    additive: Record<string, number>;
    saturation: {
      framework: string;
      measured: number;
      floor: number;
      saturation: number;
      label: string;
      lambdaSymbol?: string;
      saturationCrossCheck?: number;
      crossCheckResidual?: number;
    }[];
    maxResidual: number;
    okCount: number;
    totalCount: number;
  } | null;
  /** V13 Lyapunov bank — per-rung physical floor + symbolic form + provenance. */
  lyapunovBank?: Record<string, { lambda: number; symbolic: string; source: string }>;
  memory: {
    enabled: boolean;
    status: string;
  };
  /** Wolfram-verified constants the model may cite. */
  constants: {
    phi: number;
    phi_inv: number;
    phi_sq: number;
    psi: number;
    pi: number;
    e: number;
  };
  /** Live framework snapshot (F1..F9 marker values). */
  frameworks: Record<string, { scale: string; chainUpCoupling: number; closureResidual: number; masterMetric: number }>;
  /** Λ stability scalar + 1/φ² floor — explicit so the model never reports Λ as a percentage. */
  stability?: { value: number; floor: number; target: number; band: "green" | "amber" | "red" };
  /**
   * MASTER readings — the *only* numbers the model is allowed to report as
   * "the coherence" / "the stability" / "tools available". Per-rung
   * `frameworks[Fx].masterMetric` is rung-local and must NOT be relabelled
   * as master Ω.
   */
  master?: {
    coherenceOmega: number;
    /**
     * Live Ω-engine warm-field coherence (mean over rungs whose coherence ring
     * has filled). A MEASUREMENT of the running toroidal web — a different axis
     * from the analytic `coherenceOmega`. NaN when nothing is warm yet.
     */
    measuredFieldCoherence: number;
    driverCoherence: number;
    metatronClosure: number;
    torusClosure: number;
    phaseCirculation: number;
    stabilityLambda: number;
    stabilityFloor: number;
    isFullCoherence: boolean;
    f8KappaClosure: number;
    f8BoundaryIndex: number;
    f8SinkCoupling: number;
  };
  /** Tool catalogue size + names. The model MUST cite `tools.available` for any count. */
  tools?: {
    available: number;
    protocol: "markers" | "native" | "none";
    names: string[];
  };
  /** V10-ported Qualia Correlate measurement (Q, Q_inc, Q_stab, Q_res). */
  qualia?: { Q: number; Q_inc: number; Q_stab: number; Q_res: number; N: number; attractorK: number; live: boolean };
  /** Chapter 44 F8 boundary closure — boundaryIndex (≈40), boundaryClosure, sinkCoupling. */
  chapter44?: { boundaryIndex: number; boundaryClosure: number; sinkCoupling: number };
  /** ISO timestamp the snapshot was built. */
  builtAt: string;
}


// ─── Tool call protocol ────────────────────────────────────────────────────

export type JsonValue =
  | string | number | boolean | null
  | JsonValue[]
  | { [k: string]: JsonValue };

export type ToolArgs = Record<string, JsonValue>;

export interface ToolCall {
  name: string;
  args: ToolArgs;
}

export type ToolResult =
  | { ok: true; name: string; args: ToolArgs; data: JsonValue; latencyMs: number }
  | { ok: false; name: string; args: ToolArgs; reason: string; env?: string; latencyMs?: number };
