/**
 * MIND deck — Ω-P7 cognition and self-model.
 *
 * Three honest readouts, all pulled from the worker:
 *   • the self-model scoreboard — λ-SSM vs its RLS baseline vs persistence.
 *     The SSM is only "in force" while its measured margin is positive, and
 *     |λ| is shown against the hard stability ceiling φ⁻¹ it cannot cross.
 *   • the concept store — HNSW graph shape, PQ compression ratio and the
 *     measured PQ cosine error, plus the exact-comparison cost each search
 *     actually spent (the number HNSW exists to shrink).
 *   • the thought stream — novelty, surprise and the gate's decision per fold.
 *
 * Nothing on this deck is synthesised; every value is a measurement.
 */
import { useCallback } from "react";
import { getOmegaRuntime } from "../omegaRuntime";
import { useOmegaState } from "../useOmegaRuntime";
import { useOmegaPull } from "../useOmegaPull";

const num = (x: number | undefined, d = 4) =>
  x === undefined || !Number.isFinite(x) ? "—" : x.toFixed(d);
const exp = (x: number | undefined) =>
  x === undefined || !Number.isFinite(x) ? "—" : x.toExponential(2);

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <>
      <span className="text-muted-foreground">{k}</span>
      <span className={`tabular-nums ${tone ?? ""}`}>{v}</span>
    </>
  );
}

const ACTION_TONE: Record<string, string> = {
  seed: "text-primary",
  store: "text-primary",
  recognise: "text-muted-foreground",
};

