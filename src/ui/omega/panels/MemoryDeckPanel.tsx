/**
 * MemoryDeckPanel — the live memory substrate surface.
 *
 * Everything here reads the real MemoryStore driven by memoryRuntime; there
 * are no simulated values. Reads go through useMemorySelector so the panel
 * re-renders on memory versions (2 Hz), never at engine tick rate.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { getCorpusRuntime } from "../corpusRuntime";
import { getMemoryRuntime } from "../memoryRuntime";
import { useMemorySelector, useMemoryVersion } from "../useMemoryRuntime";
import { densify } from "@/core/memory/PatternBitmapIndex";
import { MERGE_THRESHOLD, zeckAddress, fingerprint } from "@/core/gematria";
import { groundingStats } from "@/core/knowledge/lexicon";

type Section = "words" | "substrate" | "patterns" | "episodes" | "percepts" | "pathways" | "journal" | "recall" | "corpus" | "capacity";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "words", label: "WORDS" },
  { id: "substrate", label: "SUBSTRATE" },
  { id: "patterns", label: "PATTERNS" },
  { id: "episodes", label: "EPISODES" },
  { id: "percepts", label: "PERCEPTS" },
  { id: "pathways", label: "PATHWAYS" },
  { id: "journal", label: "JOURNAL" },
  { id: "recall", label: "RECALL" },
  { id: "corpus", label: "CORPUS" },
  { id: "capacity", label: "CAPACITY" },
];

const fmt = (n: number, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : "—");
const bytes = (b: number) =>
  b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(2)} GB`
  : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB`
  : `${(b / 1024).toFixed(0)} KB`;

export default function MemoryDeckPanel() {
  const rt = getMemoryRuntime();
  const [section, setSection] = useState<Section>("substrate");
  const version = useMemoryVersion();

  const head = useMemorySelector(
    (s) => ({
      enabled: s.enabled,
      status: s.statusText,
      tick: s.tick,
      hz: s.hz,
      salience: s.store.lastSalience,
      surprise: s.meanSurprise,
      merged: s.totalMerged,
      fib: s.lastResult?.isFibonacci ?? false,
    }),
    (a, b) => a.enabled === b.enabled && a.status === b.status && a.tick === b.tick
      && a.salience === b.salience && a.surprise === b.surprise && a.merged === b.merged,
  );

  return (
    <div className="h-full overflow-auto p-3 space-y-3 text-[11px]">
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[10px] tracking-[0.28em] text-primary">MEMORY SUBSTRATE</span>
        <button
          onClick={() => rt.setEnabled(!head.enabled)}
          className={`px-2 py-0.5 rounded border text-[10px] tracking-wider ${
            head.enabled
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border/60 text-muted-foreground"
          }`}
        >
          {head.enabled ? "LIVE" : "PAUSED"}
        </button>
        <span className="text-muted-foreground">{head.status}</span>
        <span className="ml-auto tabular-nums text-muted-foreground">
          t={head.tick} · {fmt(head.hz, 2)} Hz {head.fib ? "· φ" : ""}
        </span>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="salience" value={fmt(head.salience)} />
        <Stat label="mean surprise" value={fmt(head.surprise)} />
        <Stat label="attractors merged" value={String(head.merged)} />
        <Stat label="merge floor" value={fmt(MERGE_THRESHOLD, 4)} />
      </div>
      <WordsStrip />

      <nav className="flex flex-wrap gap-1">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`px-2 py-0.5 rounded border text-[10px] tracking-wider shrink-0 whitespace-nowrap ${
              section === s.id
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {section === "substrate" && <Substrate />}
      {section === "patterns" && <Patterns key={version} />}
      {section === "episodes" && <Episodes key={version} />}
      {section === "percepts" && <Percepts key={version} />}
      {section === "pathways" && <Pathways key={version} />}
      {section === "journal" && <Journal key={version} />}
      {section === "recall" && <Recall />}
      {section === "corpus" && <CorpusBlock />}
      {section === "capacity" && <CapacityBlock />}
    </div>
  );
}

/**
 * Ω-CAPACITY — the measured ceiling table, run on demand.
 *
 * The probe is read-only and self-contained: it times real transforms, decodes
 * real bundles and writes shards into its own in-memory store, so pressing
 * measure can never disturb the engine or the archive of record. It is not run
 * automatically because it deliberately consumes CPU for a second.
 */
