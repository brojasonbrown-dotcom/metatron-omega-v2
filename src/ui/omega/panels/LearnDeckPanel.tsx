/**
 * LEARN deck — Ω-P8 learning tiers.
 *
 * Three honest readouts:
 *   • CERTIFICATES — the constrained parametrizations and the worst-case Jury
 *     gain over *all* parameter values at the current gate. These hold by
 *     construction; the deck shows the measured value next to the bound.
 *   • BATTERY — the held-out verdict. A learnable ships only when its measured
 *     margin on data it never trained on clears φ⁻²; otherwise the gate stays
 *     at 0 and the cell is bit-exact with the certified baseline.
 *   • TIERS — measured execution tiers. Nothing is assumed available: each row
 *     carries the evidence or the reason it is off.
 */
import { useCallback, useEffect, useState } from 'react';
import { getOmegaRuntime } from '../omegaRuntime';
import { useOmegaState } from '../useOmegaRuntime';

const num = (x: number | undefined, d = 4) =>
  x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d);

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <>
      <span className="text-muted-foreground">{k}</span>
      <span className={`tabular-nums ${tone ?? ''}`}>{v}</span>
    </>
  );
}

const SLOTS = ['G', 'P', 'R', 'Π', 'ẑ'];

export default function LearnDeckPanel() {
  const s = useOmegaState();
  const rt = getOmegaRuntime();
  const [iterations, setIterations] = useState(240);
  const [sidecar, setSidecar] = useState('');

  useEffect(() => {
    rt.probeTiers(undefined, '/api/public/omega-train');
  }, [rt]);

  const run = useCallback(() => rt.runBattery(iterations), [rt, iterations]);
  const reprobe = useCallback(
    () => rt.probeTiers(sidecar.trim() || undefined, '/api/public/omega-train'),
    [rt, sidecar],
  );

  const run0 = s.learn;
  const rep = run0?.report;
  const shipped = Boolean(rep?.enabled);

  return (
    <div className="h-full overflow-auto p-2 space-y-2">
      {/* headline + controls */}
      <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] font-mono">
        <span className="text-muted-foreground tracking-widest">Ω-P8 · LEARNABLE CELL</span>
        <span className={shipped ? 'text-primary' : 'text-muted-foreground'}>
          {rep ? (shipped ? 'SHIPPED — gate open' : 'DISABLED — gate 0') : 'NOT MEASURED'}
        </span>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">SPSA iters</span>
          <input
            type="number"
            min={20}
            max={2000}
            step={20}
            value={iterations}
            onChange={(e) =>
              setIterations(Math.max(20, Math.min(2000, Number(e.target.value) || 240)))
            }
            className="w-20 bg-background border border-border/50 rounded px-1.5 py-0.5 tabular-nums"
          />
        </label>
        <button
          onClick={run}
          disabled={!s.snapshot || s.learning}
          className="px-2.5 py-1 rounded border border-primary/50 text-primary disabled:opacity-40 hover:bg-primary/10 tracking-widest"
        >
          {s.learning ? 'TRAINING…' : 'RUN BATTERY'}
        </button>
        {!s.snapshot && <span className="text-muted-foreground">build the engine first</span>}
        {run0 && (
          <span className="text-muted-foreground">
            {run0.elapsedMs} ms · {run0.nodes} nodes
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {/* battery */}
        <section className="rounded-md border border-border/40 bg-background/40 p-2.5 space-y-2">
          <header className="text-[10px] font-mono tracking-widest text-muted-foreground">
            BATTERY · held-out, temporal split, no leakage
          </header>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
            <Row k="baseline train NRMSE" v={num(rep?.baselineTrain)} />
            <Row k="baseline hold NRMSE" v={num(rep?.baselineHold)} />
            <Row k="learned train NRMSE" v={num(rep?.learnedTrain)} />
            <Row k="learned hold NRMSE" v={num(rep?.learnedHold)} />
            <Row
              k="held-out margin"
              v={num(rep?.margin)}
              tone={shipped ? 'text-primary' : 'text-destructive'}
            />
            <Row k="required (φ⁻²)" v={num(rep?.required)} />
            <Row k="train / hold pairs" v={rep ? `${rep.trainPairs} / ${rep.holdPairs}` : '—'} />
            <Row k="iterations" v={String(rep?.iterations ?? 0)} />
          </div>
          <div
            className={`text-[9px] font-mono leading-relaxed ${
              shipped ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            {rep?.verdict ?? 'No verdict yet — the cell ships disabled until a battery is run.'}
          </div>
          {rep && (
            <div className="border-t border-border/30 pt-1.5 space-y-1">
              <div className="text-[9px] font-mono tracking-widest text-muted-foreground">
                DRIVE MIX · ℓ¹ budget{' '}
                {num(
                  rep.mix.reduce((a, b) => a + b, 0),
                  6,
                )}
              </div>
              {rep.mix.map((w, i) => (
                <div key={SLOTS[i]} className="flex items-center gap-2 text-[9px] font-mono">
                  <span className="w-4 text-muted-foreground">{SLOTS[i]}</span>
                  <div className="flex-1 h-1.5 bg-border/30 rounded overflow-hidden">
                    <div
                      className="h-full bg-primary/70"
                      style={{
                        width: `${(w / Math.max(1e-12, Math.max(...rep.mix))) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="tabular-nums w-20 text-right">{num(w, 6)}</span>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-x-4 text-[10px] font-mono pt-1">
                <Row k="λ (bounded eig)" v={num(rep.lambda, 6)} />
                <Row k="gate" v={num(rep.gate, 3)} tone={shipped ? 'text-primary' : ''} />
              </div>
            </div>
          )}
        </section>

        {/* certificates */}
        <section className="rounded-md border border-border/40 bg-background/40 p-2.5 space-y-2">
          <header className="text-[10px] font-mono tracking-widest text-muted-foreground">
            CERTIFICATES · hold for every parameter value, not just the trained one
          </header>
          {(run0?.certificates ?? []).length === 0 ? (
            <div className="text-[9px] font-mono text-muted-foreground">
              Run the battery to stamp certificates from the live parametrization.
            </div>
          ) : (
            <div className="space-y-1.5">
              {run0!.certificates.map((c) => (
                <div key={c.kind} className="space-y-0.5">
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <span className={c.holds ? 'text-primary' : 'text-destructive'}>{c.kind}</span>
                    <span className="tabular-nums">
                      {num(c.measured, 6)} ≤ {num(c.bound, 6)}
                    </span>
                  </div>
                  <div className="text-[9px] font-mono text-muted-foreground">{c.statement}</div>
                </div>
              ))}
            </div>
          )}
          <div className="text-[9px] font-mono text-muted-foreground leading-relaxed border-t border-border/30 pt-1.5">
            Learning is a bounded additive correction on top of the certified nine-term cell. At
            gate 0 the step is bit-identical to the baseline; at gate 1 the worst-case homogeneous
            gain is still below 1 for every point of parameter space, so the contraction can never
            be trained away.
          </div>
        </section>
      </div>

      {/* tiers */}
      <section className="rounded-md border border-border/40 bg-background/40 p-2.5 space-y-2">
        <header className="flex items-center justify-between">
          <span className="text-[10px] font-mono tracking-widest text-muted-foreground">
            EXECUTION TIERS · measured, never assumed
          </span>
          <div className="flex items-center gap-1.5 text-[10px] font-mono">
            <input
              value={sidecar}
              onChange={(e) => setSidecar(e.target.value)}
              placeholder="sidecar URL (http://127.0.0.1:8765)"
              className="w-56 bg-background border border-border/50 rounded px-1.5 py-0.5"
            />
            <button
              onClick={reprobe}
              className="px-2 py-0.5 rounded border border-border/60 hover:bg-primary/10 tracking-widest"
            >
              PROBE
            </button>
          </div>
        </header>
        <div className="space-y-1">
          {(s.tiers?.tiers ?? []).map((t) => (
            <div
              key={t.id}
              className="grid grid-cols-[3rem_9rem_1fr] gap-2 text-[10px] font-mono items-baseline"
            >
              <span className={t.available ? 'text-primary' : 'text-muted-foreground'}>{t.id}</span>
              <span className={t.available ? '' : 'text-muted-foreground'}>{t.label}</span>
              <span className="text-muted-foreground">
                {t.reason}
                {t.evidence
                  ? ` · ${Object.entries(t.evidence)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(' ')}`
                  : ''}
              </span>
            </div>
          ))}
          {!s.tiers && (
            <div className="text-[9px] font-mono text-muted-foreground">Probing tiers…</div>
          )}
        </div>
        {s.tiers && (
          <div className="text-[9px] font-mono text-muted-foreground border-t border-border/30 pt-1.5">
            selected: <span className="text-primary">{s.tiers.selected}</span> — training runs on
            the highest tier that actually answered; T0 is the guaranteed floor.
          </div>
        )}
      </section>
    </div>
  );
}
