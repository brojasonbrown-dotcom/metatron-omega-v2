/**
 * Theme presets for the Metatron V11 engine shell.
 *
 * Each preset overrides the core semantic tokens (`--background`,
 * `--foreground`, `--primary`, `--accent`, `--border`, `--card`, `--muted`,
 * `--muted-foreground`, `--ring`) via a `[data-theme="..."]` attribute on
 * <html>. CSS values are `oklch` per project convention.
 *
 * `applyTheme()` is SSR-safe: it no-ops when `document` is unavailable.
 * Persistence lives in `localStorage` under `metatron.theme`.
 */

export type ThemeId = "matrix" | "noir" | "aurora" | "solar" | "ocean";

export interface ThemePreset {
  id: ThemeId;
  label: string;
  /** Short swatch description for the Settings menu. */
  swatch: { bg: string; fg: string; primary: string; accent: string };
}

export const THEMES: ThemePreset[] = [
  {
    id: "matrix",
    label: "Matrix",
    swatch: {
      bg: "oklch(0.12 0.02 145)",
      fg: "oklch(0.92 0.18 145)",
      primary: "oklch(0.78 0.22 145)",
      accent: "oklch(0.78 0.18 85)",
    },
  },
  {
    id: "noir",
    label: "Noir",
    swatch: {
      bg: "oklch(0.10 0.005 270)",
      fg: "oklch(0.95 0.005 270)",
      primary: "oklch(0.92 0.005 270)",
      accent: "oklch(0.78 0.16 85)",
    },
  },
  {
    id: "aurora",
    label: "Aurora",
    swatch: {
      bg: "oklch(0.14 0.04 280)",
      fg: "oklch(0.93 0.04 200)",
      primary: "oklch(0.72 0.18 200)",
      accent: "oklch(0.78 0.18 160)",
    },
  },
  {
    id: "solar",
    label: "Solar",
    swatch: {
      bg: "oklch(0.16 0.04 60)",
      fg: "oklch(0.95 0.04 80)",
      primary: "oklch(0.78 0.18 70)",
      accent: "oklch(0.70 0.20 25)",
    },
  },
  {
    id: "ocean",
    label: "Ocean",
    swatch: {
      bg: "oklch(0.14 0.04 220)",
      fg: "oklch(0.93 0.04 200)",
      primary: "oklch(0.72 0.16 210)",
      accent: "oklch(0.78 0.18 190)",
    },
  },
];

export const DEFAULT_THEME: ThemeId = "matrix";
const STORAGE_KEY = "metatron.theme";
const GLOW_KEY = "metatron.glow";
const DENSITY_KEY = "metatron.density";

export function applyTheme(id: ThemeId): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", id);
}

export function loadTheme(): ThemeId {
  if (typeof localStorage === "undefined") return DEFAULT_THEME;
  const v = localStorage.getItem(STORAGE_KEY);
  if (v && THEMES.some((t) => t.id === v)) return v as ThemeId;
  return DEFAULT_THEME;
}

export function saveTheme(id: ThemeId): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, id); } catch { /* quota */ }
}

export type DensityMode = "comfortable" | "compact";
export function loadDensity(): DensityMode {
  if (typeof localStorage === "undefined") return "comfortable";
  const v = localStorage.getItem(DENSITY_KEY);
  return v === "compact" ? "compact" : "comfortable";
}
export function saveDensity(m: DensityMode): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(DENSITY_KEY, m); } catch { /* quota */ }
}
export function applyDensity(m: DensityMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-density", m);
}

export function loadGlow(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(GLOW_KEY) !== "off";
}
export function saveGlow(on: boolean): void {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(GLOW_KEY, on ? "on" : "off"); } catch { /* quota */ }
}
export function applyGlow(on: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-glow", on ? "on" : "off");
}

/* UI scaling removed — was injecting CSS zoom on <html> which broke
 * panel resize math and produced fractional layout drift. */
export const UI_SCALE_DEFAULT = 1.0;
export function clearLegacyUiScale(): void {
  if (typeof document === "undefined") return;
  try { localStorage.removeItem("metatron.uiScale"); } catch { /* quota */ }
  const root = document.documentElement.style as CSSStyleDeclaration & { zoom?: string };
  if (root.zoom) root.zoom = "";
  document.documentElement.removeAttribute("data-ui-scale");
}