function CapacityBlock() {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const m = await import("@/core/capacity");
      const report = await m.measureCapacity({ budgetMsPerRung: 24, population: 512, residencyFrames: 512 });
      setText(m.formatCapacityReport(report));
    } catch (e) {
      setText(`capacity probe failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={run}
          disabled={busy}
          className="px-2 py-0.5 rounded border border-primary/60 bg-primary/10 text-primary text-[10px] tracking-wider disabled:opacity-50"
        >
          {busy ? "MEASURING…" : "MEASURE CEILINGS"}
        </button>
        <span className="text-[10px] text-muted-foreground">
          real transforms, real shards, own store — nothing here touches the engine
        </span>
      </div>
      {text === null
        ? <Empty what="a capacity measurement — press measure to time this host" />
        : <pre className="rounded border border-border/40 p-2 overflow-auto text-[10px] leading-[1.35] whitespace-pre">{text}</pre>}
    </div>
  );
}


/**
 * Ω-CORPUS — the durable ladder, read-only.
 *
 * Every number here comes from the live tiers; nothing is estimated. The
 * ladder is demotion-only, so HOT evictions appear as WARM shards rather
 * than as loss.
 */
function CorpusBlock() {
  const rt = getCorpusRuntime();
  const v = useSyncExternalStore(rt.subscribe, rt.getSnapshot, rt.getSnapshot);
  const usedPct = Number.isFinite(v.quota.quota) && v.quota.quota > 0
    ? v.quota.usage / v.quota.quota : NaN;

  if (!v.enabled) {
    return <Empty what="corpus frames — the ladder builds as the field is sampled" />;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="store" value={v.storeKind} />
        <Stat label="frames offered" value={v.frames.toLocaleString()} />
        <Stat label="retained numbers" value={v.retainedNumbers.toLocaleString()} />
        <Stat label="ledger leaves" value={v.ledger.size.toLocaleString()} />
      </div>

      <div className="rounded border border-border/40 p-2 space-y-1">
        <div className="text-[10px] tracking-[0.2em] text-muted-foreground uppercase">tiers</div>
        <Bar label="hot (ram)" used={v.hot.count} cap={Math.max(1, v.hot.capacity)} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          <Stat label="hot numbers" value={v.hot.numbers.toLocaleString()} />
          <Stat label="hot surprise" value={fmt(v.hot.meanSurprise)} />
          <Stat label="warm shards" value={`${v.warm.shards} (+${v.warm.pending})`} />
          <Stat label="warm bytes" value={bytes(v.warm.bytes)} />
          <Stat label="warm numbers" value={v.warm.numbers.toLocaleString()} />
          <Stat label="cold segments" value={String(v.cold.segments)} />
          <Stat label="cold numbers" value={v.cold.numbers.toLocaleString()} />
          <Stat label="cold bytes" value={bytes(v.cold.bytes)} />
        </div>
      </div>

      <div className="rounded border border-border/40 p-2 space-y-1">
        <div className="text-[10px] tracking-[0.2em] text-muted-foreground uppercase">admission</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="admitted" value={v.counters.admitted.toLocaleString()} />
          <Stat label="rejected" value={v.counters.rejected.toLocaleString()} />
          <Stat label="demoted" value={v.counters.demoted.toLocaleString()} />
          <Stat label="cold refusals" value={String(v.cold.refused)} />
        </div>
        <div className="text-[10px] text-muted-foreground">
          rejection is not loss of information: a frame inside its own calibrated
          band carries none. Demotion moves a frame down the ladder, never out.
        </div>
      </div>

      <div className="rounded border border-border/40 p-2 space-y-1">
        <div className="text-[10px] tracking-[0.2em] text-muted-foreground uppercase">evidence + quota</div>
        <div className="font-mono text-[10px] break-all text-muted-foreground">
          root {v.ledger.rootHex ? v.ledger.rootHex.slice(0, 32) : "—"}
        </div>
        {Number.isFinite(usedPct) ? (
          <Bar label="host storage" used={v.quota.usage} cap={v.quota.quota} />
        ) : (
          <div className="text-[10px] text-muted-foreground">host quota not reported</div>
        )}
        {v.lastError && (
          <div className="text-[10px] text-destructive">storage: {v.lastError}</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border/40 bg-background/40 px-2 py-1">
      <div className="text-[9px] tracking-[0.2em] text-muted-foreground uppercase">{label}</div>
      <div className="tabular-nums">{value}</div>
    </div>
  );
}

function Bar({ label, used, cap }: { label: string; used: number; cap: number }) {
  const pct = Math.min(1, used / Math.max(1, cap));
  const tone = pct > 0.9 ? "bg-destructive" : pct > 0.6 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{used.toLocaleString()}/{cap.toLocaleString()}</span>
      </div>
      <div className="h-1.5 bg-muted rounded overflow-hidden">
        <div className={`h-full ${tone}`} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

function Substrate() {
  const rt = getMemoryRuntime();
  const s = useMemorySelector((x) => x);
  const learn = s.learning;
  const idx = rt.learning.index.stats();
  const opts = rt.learningOptions();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        <Bar label="L0 field tape" used={s.store.tapeFrames} cap={s.capacities.tape} />
        <Bar label="L1 hebbian" used={s.store.hebbianEntries} cap={s.capacities.hebbian} />
        <Bar label="L2 episodic" used={s.store.episodes} cap={s.capacities.episodes} />
        <Bar label="L3 patterns" used={s.store.patternCount} cap={s.capacities.patterns} />
        <Bar label="L4 pathway" used={s.store.pathwayEdges} cap={s.capacities.pathway} />
        <Bar label="L5 journal" used={s.store.journalRecords} cap={s.capacities.journal} />
        <Bar label="L-S sensory" used={s.store.sensoryAtoms} cap={s.capacities.sensory} />
        <Bar label="bitmap index" used={idx.size} cap={Math.max(1, s.capacities.patterns)} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="‖W‖_F" value={fmt(s.store.hebbianFrobenius, 4)} />
        <Stat label="tape bytes" value={bytes(s.store.tapeBytesUsed)} />
        <Stat label="sensory bytes" value={bytes(s.store.sensoryBytesUsed)} />
        <Stat label="ram budget" value={bytes(s.caps.ramBytes)} />
      </div>

      <div className="rounded border border-border/40 p-2 space-y-1">
        <div className="text-[10px] tracking-[0.2em] text-muted-foreground uppercase">learning</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="surprise" value={fmt(learn.surprise)} />
          <Stat label="prediction C" value={fmt(learn.predictionResonance)} />
          <Stat label="trace ‖e‖" value={fmt(learn.traceNorm, 2)} />
          <Stat label="bound pairs" value={String(learn.boundPairs)} />
        </div>
        <div className="flex flex-wrap gap-3 pt-1 text-[10px] text-muted-foreground">
          <span>current {learn.currentHash ?? "—"}</span>
          <span>predicted {learn.predictedHash ?? "—"}</span>
          <span>observations {learn.observations}</span>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Toggle label="predictive" on={opts.predictive} onClick={() => rt.setLearningOptions({ predictive: !opts.predictive })} />
          <Toggle label="temporal binding" on={opts.temporalBinding} onClick={() => rt.setLearningOptions({ temporalBinding: !opts.temporalBinding })} />
          <Toggle label="consolidation" on={opts.consolidation} onClick={() => rt.setLearningOptions({ consolidation: !opts.consolidation })} />
          <Toggle label="learning" on={s.enabled && rt.isLearningEnabled()} onClick={() => rt.setLearningEnabled(!rt.isLearningEnabled())} />
        </div>
      </div>

      <div className="rounded border border-border/40 p-2 space-y-1">
        <div className="text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
          bitmap / gematria index
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="entries" value={String(idx.size)} />
          <Stat label="lsh buckets" value={String(idx.buckets)} />
          <Stat label="prefiltered → rescored" value={`${idx.lastPrefiltered} → ${idx.lastRescored}`} />
          <Stat label="dim" value={String(idx.dim)} />
        </div>
        <div className="text-[10px] text-muted-foreground">
          fingerprint collisions {idx.fingerprintCollisions} · p = {idx.collisionPValue.toExponential(2)} ·
          CRT modulus {idx.crtModulus.toLocaleString()} — collisions are reported as a statistic, never as a meaning.
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Action label="SAVE" onClick={() => void rt.save()} />
        <Action label="LOAD" onClick={() => void rt.load()} />
        <Action label="CLEAR" onClick={() => void rt.clear()} tone="destructive" />
        <Action label="REFRESH CAPS" onClick={() => rt.refreshCaps()} />
        <Action label="CONSOLIDATE NOW" onClick={() => rt.learning.consolidate(rt.learning.index.dimension() || 40, rt.getStats().tick)} />
      </div>
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded border text-[10px] tracking-wider shrink-0 whitespace-nowrap ${
        on ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400" : "border-border/50 text-muted-foreground"
      }`}
    >
      {on ? "● " : "○ "}{label}
    </button>
  );
}

