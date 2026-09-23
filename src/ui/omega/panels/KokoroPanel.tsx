/**
 * KokoroPanel — matrix chrome around our existing KokoroTTSPanel.
 * Zero changes to `src/lib/tts/**`.
 */
import SourceChip from "./SourceChip";
import { KokoroTTSPanel } from "@/components/v11/panels/KokoroTTSPanel";

export default function KokoroPanel() {
  return (
    <section className="panel-matrix rounded-md border border-border/40 bg-card/60 backdrop-blur-sm">
      <header className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <h2 className="text-[10px] font-display tracking-[0.28em] uppercase text-foreground/80">
          ◆ KOKORO TTS
        </h2>
        <SourceChip state="IDLE" tone="idle" />
      </header>
      <KokoroTTSPanel />
    </section>
  );
}
