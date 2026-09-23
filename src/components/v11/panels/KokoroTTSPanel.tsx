/**
 * KOKORO TTS panel — toggle, voice picker, volume/rate, listens for
 * `kokoro:speak` CustomEvents from chat. Consumes the shared prefs store
 * so ControlDock button, TopMenuBar Audio menu, and this panel all reflect
 * (and mutate) the same state.
 */
import { useEffect, useRef } from "react";
import { Slider } from "@/components/ui/slider";
import {
  KOKORO_VOICES, type KokoroVoice,
  speak, stopSpeaking, setVolume, subscribeStatus, preloadWhenIdle, primeAudio,
} from "@/lib/tts/kokoro";
import { useKokoroPrefs, setPrefs, getPrefs } from "@/lib/tts/kokoroPrefs";

export function KokoroTTSPanel() {
  const prefs = useKokoroPrefs();
  const statusRef = useRef<{ status: string; message?: string }>({ status: "idle" });
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => subscribeStatus((s) => { statusRef.current = s; }), []);
  useEffect(() => { setVolume(prefs.volume); }, [prefs.volume]);

  // listen for "kokoro:speak" events from chat
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ text: string }>).detail;
      const p = prefsRef.current;
      if (!p.enabled || !detail?.text) return;
      void speak(detail.text, p.voice, p.volume, p.rate);
    };
    window.addEventListener("kokoro:speak", handler);
    return () => window.removeEventListener("kokoro:speak", handler);
  }, []);

  const toggle = () => {
    const next = !prefs.enabled;
    setPrefs({ enabled: next });
    if (next) { primeAudio(prefs.volume); preloadWhenIdle(); } else stopSpeaking();
  };

  const testVoice = () => {
    const p = getPrefs();
    void speak("Coherence rising. Phase lock confirmed.", p.voice, p.volume, p.rate);
  };

  const status = statusRef.current;
  const statusTone =
    status.status === "ready" ? "text-accent"
    : status.status === "loading" ? "text-primary animate-pulse"
    : status.status === "error" ? "text-destructive"
    : "text-muted-foreground";

  return (
    <div className="p-2.5 space-y-2.5">
      <button
        onClick={toggle}
        className={`w-full px-3 py-1.5 rounded font-display text-[10px] tracking-[0.25em] border-2 transition-all ${
          prefs.enabled
            ? "border-accent text-accent bg-accent/15"
            : "border-border text-muted-foreground hover:text-accent hover:border-accent/60"
        }`}
      >
        {prefs.enabled ? "● VOICE ON" : "○ VOICE OFF"}
      </button>

      <div>
        <div className="text-[9px] font-display tracking-[0.22em] text-muted-foreground mb-1">◇ VOICE</div>
        <select
          value={prefs.voice}
          onChange={(e) => setPrefs({ voice: e.target.value as KokoroVoice })}
          className="w-full px-2 py-1 rounded border border-border bg-background text-foreground text-[10px] font-mono focus:outline-none focus:border-primary"
        >
          {KOKORO_VOICES.map((v) => (
            <option key={v.id} value={v.id}>{v.label}</option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] font-display tracking-[0.22em] text-muted-foreground">◇ VOLUME</span>
          <span className="text-[9px] font-mono text-accent tabular-nums">{Math.round(prefs.volume * 100)}%</span>
        </div>
        <Slider
          value={[prefs.volume * 100]}
          min={0} max={100} step={1}
          onValueChange={([v]) => setPrefs({ volume: v / 100 })}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] font-display tracking-[0.22em] text-muted-foreground">◇ RATE</span>
          <span className="text-[9px] font-mono text-accent tabular-nums">{prefs.rate.toFixed(2)}×</span>
        </div>
        <Slider
          value={[prefs.rate * 100]}
          min={50} max={200} step={5}
          onValueChange={([v]) => setPrefs({ rate: v / 100 })}
        />
      </div>

      <div className="grid grid-cols-2 gap-1">
        <button
          onClick={testVoice}
          className="px-2 py-1 rounded font-display text-[9px] tracking-[0.2em] border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
        >
          ▶ TEST
        </button>
        <button
          onClick={stopSpeaking}
          className="px-2 py-1 rounded font-display text-[9px] tracking-[0.2em] border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-all"
        >
          ■ STOP
        </button>
      </div>

      <p className={`text-[9px] font-mono truncate ${statusTone}`}>
        {status.status}{status.message ? ` · ${status.message}` : ""}
      </p>
    </div>
  );
}