export default function MindDeckPanel() {
  const s = useOmegaState();
  const rt = getOmegaRuntime();

  const request = useCallback(() => {
    rt.requestMind();
    rt.requestReflection(5);
  }, [rt]);
  useOmegaPull(request, 4, Boolean(s.snapshot));

  if (!s.snapshot) {
    return (
      <div className="h-full grid place-items-center text-[11px] font-mono text-muted-foreground">
        Build the engine on the ENGINE deck to open the mind.
      </div>
    );
  }

  const m = s.mind;
  const self = m?.selfModel;
  const c = m?.concepts;
  const ratio = c && c.vectorBytes > 0 ? c.vectorBytes / Math.max(1, c.codeBytes) : 0;
  const stable = self ? self.spectralRadius < self.lambdaMax : true;

  return (
    <div className="h-full overflow-auto p-2 space-y-2">
      {/* headline */}
      <div className="rounded-md border border-border/40 bg-background/40 px-2.5 py-2 grid grid-cols-2 md:grid-cols-6 gap-x-4 gap-y-1 text-[10px] font-mono">
        <Row k="thoughts" v={String(m?.thoughts ?? 0)} />
        <Row k="concepts" v={`${c?.size ?? 0} / ${c?.capacity ?? 0}`} />
        <Row k="mean novelty" v={num(m?.meanNovelty)} />
        <Row k="mean surprise" v={num(m?.meanSurprise)} />
        <Row
          k="self-model"
          v={self?.enabled ? "λ-SSM in force" : "RLS baseline"}
          tone={self?.enabled ? "text-primary" : "text-muted-foreground"}
        />
        <Row
          k="margin"
          v={num(self?.margin)}
          tone={(self?.margin ?? 0) > 0 ? "text-primary" : "text-destructive"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        {/* self-model */}
        <section className="rounded-md border border-border/40 bg-background/40 p-2.5 space-y-2">
          <header className="text-[10px] font-mono tracking-widest text-muted-foreground">
            SELF-MODEL · measured against its own baselines
          </header>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
            <Row k="samples" v={String(self?.samples ?? 0)} />
            <Row k="window" v={String(self?.window ?? 0)} />
            <Row k="ssm mse" v={exp(self?.ssmMse)} />
            <Row k="rls mse" v={exp(self?.rlsMse)} />
            <Row k="persistence mse" v={exp(self?.persistenceMse)} />
            <Row
              k="skill vs persistence"
              v={num(self?.skill)}
              tone={(self?.skill ?? 0) > 0 ? "text-primary" : "text-destructive"}
            />
            <Row
              k="|λ| max"
              v={`${num(self?.spectralRadius)} < ${num(self?.lambdaMax)}`}
              tone={stable ? "text-primary" : "text-destructive"}
            />
            <Row k="dim" v={String(self?.dim ?? 0)} />
            <Row k="quiescent folds" v={String(s.snapshot?.quiescentFolds ?? 0)} />
          </div>
          <div className="text-[9px] font-mono text-muted-foreground leading-relaxed">
            The λ-SSM is parametrised so |λ| can never reach φ⁻¹ — stability is
            structural, not monitored. It is only read when its margin over RLS
            is positive; otherwise the deck reports the baseline.
          </div>
          {/* per-fold error tail */}
          <div className="border-t border-border/30 pt-1.5 space-y-0.5 text-[9px] font-mono">
            {(self?.recent ?? []).slice(-8).map((p) => (
              <div key={p.tick} className="grid grid-cols-5 gap-2 tabular-nums">
                <span className="text-muted-foreground">t{p.tick}</span>
                <span className={p.source === "ssm" ? "text-primary" : "text-muted-foreground"}>
                  {p.source}
                </span>
                <span>{exp(p.ssmError)}</span>
                <span>{exp(p.rlsError)}</span>
                <span className="text-muted-foreground">{exp(p.persistenceError)}</span>
              </div>
            ))}
            {!self?.recent?.length && <span className="text-muted-foreground">no folds yet</span>}
          </div>
        </section>

        {/* concept store */}
        <section className="rounded-md border border-border/40 bg-background/40 p-2.5 space-y-2">
          <header className="text-[10px] font-mono tracking-widest text-muted-foreground">
            CONCEPT STORE · HNSW + product quantisation
          </header>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
            <Row k="dim" v={String(c?.dim ?? 0)} />
            <Row k="graph levels" v={String(c?.levels ?? 0)} />
            <Row k="M / efSearch" v={`${c?.M ?? 0} / ${c?.efSearch ?? 0}`} />
            <Row
              k="pq"
              v={c?.pqReady ? `${c.sub}×${c.centroids}` : "training"}
              tone={c?.pqReady ? "text-primary" : "text-muted-foreground"}
            />
            <Row k="pq cosine error" v={num(c?.pqError)} />
            <Row k="compression" v={ratio > 0 ? `${ratio.toFixed(1)}×` : "—"} />
            <Row k="evictions" v={String(c?.evictions ?? 0)} />
            <Row k="exact ops · last" v={String(s.reflection?.exactOps ?? 0)} />
          </div>
          <div className="border-t border-border/30 pt-1.5 space-y-0.5 text-[9px] font-mono">
            <div className="text-muted-foreground">nearest to the live state</div>
            {(s.reflection?.hits ?? []).map((h) => (
              <div key={h.id} className="grid grid-cols-3 gap-2 tabular-nums">
                <span className="truncate">{h.key}</span>
                <span>{num(h.score)}</span>
                <span className="text-muted-foreground">#{h.id}</span>
              </div>
            ))}
            {!s.reflection?.hits?.length && (
              <span className="text-muted-foreground">store empty</span>
            )}
          </div>
        </section>
      </div>

      {/* thought stream */}
      <section className="rounded-md border border-border/40 bg-background/40 p-2.5 space-y-1">
        <header className="text-[10px] font-mono tracking-widest text-muted-foreground">
          THOUGHT STREAM · gate at novelty {num(m?.noveltyThreshold, 3)}
        </header>
        <div className="grid grid-cols-6 gap-2 text-[9px] font-mono text-muted-foreground">
          <span>tick</span>
          <span>action</span>
          <span>novelty</span>
          <span>surprise</span>
          <span>concept</span>
          <span>predictor</span>
        </div>
        <div className="space-y-0.5">
          {(m?.recent ?? [])
            .slice()
            .reverse()
            .map((t) => (
              <div
                key={t.tick}
                className="grid grid-cols-6 gap-2 text-[9px] font-mono tabular-nums"
              >
                <span className="text-muted-foreground">{t.tick}</span>
                <span className={ACTION_TONE[t.action] ?? ""}>{t.action}</span>
                <span>{num(t.novelty, 3)}</span>
                <span>{num(t.surprise, 3)}</span>
                <span className="truncate">{t.conceptKey ?? "—"}</span>
                <span className={t.source === "ssm" ? "text-primary" : "text-muted-foreground"}>
                  {t.source}
                </span>
              </div>
            ))}
          {!m?.recent?.length && (
            <span className="text-[9px] font-mono text-muted-foreground">
              run the engine — folds land every 21 ticks
            </span>
          )}
        </div>
      </section>

      {/* top concepts */}
      <section className="rounded-md border border-border/40 bg-background/40 p-2.5 space-y-1">
        <header className="text-[10px] font-mono tracking-widest text-muted-foreground">
          MOST-RETRIEVED CONCEPTS
        </header>
        <div className="grid grid-cols-4 gap-2 text-[9px] font-mono text-muted-foreground">
          <span>key</span>
          <span>hits</span>
          <span>first seen</span>
          <span>norm</span>
        </div>
        {(m?.top ?? []).map((r) => (
          <div key={r.id} className="grid grid-cols-4 gap-2 text-[9px] font-mono tabular-nums">
            <span className="truncate">{r.label ?? r.key}</span>
            <span>{r.hits}</span>
            <span className="text-muted-foreground">t{r.tick}</span>
            <span>{num(r.rawNorm, 3)}</span>
          </div>
        ))}
        {!m?.top?.length && (
          <span className="text-[9px] font-mono text-muted-foreground">nothing retained yet</span>
        )}
      </section>
    </div>
  );
}
