/**
 * LADDER deck — the scale ladder as the engine actually instantiated it.
 * Every column is read from the engine description or the live snapshot; no
 * value is modelled here.
 */
import { useMemo } from "react";
import { useOmegaState } from "../useOmegaRuntime";
import { useOmegaDescribe } from "../useOmegaPull";
import { dimensionProfile, torusGrid } from "@/core/runtime/rhuftf/ScaleMeasurement";

/**
 * Effective (spectral) dimension a rung of `nodes` nodes can carry, measured
 * from the closed-form heat trace of its φ-aspect torus grid. Memoised by node
 * count — the value depends on nothing else, so rungs sharing a node count
 * share one computation.
 */
const DIM_CACHE = new Map<number, number>();
function rungDimension(nodes: number): number {
  if (!(nodes >= 1)) return NaN;
  const hit = DIM_CACHE.get(nodes);
  if (hit !== undefined) return hit;
  const d = dimensionProfile(torusGrid(nodes)).plateauDim;
  DIM_CACHE.set(nodes, d);
  return d;
}

const num = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : "—");

// The engine's corridor gate emits exactly these regimes (measure/state.ts).
const REGIME_TONE: Record<string, string> = {
  STABLE: "text-emerald-400",
  STRESS: "text-amber-400",
  CRITICAL: "text-rose-400",
  IDLE: "text-muted-foreground",
};

