/**
 * SELF deck — the machine's own registry, genome audit and test harness.
 *
 * Every number here is measured on demand from the live runtimes. Nothing is
 * cached from a previous session and nothing is estimated: a metric that
 * cannot be read renders as "n/a", and a module that is not running renders
 * with its true state rather than a friendly label.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  buildRegistry,
  runCheapTests,
  runHeavyTests,
  setLastTestRun,
  getLastTestRun,
} from '../selfRegistry';
import { getKnowledgeRuntime } from '../knowledgeRuntime';
import {
  measureGenomeHealth,
  measureMeaning,
  measureSelfRetrieval,
  type GenomeHealth,
  type MeaningReport,
  type RetrievalReport,
} from '@/core/knowledge/genome';
import type { LiveState, SelfRegistry, SelfTestRun } from '@/core/self/types';
import { crossMap, type CrossMap, type EdgeStatus } from '@/core/self/crossMap';
import { ATLAS_BY_ID } from '@/core/self/atlas';

const STATE_STYLE: Record<LiveState, string> = {
  live: 'text-primary border-primary/50 bg-primary/10',
  dormant: 'text-muted-foreground border-border bg-muted/20',
  stale: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  absent: 'text-destructive border-destructive/40 bg-destructive/10',
};

function Val({ v, unit }: { v: number | string | null; unit?: string }) {
  if (v === null) return <span className="text-muted-foreground/60">n/a</span>;
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : v;
  return (
    <span className="text-foreground">
      {s}
      {unit ? ` ${unit}` : ''}
    </span>
  );
}

export default function SelfDeckPanel() {
  const [registry, setRegistry] = useState<SelfRegistry | null>(null);
  const [genome, setGenome] = useState<GenomeHealth | null>(null);
  const [meaning, setMeaning] = useState<MeaningReport | null>(null);
  const [retrieval, setRetrieval] = useState<RetrievalReport | null>(null);
  const [run, setRun] = useState<SelfTestRun | null>(getLastTestRun());
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [map, setMap] = useState<CrossMap | null>(null);

  const refresh = useCallback(() => {
    const reg = buildRegistry();
    setRegistry(reg);
    setMap(crossMap(reg));
    const kb = getKnowledgeRuntime().kb;
    if (kb.stats().chunks > 0) {
      setGenome(measureGenomeHealth(kb, 128));
      setMeaning(measureMeaning(kb, 10, 6));
      setRetrieval(measureSelfRetrieval(kb, 10));
    } else {
      setGenome(null);
      setMeaning(null);
      setRetrieval(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const cheap = () => {
    setBusy('cheap');
    const r = runCheapTests();
    setLastTestRun(r);
    setRun(r);
    setBusy(null);
  };
  const heavy = async () => {
    setBusy('heavy');
    const r = await runHeavyTests();
    setLastTestRun(r);
    setRun(r);
    setBusy(null);
  };

  const c = registry?.counts;

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 text-[11px] font-mono">
      {/* header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-display text-[10px] tracking-[0.28em] text-primary">
          SELF REGISTRY
        </span>
        {c && (
          <span className="text-muted-foreground">
            {registry!.modules.length} modules · <span className="text-primary">{c.live} live</span>{' '}
            · {c.dormant} dormant · <span className="text-amber-400">{c.stale} stale</span> ·{' '}
            <span className="text-destructive">{c.absent} absent</span>
          </span>
        )}
        <div className="ml-auto flex gap-1">
          <button
            onClick={refresh}
            className="px-2 py-0.5 border border-border rounded text-[10px] hover:bg-muted/40"
          >
            REMEASURE
          </button>
          <button
            onClick={cheap}
            disabled={busy !== null}
            className="px-2 py-0.5 border border-primary/50 text-primary rounded text-[10px] hover:bg-primary/10 disabled:opacity-40"
          >
            {busy === 'cheap' ? 'RUNNING…' : 'SELF-TEST'}
          </button>
          <button
            onClick={() => void heavy()}
            disabled={busy !== null}
            className="px-2 py-0.5 border border-border rounded text-[10px] hover:bg-muted/40 disabled:opacity-40"
          >
            {busy === 'heavy' ? 'RUNNING…' : 'DEEP TEST'}
          </button>
        </div>
      </div>

      {/* modules */}
      <div className="space-y-1">
        {registry?.modules.map((m) => {
          const isOpen = open === m.id;
          return (
            <div key={m.id} className="border border-border/40 rounded bg-card/40">
              <button
                onClick={() => setOpen(isOpen ? null : m.id)}
                className="w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-muted/20"
              >
                <span
                  className={`px-1.5 py-px rounded border text-[9px] tracking-wider ${STATE_STYLE[m.state]}`}
                >
                  {m.state.toUpperCase()}
                </span>
                <span className="text-foreground">{m.title}</span>
                <span className="text-muted-foreground/60">{m.id}</span>
                <span className="ml-auto text-muted-foreground/50 text-[10px]">
                  {isOpen ? '−' : '+'}
                </span>
              </button>
              {isOpen && (
                <div className="px-3 pb-2 space-y-1 text-[10px] text-muted-foreground">
                  <div>
                    <span className="text-foreground/70">purpose:</span> {m.purpose}
                  </div>
                  <div>
                    <span className="text-foreground/70">contract:</span> {m.contract}
                  </div>
                  <div>
                    <span className="text-foreground/70">evidence:</span> {m.detail}
                  </div>
                  <div>
                    <span className="text-foreground/70">source:</span> {m.source}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 pt-1">
                    {m.metrics.map((x) => (
                      <div key={x.label} className="flex justify-between border-b border-border/20">
                        <span>{x.label}</span>
                        <Val v={x.value} unit={x.unit} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* structure — Ω-MAP */}
      <StructureStrip map={map} />

      {/* genome */}
      <div>
        <div className="font-display text-[10px] tracking-[0.28em] text-primary mb-1">
          GENOME AUDIT
        </div>
        {genome ? (
          <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-[10px]">
            {(
              [
                ['version', genome.version],
                ['dim', genome.dim],
                ['chunks', genome.chunks],
                ['sampled', genome.sampled],
                ['fill', genome.fill],
                ['norm', genome.norm],
                ['anisotropy', genome.anisotropy],
                ['lsh false+', genome.barcodeFalsePositive],
                ['re-encode exact', String(genome.reencodeExact)],
                ['drifted', genome.driftedChunks],
                ['cross-modal', genome.crossModal],
                ['field sig tier', genome.fieldSignatureTier ?? 'none'],
                ['field sig width', genome.fieldSignatureWidth],
                ['field sig coverage', genome.fieldSignatureCoverage],
                ['top1 recall', retrieval?.top1 ?? null],
                ['top5 recall', retrieval?.top5 ?? null],
                ['term precision', meaning?.meanPrecision ?? null],
                ['field agreement', meaning?.meanFieldAgreement ?? null],
              ] as [string, number | string | null][]
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-border/20">
                <span className="text-muted-foreground">{k}</span>
                <Val v={v} />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground text-[10px]">
            Corpus is empty — nothing to audit. Acquire material from the COGNITION deck first.
          </div>
        )}
      </div>

      {/* meaning rows */}
      {meaning && meaning.rows.length > 0 && (
        <div>
          <div className="font-display text-[10px] tracking-[0.28em] text-primary mb-1">
            MEANING CORRELATION
          </div>
          <div className="space-y-0.5 text-[10px]">
            {meaning.rows.map((r) => (
              <div key={r.term} className="flex gap-2 border-b border-border/20">
                <span className="w-32 truncate text-foreground">{r.term}</span>
                <span className="text-muted-foreground">hits {r.returned}</span>
                <span className={r.precision >= 0.5 ? 'text-primary' : 'text-amber-400'}>
                  precision {r.precision.toFixed(2)}
                </span>
                <span className="text-muted-foreground">
                  agreement {r.fieldAgreement.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* tests */}
      <div>
        <div className="font-display text-[10px] tracking-[0.28em] text-primary mb-1">
          SELF-TEST
        </div>
        {run ? (
          <>
            <div className="text-[10px] text-muted-foreground mb-1">
              scope {run.scope} · <span className="text-primary">{run.passed} passed</span> ·{' '}
              <span className={run.failed ? 'text-destructive' : ''}>{run.failed} failed</span> ·{' '}
              {run.ms}ms · {new Date(run.at).toLocaleTimeString()}
            </div>
            <div className="space-y-0.5 text-[10px]">
              {run.results.map((r, i) => (
                <div key={i} className="border-b border-border/20 py-0.5">
                  <div className="flex gap-2">
                    <span className={r.passed ? 'text-primary' : 'text-destructive'}>
                      {r.passed ? 'PASS' : 'FAIL'}
                    </span>
                    <span className="text-muted-foreground/70">{r.id}</span>
                    <span className="text-foreground">{r.name}</span>
                    <span className="ml-auto text-muted-foreground/50">{r.ms}ms</span>
                  </div>
                  <div className="pl-10 text-muted-foreground">measured: {r.measured}</div>
                  <div className="pl-10 text-muted-foreground/60">expected: {r.expected}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-muted-foreground text-[10px]">
            No run yet. Until a test executes, every module is untested — the chat will say so.
          </div>
        )}
      </div>
    </div>
  );
}

const EDGE_STYLE: Record<EdgeStatus, string> = {
  wired: 'text-primary',
  cold: 'text-amber-400',
  broken: 'text-destructive',
  unknown: 'text-muted-foreground/60',
};

/**
 * Structural map. Left: wiring that is declared in code, coloured by whether
 * both ends are actually live. Right: port-compatible pairings that nothing
 * connects — potential only, and marked SPEC so it is never read as ability.
 */
function StructureStrip({ map }: { map: CrossMap | null }) {
  if (!map) return null;
  const c = map.counts;
  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="font-display text-[10px] tracking-[0.28em] text-primary">STRUCTURE</span>
        <span className="text-muted-foreground text-[10px]">
          <span className="text-primary">{c.wired} wired</span> ·{' '}
          <span className="text-amber-400">{c.cold} cold</span> ·{' '}
          <span className="text-destructive">{c.broken} broken</span> · {c.opportunities} unused
          pairings · {c.gaps} port gaps
        </span>
      </div>
      {(map.orphans.atlasOnly.length > 0 || map.orphans.registryOnly.length > 0) && (
        <div className="text-[10px] text-destructive mb-1">
          atlas drift — atlas-only [{map.orphans.atlasOnly.join(', ') || '—'}] registry-only [
          {map.orphans.registryOnly.join(', ') || '—'}]
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-x-4">
        <div className="space-y-0.5 text-[10px]">
          <div className="text-muted-foreground/70">DECLARED WIRING</div>
          {map.edges.map((e) => (
            <div key={`${e.from}->${e.to}`} className="flex gap-2 border-b border-border/20">
              <span className={`w-14 ${EDGE_STYLE[e.status]}`}>{e.status.toUpperCase()}</span>
              <span className="text-foreground truncate">
                {e.from} → {e.to}
              </span>
              <span className="ml-auto text-muted-foreground/60 truncate">
                {e.kinds.join(',') || '—'}
              </span>
            </div>
          ))}
        </div>
        <div className="space-y-0.5 text-[10px]">
          <div className="text-muted-foreground/70">
            UNUSED POTENTIAL{' '}
            <span className="text-muted-foreground/50">— SPEC hypotheses, not capabilities</span>
          </div>
          {map.opportunities.slice(0, 12).map((o) => (
            <div key={`${o.from}->${o.to}:${o.kind}`} className="border-b border-border/20 py-0.5">
              <div className="flex gap-2">
                <span className="text-muted-foreground/50">SPEC</span>
                <span className="text-foreground truncate">
                  {o.from} → {o.to}
                </span>
                <span className="ml-auto text-muted-foreground/60">{o.kind}</span>
              </div>
              <div className="pl-10 text-muted-foreground/70 truncate" title={o.because}>
                {o.via} · {o.because}
              </div>
            </div>
          ))}
          {map.opportunities.length === 0 && <div className="text-muted-foreground/60">none</div>}
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground/60 mt-1">
        atlas: {ATLAS_BY_ID.size} entries · layers{' '}
        {Object.entries(map.layers)
          .sort()
          .map(([k, v]) => `${k}:${v}`)
          .join(' · ')}
      </div>
    </div>
  );
}
