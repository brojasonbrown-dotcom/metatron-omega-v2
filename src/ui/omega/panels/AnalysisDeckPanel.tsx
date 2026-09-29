/**
 * ANALYSIS deck — Ω-P9.
 *
 * What the machine can actually say about the relationships between its own
 * live channels, and — just as important — what it refuses to say. Every row
 * is either a measured association with the statistics behind it, or an
 * abstention with the reason printed. There is no third state, and no cell
 * ever shows a confident 0 for something that was never measured.
 */
import { useCallback } from 'react';
import { getAnalysisRuntime } from '../analysisRuntime';
import { useAnalysisState } from '../useAnalysisRuntime';
import type { PairFinding } from '@/core/analysis/analysisSpine';

const n4 = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(4);

const n1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '—');

function DirectionCell({ f }: { f: PairFinding }) {
  if (f.direction === null || f.directionVerdict === null || f.directionVerdict === 'none') {
    return <span className="text-muted-foreground">no directed evidence</span>;
  }
  const d = f.direction;
  const arrow = d > 0.05 ? `${f.a} → ${f.b}` : d < -0.05 ? `${f.b} → ${f.a}` : 'symmetric';
  return (
    <span className={d > 0.05 || d < -0.05 ? 'text-primary' : 'text-foreground'}>
      {arrow} <span className="text-muted-foreground">({n4(d)})</span>
    </span>
  );
}

