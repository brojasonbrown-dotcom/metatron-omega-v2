/**
 * CognitionPanel — the merged LEARN + MEMORY surface.
 *
 * Sub-decks:
 *   ACQUIRE  — field-of-study input, activation toggle, live run console
 *   CORPUS   — everything stored on-device, per-document, removable
 *   RECALL   — the cascade with its per-channel evidence exposed
 *   SUBSTRATE— the live engine memory substrate (unchanged)
 *   CERTIFY  — learnable-cell certificates and battery (unchanged)
 *
 * Every number shown is read from the real store. No placeholders.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { dispatchTool } from '@/lib/chat/tools/dispatch.functions';
import { getKnowledgeRuntime } from '../knowledgeRuntime';
import MemoryDeckPanel from './MemoryDeckPanel';
import LearnDeckPanel from './LearnDeckPanel';
import MultimodalDeck from './MultimodalDeck';
import type { RecallHit } from '@/core/knowledge/types';
import { useOmegaState } from '../useOmegaRuntime';
import { fieldContextFrom, dominantRung, captureRung } from '../fieldContext';
import { memoryPolicy } from '@/core/memory/MemoryPolicy';

type Deck = 'acquire' | 'multimodal' | 'corpus' | 'recall' | 'substrate' | 'certify';
const DECKS: { id: Deck; label: string }[] = [
  { id: 'acquire', label: 'ACQUIRE' },
  { id: 'multimodal', label: 'MULTIMODAL' },
  { id: 'corpus', label: 'CORPUS' },
  { id: 'recall', label: 'RECALL' },
  { id: 'substrate', label: 'SUBSTRATE' },
  { id: 'certify', label: 'CERTIFY' },
];

const bytes = (b: number) =>
  b >= 1 << 30
    ? `${(b / (1 << 30)).toFixed(2)} GB`
    : b >= 1 << 20
      ? `${(b / (1 << 20)).toFixed(1)} MB`
      : `${(b / 1024).toFixed(0)} KB`;

const pct = (x: number) => `${(Math.max(0, Math.min(1, x)) * 100).toFixed(0)}%`;

function Stat({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] tracking-[0.2em] text-muted-foreground">{k}</span>
      <span className={`text-[11px] font-mono tabular-nums ${tone ?? ''}`}>{v}</span>
    </div>
  );
}

function Bar({ v }: { v: number }) {
  return (
    <span className="inline-block h-1 w-10 rounded-sm bg-muted/40 align-middle">
      <span className="block h-1 rounded-sm bg-primary" style={{ width: pct(v) }} />
    </span>
  );
}

export default function CognitionPanel() {
  const [deck, setDeck] = useState<Deck>('acquire');
  const rt = getKnowledgeRuntime();
  const dispatch = useServerFn(dispatchTool);

  const state = useSyncExternalStore(rt.subscribe, rt.getStats, rt.getStats);
  const omega = useOmegaState();

  useEffect(() => {
    rt.setToolCall(async (name, args) => {
      const r = await dispatch({
        data: { name, args: args as Record<string, never>, enabled: true },
      });
      return r.ok
        ? { ok: true as const, data: r.data }
        : { ok: false as const, reason: r.reason ?? 'failed' };
    });
    void rt.hydrate();
  }, [rt, dispatch]);

  // Scale binding: acquisition stamps whatever rung is dominant at the moment
  // each document lands. Read live, so a rung change mid-crawl is recorded.
  useEffect(() => {
    rt.setRungProvider(() => captureRung(omega.snapshot));
  }, [rt, omega.snapshot]);

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 flex items-stretch gap-0 border-b border-border/30 bg-background/30 overflow-x-auto no-scrollbar">
        {DECKS.map((d) => (
          <button
            key={d.id}
            onClick={() => setDeck(d.id)}
            className={`shrink-0 px-2.5 py-1.5 font-display text-[9px] tracking-[0.22em] border-b-2 transition-colors ${
              deck === d.id
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {d.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 px-3 text-[9px] font-mono text-muted-foreground">
          <span>{state.storage.kind.toUpperCase()}</span>
          <span>{state.stats.documents} docs</span>
          <span>{state.stats.chunks} chunks</span>
          {state.run.active && <span className="text-primary">● LEARNING</span>}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {deck === 'acquire' && <AcquireDeck />}
        {deck === 'multimodal' && <MultimodalDeck />}
        {deck === 'corpus' && <CorpusDeck />}
        {deck === 'recall' && <RecallDeck />}
        {deck === 'substrate' && <MemoryDeckPanel />}
        {deck === 'certify' && <LearnDeckPanel />}
      </div>
    </div>
  );
}

// ── ACQUIRE ───────────────────────────────────────────────────────────────
function AcquireDeck() {
  const rt = getKnowledgeRuntime();
  const s = useSyncExternalStore(rt.subscribe, rt.getStats, rt.getStats);
  const [field, setField] = useState(s.field);

  useEffect(() => {
    setField(s.field);
  }, [s.field]);

  const toggle = useCallback(() => {
    if (s.run.active) rt.stop();
    else if (field.trim()) rt.start(field.trim());
  }, [rt, s.run.active, field]);

  return (
    <div className="h-full overflow-auto p-2 space-y-2">
      <div className="rounded-md border border-border/40 bg-background/40 p-2.5 space-y-2">
        <div className="text-[9px] tracking-[0.28em] text-muted-foreground">FIELD OF STUDY</div>
        <div className="flex gap-2">
          <input
            value={field}
            onChange={(e) => setField(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') toggle();
            }}
            disabled={s.run.active}
            placeholder="e.g. business structures, corporate governance, BIM coordination"
            className="flex-1 bg-background/60 border border-border/50 rounded px-2 py-1.5 text-[11px] font-mono outline-none focus:border-primary/60 disabled:opacity-60"
          />
          <button
            onClick={toggle}
            disabled={!field.trim() && !s.run.active}
            className={`px-3 rounded font-display text-[10px] tracking-[0.22em] border transition-colors disabled:opacity-40 ${
              s.run.active
                ? 'border-destructive/60 text-destructive hover:bg-destructive/10'
                : 'border-primary/60 text-primary hover:bg-primary/10'
            }`}
          >
            {s.run.active ? 'DEACTIVATE' : 'ACTIVATE'}
          </button>
        </div>
        <p className="text-[9px] text-muted-foreground leading-relaxed">
          Activation runs a continuous PLAN → SEARCH → FETCH → PARSE → DISTIL loop over real,
          keyless sources (encyclopedic, news, scholarly, filings, forums) through the tool layer.
          Everything acquired is chunked, hashed, barcoded and stored on this device only.
        </p>
      </div>

      <div className="rounded-md border border-border/40 bg-background/40 p-2.5 grid grid-cols-4 gap-3">
        <Stat k="PHASE" v={s.run.phase.toUpperCase()} tone={s.run.active ? 'text-primary' : ''} />
        <Stat k="CYCLE" v={String(s.run.cycle)} />
        <Stat k="FETCHED" v={String(s.run.fetched)} />
        <Stat k="FAILED" v={String(s.run.failed)} tone={s.run.failed ? 'text-destructive' : ''} />
        <Stat k="FRONTIER" v={String(s.run.frontier)} />
        <Stat k="NEW CHUNKS" v={String(s.run.newChunks)} />
        <Stat k="NOVELTY" v={pct(s.run.novelty)} />
        <Stat k="CONCEPTS" v={`${s.stats.concepts} · ${s.stats.edges}e`} />
      </div>

      <div className="rounded-md border border-border/40 bg-background/40 p-2.5 grid grid-cols-4 gap-3">
        <Stat k="ARCHIVE" v={s.storage.kind.toUpperCase()} />
        <Stat k="ON DISK" v={bytes(s.storage.bytes)} />
        <Stat
          k="ORIGIN USAGE"
          v={s.storage.quota ? `${bytes(s.storage.usage)} / ${bytes(s.storage.quota)}` : '—'}
        />
        <Stat k="SAVED" v={s.lastSavedAt ? new Date(s.lastSavedAt).toLocaleTimeString() : '—'} />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => void rt.save()}
          disabled={s.saving}
          className="px-2.5 py-1 rounded border border-border/60 text-[9px] font-display tracking-[0.2em] hover:bg-muted/30 disabled:opacity-40"
        >
          {s.saving ? 'SAVING…' : 'SAVE ARCHIVE'}
        </button>
        <button
          onClick={() => void rt.wipe()}
          className="px-2.5 py-1 rounded border border-destructive/50 text-destructive text-[9px] font-display tracking-[0.2em] hover:bg-destructive/10"
        >
          WIPE LOCAL CORPUS
        </button>
      </div>

      <div className="rounded-md border border-border/40 bg-background/40">
        <div className="px-2.5 py-1.5 border-b border-border/30 text-[9px] tracking-[0.28em] text-muted-foreground">
          RUN CONSOLE
        </div>
        <div className="max-h-64 overflow-auto divide-y divide-border/20">
          {s.run.events.length === 0 && (
            <div className="px-2.5 py-3 text-[10px] text-muted-foreground font-mono">
              no activity yet
            </div>
          )}
          {s.run.events.map((e, i) => (
            <div key={`${e.t}-${i}`} className="px-2.5 py-1 flex gap-2 text-[9px] font-mono">
              <span className="text-muted-foreground w-14 shrink-0">
                {new Date(e.t).toLocaleTimeString()}
              </span>
              <span className={`w-16 shrink-0 ${e.ok ? 'text-primary' : 'text-destructive'}`}>
                {e.phase}
              </span>
              <span className="w-24 shrink-0 text-muted-foreground truncate">{e.tool}</span>
              <span className="flex-1 truncate">{e.target}</span>
              <span className={`shrink-0 ${e.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
                {e.detail}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── CORPUS ────────────────────────────────────────────────────────────────
function CorpusDeck() {
  const rt = getKnowledgeRuntime();
  const s = useSyncExternalStore(rt.subscribe, rt.getStats, rt.getStats);
  const [field, setField] = useState<string>('');

  // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalidates the mutable-store read
  const fields = useMemo(() => rt.kb.fields(), [rt, s.version]);
  const docs = useMemo(
    () => rt.kb.documents(field || undefined).slice(0, 300),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalidates the mutable-store read
    [rt, field, s.version],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version invalidates the mutable-store read
  const concepts = useMemo(() => rt.kb.concepts.top(28), [rt, s.version]);

  return (
    <div className="h-full overflow-auto p-2 space-y-2">
      <div className="rounded-md border border-border/40 bg-background/40 p-2.5 grid grid-cols-4 gap-3">
        <Stat k="FIELDS" v={String(s.stats.fields)} />
        <Stat k="DOCUMENTS" v={String(s.stats.documents)} />
        <Stat k="CHUNKS" v={String(s.stats.chunks)} />
        <Stat k="TERMS" v={String(s.stats.terms)} />
        <Stat k="CONCEPTS" v={String(s.stats.concepts)} />
        <Stat k="EDGES" v={String(s.stats.edges)} />
        <Stat k="LSH BANDS" v={String(s.stats.bands)} />
        <Stat k="RESIDENT" v={bytes(s.stats.bytes)} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setField('')}
          className={`px-2 py-0.5 rounded border text-[9px] font-mono ${field === '' ? 'border-primary text-primary' : 'border-border/50 text-muted-foreground'}`}
        >
          ALL
        </button>
        {fields.map((f) => (
          <button
            key={f.field}
            onClick={() => setField(f.field)}
            className={`px-2 py-0.5 rounded border text-[9px] font-mono ${field === f.field ? 'border-primary text-primary' : 'border-border/50 text-muted-foreground'}`}
          >
            {f.field} · {f.docs}
          </button>
        ))}
      </div>

      <div className="rounded-md border border-border/40 bg-background/40">
        <div className="px-2.5 py-1.5 border-b border-border/30 text-[9px] tracking-[0.28em] text-muted-foreground">
          DOCUMENTS
        </div>
        <div className="max-h-72 overflow-auto divide-y divide-border/20">
          {docs.length === 0 && (
            <div className="px-2.5 py-3 text-[10px] font-mono text-muted-foreground">
              corpus empty
            </div>
          )}
          {docs.map((d) => (
            <div key={d.id} className="px-2.5 py-1 flex items-center gap-2 text-[9px] font-mono">
              <span className="flex-1 truncate" title={d.url}>
                {d.title}
              </span>
              <span className="text-muted-foreground shrink-0">{d.chunkIds.length}c</span>
              <span className="text-muted-foreground shrink-0">{(d.chars / 1000).toFixed(1)}k</span>
              <button
                onClick={() => rt.removeDocument(d.id)}
                className="shrink-0 text-destructive/70 hover:text-destructive"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-border/40 bg-background/40 p-2.5">
        <div className="text-[9px] tracking-[0.28em] text-muted-foreground mb-1.5">
          CONCEPT GRAPH — TOP NODES
        </div>
        <div className="flex flex-wrap gap-1.5">
          {concepts.length === 0 && (
            <span className="text-[10px] font-mono text-muted-foreground">no concepts yet</span>
          )}
          {concepts.map((c) => (
            <span
              key={c.term}
              className="px-1.5 py-0.5 rounded border border-border/40 text-[9px] font-mono"
              title={rt.kb.concepts
                .neighbours(c.term, 6)
                .map((n) => `${n.term} ${n.w.toFixed(2)}`)
                .join(', ')}
            >
              {c.term} <span className="text-muted-foreground">{c.strength.toFixed(1)}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── RECALL ────────────────────────────────────────────────────────────────
function RecallDeck() {
  const rt = getKnowledgeRuntime();
  const s = useSyncExternalStore(rt.subscribe, rt.getStats, rt.getStats);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<RecallHit[]>([]);
  const [ms, setMs] = useState(0);

  const omega = useOmegaState();
  const rung = dominantRung(omega.snapshot);
  const [report, setReport] = useState(rt.getStats().consolidation);

  const run = useCallback(() => {
    const t0 = performance.now();
    // Live telemetry is passed only when a field is actually streaming; with
    // the engine idle the resonance channel abstains and the ranking is the
    // text-only cascade, unchanged.
    const ctx = fieldContextFrom(omega.snapshot);
    setHits(rt.recall(q, memoryPolicy.recallDepth(), undefined, ctx));
    setMs(performance.now() - t0);
  }, [rt, q, omega.snapshot]);

  const runLatent = useCallback(() => {
    rt.trainLatent();
  }, [rt]);

  // Ω-SHFN G — the field-signature sweep. The basis build is the expensive
  // part and runs once; the sweep then covers the corpus in budgeted slices.
  const runSignatures = useCallback(() => {
    void rt.buildSignatures();
  }, [rt]);

  const runConsolidate = useCallback(() => {
    setReport(rt.consolidate());
  }, [rt]);

  return (
    <div className="h-full overflow-auto p-2 space-y-2">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run();
          }}
          placeholder="cue the cascade — exact terms, a question, or a fragment"
          className="flex-1 bg-background/60 border border-border/50 rounded px-2 py-1.5 text-[11px] font-mono outline-none focus:border-primary/60"
        />
        <button
          onClick={run}
          disabled={!q.trim() || s.stats.chunks === 0}
          className="px-3 rounded border border-primary/60 text-primary font-display text-[10px] tracking-[0.22em] hover:bg-primary/10 disabled:opacity-40"
        >
          RECALL
        </button>
      </div>

      <div className="space-y-1">
        <div className="text-[9px] font-mono text-muted-foreground">
          cascade: barcode LSH → BM25 → cosine rescore → spreading activation → φ-fusion → resonance
          → Fibonacci age bands · {hits.length} hits · {ms.toFixed(1)} ms · depth{' '}
          {memoryPolicy.recallDepth()} · dial {memoryPolicy.dial()}
        </div>
        <div className="text-[9px] font-mono text-muted-foreground">
          resonance{' '}
          {rung ? (
            <span className="text-primary">
              LIVE · rung {rung.n} · C {rung.coherence.toFixed(3)} · γ {rung.closure.toFixed(3)}
            </span>
          ) : (
            <span>ABSTAINING — engine not streaming, text-only ranking</span>
          )}
          {' · '}
          <button onClick={runConsolidate} className="underline hover:text-primary">
            consolidate
          </button>
          {' · '}
          <button onClick={runLatent} className="underline hover:text-primary">
            train latent
          </button>
          {s.latent ? (
            <span>
              {' '}
              · latent {s.latent.vocab} terms × {s.latent.dims} axes · {s.latent.pairs} pairs ·{' '}
              {s.latent.ms} ms
            </span>
          ) : (
            <span> · latent ABSTAINING (untrained)</span>
          )}
          {' · '}
          <button
            onClick={runSignatures}
            disabled={s.signing}
            className="underline hover:text-primary disabled:opacity-40"
          >
            {s.signing ? 'signing…' : 'field signatures'}
          </button>
          {s.signature ? (
            <span>
              {' · '}FLD {s.signature.tier} · {s.signature.modes} modes · λ≤
              {s.signature.lambdaMax.toFixed(3)}
              {' · residual '}
              {s.signature.maxResidual.toExponential(1)} · digest {s.signature.digest}
              {' · coverage '}
              {s.signatureTotal ? ((s.signatureCovered / s.signatureTotal) * 100).toFixed(0) : '0'}%
              {' ('}
              {s.signatureCovered}/{s.signatureTotal}
              {')'} · basis {s.signature.buildMs.toFixed(0)} ms
            </span>
          ) : (
            <span> · FLD ABSTAINING (no eigenbasis — fingerprints only)</span>
          )}
          {report && (
            <span>
              {' '}
              · {report.clusters.length} prototypes · {report.contradictions.length} conflicts ·{' '}
              {report.compared} compared{report.budgetExhausted ? ' (budget hit)' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        {hits.map((h) => (
          <div
            key={h.chunk.id}
            className="rounded-md border border-border/40 bg-background/40 p-2 space-y-1"
          >
            <div className="flex items-center gap-2 text-[9px] font-mono">
              <span className="text-primary tabular-nums">{h.score.toFixed(3)}</span>
              <span className="flex-1 truncate text-muted-foreground" title={h.doc?.url}>
                {h.doc?.title ?? h.chunk.docId}
              </span>
              <span className="text-muted-foreground">{h.chunk.field}</span>
            </div>
            <div className="flex gap-3 text-[9px] font-mono text-muted-foreground">
              <span>
                LEX <Bar v={h.lexical} /> {h.lexical.toFixed(2)}
              </span>
              <span>
                SEM <Bar v={h.semantic} /> {h.semantic.toFixed(2)}
              </span>
              <span>
                BAR <Bar v={h.barcode} /> {h.barcode.toFixed(2)}
              </span>
              {Number.isFinite(h.latent) && (
                <span title="PPMI-SVD latent semantics — learned from term company">
                  LAT <Bar v={h.latent} /> {h.latent.toFixed(2)}
                </span>
              )}
              {Number.isFinite(h.fieldSig) && (
                <span title="measured field signature — text propagated through the rung's measured Laplacian spectrum, phase-aligned cosine">
                  FLD <Bar v={h.fieldSig} /> {h.fieldSig.toFixed(2)}
                </span>
              )}
              <span>
                SPR <Bar v={h.spread} /> {h.spread.toFixed(2)}
              </span>
              {Number.isFinite(h.resonance) && (
                <span title={h.resonanceVeto ? `weakest channel: ${h.resonanceVeto}` : undefined}>
                  RES <Bar v={h.resonance} /> {h.resonance.toFixed(2)}
                </span>
              )}
              <span title="Fibonacci age band — 0 is freshest; every band keeps a quota">
                BAND {h.band}
              </span>
            </div>
            {h.contradicts.length > 0 && (
              <div className="text-[9px] font-mono text-amber-500/90">
                ⚠ conflicts with {h.contradicts.length} stored chunk
                {h.contradicts.length > 1 ? 's' : ''} — both sides kept
              </div>
            )}
            <p className="text-[10px] leading-relaxed text-foreground/80 line-clamp-4">
              {h.chunk.text.slice(0, 420)}
            </p>
          </div>
        ))}
        {hits.length === 0 && (
          <div className="text-[10px] font-mono text-muted-foreground px-1">
            {s.stats.chunks === 0
              ? 'corpus empty — activate a field of study in ACQUIRE'
              : 'no hits yet'}
          </div>
        )}
      </div>
    </div>
  );
}
