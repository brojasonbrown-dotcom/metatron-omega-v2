/**
 * METATRON V11 — Tool health probe (server fn).
 *
 * For every auth:"key" tool, checks whether the corresponding env var is
 * present in the Worker runtime. Returns per-tool status used by the Catalog
 * tab to render an auth pill (key✓ / key✗) and to power the "Disable
 * missing-key" bulk action.
 */
import { createServerFn } from "@tanstack/react-start";

interface HealthEntry {
  name: string;
  envKey?: string;
  hasKey: boolean;
  status: "ready" | "needs-key" | "no-auth";
}

export const probeToolHealth = createServerFn({ method: "GET" }).handler(async (): Promise<HealthEntry[]> => {
  // Imported inside handler so client bundle never pulls intelMeta.
  const { INTEL_META } = await import("./intelMeta");
  return INTEL_META.map((t) => {
    if (t.auth === "none") {
      return { name: t.name, hasKey: true, status: "no-auth" as const };
    }
    const env = t.envKey ? process.env[t.envKey] : undefined;
    const hasKey = !!env && env.length > 0;
    return {
      name: t.name,
      envKey: t.envKey,
      hasKey,
      status: hasKey ? "ready" as const : "needs-key" as const,
    };
  });
});

export type ToolHealthEntry = HealthEntry;
