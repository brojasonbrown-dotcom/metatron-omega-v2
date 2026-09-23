/**
 * METATRON V11 — Tools Panel.
 *
 * Lives in the lower half of the center column under the FIELD stage.
 * Four sub-tabs:
 *
 *   • CHAT     — streaming LLM chat with tool-marker dispatch (honors prefs).
 *   • KIMI     — Kimi K2 autonomous agent (disabled tools stripped server-side).
 *   • CATALOG  — every wired tool with: enable/disable toggle, auth/health pill,
 *                rolling success-fail stats, category bulk actions, search,
 *                "Try" form per tool.
 *   • RUNS     — in-memory ring buffer of every tool dispatch, filterable by
 *                source and status, with aggregate counters.
 *
 * All four share a single global RunLog so Catalog "Try" calls, Chat tool
 * markers, and Kimi steps all converge into one feed and per-tool stat tally.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useServerFn } from "@tanstack/react-start";
import { useEngineRef } from "../EngineContext";
import { buildEngineSnapshot } from "@/lib/chat/engineSnapshot";

import {
  AVAILABLE_MODELS, DEFAULT_MODEL,
  type ChatMessage, type ChatModel, type ToolResult,
} from "@/lib/chat/types";
import { useChatSettings, setChatSettings } from "@/lib/chat/chatSettings";
import {
  loadSessions, saveSessions, newSession, newMessage, loadActiveId, saveActiveId,
} from "@/lib/chat/sessions";
import { makeDebouncedWriter } from "@/lib/persist/flush";
import {
  streamChat, runKimi, parseToolMarkers, useToolDispatch, isAgenticModel,
  type KimiRunResult,
} from "@/lib/chat/client";
import { TOOL_SPECS, type ToolSpec, toolsByCategory } from "@/lib/chat/tools/registry";
import {
  useToolPrefs, setEnabled, enableAll, disableAll, enableCategory, applyHealthFilter,
} from "@/lib/chat/tools/toolPrefs";
import { probeToolHealth, type ToolHealthEntry } from "@/lib/chat/tools/health.functions";
import { Switch } from "@/components/ui/switch";
import { ChatSettingsPopover } from "./ChatSettingsPopover";
import { isEnabled as ttsEnabled } from "@/lib/tts/kokoroPrefs";
import { buildMemoryPack, reinforceCitations } from "@/ui/omega/memoryBridge";
import { buildSelfPack } from "@/ui/omega/selfRegistry";


type SubTab = "chat" | "kimi" | "catalog" | "runs";

// ─── Global run-log (in-memory ring) ─────────────────────────────────────────
export interface RunRecord {
  id: string;
  ts: number;
  name: string;
  args: Record<string, unknown>;
  source: "chat" | "kimi" | "catalog";
  ok: boolean;
  latencyMs?: number;
  reason?: string;
  preview?: string;
}
const RUN_LOG: RunRecord[] = [];
const RUN_LISTENERS = new Set<() => void>();

function pushRun(r: RunRecord) {
  RUN_LOG.unshift(r);
  if (RUN_LOG.length > 200) RUN_LOG.length = 200;
  RUN_LISTENERS.forEach((fn) => fn());
}
function useRunLog(): RunRecord[] {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    RUN_LISTENERS.add(fn);
    return () => { RUN_LISTENERS.delete(fn); };
  }, []);
  return RUN_LOG;
}

interface ToolStat { runs: number; ok: number; fail: number; lastMs?: number; lastErr?: string }
function useToolStats(): Record<string, ToolStat> {
  const runs = useRunLog();
  return useMemo(() => {
    const out: Record<string, ToolStat> = {};
    for (const r of runs) {
      const s = (out[r.name] ??= { runs: 0, ok: 0, fail: 0 });
      s.runs++; if (r.ok) s.ok++; else { s.fail++; s.lastErr = r.reason; }
      if (s.lastMs == null) s.lastMs = r.latencyMs;
    }
    return out;
  }, [runs]);
}

export function ToolsPanel({ onlyTabs, defaultTab }: { onlyTabs?: SubTab[]; defaultTab?: SubTab } = {}) {
  const visibleTabs = (onlyTabs && onlyTabs.length ? onlyTabs : (["chat","kimi","catalog","runs"] as SubTab[]));
  const [tab, setTab] = useState<SubTab>(defaultTab && visibleTabs.includes(defaultTab) ? defaultTab : visibleTabs[0]);
  const { enabledCount, totalCount } = useToolPrefs();
  const hideBar = visibleTabs.length === 1;
  return (
    <div className="h-full min-h-0 flex flex-col bg-card/40 text-foreground">
      {!hideBar && (
        <div className="shrink-0 h-9 border-b border-border bg-background/40 flex items-stretch">
          {visibleTabs.map((id) => {
            const active = tab === id;
            return (
              <button key={id} onClick={() => setTab(id)}
                className={`px-4 font-display text-[10px] tracking-[0.25em] border-b-2 transition-colors ${
                  active ? "border-primary text-primary bg-primary/5"
                         : "border-transparent text-muted-foreground hover:text-foreground"
                }`}>
                {id.toUpperCase()}
              </button>
            );
          })}
          <div className="flex-1" />
          <div className="px-3 flex items-center text-[10px] font-mono text-muted-foreground tabular-nums">
            {enabledCount}/{totalCount} tools enabled
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "chat" && <ChatTab />}
        {tab === "kimi" && <KimiTab />}
        {tab === "catalog" && <CatalogTab />}
        {tab === "runs" && <RunsTab />}
      </div>
    </div>
  );
}


/* ─────────────────────────── CHAT TAB ─────────────────────────── */