export default function LadderDeckPanel() {
  const s = useOmegaState();
  useOmegaDescribe(Boolean(s.snapshot));

  const rungs = s.description?.rungs ?? [];
  const maxTau = useMemo(
    () => Math.max(1e-12, ...rungs.map((r) => Math.abs(r.logTau))),
    [rungs],
  );

  if (!s.snapshot) {
    return (
      <div className="h-full grid place-items-center text-[11px] font-mono text-muted-foreground">
        Build the engine on the ENGINE deck to populate the ladder.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-2 space-y-2">
      <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-2 flex flex-wrap gap-x-6 gap-y-1 text-[10px] font-mono">
        <span className="text-muted-foreground">
          profile <span className="text-foreground">{s.snapshot.profile}</span>
        </span>
        <span className="text-muted-foreground">
          rungs <span className="text-foreground tabular-nums">{rungs.length}</span>
        </span>
        <span className="text-muted-foreground">
          band <span className="text-foreground tabular-nums">±{s.description?.web.band ?? "—"}</span>
        </span>
        <span className="text-muted-foreground">
          row-sum defect{" "}
          <span className="text-foreground tabular-nums">
            {num(s.snapshot.rowSumDefect, 3).replace(/0\.0000/, "0")}
          </span>
        </span>
        <span className="text-muted-foreground">
          tick <span className="text-foreground tabular-nums">{s.snapshot.tick}</span>
        </span>
      </div>

      <div className="rounded-md border border-border/40 bg-card/30 overflow-hidden">
        <table className="w-full text-[10px] font-mono">
          <thead className="bg-background/60 text-[9px] font-display tracking-[0.16em] text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-1.5">n</th>
              <th className="text-right px-2">NODES</th>
              <th className="text-right px-2">÷CLOCK</th>
              <th className="text-right px-2">L(n) mod</th>
              <th className="text-right px-2">log R</th>
              <th className="text-right px-2">log r</th>
              <th className="text-right px-2">log τ</th>
              <th className="text-right px-2">QRF</th>
              <th className="text-right px-2">d_s</th>
              <th className="text-right px-2">EMIT</th>
              <th className="text-right px-2">COH</th>
              <th className="text-right px-2">ENERGY</th>
              <th className="text-right px-2">CLAMP</th>
              <th className="text-right px-2">CLOSURE γ</th>
              <th className="text-right px-2">SKILL</th>
              <th className="text-right px-2 pr-3">REGIME</th>
            </tr>
          </thead>
          <tbody>
            {rungs.map((r) => {
              const live = s.snapshot?.rungs[r.rank];
              const stepped = s.snapshot?.stepped?.includes(r.rank);
              return (
                <tr
                  key={r.rank}
                  className={`border-t border-border/25 ${stepped ? "bg-primary/5" : ""}`}
                >
                  <td className="px-2 py-1 text-primary/90">
                    {r.n}
                    {r.dense && <span className="text-muted-foreground/60"> ·core</span>}
                  </td>
                  <td className="px-2 text-right tabular-nums">{r.nodes}</td>
                  <td className="px-2 text-right tabular-nums">{r.stride}</td>
                  <td className="px-2 text-right tabular-nums">{r.lucasResidue}</td>
                  <td className="px-2 text-right tabular-nums">{num(r.logRadius, 3)}</td>
                  <td className="px-2 text-right tabular-nums">{num(r.logMinorRadius, 3)}</td>
                  <td className="px-2 text-right tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <span
                        className="inline-block h-1 bg-primary/50 rounded"
                        style={{ width: `${(Math.abs(r.logTau) / maxTau) * 28}px` }}
                      />
                      {num(r.logTau, 3)}
                    </span>
                  </td>
                  <td className="px-2 text-right tabular-nums">{num(r.qrf, 4)}</td>
                  <td
                    className={`px-2 text-right tabular-nums ${
                      rungDimension(r.nodes) >= 1.9
                        ? "text-emerald-400"
                        : rungDimension(r.nodes) >= 1.5
                          ? "text-amber-400"
                          : "text-rose-400"
                    }`}
                  >
                    {num(rungDimension(r.nodes), 3)}
                  </td>
                  <td className="px-2 text-right tabular-nums">{num(r.emitted, 4)}</td>
                  <td className="px-2 text-right tabular-nums">
                    {live?.warm ? (
                      num(live.coherence, 4)
                    ) : (
                      <span className="text-muted-foreground/70">warming</span>
                    )}
                  </td>
                  <td className="px-2 text-right tabular-nums">
                    {(live?.energy ?? 0).toExponential(2)}
                  </td>
                  <td className="px-2 text-right tabular-nums">{live?.clamped ?? 0}</td>
                  <td className="px-2 text-right tabular-nums">{num(live?.closureQuality ?? 0, 4)}</td>
                  <td className="px-2 text-right tabular-nums">{num(live?.skill ?? 0, 4)}</td>
                  <td
                    className={`px-2 pr-3 text-right ${REGIME_TONE[live?.regime ?? "IDLE"] ?? ""}`}
                  >
                    {live?.regime ?? "IDLE"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[9px] font-mono text-muted-foreground px-1">
        Rows tinted on the last tick are the rungs whose multi-rate clock fired; a rung with ÷k
        advances once every k web ticks, so its τ and its update cadence stay bound to the same
        ladder index. A rung reads <span className="text-muted-foreground/70">warming</span> until its
        coherence ring has filled τ samples — that is &ldquo;not measured yet&rdquo;, not zero
        coherence. CLOSURE γ is the rung&apos;s shift autocorrelation |⟨Sz,z⟩|/‖z‖² — 1 means the
        field is an exact eigenvector of its own toroidal shift. SKILL = 1/(1+√(2−2γ)) is the
        corridor reading: it is amplitude- and node-count-free, so a large rung is not penalised
        for carrying more field than a small one. d_s is the rung&apos;s measured spectral
        dimension: the plateau of −2 d ln Z(t)/d ln t over the closed-form heat trace
        Z(t) = Σ e<sup>−tλ</sup> of its φ-aspect torus grid, λ(a,b) = (4/h_u²)sin²(πa/p) +
        (4/h_v²)sin²(πb/q). It is a property of the rung&apos;s own geometry, not a target:
        green means the rung resolves both toroidal cycles and genuinely carries a
        two-dimensional scale of spacetime, red means it is a ring with too few nodes to
        carry one, and no amount of field amplitude changes that.

      </p>
    </div>
  );
}
