/**
 * METATRON V13 — Chat settings store (client-only, localStorage-backed).
 *
 * Single source of truth for per-turn LLM knobs surfaced by the chat
 * settings popover: model, temperature, max agent iterations, tool_choice.
 * ChatTab and KimiTab both read from here so the popover controls a
 * single canonical state; the /api/kimi handler receives temperature +
 * toolChoice on every agentic call.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_MODEL, AVAILABLE_MODEL_IDS, type ChatModel } from "./types";

export type ToolChoice = "auto" | "required" | "none";

export interface ChatSettings {
  model: ChatModel;
  temperature: number;   // 0..2 (Moonshot accepts up to 1; we clamp for kimi)
  maxIterations: number; // agentic loop cap 1..16
  toolChoice: ToolChoice;
}

export const DEFAULT_SETTINGS: ChatSettings = {
  model: DEFAULT_MODEL,
  temperature: 0.6,
  maxIterations: 8,
  toolChoice: "auto",
};

const LS_KEY = "metatron.v13.chatSettings.v1";

function read(): ChatSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ChatSettings>;
    const model = typeof parsed.model === "string" && AVAILABLE_MODEL_IDS.has(parsed.model)
      ? parsed.model
      : DEFAULT_SETTINGS.model;
    return {
      model,
      temperature: clampNum(parsed.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
      maxIterations: Math.round(clampNum(parsed.maxIterations, 1, 16, DEFAULT_SETTINGS.maxIterations)),
      toolChoice: parsed.toolChoice === "required" || parsed.toolChoice === "none" ? parsed.toolChoice : "auto",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : NaN;
  if (Number.isNaN(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

let state: ChatSettings = read();
const listeners = new Set<() => void>();

function emit() { listeners.forEach((fn) => fn()); }
function persist() {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* quota */ }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === LS_KEY) { state = read(); emit(); }
  });
}

export function getChatSettings(): ChatSettings { return state; }
export function setChatSettings(patch: Partial<ChatSettings>) {
  state = {
    ...state,
    ...patch,
    temperature: patch.temperature != null ? clampNum(patch.temperature, 0, 2, state.temperature) : state.temperature,
    maxIterations: patch.maxIterations != null
      ? Math.round(clampNum(patch.maxIterations, 1, 16, state.maxIterations))
      : state.maxIterations,
  };
  persist(); emit();
}
export function resetChatSettings() {
  state = DEFAULT_SETTINGS;
  persist(); emit();
}

export function useChatSettings(): ChatSettings {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => state,
    () => state,
  );
}
