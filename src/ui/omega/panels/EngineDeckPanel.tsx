/**
 * ENGINE deck — the Ω-P4 hardware + runtime surface.
 *
 * Every number on this panel is read from an engine field or a measured probe.
 * Nothing is interpolated, smoothed or invented; values the platform refuses
 * to disclose render as "undisclosed".
 */
import { useEffect } from "react";
import { getOmegaRuntime } from "../omegaRuntime";
import { useOmegaState } from "../useOmegaRuntime";
import type { ProfileId } from "@/core/omega/omegaProtocol";

function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "undisclosed";
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 0)} ${u[i]}`;
}

const num = (x: number, d = 3) =>
  Number.isFinite(x) ? x.toFixed(d) : "—";

function Row({ k, v, tone }: { k: string; v: string; tone?: "ok" | "warn" | "bad" }) {
  const color =
    tone === "bad" ? "text-destructive" : tone === "warn" ? "text-yellow-500" : "text-foreground";
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px] border-b border-border/20 last:border-0">
      <span className="text-[9px] font-display tracking-[0.18em] text-muted-foreground uppercase">{k}</span>
      <span className={`text-[10px] font-mono tabular-nums ${color}`}>{v}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border/40 bg-card/40 p-2.5">
      <h3 className="text-[9px] font-display tracking-[0.28em] text-primary/80 mb-1.5">{title}</h3>
      {children}
    </section>
  );
}

export default function EngineDeckPanel() {
  const s = useOmegaState();
  const rt = getOmegaRuntime();

  // Probe once on mount — off the tick path, worker-side, non-blocking.
  useEffect(() => {
    if (!s.probe && !s.probing && s.supported) rt.probe(64);
  }, [rt, s.probe, s.probing, s.supported]);

  if (!s.supported) {
    return (
      <div className="p-4 text-[11px] font-mono text-muted-foreground">
        Web Workers unavailable in this context — the engine refuses to run on the UI thread.
      </div>
    );
  }

  const snap = s.snapshot;
  const p = s.probe;
  const v = s.verdict;

  return (
    <div className="h-full overflow-auto p-2 space-y-2">
      {/* control bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-background/40 px-2.5 py-2">
        <span className="text-[9px] font-mono tracking-wider text-muted-foreground">{s.status}</span>
        <div className="flex-1" />
        <select
          value={s.profile ?? v?.selected ?? "PICO"}
          onChange={(e) => rt.build(e.target.value as ProfileId)}
          className="bg-card border border-border/60 rounded px-2 py-1 text-[10px] font-mono"
        >
          {(s.profiles.length ? s.profiles : []).map((pr) => {
            const row = v?.table.find((t) => t.id === pr.id);
            return (
              <option key={pr.id} value={pr.id}>
                {pr.id} · {pr.rungs} rungs {row ? (row.fits ? "· fits" : `· over ${row.reason}`) : ""}
              </option>
            );
          })}
        </select>
        <button
          onClick={() => (s.running ? rt.stop() : rt.start())}
          className="px-3 py-1 rounded text-[10px] font-display tracking-[0.2em] border border-primary/50 text-primary hover:bg-primary/10"
        >
          {s.running ? "HALT" : "RUN"}
        </button>
        <button
          onClick={() => rt.checkpoint()}
          className="px-3 py-1 rounded text-[10px] font-display tracking-[0.2em] border border-border/60 text-muted-foreground hover:text-foreground"
        >
          CHECKPOINT
        </button>
        <button
          onClick={() => rt.probe(64)}
          className="px-3 py-1 rounded text-[10px] font-display tracking-[0.2em] border border-border/60 text-muted-foreground hover:text-foreground"
        >
          RE-PROBE
        </button>
      </div>

      {s.error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-[10px] font-mono text-destructive">
          {s.error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <Section title="HARDWARE · MEASURED">
          <Row k="cores" v={p ? `${p.cores} (${p.coresSource})` : "…"} />
          <Row k="memory budget" v={p ? `${bytes(p.memoryBudget)} (${p.memorySource})` : "…"} />
          <Row
            k="throughput"
            v={p ? `${(p.throughput.nodeTicksPerSecond / 1e6).toFixed(2)} M node-ticks/s` : "…"}
          />
          <Row
            k="bench jitter"
            v={p ? `${(p.throughput.jitter * 100).toFixed(1)} %` : "…"}
            tone={p && p.throughput.jitter > 0.5 ? "warn" : "ok"}
          />
          <Row k="webgpu" v={p ? (p.webgpu.available ? (p.webgpu.vendor ?? "adapter") : "unavailable") : "…"} />
          <Row k="max buffer" v={bytes(p?.webgpu.maxBufferSize ?? null)} />
        </Section>

        <Section title="GOVERNOR · 75% HEADROOM">
          <Row k="selected" v={v ? v.selected : "…"} tone={v?.degraded ? "warn" : "ok"} />
          <Row k="target rate" v={v ? `${v.targetHz} Hz` : "…"} />
          <Row k="sustainable" v={v ? `${num(v.maxHz, 1)} Hz` : "…"} />
          <Row k="headroom" v={v ? `${(v.headroom * 100).toFixed(0)} %` : "…"} />
          <Row k="memory axis" v={v ? (v.memoryConstrained ? "bound" : "unconstrained") : "…"} />
          <Row
            k="footprint model"
            v={s.footprintRatio === null ? "—" : `${num(s.footprintRatio, 4)} measured/predicted`}
          />
        </Section>
      </div>

      <Section title="PROFILE TABLE">
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 text-[9px] font-mono">
          <div className="text-muted-foreground tracking-wider">PROFILE</div>
          <div className="text-muted-foreground tracking-wider text-right">RATE NEED</div>
          <div className="text-muted-foreground tracking-wider text-right">CPU LOAD</div>
          <div className="text-muted-foreground tracking-wider text-right">BYTES</div>
          <div className="text-muted-foreground tracking-wider text-right">VERDICT</div>
          {(v?.table ?? []).map((r) => (
            <div key={r.id} className="contents">
              <div className={r.id === v?.selected ? "text-primary" : "text-foreground/80"}>{r.id}</div>
              <div className="text-right tabular-nums">{(r.requiredRate / 1e6).toFixed(2)} M/s</div>
              <div
                className={`text-right tabular-nums ${r.computeLoad > 1 ? "text-destructive" : "text-foreground"}`}
              >
                {(r.computeLoad * 100).toFixed(0)}%
              </div>
              <div className="text-right tabular-nums">{bytes(r.bytes)}</div>
              <div className={`text-right ${r.fits ? "text-primary/80" : "text-muted-foreground"}`}>
                {r.fits ? "fits" : r.reason}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <Section title="RUNTIME · LIVE">
          <Row k="tick" v={snap ? String(snap.tick) : "—"} />
          <Row k="tick rate" v={snap ? `${num(snap.tickRate, 1)} Hz` : "—"} />
          <Row k="snapshot bus" v={snap ? `${num(snap.busHz, 1)} Hz` : "—"} />
          <Row k="slice load" v={snap ? `${(snap.load * 100).toFixed(0)} %` : "—"} tone={snap && snap.load > 1 ? "warn" : "ok"} />
          <Row
            k="coherence (warm)"
            v={
              snap
                ? Number.isFinite(snap.coherenceWarm)
                  ? `${num(snap.coherenceWarm, 6)} · ${snap.warmRungs}/${snap.rungs.length} rungs`
                  : "warming"
                : "—"
            }
          />
          <Row k="energy" v={snap ? num(snap.energy, 4) : "—"} />
          <Row k="digest" v={snap ? snap.digest : "—"} />
          <Row k="finite" v={snap ? (snap.finite ? "yes" : "NO") : "—"} tone={snap && !snap.finite ? "bad" : "ok"} />
        </Section>

        <Section title="WEB · CONSERVATION">
          <Row k="flux moved" v={snap ? num(snap.fluxMoved, 6) : "—"} />
          <Row
            k="flux imbalance"
            v={snap ? snap.fluxImbalance.toExponential(2) : "—"}
            tone={snap && Math.abs(snap.fluxImbalance) > 1e-9 ? "bad" : "ok"}
          />
          <Row
            k="ordering violations"
            v={snap ? String(snap.orderingViolations) : "—"}
            tone={snap && snap.orderingViolations > 0 ? "bad" : "ok"}
          />
          <Row k="row-sum defect" v={snap ? snap.rowSumDefect.toExponential(2) : "—"} />
          <Row k="worst octave ratio" v={snap ? num(snap.worstEnergyRatio, 6) : "—"} />
          <Row k="checkpoint" v={s.lastCheckpoint === null ? "—" : `tick ${s.lastCheckpoint}`} />
          <Row k="ledger marks" v={snap ? String(snap.ledgerMarks) : "—"} />
          <Row k="predicted footprint" v={snap ? bytes(snap.predictedBytes) : "—"} />
        </Section>
      </div>

      <Section title="RUNGS">
        <div className="grid grid-cols-[auto_auto_1fr_1fr_auto_auto] gap-x-3 text-[9px] font-mono">
          <div className="text-muted-foreground tracking-wider">n</div>
          <div className="text-muted-foreground tracking-wider text-right">NODES</div>
          <div className="text-muted-foreground tracking-wider text-right">COHERENCE</div>
          <div className="text-muted-foreground tracking-wider text-right">ENERGY</div>
          <div className="text-muted-foreground tracking-wider text-right">CLAMPED</div>
          <div className="text-muted-foreground tracking-wider text-right">REGIME</div>
          {(snap?.rungs ?? []).map((r, i) => (
            <div key={i} className="contents">
              <div className="text-foreground/70">{r.n}</div>
              <div className="text-right tabular-nums">{r.nodes}</div>
              <div className="text-right tabular-nums">
                {r.warm ? num(r.coherence, 5) : <span className="text-muted-foreground/70">warming</span>}
              </div>
              <div className="text-right tabular-nums">{num(r.energy, 3)}</div>
              <div className="text-right tabular-nums">{r.clamped}</div>
              <div
                className={`text-right ${r.regime === "CRITICAL" ? "text-destructive" : r.regime === "STRESS" ? "text-yellow-500" : "text-primary/80"}`}
              >
                {r.regime}
              </div>
            </div>
          ))}
          {!snap && (
            <div className="col-span-6 py-3 text-center text-muted-foreground">
              no engine built — pick a profile above
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
