/**
 * SPECTRAL deck — measured analysis/synthesis roundtrip on the shell and
 * radial planes for one rung. The error figures are what the planes actually
 * returned on this frame, not a tolerance constant.
 */
import { useCallback, useMemo, useState } from 'react';
import { getOmegaRuntime } from '../omegaRuntime';
import { useOmegaState } from '../useOmegaRuntime';
import { useOmegaPull, useOmegaDescribe } from '../useOmegaPull';
import { useCognitive } from '../useCognitive';
import { descendTo, closureDefect, levelEnergies } from '@metatron/trnn-core/operator/nestedField';

const sci = (v: number) => (Number.isFinite(v) ? v.toExponential(3) : '—');
const fx = (v: number, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : '—');

function Witness({
  label,
  value,
  note,
  good,
}: {
  label: string;
  value: string;
  note: string;
  good?: boolean;
}) {
  return (
    <div className="rounded border border-border/30 bg-background/40 px-2 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9px] font-display tracking-[0.2em] text-muted-foreground">
          {label}
        </span>
        <span
          className={`text-[11px] font-mono tabular-nums ${
            value === '\u2014'
              ? 'text-muted-foreground'
              : good === false
                ? 'text-amber-400'
                : good
                  ? 'text-emerald-400'
                  : 'text-foreground'
          }`}
        >
          {value}
        </span>
      </div>
      <p className="text-[9px] font-mono text-muted-foreground mt-0.5 leading-snug">{note}</p>
    </div>
  );
}

function Plane({
  title,
  report,
}: {
  title: string;
  report: { roundtrip: number; gramDefect: number; width: number };
}) {
  return (
    <div className="rounded-md border border-border/40 bg-card/30 p-2">
      <h3 className="text-[9px] font-display tracking-[0.28em] text-primary/80 mb-1.5">{title}</h3>
      <div className="grid grid-cols-2 gap-x-4 text-[10px] font-mono">
        <span className="text-muted-foreground">roundtrip error</span>
        <span
          className={`text-right tabular-nums ${report.roundtrip < 1e-9 ? 'text-emerald-400' : 'text-amber-400'}`}
        >
          {report.roundtrip.toExponential(3)}
        </span>
        <span className="text-muted-foreground">raw Gram defect</span>
        <span className="text-right tabular-nums">{report.gramDefect.toExponential(3)}</span>
        <span className="text-muted-foreground">basis width</span>
        <span className="text-right tabular-nums">{report.width}</span>
      </div>
      <p className="text-[9px] font-mono text-muted-foreground mt-1.5">
        Roundtrip is measured against the plane&apos;s own quadrature weights; the Gram defect is
        the pre-orthonormalization figure, so a small roundtrip beside a larger defect means the
        re-orthogonalization did its job.
      </p>
    </div>
  );
}

