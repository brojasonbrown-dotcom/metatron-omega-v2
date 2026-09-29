/**
 * TOROID deck — the six-section scan of one line-convergence grid.
 *
 * This is a measurement readout, not a dashboard. Every figure comes from
 * `scanRung` on the worker; a section with nothing real to report prints
 * ABSENT and says why, rather than showing a zeroed gauge that would read
 * as a measurement of a quiet toroid.
 */
import { useCallback, useMemo, useState } from 'react';
import { getOmegaRuntime } from '../omegaRuntime';
import { useOmegaState } from '../useOmegaRuntime';
import { useOmegaPull, useOmegaDescribe } from '../useOmegaPull';
import type { RungScanReport } from '@metatron/trnn-core';

type Status = RungScanReport['census']['status'];

const STATUS_CLASS: Record<Status, string> = {
  OK: 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10',
  DEFECT: 'text-rose-400 border-rose-400/40 bg-rose-400/10',
  ABSENT: 'text-muted-foreground border-border/50 bg-muted/10',
  WARMING: 'text-amber-400 border-amber-400/40 bg-amber-400/10',
};

function Badge({ status }: { status: Status }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[8px] font-display tracking-[0.18em] ${STATUS_CLASS[status]}`}
    >
      {status}
    </span>
  );
}

function Section({
  code,
  title,
  status,
  children,
}: {
  code: string;
  title: string;
  status: Status;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-card/30 p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[9px] font-mono text-muted-foreground">{code}</span>
        <h3 className="flex-1 text-[9px] font-display tracking-[0.28em] text-primary/80">
          {title}
        </h3>
        <Badge status={status} />
      </div>
      {children}
    </div>
  );
}

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] font-mono">
      {rows.map(([k, v]) => (
        <span key={k} className="contents">
          <span className="text-muted-foreground">{k}</span>
          <span className="text-right tabular-nums">{v}</span>
        </span>
      ))}
    </div>
  );
}

function Bars({ values, labels }: { values: readonly number[]; labels?: readonly string[] }) {
  const max = Math.max(1e-15, ...values.map(Math.abs));
  return (
    <div className="flex items-end gap-[3px] h-[54px]">
      {values.map((v, i) => (
        <div
          key={i}
          title={`${labels?.[i] ?? i}: ${v.toExponential(4)}`}
          className="flex-1 rounded-sm bg-primary/50"
          style={{ height: `${Math.max(1, (Math.abs(v) / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

const ABSENT_NOTE =
  'This section reports nothing because the rung carries no array for it — not because the measurement came back zero.';

export default function ToroidScanPanel() {
  const s = useOmegaState();
  const rt = getOmegaRuntime();
  const [rank, setRank] = useState(0);
  useOmegaDescribe(Boolean(s.snapshot));
  const request = useCallback(() => rt.requestScan(rank), [rt, rank]);
  useOmegaPull(request, 2, Boolean(s.snapshot));

  const rungs = s.description?.rungs ?? [];
  const r = s.scan && s.scan.rank === rank ? s.scan : null;

  const histo = useMemo(() => r?.organs.coherenceHistogram ?? [], [r]);

  if (!s.snapshot) {
    return (
      <div className="grid h-full place-items-center text-[11px] font-mono text-muted-foreground">
        Build the engine on the ENGINE deck to scan a toroid.
      </div>
    );
  }

  return (
    <div className="h-full space-y-2 overflow-auto p-2">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-background/40 px-2.5 py-2">
        <span className="text-[9px] font-display tracking-[0.2em] text-muted-foreground">
          TOROID
        </span>
        <select
          value={rank}
          onChange={(e) => setRank(Number(e.target.value))}
          className="rounded border border-border/60 bg-card px-2 py-1 text-[10px] font-mono"
        >
          {rungs.map((x) => (
            <option key={x.rank} value={x.rank}>
              n={x.n} · {x.nodes} nodes
            </option>
          ))}
          {rungs.length === 0 && <option value={0}>rung 0</option>}
        </select>
        {r && (
          <>
            <span className="text-[9px] font-mono text-muted-foreground">tick {r.tick}</span>
            <span
              className={`ml-auto rounded border px-2 py-0.5 text-[9px] font-display tracking-[0.2em] ${
                r.verdict.pass
                  ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400'
                  : 'border-rose-400/40 bg-rose-400/10 text-rose-400'
              }`}
            >
              {r.verdict.pass ? 'SCAN CLEAN' : `${r.verdict.defects.length} DEFECT`}
            </span>
          </>
        )}
      </div>

      {!r ? (
        <div className="p-2 text-[10px] font-mono text-muted-foreground">
          waiting for the first scan of this toroid…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            <Section code="S1" title="GRID CENSUS" status={r.census.status}>
              <Rows
                rows={[
                  ['convergences', String(r.census.nodes)],
                  ['lattice', r.census.latticeKind],
                  ['lines per node', String(r.census.incidentLines)],
                  ['golden stride', String(r.census.goldenStride)],
                  ['min separation', `${r.census.minSeparation.toExponential(3)} rad`],
                  ['separation × nodes', r.census.separationRatio.toFixed(6)],
                  ['modal basis', String(r.census.modes)],
                ]}
              />
            </Section>

            <Section code="S2" title="ORGAN READOUT" status={r.organs.status}>
              {r.organs.report ? (
                <>
                  <Rows
                    rows={[
                      ['mean local coherence', r.organs.report.meanLocalCoherence.toFixed(6)],
                      ['mean participation', r.organs.report.meanParticipation.toFixed(6)],
                      ['mean modal residual', r.organs.report.meanEigenResidual.toExponential(3)],
                      ['max modal residual', r.organs.report.maxEigenResidual.toExponential(3)],
                      ['live receptors', String(r.organs.report.receptors)],
                      ['bank age', `${r.organs.report.age} ticks`],
                      ['clean nodes', `${(r.organs.cleanFraction * 100).toFixed(1)}%`],
                    ]}
                  />
                  <p className="mt-1.5 text-[9px] font-mono text-muted-foreground">
                    coherence distribution across convergences
                  </p>
                  <Bars values={histo} />
                </>
              ) : (
                <p className="text-[9px] font-mono text-muted-foreground">{ABSENT_NOTE}</p>
              )}
            </Section>

            <Section code="S3" title="VIBRATION SPECTRUM" status={r.spectral.status}>
              {r.spectral.status === 'ABSENT' ? (
                <p className="text-[9px] font-mono text-muted-foreground">{ABSENT_NOTE}</p>
              ) : (
                <>
                  <Rows
                    rows={[
                      ['bands × window', `${r.spectral.bands} × ${r.spectral.depth} ticks`],
                      ['windows closed', String(r.spectral.windowsClosed)],
                      ['window phase', `${r.spectral.windowPhase}/${r.spectral.depth}`],
                      ['mean AC capture', r.spectral.meanCapture.toFixed(6)],
                      ['worst node capture', r.spectral.minCapture.toFixed(6)],
                      ['standing (DC) share', r.spectral.meanDcShare.toFixed(6)],
                      ['silent receptors', String(r.spectral.silentNodes)],
                      ['max bin drift', r.spectral.maxDrift.toExponential(3)],
                    ]}
                  />
                  <p className="mt-1.5 text-[9px] font-mono text-muted-foreground">
                    mean band occupancy — signed φ ladder, both circulation senses
                  </p>
                  <Bars
                    values={r.spectral.occupancy}
                    labels={r.spectral.plan.map((p) => `${p.frequency.toFixed(4)} c/t`)}
                  />
                  {r.spectral.probe && (
                    <div className="mt-2 border-t border-border/40 pt-1.5">
                      <p className="text-[9px] font-mono text-muted-foreground">
                        full-spectrum probe · node {r.spectral.probe.node} · φ ladder holds{' '}
                        {(r.spectral.probe.ladderShare * 100).toFixed(2)}% of its motion
                      </p>
                      <Rows
                        rows={r.spectral.probe.lines.map((l) => [
                          `${l.frequency.toFixed(4)} c/t ${l.onLadder ? '(on ladder)' : '(off ladder)'}`,
                          `${(l.share * 100).toFixed(2)}%`,
                        ])}
                      />
                    </div>
                  )}
                </>
              )}
            </Section>

            <Section code="S4" title="ENERGY STATE" status={r.energy.status}>
              {r.energy.status === 'ABSENT' ? (
                <p className="text-[9px] font-mono text-muted-foreground">{ABSENT_NOTE}</p>
              ) : (
                <Rows
                  rows={[
                    ['total field energy', r.energy.total.toExponential(6)],
                    ['peak convergence', `#${r.energy.peakNode}`],
                    ['peak share', `${(r.energy.peakShare * 100).toFixed(3)}%`],
                    ['distribution entropy', r.energy.entropy.toFixed(6)],
                    ['mean |frequency|', `${r.energy.meanFrequency.toExponential(3)} c/t`],
                    ['peak node frequency', `${r.energy.peakFrequency.toExponential(3)} c/t`],
                    ['hot nodes', r.energy.hotNodes.join(', ')],
                  ]}
                />
              )}
            </Section>

            <Section code="S5" title="SUPERPOSITIONAL FLUX" status={r.flux.status}>
              {r.flux.status === 'ABSENT' ? (
                <p className="text-[9px] font-mono text-muted-foreground">{ABSENT_NOTE}</p>
              ) : (
                <>
                  <Rows
                    rows={[
                      ['Σ divergence', r.flux.divergenceSum.toExponential(3)],
                      ['Σ |divergence|', r.flux.circulation.toExponential(6)],
                      ['closure defect', r.flux.closureDefect.toExponential(3)],
                      ['max |divergence|', r.flux.maxDivergence.toExponential(6)],
                      ['at convergence', `#${r.flux.maxDivergenceNode}`],
                    ]}
                  />
                  <p className="mt-1.5 text-[9px] font-mono text-muted-foreground">
                    Current on each of the four incident lines is antisymmetric, so the divergence
                    sum is structurally zero — the closure defect is what the grid actually
                    returned.
                  </p>
                </>
              )}
            </Section>

            <Section code="S6" title="VERDICT" status={r.verdict.pass ? 'OK' : 'DEFECT'}>
              {r.verdict.defects.length > 0 && (
                <ul className="space-y-1">
                  {r.verdict.defects.map((d) => (
                    <li key={d} className="text-[10px] font-mono text-rose-400">
                      {d}
                    </li>
                  ))}
                </ul>
              )}
              {r.verdict.notes.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {r.verdict.notes.map((n) => (
                    <li key={n} className="text-[9px] font-mono text-muted-foreground">
                      {n}
                    </li>
                  ))}
                </ul>
              )}
              {r.verdict.defects.length === 0 && r.verdict.notes.length === 0 && (
                <p className="text-[10px] font-mono text-emerald-400">
                  All five sections passed their laws on this frame.
                </p>
              )}
              <p className="mt-1.5 break-all text-[9px] font-mono text-muted-foreground">
                digest {r.verdict.digest}
              </p>
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
