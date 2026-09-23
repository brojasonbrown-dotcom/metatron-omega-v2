/**
 * Kokoro TTS — V10-style browser SpeechSynthesis bridge.
 *
 * Lesson from V10: the original "Kokoro" experience used the browser's
 * native `speechSynthesis` API, not the 80MB WASM model. That is why it
 * had ZERO mid-reply pauses, no first-batch latency, and no audio scheduling
 * jitter. We keep the full 11-voice Kokoro lineup but map each voice ID to
 * the best available system voice and chain chunks via `onend`, exactly as
 * the V10 engine did. The previous worker/WASM path remains on disk but is
 * no longer used at runtime.
 */

export const KOKORO_VOICES = [
  { id: "af_heart",    label: "Heart (US F)" },
  { id: "af_bella",    label: "Bella (US F)" },
  { id: "af_nicole",   label: "Nicole (US F)" },
  { id: "af_sarah",    label: "Sarah (US F)" },
  { id: "am_michael",  label: "Michael (US M)" },
  { id: "am_adam",     label: "Adam (US M)" },
  { id: "am_fenrir",   label: "Fenrir (US M)" },
  { id: "bf_emma",     label: "Emma (UK F)" },
  { id: "bf_isabella", label: "Isabella (UK F)" },
  { id: "bm_george",   label: "George (UK M)" },
  { id: "bm_lewis",    label: "Lewis (UK M)" },
] as const;

export type KokoroVoice = (typeof KOKORO_VOICES)[number]["id"];

type Status = "idle" | "loading" | "ready" | "error";
type Listener = (s: { status: Status; message?: string }) => void;

let status: Status = "idle";
let lastMessage: string | undefined;
const listeners = new Set<Listener>();

function setStatus(s: Status, message?: string) {
  status = s;
  lastMessage = message;
  for (const fn of listeners) fn({ status: s, message });
}

export function subscribeStatus(fn: Listener): () => void {
  listeners.add(fn);
  fn({ status, message: lastMessage });
  return () => listeners.delete(fn);
}

/* ---------------- voice resolution ---------------- */

const PRIORITY_NAMES: Record<KokoroVoice, string[]> = {
  af_heart:    ["samantha", "karen", "victoria", "google us english", "microsoft aria"],
  af_bella:    ["allison", "ava", "joanna", "microsoft jenny", "google us english"],
  af_nicole:   ["nicole", "tessa", "serena", "microsoft michelle"],
  af_sarah:    ["sara", "kathy", "vicki", "microsoft zira"],
  am_michael:  ["alex", "fred", "tom", "microsoft guy", "google us english"],
  am_adam:     ["daniel", "aaron", "alex", "microsoft david"],
  am_fenrir:   ["fred", "rishi", "albert", "microsoft mark"],
  bf_emma:     ["kate", "serena", "moira", "google uk english female", "microsoft hazel"],
  bf_isabella: ["isha", "fiona", "tessa", "google uk english female", "microsoft susan"],
  bm_george:   ["daniel", "oliver", "arthur", "google uk english male", "microsoft george"],
  bm_lewis:    ["lewis", "ryan", "oliver", "google uk english male", "microsoft ryan"],
};

let cachedVoices: SpeechSynthesisVoice[] = [];
let voicesLoaded = false;

function refreshVoices(synth: SpeechSynthesis) {
  try { cachedVoices = synth.getVoices() ?? []; } catch { cachedVoices = []; }
  if (cachedVoices.length > 0) voicesLoaded = true;
}

function pickVoice(voiceId: KokoroVoice): SpeechSynthesisVoice | null {
  if (cachedVoices.length === 0) return null;
  const en = cachedVoices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  const pool = en.length >= 4 ? en : cachedVoices;
  const names = PRIORITY_NAMES[voiceId] ?? [];
  for (const name of names) {
    const match = pool.find((v) => v.name.toLowerCase().includes(name));
    if (match) return match;
  }
  // Stable fallback: hash voice id into the pool so each id keeps a distinct slot.
  const ids = KOKORO_VOICES.map((v) => v.id) as readonly string[];
  const idx = ids.indexOf(voiceId);
  return pool[(idx >= 0 ? idx : 0) % pool.length] ?? null;
}

function ensureSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  const synth = window.speechSynthesis;
  if (!synth) return null;
  if (!voicesLoaded) {
    refreshVoices(synth);
    if (typeof synth.onvoiceschanged !== "undefined") {
      synth.onvoiceschanged = () => refreshVoices(synth);
    }
  }
  return synth;
}

/**
 * The voice list is populated asynchronously in Chrome/Safari. If the first
 * utterance is spoken before it arrives, `pickVoice` returns null and the
 * browser uses its default voice — which is exactly why the voice used to
 * change after the first paragraph. Wait (bounded) for the list once.
 */
function ensureVoicesReady(synth: SpeechSynthesis, timeoutMs = 2000): Promise<void> {
  refreshVoices(synth);
  if (voicesLoaded) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      refreshVoices(synth);
      if (voicesLoaded || Date.now() - started > timeoutMs) resolve();
      else setTimeout(tick, 50);
    };
    tick();
  });
}


/* ---------------- volume + prime ---------------- */

let currentVolume = 1;
export function setVolume(v: number) { currentVolume = Math.max(0, Math.min(1, v)); }

export function primeAudio(volume = 1) {
  currentVolume = Math.max(0, Math.min(1, volume));
  const synth = ensureSynth();
  if (!synth) { setStatus("error", "speechSynthesis unavailable"); return; }
  // Some browsers (Safari, Chrome) require an utterance during a user gesture
  // before they will speak. Push a silent zero-volume utterance to unlock.
  try {
    const warm = new SpeechSynthesisUtterance(" ");
    warm.volume = 0;
    synth.speak(warm);
    setStatus("ready");
  } catch (e) {
    setStatus("error", (e as Error).message);
  }
}

/* ---------------- chunking + queue ---------------- */

const MAX_CHUNK = 220;

// Strip thousands separators (1,234,567 -> 1234567) and protect decimal points
// inside numbers — including scientific notation mantissas like 3.0e-2 — so
// sentence splitting on "." never breaks a number apart.
function protectNumbers(text: string): string {
  let out = text.replace(/(\d{1,3}(?:,\d{3})+)(?!\d)/g, (m) => m.replace(/,/g, ""));
  out = out.replace(/(\d)\.(\d)/g, "$1<dp>$2");
  return out;
}

function splitText(text: string): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= MAX_CHUNK) return [clean];
  const protectedText = protectNumbers(clean);
  const sentences = protectedText.match(/[^.!?]+[.!?]+\s*/g) ?? [protectedText];
  const out: string[] = [];
  let current = "";
  const flush = () => {
    const s = current.replace(/<dp>/g, ".").trim();
    if (s) out.push(s);
    current = "";
  };
  for (const sentence of sentences) {
    if (current.length + sentence.length > MAX_CHUNK && current.length > 0) {
      flush();
      current = sentence;
    } else {
      current += sentence;
    }
  }
  flush();
  return out.length ? out : [clean];
}

interface QueuedJob { text: string; voice: KokoroVoice; volume: number; rate: number }
const queue: QueuedJob[] = [];
let speaking = false;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let keepAlive: ReturnType<typeof setInterval> | null = null;

/* ---------------- speaking-state pub/sub ---------------- */

const speakingListeners = new Set<(v: boolean) => void>();
export function isSpeaking(): boolean { return speaking; }
export function subscribeSpeaking(fn: (v: boolean) => void): () => void {
  speakingListeners.add(fn);
  fn(speaking);
  return () => { speakingListeners.delete(fn); };
}
function setSpeaking(v: boolean) {
  if (speaking === v) return;
  speaking = v;
  for (const fn of speakingListeners) fn(v);
}

function startKeepAlive(synth: SpeechSynthesis) {
  stopKeepAlive();
  // Chrome pauses synthesis after ~15s — pause/resume keeps it alive.
  keepAlive = setInterval(() => {
    if (!synth.speaking) { stopKeepAlive(); return; }
    try { synth.pause(); synth.resume(); } catch { /* noop */ }
  }, 10000);
}
function stopKeepAlive() {
  if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
}