function Action({ label, onClick, tone }: { label: string; onClick: () => void; tone?: "destructive" }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded border text-[10px] tracking-[0.2em] shrink-0 whitespace-nowrap ${
        tone === "destructive"
          ? "border-destructive/50 text-destructive hover:bg-destructive/10"
          : "border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/40"
      }`}
    >
      {label}
    </button>
  );
}

function Empty({ what }: { what: string }) {
  return <div className="text-muted-foreground italic py-4">no {what} yet — the substrate fills as the field runs</div>;
}

function Patterns() {
  const rt = getMemoryRuntime();
  const rows = useMemo(
    () => [...rt.store.patterns.all()].sort((a, b) => b.tick - a.tick).slice(0, 40),
    [rt],
  );
  if (rows.length === 0) return <Empty what="φ-patterns" />;
  return (
    <table className="w-full tabular-nums">
      <thead className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        <tr><th className="text-left">hash</th><th className="text-left">zeck addr</th><th>tick</th><th>F#</th><th>‖Ψ‖</th><th>pol</th><th>tor</th><th>qualia</th></tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.hash + p.tick} className="border-t border-border/20">
            <td className="font-mono text-emerald-400">{p.hash}</td>
            <td className="font-mono text-[10px] text-muted-foreground">{zeckAddress(Math.max(0, p.tick))}</td>
            <td className="text-center">{p.tick}</td>
            <td className="text-center">{p.fibIndex}</td>
            <td className="text-right">{fmt(p.norm)}</td>
            <td className="text-right">{fmt(p.poloidal, 2)}</td>
            <td className="text-right">{fmt(p.toroidal, 2)}</td>
            <td className="text-right">{fmt(p.qualiaScalar)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Episodes() {
  const rt = getMemoryRuntime();
  const rows = useMemo(() => [...rt.store.episodic.all()].slice(-30).reverse(), [rt]);
  if (rows.length === 0) return <Empty what="episodes" />;
  return (
    <table className="w-full tabular-nums">
      <thead className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        <tr><th className="text-left">hash</th><th className="text-left">reason</th><th>tick</th><th>salience</th><th>novelty</th><th>surprise</th><th>C</th></tr>
      </thead>
      <tbody>
        {rows.map((e, i) => (
          <tr key={`${e.hash}-${e.tick}-${i}`} className="border-t border-border/20">
            <td className="font-mono text-emerald-400">{e.hash}</td>
            <td className="text-muted-foreground">{e.reason}</td>
            <td className="text-center">{e.tick}</td>
            <td className="text-right">{fmt(e.salience)}</td>
            <td className="text-right">{fmt(e.novelty)}</td>
            <td className="text-right">{fmt(e.surprise)}</td>
            <td className="text-right">{fmt(e.coherence)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Percepts() {
  const rt = getMemoryRuntime();
  const rows = useMemo(() => rt.store.percepts.list(40), [rt]);
  const stats = rt.store.percepts.stats();
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="percepts" value={String(stats.total)} />
        <Stat label="named" value={String(stats.named)} />
        <Stat label="cross-modal bonds" value={String(stats.boundPairs)} />
        <Stat label="modalities" value={Object.entries(stats.perModality).filter(([, n]) => n > 0).map(([m, n]) => `${m}:${n}`).join(" ") || "—"} />
      </div>
      {rows.length === 0 ? <Empty what="percepts" /> : (
        <table className="w-full tabular-nums">
          <thead className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            <tr><th className="text-left">id</th><th className="text-left">label</th><th className="text-left">modality</th><th>reinf.</th><th>first</th><th>last</th><th>bonds</th></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-border/20">
                <td className="font-mono text-emerald-400">{p.id}</td>
                <td>{p.label ?? <span className="text-muted-foreground italic">unnamed</span>}</td>
                <td className="text-muted-foreground">{p.modality}</td>
                <td className="text-center">{p.reinforcements}</td>
                <td className="text-center">{p.firstSeen}</td>
                <td className="text-center">{p.lastSeen}</td>
                <td className="text-center">{p.coBound.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Pathways() {
  const rt = getMemoryRuntime();
  const rows = useMemo(
    () => [...rt.store.pathway.all()].sort((a, b) => b.count - a.count).slice(0, 40),
    [rt],
  );
  if (rows.length === 0) return <Empty what="transitions" />;
  return (
    <table className="w-full tabular-nums">
      <thead className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
        <tr><th className="text-left">from → to</th><th>count</th><th>last tick</th></tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <tr key={`${e.from}-${e.to}`} className="border-t border-border/20">
            <td className="font-mono text-[10px]">{e.from} → {e.to}</td>
            <td className="text-center text-amber-400">×{e.count}</td>
            <td className="text-center text-muted-foreground">{e.lastTick}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Journal() {
  const rt = getMemoryRuntime();
  const rows = useMemo(() => rt.store.journal.tail(40).reverse(), [rt]);
  if (rows.length === 0) return <Empty what="journal records" />;
  return (
    <div className="space-y-1">
      {rows.map((r, i) => (
        <div key={`${r.signatureHash}-${r.tick}-${i}`} className="flex gap-2 border-t border-border/20 py-0.5">
          <span className="tabular-nums text-muted-foreground w-16">t={r.tick}</span>
          <span className="font-mono text-[10px] text-emerald-400 w-20">{r.signatureHash}</span>
          <span className="flex-1 truncate">{r.text ?? `q=${fmt(r.qualiaScalar)}`}</span>
        </div>
      ))}
    </div>
  );
}

function Recall() {
  const rt = getMemoryRuntime();
  const [seed, setSeed] = useState("");
  const [result, setResult] = useState<Array<{ hash: string; res: number; dist: number; addr: string; fp: string }> | null>(null);
  const [meta, setMeta] = useState<{ prefiltered: number; rescored: number; ms: number } | null>(null);

  const run = useCallback((cue: Float64Array) => {
    const t0 = performance.now();
    const hits = rt.learning.index.search(cue, rt.store.patterns.all(), 8);
    const ms = performance.now() - t0;
    const st = rt.learning.index.stats();
    setResult(hits.map((h) => ({
      hash: h.pattern.hash,
      res: h.resonance,
      dist: h.distance,
      addr: h.entry.address,
      fp: h.entry.fingerprint.key,
    })));
    setMeta({ prefiltered: st.lastPrefiltered, rescored: st.lastRescored, ms });
  }, [rt]);

  const runFromLatest = useCallback(() => {
    const latest = rt.store.patterns.all().at(-1);
    const dim = rt.learning.index.dimension() || 40;
    if (!latest) return;
    run(densify(latest, dim));
  }, [rt, run]);

  const runFromSeed = useCallback(() => {
    const dim = rt.learning.index.dimension() || 40;
    // Deterministic cue from the typed text: residue fingerprint drives a
    // φ-phase comb. Same text ⇒ same cue, every run, every device.
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    const fp = fingerprint(Math.max(1, h % 1_000_003));
    const cue = new Float64Array(dim);
    for (let i = 0; i < dim; i++) {
      const r = fp.roots[i % fp.roots.length];
      cue[i] = Math.cos((2 * Math.PI * r * (i + 1)) / 1.618033988749895 / dim);
    }
    run(cue);
  }, [rt, run, seed]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="deterministic cue text…"
          className="flex-1 min-w-[10rem] bg-background/60 border border-border/50 rounded px-2 py-1 text-[11px]"
        />
        <Action label="PROBE CUE" onClick={runFromSeed} />
        <Action label="PROBE LATEST Ψ" onClick={runFromLatest} />
      </div>
      {meta && (
        <div className="text-[10px] text-muted-foreground">
          two-stage recall: {meta.prefiltered} bitmap prefiltered → {meta.rescored} exact rescored in {meta.ms.toFixed(2)} ms
        </div>
      )}
      {result && result.length === 0 && <Empty what="matches" />}
      {result && result.length > 0 && (
        <table className="w-full tabular-nums">
          <thead className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            <tr><th className="text-left">hash</th><th className="text-left">zeck addr</th><th className="text-left">fingerprint</th><th>C(a,b)</th><th>bitmap d</th></tr>
          </thead>
          <tbody>
            {result.map((r) => (
              <tr key={r.hash} className="border-t border-border/20">
                <td className="font-mono text-emerald-400">{r.hash}</td>
                <td className="font-mono text-[10px] text-muted-foreground">{r.addr}</td>
                <td className="font-mono text-[10px] text-muted-foreground">{r.fp}</td>
                <td className="text-right">{fmt(r.res, 4)}</td>
                <td className="text-right">{fmt(r.dist, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function WordsStrip() {
  const rt = getMemoryRuntime();
  useMemoryVersion();
  const st = rt.lexiconStats();
  const [draft, setDraft] = useState("");
  const [probe, setProbe] = useState("");
  const recall = useMemo(() => {
    const w = probe.trim();
    if (!w) return null;
    const lex = rt.getStats().store.lexicon;
    return lex.recall(lex.signature(w), 5);
  }, [probe, rt, st.tokens]);
  const grounding = useMemo(() => groundingStats(), []);
  return (
    <section className="rounded border border-border/60 p-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-[10px] tracking-[0.28em] text-primary">WORDS</span>
        <button
          onClick={() => void rt.setListening(st.hearing !== "listening")}
          className="px-2 py-0.5 rounded border border-border/60 text-[10px] tracking-wider"
        >
          {st.hearing === "listening" ? "STOP LISTENING" : "LISTEN"}
        </button>
        <span className="text-muted-foreground">{st.hearing}</span>
        {st.lastHeard && <span className="text-muted-foreground truncate">heard: “{st.lastHeard}”</span>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Stat label="words known" value={String(st.words)} />
        <Stat label="tokens learned" value={String(st.tokens)} />
        <Stat label="queued → placed" value={`${st.enqueued} → ${st.injected}`} />
        <Stat label="grounded words" value={`${grounding.grounded}/${grounding.entries}`} />
        <Stat label="field says" value={st.description ?? "—"} />
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { rt.hear(draft); setDraft(""); } }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a sentence for the brain to read"
          className="flex-1 rounded border border-border/60 bg-background px-2 py-1" />
        <button className="px-2 py-1 rounded border border-primary/60 text-primary text-[10px]">READ</button>
      </form>
      <div className="flex gap-2 items-center">
        <input value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="Recall a word"
          className="flex-1 rounded border border-border/60 bg-background px-2 py-1" />
        {recall && (
          <span className="text-muted-foreground tabular-nums">
            {recall.hits.map((h) => `${h.word} ${h.score.toFixed(2)}`).join(" · ")} · β={recall.beta.toFixed(1)} · {recall.crisp ? "crisp" : "blend"}
          </span>
        )}
      </div>
    </section>
  );
}
