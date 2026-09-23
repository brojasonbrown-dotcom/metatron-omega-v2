/**
 * OmegaWorkstation — the cleaned Metatron Omega shell.
 *
 * Everything engine-side (field loop, telemetry columns, brain/scales/qualia
 * decks, tune + control dock) has been removed. What remains:
 *
 *   • MEMORY   — the archived memory substrate (read/save/load/clear)
 *   • TOOLS    — tool catalog
 *   • INTEGRATIONS — auth-key surface
 *   • RUNS     — run log
 *   • right column — Kokoro TTS + Chat/Kimi
 *
 * The new engine mounts into the ENGINE slot below (currently a placeholder).
 */
import { useEffect, useState } from "react";
import { OmegaEngineShim } from "./OmegaEngineShim";
import FieldStage from "./FieldStage";
import { useFieldView } from "./fieldViewStore";
import { getMemoryRuntime } from "./memoryRuntime";
import { getKnowledgeRuntime } from "./knowledgeRuntime";
import { getMemoryDriver } from "./memoryDriver";
import { getSensoryDriver } from "./sensoryDriver";
import { getCognitiveDriver } from "./cognitiveDriver";
import { getAnalysisRuntime } from "./analysisRuntime";

import EngineDeckPanel from "./panels/EngineDeckPanel";
import LadderDeckPanel from "./panels/LadderDeckPanel";
import FieldDeckPanel from "./panels/FieldDeckPanel";
import WebDeckPanel from "./panels/WebDeckPanel";
import SpectralDeckPanel from "./panels/SpectralDeckPanel";
import ToroidScanPanel from "./panels/ToroidScanPanel";
import SenseDeckPanel from "./panels/SenseDeckPanel";
import MindDeckPanel from "./panels/MindDeckPanel";
import CognitionPanel from "./panels/CognitionPanel";
import SelfDeckPanel from "./panels/SelfDeckPanel";
import AnalysisDeckPanel from "./panels/AnalysisDeckPanel";
import { useOmegaState } from "./useOmegaRuntime";
import IntegrationsView from "./panels/IntegrationsView";
import KokoroPanel from "./panels/KokoroPanel";
import SourceChip from "./panels/SourceChip";
import { ToolsPanel } from "@/components/v11/chat/ToolsPanel";

type Tab = "engine" | "ladder" | "field" | "web" | "spectral" | "toroid" | "sense" | "mind" | "cognition" | "analysis" | "self" | "tools" | "integrations" | "runs";
const TABS: { id: Tab; label: string }[] = [
  { id: "engine", label: "ENGINE" },
  { id: "ladder", label: "LADDER" },
  { id: "field", label: "FIELD" },
  { id: "web", label: "WEB" },
  { id: "spectral", label: "SPECTRAL" },
  { id: "toroid", label: "TOROID" },
  { id: "sense", label: "SENSE" },
  { id: "mind", label: "MIND" },
  { id: "cognition", label: "COGNITION" },
  { id: "analysis", label: "ANALYSIS" },
  { id: "self", label: "SELF" },
  { id: "tools", label: "TOOLS" },
  { id: "integrations", label: "INTEGRATIONS" },
  { id: "runs", label: "RUNS" },
];

const TAB_KEY = "metatron.omega.tab";

