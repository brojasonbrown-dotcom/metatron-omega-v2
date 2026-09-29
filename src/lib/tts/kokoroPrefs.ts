/**
 * Single source of truth for Kokoro TTS preferences.
 *
 * Persisted to localStorage["v13.kokoroTTS"]. Subscribed to by every UI
 * control (side panel, ControlDock button, TopMenuBar Audio menu) and by
 * the chat gate in ToolsPanel — so flipping the toggle anywhere flips it
 * everywhere and actually turns speech on/off.
 */
import { useSyncExternalStore } from 'react';
import { KOKORO_VOICES, type KokoroVoice } from './kokoro';

const LS_KEY = 'v13.kokoroTTS';

export interface KokoroPrefs {
  enabled: boolean;
  voice: KokoroVoice;
  volume: number; // 0–1
  rate: number; // 0.5–2.0
}

const DEFAULTS: KokoroPrefs = {
  enabled: false,
  voice: 'af_heart',
  volume: 0.9,
  rate: 1.0,
};

const VOICE_IDS = new Set<string>(KOKORO_VOICES.map((v) => v.id));

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.max(lo, Math.min(hi, x));
}

function load(): KokoroPrefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<KokoroPrefs>;
    return {
      enabled: !!p.enabled,
      voice:
        typeof p.voice === 'string' && VOICE_IDS.has(p.voice)
          ? (p.voice as KokoroVoice)
          : DEFAULTS.voice,
      volume: clamp(p.volume, 0, 1, DEFAULTS.volume),
      rate: clamp(p.rate, 0.5, 2, DEFAULTS.rate),
    };
  } catch {
    return DEFAULTS;
  }
}

let current: KokoroPrefs = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(current));
  } catch {
    /* noop */
  }
}

// Cross-tab / cross-panel sync so a change in one window updates the others.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_KEY) return;
    current = load();
    listeners.forEach((fn) => fn());
  });
}

export function getPrefs(): KokoroPrefs {
  return current;
}
export function isEnabled(): boolean {
  return current.enabled;
}

export function setPrefs(patch: Partial<KokoroPrefs>): KokoroPrefs {
  const next: KokoroPrefs = {
    enabled: patch.enabled ?? current.enabled,
    voice: patch.voice && VOICE_IDS.has(patch.voice) ? patch.voice : current.voice,
    volume: patch.volume !== undefined ? clamp(patch.volume, 0, 1, current.volume) : current.volume,
    rate: patch.rate !== undefined ? clamp(patch.rate, 0.5, 2, current.rate) : current.rate,
  };
  if (
    next.enabled === current.enabled &&
    next.voice === current.voice &&
    next.volume === current.volume &&
    next.rate === current.rate
  )
    return current;
  current = next;
  persist();
  listeners.forEach((fn) => fn());
  return current;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useKokoroPrefs(): KokoroPrefs {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs);
}
