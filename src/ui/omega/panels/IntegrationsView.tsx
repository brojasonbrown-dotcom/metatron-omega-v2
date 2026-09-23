/**
 * IntegrationsView — every auth:"key" tool with live env-var status.
 *
 * Reuses `probeToolHealth` (server fn) as the source of truth for whether
 * a secret is set. No new backend surface; no writes from the browser.
 * The user configures secrets via the assistant (which invokes
 * `secrets--add_secret`) or via Project Settings → Secrets.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { TOOL_SPECS, toolsByCategory, type ToolSpec } from "@/lib/chat/tools/registry";
import { probeToolHealth, type ToolHealthEntry } from "@/lib/chat/tools/health.functions";

type HealthMap = Record<string, ToolHealthEntry>;

function StatusPill({ h }: { h?: ToolHealthEntry }) {
  if (!h) return <span className="text-[9px] font-mono text-muted-foreground">…</span>;
  if (h.status === "ready")
    return <span className="text-[9px] font-mono text-primary">● READY</span>;
  if (h.status === "needs-key")
    return <span className="text-[9px] font-mono text-destructive">○ MISSING KEY</span>;
  return <span className="text-[9px] font-mono text-muted-foreground">— NO AUTH</span>;
}

function copyToClipboard(text: string) {
  try { void navigator.clipboard?.writeText(text); } catch { /* noop */ }
}

export default function IntegrationsView() {
  const probe = useServerFn(probeToolHealth) as () => Promise<ToolHealthEntry[]>;
  const [health, setHealth] = useState<HealthMap>({});
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const list = await probe();
      const map: HealthMap = {};
      for (const h of list) map[h.name] = h;
      setHealth(map);
    } catch { /* ignore transient probe failure */ }
    finally { setBusy(false); }
  }, [probe]);

  useEffect(() => { void reload(); }, [reload]);

  // Only tools that require credentials show up here — no-auth tools are
  // covered by the TOOLS/Catalog tab.
  const keyToolsByCat = useMemo(() => {
    const cats = toolsByCategory();
    const out: Record<string, ToolSpec[]> = {};
    for (const [c, list] of Object.entries(cats)) {
      const gated = list.filter((s) => s.auth === "key");
      if (gated.length) out[c] = gated;
    }
    return out;
  }, []);

  const catNames = useMemo(() => Object.keys(keyToolsByCat).sort(), [keyToolsByCat]);
  const filtered = useMemo(() => {
    if (!query.trim()) return keyToolsByCat;
    const q = query.toLowerCase();
    const out: Record<string, ToolSpec[]> = {};
    for (const c of catNames) {
      const matches = keyToolsByCat[c].filter((s) =>
        s.name.toLowerCase().includes(q) ||
        (s.envKey ?? "").toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q));
      if (matches.length) out[c] = matches;
    }
    return out;
  }, [keyToolsByCat, catNames, query]);

  const readyCount = Object.values(health).filter((h) => h.status === "ready").length;
  const missingCount = Object.values(health).filter((h) => h.status === "needs-key").length;
  const totalKeyTools = TOOL_SPECS.filter((s) => s.auth === "key").length;

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2 flex flex-wrap items-center gap-3 text-[10px] font-mono">
        <span className="text-primary tabular-nums">READY {readyCount}</span>
        <span className="text-destructive tabular-nums">MISSING {missingCount}</span>
        <span className="text-muted-foreground tabular-nums">TOTAL {totalKeyTools}</span>
        <div className="flex-1" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter integrations…"
          className="w-48 bg-background border border-border rounded px-2 py-1 text-xs font-mono"
        />
        <button
          onClick={() => { void reload(); }}
          disabled={busy}
          className="px-2 py-1 border border-border rounded hover:bg-accent/10 disabled:opacity-40"
        >
          {busy ? "…" : "↻ re-probe"}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3 space-y-4">
        <div className="text-[11px] font-mono text-muted-foreground border border-border/40 rounded p-2 bg-background/40">
          To add a missing API key, tell the assistant e.g. <span className="text-primary">"add my Shodan API key"</span>
          — a secure form opens for pasting the value. Secrets are stored server-side and read by
          <span className="text-accent"> intel.server.ts</span> at dispatch time. Never paste keys in chat.
        </div>

        {Object.keys(filtered).length === 0 && (
          <div className="text-xs text-muted-foreground italic">No integrations match.</div>
        )}

        {Object.keys(filtered).sort().map((c) => {
          const list = filtered[c];
          return (
            <div key={c} className="border border-border/40 rounded overflow-hidden">
              <div className="px-3 py-1.5 bg-card/60 border-b border-border/40 flex items-center gap-2">
                <span className="text-[10px] font-display tracking-[0.28em] text-accent">
                  {c.toUpperCase()}
                </span>
                <span className="text-[9px] text-muted-foreground tabular-nums">
                  {list.filter((s) => health[s.name]?.status === "ready").length}/{list.length} ready
                </span>
              </div>
              <div className="divide-y divide-border/20">
                {list.map((s) => {
                  const h = health[s.name];
                  return (
                    <div key={s.name} className="px-3 py-2 flex flex-wrap items-center gap-3 hover:bg-primary/5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-mono text-foreground">{s.name}</span>
                          <StatusPill h={h} />
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {s.description}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {s.envKey && (
                          <code className="text-[10px] font-mono px-2 py-0.5 rounded border border-border/60 bg-background/60 text-accent">
                            {s.envKey}
                          </code>
                        )}
                        {s.envKey && (
                          <button
                            onClick={() => copyToClipboard(s.envKey!)}
                            className="text-[9px] font-mono px-2 py-0.5 border border-border rounded hover:bg-accent/10"
                            title="Copy env var name to clipboard"
                          >
                            copy
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