export default function AnalysisDeckPanel() {
  const s = useAnalysisState();
  const rt = getAnalysisRuntime();
  const runNow = useCallback(() => {
    rt.analyse();
  }, [rt]);
  const reset = useCallback(() => {
    rt.reset();
  }, [rt]);

  const rep = s.report;

  return (
    <div className="h-full overflow-auto p-2 space-y-2">
      <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px] font-mono">
        <span className={s.running ? 'text-primary' : 'text-muted-foreground'}>
          {s.running ? '● sampling 16 Hz' : '○ idle'}
        </span>
        <span>
          frames <span className="text-foreground">{s.frames}</span>
        </span>
        <span>
          passes <span className="text-foreground">{s.passes}</span>
        </span>
        <span>
          pass cost <span className="text-foreground">{n1(s.lastPassMs)} ms</span>
        </span>
        <span>
          reported <span className="text-primary">{rep?.reported ?? 0}</span>
          {' / abstained '}
          <span className="text-muted-foreground">{rep?.abstained ?? 0}</span>
          {rep && rep.skipped > 0 ? (
            <>
              {' '}
              {' / over budget '}
              <span className="text-muted-foreground">{rep.skipped}</span>
            </>
          ) : null}
        </span>
        <button
          onClick={runNow}
          className="ml-auto px-2 py-0.5 border border-border/60 text-[9px] tracking-[0.2em] font-display hover:text-primary hover:border-primary/60"
        >
          ANALYSE NOW
        </button>
        <button
          onClick={reset}
          className="px-2 py-0.5 border border-border/60 text-[9px] tracking-[0.2em] font-display hover:text-destructive hover:border-destructive/60"
        >
          CLEAR
        </button>
      </div>

      {/* channel occupancy — names the silent source instead of showing nothing */}
      <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-2">
        <div className="text-[9px] font-display tracking-[0.25em] text-muted-foreground mb-1">
          CHANNELS
        </div>
        {s.channels.length === 0 ? (
          <div className="text-[10px] font-mono text-muted-foreground">
            No channel has produced a sample yet. Build the engine, enable memory drive, or open a
            sense channel — the spine only reads what is genuinely measured.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-0.5 text-[10px] font-mono">
            {s.channels.map((c) => (
              <div key={c.id} className="flex justify-between gap-2">
                <span className="text-muted-foreground truncate">{c.id}</span>
                <span className={c.count > 0 ? 'text-foreground' : 'text-muted-foreground'}>
                  {c.count}
                  <span className="text-muted-foreground">
                    {' '}
                    @ {Number.isFinite(c.hz) ? `${c.hz.toFixed(1)} Hz` : '— Hz'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ω-SCALE P1 — calibrated bands. A value without a band is a value the
          machine cannot yet bound; it says so rather than implying precision. */}
      <div className="rounded-md border border-border/40 bg-background/40">
        <div className="px-2.5 py-1.5 flex items-baseline gap-3 border-b border-border/30">
          <span className="text-[9px] font-display tracking-[0.25em] text-muted-foreground">
            CALIBRATED BANDS
          </span>
          <span className="text-[9px] font-mono text-muted-foreground">
            split-conformal · 90% · persistence baseline
          </span>
        </div>
        {s.calibration.length === 0 ? (
          <div className="px-2.5 py-3 text-[10px] font-mono text-muted-foreground">
            No channel has enough residuals for a finite-sample guarantee yet. Bands appear once a
            channel has produced 20+ measured transitions — never before.
          </div>
        ) : (
          <div className="divide-y divide-border/20">
            {s.calibration.map((c) => (
              <div
                key={c.id}
                className="px-2.5 py-1 grid grid-cols-[1fr_auto_auto_auto] gap-x-4 items-baseline text-[10px] font-mono"
              >
                <span className="text-muted-foreground truncate">{c.id}</span>
                <span className="text-foreground tabular-nums">
                  {n4(c.value)}
                  <span className="text-muted-foreground"> ± {n4(c.halfWidth)}</span>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  [{n4(c.lower)}, {n4(c.upper)}]
                </span>
                <span className={c.stale ? 'text-destructive' : 'text-muted-foreground'}>
                  {Number.isFinite(c.coverage)
                    ? `cov ${(c.coverage * 100).toFixed(0)}%${c.stale ? ' STALE' : ''}`
                    : `n=${c.samples}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ω-SCALE P2 — tiered retention. Admission is by surprise in band
          half-widths, so a frame that carries no new information is not kept. */}
      <div className="rounded-md border border-border/40 bg-background/40">
        <div className="px-2.5 py-1.5 flex items-baseline gap-3 border-b border-border/30">
          <span className="text-[9px] font-display tracking-[0.25em] text-muted-foreground">
            TIERED RETENTION
          </span>
          <span className="text-[9px] font-mono text-muted-foreground">
            admitted {s.retention.admitted} · rejected {s.retention.rejected} · evicted{' '}
            {s.retention.evicted}
          </span>
        </div>
        <div className="divide-y divide-border/20">
          {s.retention.tiers.map((t) => (
            <div
              key={t.tier}
              className="px-2.5 py-1 grid grid-cols-[1fr_auto_auto_auto] gap-x-4 items-baseline text-[10px] font-mono"
            >
              <span className="text-muted-foreground uppercase">{t.tier}</span>
              <span className="text-foreground tabular-nums">
                {t.count}
                <span className="text-muted-foreground"> / {t.capacity}</span>
              </span>
              <span className="text-muted-foreground tabular-nums">
                {t.numbers.toLocaleString()} nums
              </span>
              <span className="text-muted-foreground tabular-nums">
                floor {t.floor.toFixed(3)} · x̄σ {t.meanSurprise.toFixed(2)}
              </span>
            </div>
          ))}
          <div className="px-2.5 py-1 text-[10px] font-mono text-muted-foreground">
            held {s.retention.numbers.toLocaleString()} of{' '}
            {s.retention.capacityNumbers.toLocaleString()} numbers this policy can ever hold
          </div>
        </div>
      </div>

      {/* Ω-SCALE P4 — measured host capability and the projected split. */}
      <div className="rounded-md border border-border/40 bg-background/40">
        <div className="px-2.5 py-1.5 text-[9px] font-display tracking-[0.25em] text-muted-foreground border-b border-border/30">
          THROUGHPUT PLAN
        </div>
        <div className="px-2.5 py-1.5 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-0.5 text-[10px] font-mono">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">cores</span>
            <span>{s.throughput.cores ?? '—'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">workers</span>
            <span>{s.throughput.workers ? 'yes' : 'no'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">webgpu api</span>
            <span>{s.throughput.webgpuApi ? 'yes' : 'no'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">shared mem</span>
            <span>{s.throughput.sharedMemory ? 'yes' : 'no'}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">planned</span>
            <span>{s.throughput.plannedWorkers}w</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">speedup</span>
            <span>{s.throughput.projectedSpeedup.toFixed(2)}×</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">amdahl</span>
            <span>{s.throughput.amdahlCeiling.toFixed(2)}×</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">worth it</span>
            <span className={s.throughput.worthwhile ? 'text-foreground' : 'text-muted-foreground'}>
              {s.throughput.worthwhile ? 'yes' : 'no'}
            </span>
          </div>
        </div>
      </div>

      {/* findings */}
      <div className="rounded-md border border-border/40 bg-background/40">
        <div className="px-2.5 py-1.5 text-[9px] font-display tracking-[0.25em] text-muted-foreground border-b border-border/30">
          PAIR FINDINGS
        </div>
        {!rep || rep.findings.length === 0 ? (
          <div className="px-2.5 py-3 text-[10px] font-mono text-muted-foreground">
            No pass has completed yet.
          </div>
        ) : (
          <table className="w-full text-[10px] font-mono">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border/20">
                <th className="text-left px-2.5 py-1 font-normal">pair</th>
                <th className="text-right px-2 py-1 font-normal">n</th>
                <th className="text-right px-2 py-1 font-normal">assoc</th>
                <th className="text-right px-2 py-1 font-normal">ρ</th>
                <th className="text-right px-2 py-1 font-normal">dCor</th>
                <th className="text-right px-2 py-1 font-normal">MI</th>
                <th className="text-left px-2 py-1 font-normal">direction / reason</th>
              </tr>
            </thead>
            <tbody>
              {rep.findings.map((f) => {
                const abstain = f.verdict === 'abstain';
                return (
                  <tr key={`${f.a}|${f.b}`} className="border-b border-border/10">
                    <td className="px-2.5 py-1 truncate">
                      {f.a} <span className="text-muted-foreground">·</span> {f.b}
                    </td>
                    <td className="px-2 py-1 text-right text-muted-foreground">{f.n}</td>
                    <td
                      className={`px-2 py-1 text-right ${
                        abstain ? 'text-muted-foreground' : 'text-primary'
                      }`}
                    >
                      {n4(f.association)}
                    </td>
                    <td className="px-2 py-1 text-right">{n4(f.correlation?.pearson.value)}</td>
                    <td className="px-2 py-1 text-right">{n4(f.correlation?.dcor.value)}</td>
                    <td className="px-2 py-1 text-right">{n4(f.correlation?.mi.value)}</td>
                    <td className="px-2 py-1 truncate">
                      {abstain ? (
                        <span className="text-muted-foreground">abstained — {f.reason}</span>
                      ) : (
                        <DirectionCell f={f} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Ω-P9.3 — evidence. Each pass is hashed into an append-only log and
          published under a signed head; the audit below is recomputed live. */}
      <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-2">
        <div className="flex items-center gap-x-4 flex-wrap text-[10px] font-mono">
          <span className="text-[9px] font-display tracking-[0.25em] text-muted-foreground">
            EVIDENCE LEDGER
          </span>
          <span>
            sealed <span className="text-foreground">{s.ledger.size}</span>
          </span>
          <span className="truncate">
            root <span className="text-foreground">{s.ledger.rootHex.slice(0, 16) || '—'}</span>
          </span>
          <span
            className={
              s.ledger.size === 0
                ? 'text-muted-foreground'
                : s.ledger.verified
                  ? 'text-primary'
                  : 'text-destructive'
            }
          >
            {s.ledger.size === 0
              ? 'nothing sealed yet'
              : s.ledger.verified
                ? '✓ inclusion + signature verified'
                : `✗ ${s.ledger.verifyReason}`}
          </span>
        </div>
        {s.ledger.recent.length > 0 ? (
          <div className="mt-1 space-y-0.5 text-[10px] font-mono max-h-28 overflow-auto">
            {s.ledger.recent.map((e) => (
              <div key={e.pass.index} className="flex gap-3 text-muted-foreground">
                <span className="w-10 text-right">#{e.pass.index}</span>
                <span className="text-foreground">{e.pass.leafHex.slice(0, 12)}</span>
                <span>
                  {e.pass.reported} reported · {e.pass.abstained} abstained
                </span>
                <span className="ml-auto">
                  {new Date(e.pass.timestamp).toISOString().slice(11, 19)}Z
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Ω-P9.4 — consolidation. The sealed findings are swept by the certified
          ten-operator protocol; a failing sweep is shown, never hidden. */}
      <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-2">
        <div className="flex items-center gap-x-4 flex-wrap text-[10px] font-mono">
          <span className="text-[9px] font-display tracking-[0.25em] text-muted-foreground">
            CONSOLIDATION
          </span>
          <span>
            cycles <span className="text-foreground">{s.consolidation.cycles}</span>
          </span>
          <span>
            atoms <span className="text-foreground">{s.consolidation.atoms}</span>
          </span>
          <span>
            open <span className="text-foreground">{s.consolidation.open}</span>
          </span>
          <span>
            prototypes <span className="text-foreground">{s.consolidation.prototypes}</span>
          </span>
          <span>
            superseded <span className="text-foreground">{s.consolidation.superseded}</span>
          </span>
          <span>
            contradictions{' '}
            <span
              className={
                s.consolidation.contradictions > 0 ? 'text-destructive' : 'text-foreground'
              }
            >
              {s.consolidation.contradictions}
            </span>
          </span>
          {Number.isFinite(s.consolidation.lastCycleMs) ? (
            <span className="ml-auto text-muted-foreground">
              {s.consolidation.lastCycleMs.toFixed(1)} ms/cycle
            </span>
          ) : null}
        </div>
        {s.consolidation.sweeps.length > 0 ? (
          <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 text-[10px] font-mono">
            {s.consolidation.sweeps.map((w) => (
              <div key={w.n} className="flex gap-2 text-muted-foreground">
                <span className="w-5 text-right">{w.n}</span>
                <span className="text-foreground truncate">{w.name}</span>
                <span className={w.ok ? 'ml-auto text-primary' : 'ml-auto text-destructive'}>
                  {w.ok ? 'ok' : (w.reason ?? 'failed')}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-1 text-[10px] font-mono text-muted-foreground">
            no cycle yet — the protocol runs every third sealed pass
          </div>
        )}
      </div>

      {rep?.strongest ? (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2 text-[10px] font-mono">
          strongest measured coupling:{' '}
          <span className="text-primary">
            {rep.strongest.a} · {rep.strongest.b}
          </span>{' '}
          at {n4(rep.strongest.association)} over {rep.strongest.n} paired samples
          {rep.strongest.bus?.vetoId ? (
            <span className="text-muted-foreground">
              {' '}
              · held down by {rep.strongest.bus.vetoId} ({n4(rep.strongest.bus.vetoValue)})
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
