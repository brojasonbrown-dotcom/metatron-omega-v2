/**
 * METATRON V11 — Tool enable/disable preferences (client-only).
 *
 * Single source of truth for which of the ~135 tools are active. Persisted in
 * localStorage. All call sites (Chat tool-marker dispatch, Kimi run launcher,
 * Catalog "Try" form) consult this before issuing a tool call.
 *
 * Default: every tool is enabled. Missing entry === enabled.
 */
import { useSyncExternalStore } from "react";
import { INTEL_META } from "./intelMeta";

const LS_KEY = "metatron.v11.toolPrefs.v1";
type PrefMap = Record<string, boolean>;

function readLS(): PrefMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as PrefMap) : {};
  } catch { return {}; }
}
function writeLS(p: PrefMap) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

let state: PrefMap = readLS();
const listeners = new Set<() => void>();
function emit() { listeners.forEach((fn) => fn()); }

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === LS_KEY) { state = readLS(); emit(); }
  });
}

export function isEnabled(name: string): boolean {
  return state[name] !== false; // undefined or true → enabled
}
export function setEnabled(name: string, on: boolean) {
  state = { ...state, [name]: on };
  writeLS(state); emit();
}
export function setMany(updates: Record<string, boolean>) {
  state = { ...state, ...updates };
  writeLS(state); emit();
}
export function enableAll() {
  const next: PrefMap = {};
  for (const t of INTEL_META) next[t.name] = true;
  state = next; writeLS(state); emit();
}
export function disableAll() {
  const next: PrefMap = {};
  for (const t of INTEL_META) next[t.name] = false;
  state = next; writeLS(state); emit();
}
/** Revert to the implicit default (all tools enabled, no entries persisted). */
export function resetToDefaults() {
  state = {}; writeLS(state); emit();
}
export function enableCategory(cat: string, on: boolean) {
  const next: PrefMap = { ...state };
  for (const t of INTEL_META) if (t.category === cat) next[t.name] = on;
  state = next; writeLS(state); emit();
}
/** Bulk-disable any auth:"key" tool whose env key is missing (per health probe). */
export function applyHealthFilter(missingKeys: string[]) {
  const dis = new Set(missingKeys);
  const next: PrefMap = { ...state };
  for (const t of INTEL_META) if (dis.has(t.name)) next[t.name] = false;
  state = next; writeLS(state); emit();
}

/** Stable snapshot for useSyncExternalStore — referentially equal until emit(). */
export function getPrefsSnapshot(): PrefMap { return state; }

export function useToolPrefs(): {
  prefs: PrefMap;
  isEnabled: (n: string) => boolean;
  enabledCount: number;
  totalCount: number;
  disabledList: string[];
} {
  const prefs = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    getPrefsSnapshot,
    getPrefsSnapshot,
  );
  const disabledList: string[] = [];
  let enabledCount = 0;
  for (const t of INTEL_META) {
    if (prefs[t.name] === false) disabledList.push(t.name);
    else enabledCount++;
  }
  return {
    prefs,
    isEnabled: (n) => prefs[n] !== false,
    enabledCount,
    totalCount: INTEL_META.length,
    disabledList,
  };
}
