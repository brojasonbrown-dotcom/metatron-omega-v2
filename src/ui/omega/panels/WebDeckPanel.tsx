/**
 * WEB deck — the coupling channel matrix and the double-entry flux ledger.
 * The matrix is the engine's own weights; the ledger tail is the journal the
 * engine wrote, including the closure sink.
 */
import { useCallback } from "react";
import { getOmegaRuntime } from "../omegaRuntime";
import { useOmegaState } from "../useOmegaRuntime";
import { useOmegaPull, useOmegaDescribe } from "../useOmegaPull";

const num = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : "—");

export default function WebDeckPanel() {
  const s = useOmegaState();
  const rt = getOmegaRuntime();
  useOmegaDescribe(Boolean(s.snapshot));
  const request = useCallback(() => rt.requestWeb(24), [rt]);
  useOmegaPull(request, 4, Boolean(s.snapshot));

  const desc = s.description;
  const view = s.web;

  if (!s.snapshot || !desc) {
    return (
      <div className="h-full grid place-items-center text-[11px] font-mono text-muted-foreground">
        Build the engine on the ENGINE deck to inspect the web.
      </div>
    );
  }

  const snap = s.snapshot;
  const size = desc.web.size;
  const w = desc.web.weights;
  const maxW = Math.max(1e-12, ...Array.from(w));

  return (
    <div className="h-full overflow-auto p-2 space-y-2">
      <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-2 grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-1 text-[10px] font-mono">
        <span className="text-muted-foreground">turnover</span>
        <span className="tabular-nums">{view ? view.turnover.toExponential(3) : "—"}</span>
        <span className="text-muted-foreground">imbalance</span>
        <span className="tabular-nums">{view ? view.imbalance.toExponential(3) : "—"}</span>
        <span className="text-muted-foreground">net imbalance</span>
        <span className="tabular-nums">{view ? view.netImbalance.toExponential(3) : "—"}</span>
        <span className="text-muted-foreground">sink</span>
        <span className="tabular-nums">{view ? view.sink.toExponential(3) : "—"}</span>
        <span className="text-muted-foreground">ordering violations</span>
        <span
          className={`tabular-nums ${view && view.orderingViolations > 0 ? "text-rose-400" : "text-emerald-400"}`}
        >
          {view?.orderingViolations ?? "—"}
        </span>
      </div>

      <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-2 grid grid-cols-2 md:grid-cols-6 gap-x-4 gap-y-1 text-[10px] font-mono">
        <span className="text-muted-foreground">organ nodes</span>
        <span
          className={`tabular-nums ${snap.organNodes === snap.totalNodes ? "text-emerald-400" : "text-amber-400"}`}
        >
          {snap.organNodes}/{snap.totalNodes}
        </span>
        <span className="text-muted-foreground">eigen residual</span>
        <span className="tabular-nums">{snap.organResidual.toExponential(2)}</span>
        <span className="text-muted-foreground">participation</span>
        <span className="tabular-nums">{num(snap.organParticipation, 4)}</span>
        <span className="text-muted-foreground">chords</span>
        <span className="tabular-nums">{snap.chords.length > 0 ? snap.chords.join(" · ") : "none"}</span>
        <span className="text-muted-foreground">tape</span>
        <span className="tabular-nums">
          {snap.tapeCapacity > 0 ? `${snap.tapeOccupancy}/${snap.tapeCapacity} @ ${snap.tapeHead}` : "off"}
        </span>
        <span className="text-muted-foreground">tape fill</span>
        <span className="tabular-nums">
          {snap.tapeCapacity > 0 ? `${((snap.tapeOccupancy / snap.tapeCapacity) * 100).toFixed(1)}%` : "—"}
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        <div className="rounded-md border border-border/40 bg-card/30 p-2 overflow-auto">
          <h3 className="text-[9px] font-display tracking-[0.28em] text-primary/80 mb-1.5">
            CHANNEL MATRIX · ROW = RECEIVER, COLUMN = SOURCE
          </h3>
          <table className="text-[9px] font-mono">
            <thead>
              <tr>
                <th className="px-1 text-muted-foreground">to\from</th>
                {desc.rungs.map((r) => (
                  <th key={r.rank} className="px-1 text-muted-foreground font-normal">
                    {r.n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {desc.rungs.map((row) => (
                <tr key={row.rank}>
                  <td className="px-1 text-muted-foreground">{row.n}</td>
                  {desc.rungs.map((col) => {
                    const v = w[row.rank * size + col.rank];
                    return (
                      <td
                        key={col.rank}
                        title={`${col.n} → ${row.n}: ${v.toExponential(6)}`}
                        className="px-1 text-center tabular-nums"
                        style={{
                          background:
                            v > 0
                              ? `hsl(var(--primary) / ${(0.08 + 0.72 * (v / maxW)).toFixed(3)})`
                              : "transparent",
                        }}
                      >
                        {v > 0 ? v.toFixed(3).slice(1) : "·"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-2">
          <div className="rounded-md border border-border/40 bg-card/30 p-2">
            <h3 className="text-[9px] font-display tracking-[0.28em] text-primary/80 mb-1.5">
              NET LEDGER POSITION PER RUNG
            </h3>
            <div className="space-y-1">
              {desc.rungs.map((r) => {
                const net = view?.net[r.rank] ?? 0;
                const scale = Math.max(1e-12, ...(view?.net ?? [1]).map(Math.abs));
                const pct = (Math.abs(net) / scale) * 50;
                return (
                  <div key={r.rank} className="flex items-center gap-2 text-[9px] font-mono">
                    <span className="w-10 text-right text-muted-foreground">n={r.n}</span>
                    <div className="flex-1 h-2 relative bg-background/50 rounded">
                      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                      <div
                        className={`absolute inset-y-0 ${net >= 0 ? "bg-emerald-500/70 left-1/2" : "bg-rose-500/70 right-1/2"} rounded`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-24 text-right tabular-nums">{net.toExponential(2)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-md border border-border/40 bg-card/30 p-2">
            <h3 className="text-[9px] font-display tracking-[0.28em] text-primary/80 mb-1.5">
              FLUX JOURNAL · LAST {view?.entries.length ?? 0}
            </h3>
            <div className="max-h-[220px] overflow-auto">
              <table className="w-full text-[9px] font-mono">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left px-1">TICK</th>
                    <th className="text-left px-1">FROM</th>
                    <th className="text-left px-1">TO</th>
                    <th className="text-right px-1">AMOUNT</th>
                  </tr>
                </thead>
                <tbody>
                  {(view?.entries ?? []).map((e, i) => (
                    <tr key={i} className="border-t border-border/20">
                      <td className="px-1 tabular-nums">{e.tick}</td>
                      <td className="px-1">{e.from < 0 ? "SINK" : `n=${desc.rungs[e.from]?.n ?? e.from}`}</td>
                      <td className="px-1">{e.to < 0 ? "SINK" : `n=${desc.rungs[e.to]?.n ?? e.to}`}</td>
                      <td className="px-1 text-right tabular-nums">{e.amount.toExponential(3)}</td>
                    </tr>
                  ))}
                  {(!view || view.entries.length === 0) && (
                    <tr>
                      <td colSpan={4} className="px-1 py-2 text-muted-foreground">
                        no transfers recorded yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <p className="text-[9px] font-mono text-muted-foreground px-1">
        Row sums are normalised to 1 (defect {num(desc.web.rowSumDefect, 3)}), so the matrix moves
        mass without creating it; every transfer above is booked twice, and the residue that cannot
        be placed within the band lands in the closure sink. Cells beyond the band carry the
        stable-ratio chords (rank offsets {snap.chords.join(", ") || "—"}), weighted φ^(−d/φ) and
        renormalised, so long-range structure never outranks a nearer neighbour.
      </p>
    </div>
  );
}
