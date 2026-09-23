/**
 * FieldStage — the main visual area of the Omega workstation.
 *
 * Always mounted (independent of the active deck tab) so the torus keeps
 * rendering while you work in other tabs. This is the single owner of the
 * field pull loop; FieldDeckPanel only reads the frame the stage pulled.
 *
 * Presentation only: it probes/builds/runs through the same runtime commands
 * the ENGINE deck uses and reads the same `requestField(rank, maxSamples)`
 * path the FIELD deck used before. No engine maths changed here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getOmegaRuntime } from "./omegaRuntime";
import { useOmegaState } from "./useOmegaRuntime";
import { useOmegaPull } from "./useOmegaPull";
import { useFieldView, setFieldView, SAMPLE_STEPS, HZ_MAX } from "./fieldViewStore";
import type { ProfileId } from "@/core/omega/omegaProtocol";

/** Grouped integer, so 46368 reads as 46,368 rather than a run of digits. */
const num = (n: number): string => n.toLocaleString("en-US");
/** Allocation size of a build, from the engine's exact byte cost model. */
const mib = (bytes: number): string =>
  bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MiB` : `${Math.round(bytes / 1024)} KiB`;

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const on = () => setVisible(!document.hidden);
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

export default function FieldStage() {
  const s = useOmegaState();
  const rt = getOmegaRuntime();
  const view = useFieldView();
  const visible = useDocumentVisible();
  const canvas = useRef<HTMLCanvasElement | null>(null);

  // Probe once so the profile table (node counts) exists before anything is
  // built. The ENGINE deck guards on the same flags, so this never doubles.
  useEffect(() => {
    if (s.supported && !s.probe && !s.probing) rt.probe(64);
  }, [rt, s.supported, s.probe, s.probing]);

  const rank = view.rank;
  const active = Boolean(s.snapshot) && view.stageOpen && visible;

  const request = useCallback(
    () => rt.requestField(rank, view.samples),
    [rt, rank, view.samples],
  );
  useOmegaPull(request, view.hz, active);

  const frame = s.frame && s.frame.rank === rank ? s.frame : null;

  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w === 0 || h === 0) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!frame) return;

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.34; // major radius
    const r = Math.min(w, h) * 0.15; // minor radius
    const peak = frame.peak > 0 ? frame.peak : 1;

    // guide rings — torus core circle plus inner/outer envelope
    g.strokeStyle = "rgba(255,255,255,0.07)";
    g.lineWidth = 1;
    for (const rr of [R - r, R, R + r]) {
      g.beginPath();
      g.ellipse(cx, cy, rr, rr * 0.55, 0, 0, Math.PI * 2);
      g.stroke();
    }

    // Data-only pass: hue is exactly the legend wheel hsl(h,85%,55%), opacity
    // and radius are strictly |z|/peak. Nothing is interpolated, smoothed or
    // invented between engine samples. The additive bloom is opt-in and is the
    // only non-literal ink on the canvas.
    const n = frame.u.length;
    const xs = new Array<number>(n);
    const ys = new Array<number>(n);
    const hues = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const u = frame.u[i];
      const v = frame.v[i];
      // standard torus projection onto the screen plane, minor circle tilted
      xs[i] = cx + (R + r * Math.cos(v)) * Math.cos(u);
      ys[i] = cy + (R + r * Math.cos(v)) * Math.sin(u) * 0.55 + r * Math.sin(v) * 0.8;
      const ph = frame.phase[i];
      hues[i] = ((ph + Math.PI) / (2 * Math.PI)) * 360;
    }

    // Thin structural mesh: connect consecutive sampled nodes in lattice order.
    // This is visual structure only — it does not create new samples or data.
    g.beginPath();
    g.strokeStyle = "rgba(255,255,255,0.06)";
    g.lineWidth = 0.5;
    for (let i = 0; i < n - 1; i++) {
      g.moveTo(xs[i], ys[i]);
      g.lineTo(xs[i + 1], ys[i + 1]);
    }
    g.stroke();

    if (view.glow) g.globalCompositeOperation = "lighter";
    for (let i = 0; i < n; i++) {
      const a = frame.amp[i] / peak;
      const hue = hues[i];
      const rad = 1 + 3.6 * a;
      const x = xs[i];
      const y = ys[i];
      if (view.glow && a > 0.55) {
        g.fillStyle = `hsla(${hue.toFixed(1)}, 85%, 55%, ${(0.05 + 0.12 * a).toFixed(3)})`;
        g.beginPath();
        g.arc(x, y, rad * 3.2, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = `hsla(${hue.toFixed(1)}, 85%, 55%, ${(0.1 + 0.9 * a).toFixed(3)})`;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = "source-over";
  }, [frame, view.glow]);

  // Redraw is coalesced onto the next animation frame: one paint per real
  // engine frame, never a synthesised in-between state.
  useEffect(() => {
    const id = requestAnimationFrame(() => draw());
    return () => cancelAnimationFrame(id);
  }, [draw]);

  // redraw on container resize so the enlarged stage stays crisp
  useEffect(() => {
    const c = canvas.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(c);
    return () => ro.disconnect();
  }, [draw]);

  const rungs = s.description?.rungs ?? [];
  const profileId = (s.profile ?? s.verdict?.selected ?? "PICO") as ProfileId;
  const built = Boolean(s.snapshot);

  // A persisted rank can outlive the ladder it was chosen on (switch MACRO →
  // PICO and rank 12 no longer exists). Clamp to the built ladder instead of
  // silently pulling an out-of-range rung.
  useEffect(() => {
    if (rungs.length > 0 && rank > rungs.length - 1) setFieldView({ rank: rungs.length - 1 });
  }, [rungs.length, rank]);

  const rungNodes = rungs[rank]?.nodes ?? null;
  // RES can never exceed the rung's own node count — offering 6765 on a
  // 377-node rung is a lie, the engine would still return 377.
  const resSteps = rungNodes
    ? [...SAMPLE_STEPS.filter((n) => n < rungNodes), rungNodes]
    : [...SAMPLE_STEPS];
  const effSamples = rungNodes ? Math.min(view.samples, rungNodes) : view.samples;
  const resValue = resSteps.reduce(
    (best, n) => (Math.abs(n - effSamples) < Math.abs(best - effSamples) ? n : best),
    resSteps[0],
  );
  const drawStride = rungNodes ? Math.max(1, Math.ceil(rungNodes / Math.max(1, resValue))) : 1;
  const willDraw = rungNodes ? Math.ceil(rungNodes / drawStride) : null;


  return (
    <section className="panel-matrix rounded-md border border-border/40 bg-card/60 flex flex-1 flex-col min-h-0 overflow-hidden">
      <header className="shrink-0 flex flex-wrap items-center gap-2 border-b border-border/30 bg-background/40 px-3 py-1.5">
        <h2 className="text-[10px] font-display tracking-[0.28em] uppercase text-primary/90">
          ◆ FIELD STAGE
        </h2>

        {/* engine size — toroids, total substrate nodes, spectral width */}
        <span className="text-[9px] font-display tracking-[0.2em] text-muted-foreground ml-2">SIZE</span>
        <select
          value={profileId}
          onChange={(e) => rt.build(e.target.value as ProfileId)}
          className="bg-card border border-border/60 rounded px-2 py-0.5 text-[10px] font-mono"
        >
          {s.profiles.map((pr) => {
            const row = s.verdict?.table.find((t) => t.id === pr.id);
            return (
              <option key={pr.id} value={pr.id}>
                {pr.id} · {pr.rungs} toroids · {num(pr.totalNodes)} nodes · {num(pr.nodes[0])}→
                {num(pr.nodes[pr.nodes.length - 1])}/rung · {pr.modes} modes · {mib(pr.bytes)}
                {row ? (row.fits ? " · fits" : ` · ${row.reason}`) : ""}
              </option>
            );
          })}
          {s.profiles.length === 0 && <option value={profileId}>{s.probing ? "probing…" : profileId}</option>}
        </select>
        <button
          onClick={() => rt.build(profileId)}
          className="rounded border border-border/60 px-2 py-0.5 text-[9px] font-display tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          BUILD
        </button>
        <button
          onClick={() => (s.running ? rt.stop() : rt.start())}
          disabled={!built}
          className="rounded border border-primary/50 px-2 py-0.5 text-[9px] font-display tracking-[0.2em] text-primary hover:bg-primary/10 disabled:opacity-40"
        >
          {s.running ? "HALT" : "RUN"}
        </button>

        <span className="text-[9px] font-display tracking-[0.2em] text-muted-foreground ml-1">RUNG</span>
        <select
          value={rungs.length > 0 ? Math.min(rank, rungs.length - 1) : rank}
          onChange={(e) => setFieldView({ rank: Number(e.target.value) })}
          disabled={rungs.length === 0}
          className="bg-card border border-border/60 rounded px-2 py-0.5 text-[10px] font-mono disabled:opacity-50"
        >
          {rungs.map((r) => (
            <option key={r.rank} value={r.rank}>
              #{r.rank} · n={r.n} · {num(r.nodes)} nodes · clock ÷{r.stride}
            </option>
          ))}
          {rungs.length === 0 && <option value={rank}>no ladder — build first</option>}
        </select>

        <span className="text-[9px] font-display tracking-[0.2em] text-muted-foreground ml-1">RES</span>
        <select
          value={resValue}
          onChange={(e) => setFieldView({ samples: Number(e.target.value) })}
          className="bg-card border border-border/60 rounded px-2 py-0.5 text-[10px] font-mono"
        >
          {resSteps.map((n) => (
            <option key={n} value={n}>
              {num(n)} nodes{rungNodes && n === rungNodes ? " · ALL" : ""}
            </option>
          ))}
        </select>
        {rungNodes !== null && (
          <span className="text-[9px] font-mono text-muted-foreground tabular-nums">
            draw {num(willDraw ?? 0)}/{num(rungNodes)} · ÷{drawStride}
          </span>
        )}


        <span className="inline-flex items-center gap-2 ml-1">
          <span className="text-[9px] font-display tracking-[0.2em] text-muted-foreground">PULL</span>
          <input
            type="range"
            min={1}
            max={HZ_MAX}
            value={view.hz}
            onChange={(e) => setFieldView({ hz: Number(e.target.value) })}
            className="w-24 accent-primary"
          />
          <span className="text-[10px] font-mono tabular-nums">{view.hz} Hz</span>
        </span>

        <button
          onClick={() => setFieldView({ glow: !view.glow })}
          title="TRUE draws only measured values; BLOOM adds a decorative additive halo"
          className={`rounded border px-2 py-0.5 text-[9px] font-display tracking-[0.2em] ${
            view.glow
              ? "border-border/60 text-muted-foreground hover:text-foreground"
              : "border-primary/50 text-primary"
          }`}
        >
          {view.glow ? "BLOOM" : "TRUE"}
        </button>


        <div className="flex-1" />

        <span className="text-[9px] font-mono text-muted-foreground">
          {frame
            ? `tick ${frame.tick} · ${frame.u.length}/${frame.nodes} nodes (÷${frame.stride}) · digest ${frame.digest}`
            : built
              ? "waiting for frame…"
              : "no engine built"}
        </span>

        <button
          onClick={() => setFieldView({ stageOpen: !view.stageOpen })}
          className="rounded border border-border/60 px-2 py-0.5 text-[9px] font-display tracking-[0.2em] text-muted-foreground hover:text-foreground"
        >
          {view.stageOpen ? "COLLAPSE" : "EXPAND"}
        </button>
      </header>

      {view.stageOpen && (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_230px]">
          <div className="relative min-h-0 min-w-0">
            <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
            {!frame && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6">
                <p className="text-[11px] font-display tracking-[0.28em] text-muted-foreground">
                  {built ? "ENGINE BUILT — PRESS RUN" : "NO TOROIDAL SUBSTRATE"}
                </p>
                <p className="text-[10px] font-mono text-muted-foreground/70 max-w-md">
                  {built
                    ? "the ladder is allocated; start the tick loop to stream frames onto the stage"
                    : "choose a SIZE above and press BUILD — the ladder allocates one toroid per rung, each carrying Fibonacci-many nodes"}
                </p>
                {!built && (
                  <button
                    onClick={() => rt.build(profileId)}
                    className="mt-1 rounded border border-primary/50 px-3 py-1 text-[10px] font-display tracking-[0.24em] text-primary hover:bg-primary/10"
                  >
                    BUILD {profileId}
                  </button>
                )}
              </div>
            )}
          </div>
          <Legend
            peak={frame ? frame.peak : null}
            mean={frame ? frame.mean : null}
            nodes={frame ? frame.nodes : null}
            drawn={frame ? frame.u.length : null}
            energy={frame ? frame.amp.reduce((a, m) => a + m * m, 0) : null}
            modes={frame ? frame.signature.length : null}
            coherence={
              s.snapshot?.rungs[rank]?.warm ? s.snapshot.rungs[rank].coherence : null
            }
            coherenceWarm={s.snapshot?.rungs[rank]?.warm ?? false}
            regime={s.snapshot?.rungs[rank]?.regime ?? null}
          />
        </div>
      )}
    </section>
  );
}

function Legend({
  peak,
  mean,
  nodes,
  drawn,
  energy,
  modes,
  coherence,
  coherenceWarm,
  regime,
}: {
  peak: number | null;
  mean: number | null;
  nodes: number | null;
  drawn: number | null;
  energy: number | null;
  modes: number | null;
  coherence: number | null;
  coherenceWarm: boolean;
  regime: string | null;
}) {
  const swatches: { label: string; hue: number; meaning: string }[] = [
    { label: "−π", hue: 0, meaning: "phase reversal" },
    { label: "−π/2", hue: 90, meaning: "quarter lag" },
    { label: "0", hue: 180, meaning: "in phase" },
    { label: "+π/2", hue: 270, meaning: "quarter lead" },
  ];
  return (
    <aside className="hidden lg:flex flex-col gap-2 border-l border-border/30 bg-background/30 p-2.5 overflow-auto">
      <h3 className="text-[9px] font-display tracking-[0.28em] text-primary/80">LEGEND</h3>

      <div className="space-y-1">
        <p className="text-[9px] font-mono text-muted-foreground">
          DOT = NEURON · the cell&apos;s complex state z
        </p>
        <p className="text-[9px] font-mono text-muted-foreground">HUE = PHASE arg z</p>
        <div
          className="h-2 w-full rounded-sm"
          style={{
            background:
              "linear-gradient(to right, hsl(0,85%,55%), hsl(60,85%,55%), hsl(120,85%,55%), hsl(180,85%,55%), hsl(240,85%,55%), hsl(300,85%,55%), hsl(360,85%,55%))",
          }}
        />
        <ul className="space-y-0.5 pt-0.5">
          {swatches.map((sw) => (
            <li key={sw.label} className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground">
              <span
                className="inline-block h-2 w-2 rounded-full shrink-0"
                style={{ background: `hsl(${sw.hue},85%,55%)` }}
              />
              <span className="tabular-nums w-9">{sw.label}</span>
              <span className="truncate">{sw.meaning}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-1 pt-1">
        <p className="text-[9px] font-mono text-muted-foreground">
          SIZE + OPACITY = |z| / peak (linear, no curve)
        </p>
        <div className="flex items-end gap-2 h-6">
          {[0.15, 0.4, 0.7, 1].map((a) => (
            <span
              key={a}
              className="rounded-full bg-primary/70"
              style={{ width: `${4 + 10 * a}px`, height: `${4 + 10 * a}px` }}
            />
          ))}
        </div>
        <p className="text-[9px] font-mono text-muted-foreground">
          TRUE mode draws measured values only. BLOOM adds an additive halo above 55% of frame peak
          — decorative ink, not a new measurement.
        </p>
      </div>

      <div className="space-y-1 pt-1">
        <p className="text-[9px] font-mono text-muted-foreground">MESH = LATTICE STRUCTURE</p>
        <p className="text-[9px] font-mono text-muted-foreground">
          a very thin line joins consecutive sampled nodes in Fibonacci-lattice order. It shows the
          toroidal weave without inventing any data between engine samples.
        </p>
      </div>

      <div className="space-y-1 pt-1">
        <p className="text-[9px] font-mono text-muted-foreground">RINGS = TOROID ENVELOPE</p>
        <p className="text-[9px] font-mono text-muted-foreground">
          inner / core / outer guides (R−r, R, R+r). Position u,v is the Fibonacci lattice address of
          the node — nothing is interpolated between engine sites.
        </p>
      </div>

      <div className="space-y-1 pt-1">
        <p className="text-[9px] font-mono text-muted-foreground">PER-NODE ORGANS</p>
        <ul className="space-y-0.5 text-[9px] font-mono text-muted-foreground">
          <li>· neuron — z drives dot hue + size</li>
          <li>· eigenmode — folded into the φ-signature (FIELD deck)</li>
          <li>· radial transform — SPECTRAL deck planes</li>
          <li>· sensory — SENSE deck channel injection</li>
          <li>· superposition — the halo term above</li>
        </ul>
      </div>

      <div className="grid grid-cols-2 gap-x-2 pt-1 text-[9px] font-mono border-t border-border/30 mt-auto">
        <span className="text-muted-foreground">nodes drawn</span>
        <span className="text-right tabular-nums">
          {drawn !== null && nodes !== null ? `${drawn} / ${nodes}` : "—"}
        </span>
        <span className="text-muted-foreground">Σ|z|² sampled</span>
        <span className="text-right tabular-nums">
          {energy !== null ? energy.toExponential(3) : "—"}
        </span>
        <span className="text-muted-foreground">φ-modes</span>
        <span className="text-right tabular-nums">{modes ?? "—"}</span>
        <span className="text-muted-foreground">peak |z|</span>
        <span className="text-right tabular-nums">{peak !== null ? peak.toExponential(3) : "—"}</span>
        <span className="text-muted-foreground">mean |z|</span>
        <span className="text-right tabular-nums">{mean !== null ? mean.toExponential(3) : "—"}</span>
        <span className="text-muted-foreground">coherence</span>
        <span className="text-right tabular-nums">
          {coherence !== null && Number.isFinite(coherence)
            ? coherence.toFixed(5)
            : coherenceWarm
              ? "—"
              : "warming"}
        </span>
        <span className="text-muted-foreground">regime</span>
        <span className="text-right">{regime ?? "—"}</span>
      </div>
    </aside>
  );
}