export default function SpectralDeckPanel() {
  const s = useOmegaState();
  const rt = getOmegaRuntime();
  const [rank, setRank] = useState(0);
  useOmegaDescribe(Boolean(s.snapshot));
  const request = useCallback(() => rt.requestSpectral(rank), [rt, rank]);
  useOmegaPull(request, 2, Boolean(s.snapshot));

  const cog = useCognitive();
  const view = s.spectral && s.spectral.rank === rank ? s.spectral : null;
  const rungs = s.description?.rungs ?? [];
  /**
   * Ω-UNBOUND — the nesting witness, measured on THIS frame's signature.
   *
   * The signature is descended through narrower rungs and rebuilt. The defect
   * is the energy the chain failed to account for; a closed toroid sits at the
   * float64 floor. Nothing here writes to the engine.
   */
  const nest = useMemo(() => {
    const sig = view?.signature;
    if (!sig || sig.length < 8) return null;
    const n = sig.length;
    const f = {
      re: Float64Array.from(sig),
      im: new Float64Array(n),
      n,
    };
    const ladder = [3, 5, 8].filter((w) => w < n);
    if (ladder.length === 0) return null;
    try {
      const nested = descendTo(f, ladder);
      const w = closureDefect(nested, f);
      const e = levelEnergies(nested);
      const total = e.reduce((a, b) => a + b, 0) || 1;
      return {
        widths: nested.widths,
        shares: e.map((x) => x / total),
        defect: w.defect,
        floor: w.floor,
        closed: w.closed,
        depth: w.depth,
      };
    } catch {
      return null;
    }
  }, [view]);

  const sigMax = useMemo(() => Math.max(1e-12, ...(view?.signature ?? [1]).map(Math.abs)), [view]);

  if (!s.snapshot) {
    return (
      <div className="h-full grid place-items-center text-[11px] font-mono text-muted-foreground">
        Build the engine on the ENGINE deck to run the spectral planes.
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/40 bg-background/40 px-2.5 py-2">
        <span className="text-[9px] font-display tracking-[0.2em] text-muted-foreground">RUNG</span>
        <select
          value={rank}
          onChange={(e) => setRank(Number(e.target.value))}
          className="bg-card border border-border/60 rounded px-2 py-1 text-[10px] font-mono"
        >
          {rungs.map((r) => (
            <option key={r.rank} value={r.rank}>
              n={r.n} · {r.nodes} nodes
            </option>
          ))}
          {rungs.length === 0 && <option value={0}>rung 0</option>}
        </select>
        <span className="text-[9px] font-mono text-muted-foreground ml-2">
          {view ? view.source : 'measuring…'}
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        {view ? (
          <>
            <Plane title="SPHERICAL SHELL · REAL SHT" report={view.shell} />
            <Plane title="RADIAL · SPHERICAL BESSEL" report={view.radial} />
          </>
        ) : (
          <div className="text-[10px] font-mono text-muted-foreground p-2">
            waiting for the first spectral report…
          </div>
        )}
      </div>

      {/* Ω-CONSISTENCY K2 / Ω-10 — the graded operator witnesses, measured on the
          live signature stream. Every one of these is observation-only. */}
      <div className="rounded-md border border-border/40 bg-card/30 p-2">
        <div className="flex items-baseline justify-between gap-3 mb-1.5">
          <h3 className="text-[9px] font-display tracking-[0.28em] text-primary/80">
            GRADED WITNESSES
          </h3>
          <span className="text-[9px] font-mono text-muted-foreground">
            {cog.passes > 0
              ? `${cog.passes} passes · rung ${cog.rank ?? '—'} · ${cog.salient} salient`
              : 'no spectral pass yet — run the engine'}
          </span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
          <Witness
            label="DRIFT"
            value={sci(cog.drift)}
            note={`band x̄ ${sci(cog.meanDrift)} · σ ${sci(cog.sigmaDrift)}`}
          />
          <Witness
            label="ROUGHNESS h1/l2"
            value={fx(cog.roughness)}
            note="shape movement vs pure amplitude — scale invariant"
          />
          <Witness
            label="LEAKAGE"
            value={fx(cog.leakage)}
            note={`window seam tail · continuity gain ${fx(cog.continuity, 2)}×`}
            good={Number.isFinite(cog.leakage) ? cog.leakage < 0.1 : undefined}
          />
          <Witness
            label="PERSISTENCE"
            value={fx(cog.persistence)}
            note={`novelty vs slow memory · contraction ${fx(cog.contraction, 3)}`}
            good={Number.isFinite(cog.contraction) ? cog.contraction < 1 : undefined}
          />
          <Witness
            label="CIRCULATION"
            value={fx(cog.circulation)}
            note="driver-invariant mode-graph Hodge witness"
          />
          <Witness
            label="ENTROPY"
            value={fx(cog.entropy)}
            note="spectral occupancy of the signature"
          />
          <Witness
            label="RESIDUAL"
            value={sci(cog.residual)}
            note="analysis/synthesis residual this pass"
          />
          <Witness
            label="KNOWLEDGE"
            value={`${cog.latentBuilds} / ${cog.signatureSweeps}`}
            note="latent builds / signature sweeps"
          />
        </div>
      </div>

      {nest && (
        <div className="rounded-md border border-border/40 bg-card/30 p-2">
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <h3 className="text-[9px] font-display tracking-[0.28em] text-primary/80">
              NESTING · RESIDUAL TORUS
            </h3>
            <span
              className={`text-[9px] font-mono ${nest.closed ? 'text-emerald-400' : 'text-amber-400'}`}
            >
              {nest.closed ? 'CLOSED' : 'NOT CLOSED'} · depth {nest.depth}
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5">
            <Witness
              label="CLOSURE DEFECT"
              value={sci(nest.defect)}
              note={`float64 floor ${sci(nest.floor)}`}
              good={nest.closed}
            />
            {nest.widths.map((w, i) => (
              <Witness
                key={w}
                label={i === 0 ? `BASE w=${w}` : `RESIDUAL w=${w}`}
                value={`${(100 * nest.shares[i]).toFixed(1)}%`}
                note={
                  i === 0
                    ? 'coarsest view — what a flat rung would keep'
                    : 'energy no narrower rung could represent'
                }
              />
            ))}
          </div>
          <p className="text-[9px] font-mono text-muted-foreground mt-1.5">
            Each level is exactly what its parent could not say, so resolution is depth rather than
            grid width. A defect at the float64 floor means the chain closes on itself with nothing
            unaccounted for; anything above it is reported as unclosed rather than presented as
            lossless.
          </p>
        </div>
      )}

      {view && (
        <div className="rounded-md border border-border/40 bg-card/30 p-2">
          <h3 className="text-[9px] font-display tracking-[0.28em] text-primary/80 mb-1.5">
            φ-WEIGHTED SHELL SIGNATURE
          </h3>
          <div className="flex items-end gap-[3px] h-[70px]">
            {view.signature.map((x, i) => (
              <div
                key={i}
                title={`slot ${i}: ${x.toExponential(4)}`}
                className="flex-1 bg-primary/50 rounded-sm"
                style={{ height: `${Math.max(1, (Math.abs(x) / sigMax) * 100)}%` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