export function stopSpeaking() {
  queue.length = 0;
  setSpeaking(false);
  currentUtterance = null;
  stopKeepAlive();
  const synth = ensureSynth();
  if (synth) { try { synth.cancel(); } catch { /* noop */ } }
}

export async function speak(text: string, voice: KokoroVoice, volume: number, rate = 1.0) {
  const clean = sanitizeForSpeech(text);
  if (!clean) return;
  queue.push({ text: clean, voice, volume, rate });
  if (!speaking) void drain();
}

async function drain() {
  const synth = ensureSynth();
  if (!synth) { setStatus("error", "speechSynthesis unavailable"); return; }
  setSpeaking(true);
  try {
    // Resolve the voice list once, before the first utterance, so every
    // chunk of every job uses the same resolved system voice.
    await ensureVoicesReady(synth);
    setStatus("ready");
    while (queue.length) {
      const job = queue.shift()!;
      const resolved = pickVoice(job.voice);
      const chunks = splitText(job.text);
      for (let i = 0; i < chunks.length; i++) {
        if (!speaking) return; // stopSpeaking called
        await speakChunk(synth, chunks[i], resolved, job.volume, job.rate);
      }
    }
  } finally {
    setSpeaking(false);
    stopKeepAlive();
  }
}

function speakChunk(
  synth: SpeechSynthesis,
  text: string,
  voice: SpeechSynthesisVoice | null,
  volume: number,
  rate: number,
): Promise<void> {
  return new Promise((resolve) => {
    const utt = new SpeechSynthesisUtterance(text);
    utt.volume = Math.max(0, Math.min(1, volume * currentVolume));
    utt.rate = Math.max(0.5, Math.min(2, rate));
    utt.pitch = 1.0;
    if (voice) { utt.voice = voice; utt.lang = voice.lang; }

    utt.onend = () => { currentUtterance = null; resolve(); };
    utt.onerror = (ev) => {
      if (ev.error !== "interrupted" && ev.error !== "canceled") {
        console.warn("[kokoro] speech error", ev.error);
      }
      currentUtterance = null;
      resolve();
    };
    currentUtterance = utt;
    try { synth.speak(utt); startKeepAlive(synth); }
    catch (e) { console.warn("[kokoro] speak failed", e); resolve(); }
  });
}

/* ---------------- sanitizer ---------------- */

const DIGIT_WORDS = ["zero","one","two","three","four","five","six","seven","eight","nine"];
const spellDigits = (s: string) => s.split("").map((d) => DIGIT_WORDS[Number(d)] ?? d).join(" ");

function speakNumber(raw: string): string {
  // raw may be: [-]?digits(,digits)*(\.digits)?([eE][+-]?digits)?
  const m = raw.match(/^(-?)(\d[\d,]*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!m) return raw;
  const [, sign, intPart, frac, exp] = m;
  const intClean = intPart.replace(/,/g, "");
  let out = sign ? "minus " : "";
  out += intClean; // leave integer to engine for natural "one thousand two hundred thirty four"
  if (frac) out += ` point ${spellDigits(frac)}`;
  if (exp !== undefined) {
    const e = parseInt(exp, 10);
    out += ` times ten to the ${e < 0 ? `negative ${Math.abs(e)}` : `${e}`}`;
  }
  return out;
}

function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[FILE:[^\]]*\]/g, " ")
    .replace(/<<TOOL[_A-Z]*:[\s\S]*?>>/g, " ")
    .replace(/data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=]+/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Numbers: signed, optional thousands separators, optional decimal, optional scientific exponent.
    .replace(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:[eE][+-]?\d+)?|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g, (m) => speakNumber(m))
    .replace(/[#>*_~]/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}


/* ---------------- preload no-ops (kept for API compatibility) ---------------- */

export function preload() {
  const synth = ensureSynth();
  if (synth) { refreshVoices(synth); setStatus("ready"); }
}

export function preloadWhenIdle(_timeout = 8000) {
  // SpeechSynthesis loads instantly — nothing to preload.
  const synth = ensureSynth();
  if (synth) setStatus("ready");
}