function Shell() {
  // The selected deck is part of the session state the user expects back
  // after a reload, so it is persisted like every other setting.
  const [tab, setTabState] = useState<Tab>(() => {
    if (typeof localStorage === "undefined") return "engine";
    const saved = localStorage.getItem(TAB_KEY) as Tab | null;
    return saved && TABS.some((t) => t.id === saved) ? saved : "engine";
  });
  const setTab = (next: Tab) => {
    setTabState(next);
    if (typeof localStorage !== "undefined") localStorage.setItem(TAB_KEY, next);
  };
  const omega = useOmegaState();
  const view = useFieldView();


  // Archive: hydrate the persisted memory substrate and the local knowledge
  // corpus once on mount, regardless of which deck is open — restoring must
  // never depend on the user visiting a particular tab.
  useEffect(() => {
    void getMemoryRuntime().load();
    void getKnowledgeRuntime().hydrate();
    // Ω-WAKE S2/S3 — the drive edge from the live worker into memory + mind.
    const driver = getMemoryDriver();
    driver.start();
    // Ω-ACTIVATE A1 — attach the sensory clock. Enables no device and
    // requests no permission; channels are opt-in from the SENSE deck.
    const senses = getSensoryDriver();
    senses.start();
    // Ω-P9 — the analysis spine samples whatever those sources measure. It
    // enables nothing itself; with every source idle it records only gaps.
    const analysis = getAnalysisRuntime();
    analysis.start();
    // Ω-COG — the three cold atlas edges: spectral scan, latent training and
    // field-signature coverage. Pull-based decks no longer gate them.
    const cognition = getCognitiveDriver();
    cognition.start();
    return () => { driver.stop(); senses.stop(); analysis.stop(); cognition.stop(); };
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <header className="relative z-50 border-b border-border px-4 py-1.5 flex items-center gap-3 bg-card">
        <h1 className="font-display text-sm font-bold text-primary text-glow tracking-[0.3em]">
          METATRON
        </h1>
        <span className="text-[9px] text-muted-foreground font-display tracking-wider">
          OMEGA
        </span>
        <span
          className={`text-[9px] font-display tracking-wider ${
            omega.running ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {omega.running
            ? `● ${omega.profile ?? "ENGINE"} · t${omega.snapshot?.tick ?? 0} · ${(
                omega.snapshot?.tickRate ?? 0
              ).toFixed(0)} Hz`
            : `○ ${omega.profile ? `${omega.profile} HALTED` : "NO ENGINE"}`}
        </span>
      </header>

      <div
        className="flex-1 relative z-10 overflow-hidden grid min-h-0"
        style={{ gridTemplateColumns: "68fr 32fr" }}
      >
        {/* LEFT — stage on top, workbench below */}
        <div className="min-w-0 min-h-0 flex flex-col overflow-hidden p-2 gap-2">
          <div className={view.stageOpen ? "min-h-0 basis-1/2 grow flex flex-col" : "shrink-0 flex flex-col"}>
            <FieldStage />
          </div>
          <section className="panel-matrix rounded-md border border-border/40 bg-card/60 flex-1 min-h-0 flex flex-col overflow-hidden">

            <header className="shrink-0 flex items-stretch border-b border-border/30 bg-background/40 h-9 overflow-x-auto no-scrollbar">
              {TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`shrink-0 whitespace-nowrap px-3 font-display text-[10px] tracking-[0.28em] border-b-2 transition-colors ${
                      active
                        ? "border-primary text-primary bg-primary/5"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </header>

            <div className="flex-1 min-h-0 overflow-hidden">
              {tab === "engine" && <EngineDeckPanel />}
              {tab === "ladder" && <LadderDeckPanel />}
              {tab === "field" && <FieldDeckPanel />}
              {tab === "web" && <WebDeckPanel />}
              {tab === "spectral" && <SpectralDeckPanel />}
              {tab === "toroid" && <ToroidScanPanel />}
              {tab === "sense" && <SenseDeckPanel />}
              {tab === "mind" && <MindDeckPanel />}
              {tab === "cognition" && <CognitionPanel />}
              {tab === "analysis" && <AnalysisDeckPanel />}
              {tab === "self" && <SelfDeckPanel />}
              {tab === "tools" && <ToolsPanel onlyTabs={["catalog"]} />}
              {tab === "integrations" && <IntegrationsView />}
              {tab === "runs" && <ToolsPanel onlyTabs={["runs"]} />}
            </div>

            <div className="shrink-0 border-t border-border/30 px-3 py-1.5 bg-card/40 text-[9px] font-mono text-muted-foreground tracking-wider">
              {omega.snapshot
                ? `Ω-P4 · ${omega.profile} · ${omega.snapshot.totalNodes} nodes · digest ${omega.snapshot.digest}`
                : "Ω-P4 · engine host ready — build a profile in the ENGINE deck"}
            </div>
          </section>
        </div>

        {/* RIGHT — chat + TTS */}
        <div className="min-w-0 min-h-0 overflow-hidden p-2 gap-2 border-l border-border bg-card/95 flex flex-col">
          <KokoroPanel />
          <section className="panel-matrix rounded-md border border-border/40 bg-card/60 backdrop-blur-sm flex-1 min-h-0 flex flex-col overflow-hidden">
            <header className="flex items-center justify-between px-3 py-2 border-b border-border/30 shrink-0">
              <h2 className="text-[10px] font-display tracking-[0.28em] uppercase text-foreground/80">
                ◆ CHAT · KIMI
              </h2>
              <SourceChip state="IDLE" tone="idle" />
            </header>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ToolsPanel onlyTabs={["chat", "kimi"]} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function OmegaWorkstation() {
  return (
    <OmegaEngineShim>
      <Shell />
    </OmegaEngineShim>
  );
}