function ChatTab() {
  // Ref access: ChatTab only needs the engine at SEND time. Subscribing via
  // useEngine() re-rendered the entire chat tree (markdown re-parse per
  // message) on every engine tick (~30 Hz) — the single largest render cost
  // when the CHAT tab was open. StatusBanner subscribes independently below.
  const engineRef = useEngineRef();
  const dispatch = useToolDispatch();
  const { isEnabled } = useToolPrefs();

  const [sessions, setSessions] = useState(() => {
    const s = loadSessions();
    return s.length ? s : [newSession()];
  });
  const [activeId, setActiveIdState] = useState(() => {
    const saved = loadActiveId();
    return saved && sessions.some((s) => s.id === saved) ? saved : sessions[0].id;
  });
  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id);
    saveActiveId(id);
  }, []);
  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  const settings = useChatSettings();
  const model = settings.model;
  const setModel = (m: ChatModel) => setChatSettings({ model: m });
  // The composer text lives in the session record, so an unsent prompt
  // survives a reload, a tab switch, and a session switch.
  const input = active.draft ?? "";
  const [streaming, setStreaming] = useState(false);
  const { disabledList } = useToolPrefs();

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Throttled persistence: during streaming, every token delta updates
  // `sessions`; serializing + writing the full session list to localStorage
  // per delta caused main-thread stalls. Persist at most every 400 ms with a
  // trailing flush on unmount and on page hide — no data loss either way.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const writerRef = useRef<{ schedule: () => void; flush: () => void } | null>(null);
  if (writerRef.current === null) {
    writerRef.current = makeDebouncedWriter(() => saveSessions(sessionsRef.current), 400);
  }
  useEffect(() => { writerRef.current?.schedule(); }, [sessions]);
  useEffect(() => () => { writerRef.current?.flush(); }, []);

  const setInput = useCallback((text: string) => {
    setSessions((all) => all.map((s) => (s.id === activeId ? { ...s, draft: text } : s)));
  }, [activeId]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length]);

  const updateActive = useCallback((updater: (m: ChatMessage[]) => ChatMessage[]) => {
    setSessions((all) => all.map((s) => s.id === activeId ? { ...s, messages: updater(s.messages), updatedAt: Date.now() } : s));
  }, [activeId]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const userMsg = newMessage("user", text);
    const assistantMsg = newMessage("assistant", "", model);
    updateActive((ms) => [...ms, userMsg, assistantMsg]);
    setStreaming(true);

    const snapshot = buildEngineSnapshot(engineRef.current, isAgenticModel(model) ? "native" : "markers");
    // Recall the on-device working set BEFORE the turn — the corpus lives in
    // this tab, so the server can only see what we ship with the request.
    const memory = buildMemoryPack(text, {
      context: active.messages.filter((m) => m.role === "user").slice(-2).map((m) => m.content),
      topN: 6,
      poolN: 32,
      snapshot: engineRef.current,
    });

    // Measure the machine's own structure before the turn. This runs the cheap
    // self-tests, so every claim the model makes about its internals is backed
    // by a reading taken this turn rather than by an assumption.
    let self: ReturnType<typeof buildSelfPack> | null = null;
    try { self = buildSelfPack(); }
    catch { self = null; }  // a failed probe must never block the conversation

    abortRef.current = new AbortController();

    try {
      // Kimi is the default path. Agentic models route through the native
      // tool-loop endpoint so tool calls remain auditable. Non-agentic models
      // are kept only as an explicit manual fallback through /api/chat.
      if (isAgenticModel(model)) {
        const r = await runKimi(text, snapshot, model, {
          memory,
          self,
          maxIterations: settings.maxIterations,
          disabledTools: disabledList,
          temperature: settings.temperature,
          toolChoice: settings.toolChoice,
        });

        const finalText = r.finalAnswer
          ?? (r.error ? `*Error: ${r.error}*` : "*(no answer returned)*");
        // Usage feedback: cited chunks reinforce the concept graph.
        if (r.finalAnswer) reinforceCitations(text, r.finalAnswer);
        const toolResults: ToolResult[] = r.trace
          .filter((s) => s.toolName)
          .map((s) => s.error
            ? { ok: false as const, name: s.toolName!, args: (s.toolArgs as Record<string, never>) ?? {}, reason: s.error, latencyMs: s.latencyMs ?? 0 }
            : { ok: true as const, name: s.toolName!, args: (s.toolArgs as Record<string, never>) ?? {}, data: (s.toolResult as never) ?? null, latencyMs: s.latencyMs ?? 0 },
          );
        updateActive((ms) => ms.map((m) => m.id === assistantMsg.id ? { ...m, content: finalText, toolResults } : m));
        if (ttsEnabled()) window.dispatchEvent(new CustomEvent("kokoro:speak", { detail: { text: finalText } }));
        for (const r2 of toolResults) {
          pushRun({
            id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
            ts: Date.now(), name: r2.name, args: r2.args as Record<string, unknown>,
            source: "chat", ok: r2.ok,
            latencyMs: r2.latencyMs,
            reason: r2.ok ? undefined : r2.reason,
            preview: JSON.stringify(r2.ok ? r2.data : r2).slice(0, 300),
          });
        }
      } else {
        let acc = "";
        let flushTimer: number | null = null;
        const flushDelta = () => {
          flushTimer = null;
          const content = acc;
          updateActive((ms) => ms.map((m) => m.id === assistantMsg.id ? { ...m, content } : m));
        };
        try {
          await streamChat({
            messages: [...active.messages, userMsg],
            model, snapshot, memory, self,
            signal: abortRef.current.signal,
            onDelta: (chunk) => {
              acc += chunk;
              if (flushTimer == null) flushTimer = window.setTimeout(flushDelta, 120);
            },
          });
        } finally {
          if (flushTimer != null) window.clearTimeout(flushTimer);
          flushDelta();
        }
        if (ttsEnabled()) window.dispatchEvent(new CustomEvent("kokoro:speak", { detail: { text: acc } }));
        const { calls } = parseToolMarkers(acc);
        if (calls.length) {
          const results: ToolResult[] = [];
          for (const c of calls) {
            const enabled = isEnabled(c.name);
            let r: ToolResult;
            try {
              r = await dispatch({ data: { name: c.name, args: c.args as Record<string, unknown>, enabled } });
            } catch (err) {
              r = {
                ok: false, name: c.name, args: c.args,
                reason: (err as Error).message || "dispatch failed", latencyMs: 0,
              };
            }
            results.push(r);
            pushRun({
              id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
              ts: Date.now(), name: r.name, args: r.args as Record<string, unknown>,
              source: "chat", ok: r.ok,
              latencyMs: r.latencyMs,
              reason: r.ok ? undefined : r.reason,
              preview: JSON.stringify(r.ok ? r.data : r).slice(0, 300),
            });
          }
          updateActive((ms) => ms.map((m) => m.id === assistantMsg.id ? { ...m, toolResults: results } : m));
        }
      }
    } catch (e) {
      updateActive((ms) => ms.map((m) => m.id === assistantMsg.id ? { ...m, content: `*Error: ${(e as Error).message}*` } : m));
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, model, engineRef, active.messages, updateActive, dispatch, isEnabled, disabledList, settings.maxIterations, settings.temperature, settings.toolChoice]);

  const stop = () => abortRef.current?.abort();

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border text-xs">
        <select value={activeId} onChange={(e) => setActiveId(e.target.value)}
          className="bg-background border border-border rounded px-2 py-1">
          {sessions.map((s) => <option key={s.id} value={s.id}>{s.title || "Untitled"}</option>)}
        </select>
        <button className="px-2 py-1 border border-border rounded hover:bg-accent/20"
          onClick={() => { const n = newSession(); setSessions((s) => [n, ...s]); setActiveId(n.id); }}>+ New</button>
        <button className="px-2 py-1 border border-border rounded hover:bg-destructive/30"
          onClick={() => { if (!confirm("Delete this session?")) return;
            setSessions((all) => {
              const filtered = all.filter((s) => s.id !== activeId);
              const next = filtered.length ? filtered : [newSession()];
              setActiveId(next[0].id);
              return next;
            });
          }}>Del</button>
        <div className="flex-1" />
        <span className="text-[10px] font-mono text-muted-foreground" title="Kimi routes through the native tool-loop; other models use streaming markers.">
          {isAgenticModel(model) ? "agentic" : "stream"}
        </span>

      </div>





      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto px-3 py-2 space-y-3">
        {active.messages.length === 0 && (
          <div className="text-xs text-muted-foreground italic">
            Ask Metatron about the engine, or invoke any enabled tool.
          </div>
        )}
        {active.messages.map((m) => <MessageView key={m.id} m={m} />)}
      </div>

      <div className="shrink-0 border-t border-border p-2 flex gap-2 items-end">
        <textarea value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={streaming ? "Streaming..." : "Message Metatron... (Enter to send)"}
          className="flex-1 min-h-[44px] max-h-32 rounded border border-border bg-background px-2 py-1 text-sm font-mono resize-none"
          disabled={streaming} />
        <ChatSettingsPopover />
        {streaming
          ? <button onClick={stop} className="px-3 py-1 border border-destructive text-destructive rounded text-xs hover:bg-destructive/20">Stop</button>
          : <button onClick={send} disabled={!input.trim()} className="px-3 py-1 border border-primary text-primary rounded text-xs hover:bg-primary/20 disabled:opacity-40">Send</button>}
      </div>

    </div>
  );
}

