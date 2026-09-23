/**
 * METATRON V11 — Tool handlers (server-only).
 *
 * Unified dispatch surface. Merges the full V10 INTEL_HANDLERS port with the
 * original 19 hand-written wave-1 handlers. Intel arsenal wins on name
 * collision (it is the canonical, hardened implementation).
 *
 * Every handler returns a JSON-safe payload; network-only, no node-native deps.
 */

import { INTEL_HANDLERS } from "./intel.server";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<unknown>;

// ─── Legacy wave-1 handlers (kept for any name not covered by intel) ────────
const LEGACY: Record<string, Handler> = {
  // intentionally empty — all 19 legacy names are now covered by INTEL_HANDLERS.
  // Add overrides here only if intel.server lacks a name you need.
};

export const HANDLERS: Record<string, Handler> = {
  ...LEGACY,
  ...(INTEL_HANDLERS as Record<string, Handler>),
};

export function hasHandler(name: string) {
  return Object.prototype.hasOwnProperty.call(HANDLERS, name);
}
