/**
 * METATRON V13 — Chat client (SSE streaming + tool dispatch + Kimi).
 * Browser-only. Uses fetch directly (server routes are same-origin).
 *
 * Routing: any model whose id begins with "moonshot/" is dispatched to the
 * agentic Kimi loop (/api/kimi). Everything else streams through /api/chat.
 * That collapses the prior dual "Conversation/Technical mode" UX into a
 * single send() — see ToolsPanel.tsx.
 */
import { useServerFn } from "@tanstack/react-start";
import { dispatchTool } from "./tools/dispatch.functions";
import { parseToolMarkers } from "./toolMarkers";
import type { ChatMessage, ChatModel, EngineSnapshot, ToolResult } from "./types";
import type { MemoryPack } from "./memoryPack";
import type { SelfPack } from "./selfPack";

export function isAgenticModel(model: ChatModel): boolean {
  // Both Moonshot/Kimi and OpenAI GPT-5 series route through /api/kimi so
  // tool loops execute natively against the correct provider API key.
  return (
    model.startsWith("moonshot/") ||
    /^openai\/gpt-5/.test(model) ||
    /^google\/gemini-3\.(1|6)/.test(model)
  );
}


export interface StreamArgs {
  messages: ChatMessage[];
  model: ChatModel;
  snapshot: EngineSnapshot;
  onDelta: (chunk: string) => void;
  signal?: AbortSignal;
  /** on-device memory working set recalled before the turn */
  memory?: MemoryPack | null;
  /** on-device self registry measured before the turn */
  self?: SelfPack | null;
}

export async function streamChat(args: StreamArgs): Promise<{ full: string }> {
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: args.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })),
      model: args.model,
      snapshot: args.snapshot,
      memory: args.memory ?? null,
      self: args.self ?? null,
    }),
    signal: args.signal,
  });
  if (!resp.ok || !resp.body) {
    let err = "chat error";
    try { err = (await resp.json()).error ?? err; } catch { /* ignore */ }
    throw new Error(err);
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  let done = false;
  while (!done) {
    const { done: d, value } = await reader.read();
    if (d) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      let line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.startsWith("data: ")) continue;
      const json = line.slice(6).trim();
      if (json === "[DONE]") { done = true; break; }
      try {
        const parsed = JSON.parse(json);
        const c = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (c) { full += c; args.onDelta(c); }
      } catch {
        // partial JSON spans chunks; put back and wait
        buf = line + "\n" + buf;
        break;
      }
    }
  }
  return { full };
}

export interface KimiTraceStep {
  iteration: number;
  thought?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  latencyMs?: number;
  error?: string;
}
export interface KimiRunResult {
  iterations: number;
  toolCalls: number;
  finalAnswer: string | null;
  trace: KimiTraceStep[];
  error?: string;
}

export interface KimiOptions {
  maxIterations?: number;
  disabledTools?: string[];
  temperature?: number;
  toolChoice?: "auto" | "required" | "none";
  /** on-device memory working set recalled before the turn */
  memory?: MemoryPack | null;
  /** on-device self registry measured before the turn */
  self?: SelfPack | null;
}

export async function runKimi(
  goal: string,
  snapshot: EngineSnapshot,
  model: ChatModel = "google/gemini-3.6-flash",
  options: KimiOptions = {},
): Promise<KimiRunResult> {
  const resp = await fetch("/api/kimi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal,
      snapshot,
      model,
      maxIterations: options.maxIterations ?? 8,
      disabledTools: options.disabledTools ?? [],
      temperature: options.temperature,
      toolChoice: options.toolChoice,
      memory: options.memory ?? null,
      self: options.self ?? null,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    let msg = `Kimi request failed (${resp.status})`;
    try {
      const j = JSON.parse(txt) as { error?: string; detail?: string };
      msg = j.error ?? j.detail ?? msg;
    } catch {
      if (txt) msg = txt.slice(0, 400);
    }
    return {
      iterations: 0,
      toolCalls: 0,
      finalAnswer: null,
      trace: [{ iteration: 1, error: msg }],
      error: msg,
    };
  }
  const result = await resp.json() as KimiRunResult;
  // Upstream returned 200 but the loop itself failed (e.g. Kimi 400/429 inside a trace step).
  if (!result.finalAnswer && !result.error) {
    const lastErr = [...(result.trace ?? [])].reverse().find((s) => s.error)?.error;
    if (lastErr) result.error = lastErr;
  }
  return result;
}


export { parseToolMarkers };

/** Hook returning a thin client wrapper around the dispatch server fn.
 *  Forwards optional `enabled` flag so disabled tools short-circuit server-side. */
export function useToolDispatch() {
  return useServerFn(dispatchTool) as (input: {
    data: { name: string; args?: Record<string, unknown>; enabled?: boolean };
  }) => Promise<ToolResult>;
}