/**
 * Memoized: chat messages are immutable except the one actively streaming
 * (updateActive replaces only that object). Without memo, EVERY message
 * re-parsed its markdown on each ChatTab render — O(history) markdown work
 * per streamed token.
 */
const MessageView = memo(function MessageView({ m }: { m: ChatMessage }) {
  const isUser = m.role === "user";
  return (
    <div className={`rounded border px-3 py-2 ${isUser ? "border-primary/40 bg-primary/5" : "border-border bg-background/50"}`}>
      <div className="text-[10px] font-mono text-muted-foreground mb-1 flex justify-between">
        <span>{isUser ? "USER" : "METATRON"}{m.model ? ` · ${m.model}` : ""}</span>
        <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
      </div>
      <div className="prose prose-sm prose-invert max-w-none text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || "*(thinking...)*"}</ReactMarkdown>
      </div>
      {m.toolResults?.length ? (
        <div className="mt-2 space-y-1">
          {m.toolResults.map((r, i) => (
            <details key={i} className="text-[10px] font-mono border border-border rounded p-1 bg-background/40">
              <summary className={r.ok ? "text-primary cursor-pointer" : "text-destructive cursor-pointer"}>
                {r.ok ? "✓" : "✗"} {r.name}{r.ok ? ` (${r.latencyMs}ms)` : ` — ${r.reason}`}
              </summary>
              <pre className="mt-1 overflow-auto max-h-48 whitespace-pre-wrap">{JSON.stringify(r.ok ? r.data : r, null, 2).slice(0, 4000)}</pre>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
});

/* ─────────────────────────── KIMI TAB ─────────────────────────── */

function KimiTab() {
  // Ref access — engine state is only read when launching a run.
  const engineRef = useEngineRef();
  const { disabledList, enabledCount, totalCount } = useToolPrefs();
  const settings = useChatSettings();
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KimiRunResult | null>(null);

  const launch = useCallback(async () => {
    const g = goal.trim();
    if (!g || busy) return;
    setBusy(true); setResult(null);
    try {
      const snapshot = buildEngineSnapshot(engineRef.current, "native");
      const kimiModel = isAgenticModel(settings.model) ? settings.model : DEFAULT_MODEL;
      const r = await runKimi(g, snapshot, kimiModel, {
        maxIterations: settings.maxIterations,
        disabledTools: disabledList,
        temperature: settings.temperature,
        toolChoice: settings.toolChoice,
      });
      setResult(r);
      for (const step of r.trace) {
        if (step.toolName) {
          pushRun({
            id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
            ts: Date.now(), name: step.toolName,
            args: (step.toolArgs as Record<string, unknown>) ?? {},
            source: "kimi", ok: !step.error,
            latencyMs: step.latencyMs, reason: step.error,
            preview: JSON.stringify(step.toolResult ?? step.error ?? "").slice(0, 300),
          });
        }
      }
    } catch (e) {
      const msg = (e as Error).message || "Kimi run failed";
      setResult({ iterations: 0, toolCalls: 0, finalAnswer: null, trace: [{ iteration: 1, error: msg }], error: msg });
    } finally {
      setBusy(false);
    }
  }, [goal, busy, engineRef, disabledList, settings.model, settings.maxIterations, settings.temperature, settings.toolChoice]);


  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 border-b border-border p-2 flex gap-2 items-start">
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder="Autonomous goal — Kimi K2 plans and invokes the enabled tool subset."
          className="flex-1 min-h-[60px] max-h-40 rounded border border-border bg-background px-2 py-1 text-sm font-mono resize-none"
          disabled={busy} />
        <div className="flex flex-col gap-1 w-36">
          <div className="text-[9px] font-mono text-muted-foreground">
            tools: {enabledCount}/{totalCount}
          </div>
          <label className="text-[10px] font-mono text-muted-foreground">max iter
            <input type="number" min={1} max={16} value={settings.maxIterations}
              onChange={(e) => setChatSettings({ maxIterations: Number(e.target.value) || 8 })}
              className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono" />
          </label>
          <div className="text-[9px] font-mono text-muted-foreground truncate" title={settings.model}>
            model: {settings.model.replace(/^moonshot\//, "")}
          </div>

          <button onClick={launch} disabled={busy || !goal.trim()}
            className="px-3 py-1 border border-accent text-accent rounded text-xs hover:bg-accent/20 disabled:opacity-40">
            {busy ? "Running…" : "Launch Kimi"}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-2 text-[11px] font-mono">
        {!result && !busy && <div className="text-muted-foreground italic">No run yet.</div>}
        {result?.error && <div className="text-destructive">Error: {result.error}</div>}
        {result && (
          <>
            <div className="mb-2 text-accent">
              {result.iterations} iter · {result.toolCalls} tool calls
              {result.finalAnswer && " · final answer received"}
            </div>
            {result.finalAnswer && (
              <div className="border border-primary/40 bg-primary/5 rounded p-2 mb-2">
                <div className="text-[10px] text-primary mb-1">FINAL</div>
                <div className="whitespace-pre-wrap text-sm">{result.finalAnswer}</div>
              </div>
            )}
            {result.trace.map((s, i) => (
              <div key={i} className="border-t border-border/40 py-1">
                <span className="text-muted-foreground">[{s.iteration}]</span>{" "}
                {s.toolName ? (
                  <>
                    <span className="text-primary">{s.toolName}</span>
                    {s.latencyMs != null && <span className="text-muted-foreground"> ({s.latencyMs}ms)</span>}
                    {s.error && <span className="text-destructive"> err: {s.error}</span>}
                    <pre className="ml-4 text-[10px] text-muted-foreground overflow-auto max-h-24">
                      {JSON.stringify(s.toolArgs ?? {}, null, 2).slice(0, 600)}
                    </pre>
                  </>
                ) : (
                  <span className="text-foreground"> {s.thought?.slice(0, 600)}</span>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── CATALOG TAB ─────────────────────────── */

function CatalogTab() {
  const dispatch = useToolDispatch();
  const { isEnabled, enabledCount, totalCount } = useToolPrefs();
  const stats = useToolStats();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ToolSpec | null>(null);
  const [health, setHealth] = useState<Record<string, ToolHealthEntry>>({});
  const probe = useServerFn(probeToolHealth) as () => Promise<ToolHealthEntry[]>;

  const loadHealth = useCallback(async () => {
    try {
      const list = await probe();
      const map: Record<string, ToolHealthEntry> = {};
      for (const h of list) map[h.name] = h;
      setHealth(map);
    } catch { /* ignore */ }
  }, [probe]);

  useEffect(() => { void loadHealth(); }, [loadHealth]);

  const byCat = useMemo(() => toolsByCategory(), []);
  const cats = useMemo(() => Object.keys(byCat).sort(), [byCat]);

  const filtered = useMemo(() => {
    if (!query.trim()) return byCat;
    const q = query.toLowerCase();
    const out: Record<string, ToolSpec[]> = {};
    for (const c of cats) {
      const matches = byCat[c].filter((s) =>
        s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
      if (matches.length) out[c] = matches;
    }
    return out;
  }, [byCat, cats, query]);

  const disableMissingKey = () => {
    const missing = Object.values(health).filter((h) => h.status === "needs-key").map((h) => h.name);
    applyHealthFilter(missing);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 border-b border-border px-2 py-1 flex flex-wrap items-center gap-1 text-[10px] font-mono">
        <button onClick={enableAll} className="px-2 py-0.5 border border-border rounded hover:bg-primary/10">Enable all</button>
        <button onClick={disableAll} className="px-2 py-0.5 border border-border rounded hover:bg-destructive/10">Disable all</button>
        <button onClick={disableMissingKey} className="px-2 py-0.5 border border-border rounded hover:bg-accent/10">Disable missing-key</button>
        <button onClick={loadHealth} className="px-2 py-0.5 border border-border rounded hover:bg-accent/10">↻ Re-probe</button>
        <div className="flex-1" />
        <span className="text-muted-foreground tabular-nums">{enabledCount}/{totalCount} enabled</span>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="w-1/2 min-w-0 border-r border-border flex flex-col">
          <div className="shrink-0 p-2 border-b border-border">
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${TOOL_SPECS.length} tools…`}
              className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono" />
          </div>
          <div className="flex-1 overflow-auto text-[11px] font-mono">
            {Object.keys(filtered).sort().map((c) => {
              const list = filtered[c];
              const enabledInCat = list.filter((s) => isEnabled(s.name)).length;
              return (
                <div key={c}>
                  <div className="px-2 py-1 sticky top-0 bg-card/90 backdrop-blur border-b border-border/40 flex items-center gap-2">
                    <span className="text-[9px] font-display tracking-[0.25em] text-accent">{c.toUpperCase()}</span>
                    <span className="text-[9px] text-muted-foreground tabular-nums">{enabledInCat}/{list.length}</span>
                    <div className="flex-1" />
                    <button onClick={() => enableCategory(c, true)}
                      className="text-[9px] text-primary hover:underline">on</button>
                    <button onClick={() => enableCategory(c, false)}
                      className="text-[9px] text-destructive hover:underline">off</button>
                  </div>
                  {list.map((s) => {
                    const active = selected?.name === s.name;
                    const on = isEnabled(s.name);
                    const h = health[s.name];
                    const st = stats[s.name];
                    const authPill = h
                      ? (h.status === "ready" ? { txt: "key✓", cls: "text-primary" }
                        : h.status === "needs-key" ? { txt: "key✗", cls: "text-destructive" }
                        : { txt: s.auth === "demo" ? "demo" : "free", cls: "text-muted-foreground" })
                      : (s.auth === "key" ? { txt: "key", cls: "text-accent" }
                        : { txt: s.auth, cls: "text-muted-foreground" });
                    return (
                      <div key={s.name}
                        className={`w-full flex items-center gap-2 px-2 py-1 border-b border-border/20 ${active ? "bg-primary/10" : "hover:bg-primary/5"} ${on ? "" : "opacity-50"}`}>
                        <Switch checked={on} onCheckedChange={(v) => setEnabled(s.name, v)}
                          aria-label={`Toggle ${s.name}`} className="scale-75 origin-left" />
                        <button onClick={() => setSelected(s)} className="flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-2">
                            <span className={active ? "text-primary" : "text-foreground"}>{s.name}</span>
                            <span className={`text-[9px] ${authPill.cls}`}>[{authPill.txt}]</span>
                            {st && (
                              <span className="text-[9px] text-muted-foreground tabular-nums">
                                {st.ok}/{st.runs}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">{s.description}</div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          {selected
            ? <TryForm spec={selected} dispatch={dispatch} enabled={isEnabled(selected.name)}
                health={health[selected.name]} stat={stats[selected.name]} />
            : <div className="p-4 text-xs text-muted-foreground italic">Select a tool on the left to inspect or invoke it.</div>}
        </div>
      </div>
    </div>
  );
}

function TryForm({
  spec, dispatch, enabled, health, stat,
}: {
  spec: ToolSpec;
  dispatch: (input: { data: { name: string; args?: Record<string, unknown>; enabled?: boolean } }) => Promise<ToolResult>;
  enabled: boolean;
  health?: ToolHealthEntry;
  stat?: ToolStat;
}) {
  const props = (spec.parameters as { properties?: Record<string, { type?: string; description?: string }>; required?: string[] }) ?? {};
  const fields = Object.entries(props.properties ?? {});
  const required = new Set(props.required ?? []);
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);

  useEffect(() => { setValues({}); setResult(null); }, [spec.name]);

  const submit = async () => {
    setRunning(true); setResult(null);
    const args: Record<string, unknown> = {};
    for (const [k, schema] of fields) {
      const v = values[k];
      if (v == null || v === "") continue;
      const t = schema?.type;
      args[k] = t === "integer" || t === "number" ? Number(v)
        : t === "boolean" ? v === "true"
        : v;
    }
    // Catalog Try ignores prefs (sends enabled=true) so users can probe even
    // disabled tools without toggling first — pushed run is still logged.
    const r = await dispatch({ data: { name: spec.name, args, enabled: true } });
    setResult(r);
    pushRun({
      id: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      ts: Date.now(), name: r.name, args: r.args as Record<string, unknown>,
      source: "catalog", ok: r.ok,
      latencyMs: r.latencyMs,
      reason: r.ok ? undefined : r.reason,
      preview: JSON.stringify(r.ok ? r.data : r).slice(0, 300),
    });
    setRunning(false);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 border-b border-border p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display text-sm text-primary">{spec.name}</span>
          <span className="text-[10px] font-mono text-muted-foreground">[{spec.category}]</span>
          {spec.envKey && (
            <span className={`text-[10px] font-mono ${health?.hasKey ? "text-primary" : "text-destructive"}`}>
              env: {spec.envKey} {health ? (health.hasKey ? "✓" : "✗") : ""}
            </span>
          )}
          <span className={`text-[10px] font-mono ${enabled ? "text-primary" : "text-destructive"}`}>
            {enabled ? "● enabled" : "○ disabled"}
          </span>
          {stat && (
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
              runs {stat.ok}/{stat.runs}{stat.lastMs ? ` · last ${stat.lastMs}ms` : ""}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{spec.description}</div>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {fields.length === 0 && <div className="text-xs text-muted-foreground italic">No parameters.</div>}
        {fields.map(([k, schema]) => (
          <label key={k} className="block">
            <div className="text-[10px] font-mono text-muted-foreground mb-0.5">
              {k}{required.has(k) && <span className="text-destructive"> *</span>}
              {schema?.type && <span className="ml-2 text-[9px]">[{schema.type}]</span>}
              {schema?.description && <span className="ml-2 italic">{schema.description}</span>}
            </div>
            <input value={values[k] ?? ""} onChange={(e) => setValues({ ...values, [k]: e.target.value })}
              className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono" />
          </label>
        ))}
        <button onClick={submit} disabled={running}
          className="px-3 py-1 border border-primary text-primary rounded text-xs hover:bg-primary/20 disabled:opacity-40">
          {running ? "Running…" : "▶ Try"}
        </button>
        {result && (
          <div className={`mt-2 border rounded p-2 text-[10px] font-mono ${result.ok ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/5"}`}>
            <div className={result.ok ? "text-primary" : "text-destructive"}>
              {result.ok ? `✓ ok · ${result.latencyMs}ms` : `✗ ${result.reason}`}
            </div>
            <pre className="mt-1 overflow-auto max-h-64 whitespace-pre-wrap">
              {JSON.stringify(result.ok ? result.data : result, null, 2).slice(0, 6000)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── RUNS TAB ─────────────────────────── */

type RunFilter = "all" | "chat" | "kimi" | "catalog" | "failures";

function RunsTab() {
  const runs = useRunLog();
  const [filter, setFilter] = useState<RunFilter>("all");

  const visible = useMemo(() => {
    if (filter === "all") return runs;
    if (filter === "failures") return runs.filter((r) => !r.ok);
    return runs.filter((r) => r.source === filter);
  }, [runs, filter]);

  const stats = useMemo(() => {
    const okCount = runs.filter((r) => r.ok).length;
    const lats = runs.filter((r) => r.latencyMs != null).map((r) => r.latencyMs as number).sort((a, b) => a - b);
    const median = lats.length ? lats[Math.floor(lats.length / 2)] : 0;
    const okPct = runs.length ? Math.round((okCount / runs.length) * 100) : 0;
    return { okPct, median };
  }, [runs]);

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-2 py-1 border-b border-border flex items-center gap-1 text-[10px] font-mono">
        {(["all","chat","kimi","catalog","failures"] as RunFilter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-2 py-0.5 border rounded ${filter === f ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {f}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-muted-foreground tabular-nums">
          {visible.length}/{runs.length} · {stats.okPct}% ok · median {stats.median}ms
        </span>
      </div>
      <div className="flex-1 overflow-auto text-[11px] font-mono">
        {visible.length === 0 && <div className="p-3 text-muted-foreground italic">No matching runs.</div>}
        {visible.map((r) => (
          <details key={r.id} className="border-b border-border/30 px-2 py-1">
            <summary className="cursor-pointer flex items-center gap-2">
              <span className={r.ok ? "text-primary" : "text-destructive"}>{r.ok ? "✓" : "✗"}</span>
              <span className="text-foreground">{r.name}</span>
              <span className="text-[9px] text-accent">[{r.source}]</span>
              {r.latencyMs != null && <span className="text-muted-foreground">{r.latencyMs}ms</span>}
              {!r.ok && <span className="text-destructive truncate">{r.reason}</span>}
              <span className="ml-auto text-muted-foreground tabular-nums">
                {new Date(r.ts).toLocaleTimeString(undefined, { hour12: false })}
              </span>
            </summary>
            <div className="pl-5 pb-1">
              <pre className="text-[10px] text-muted-foreground overflow-auto max-h-32 whitespace-pre-wrap">
                args: {JSON.stringify(r.args, null, 2)}{"\n"}preview: {r.preview}
              </pre>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
