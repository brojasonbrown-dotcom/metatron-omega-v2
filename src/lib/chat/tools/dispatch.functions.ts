/**
 * METATRON V11 — Tool dispatch server function.
 *
 * Client → useServerFn(dispatchTool)({ data: { name, args, enabled? } })
 * Returns ToolResult. Latency is measured server-side.
 *
 * The `enabled` flag lets the client short-circuit user-disabled tools without
 * a network round-trip. (The Catalog "Try" button always sends true so users
 * can probe even disabled tools on demand by re-enabling first.)
 */
import { createServerFn } from "@tanstack/react-start";
import { HANDLERS, hasHandler } from "./handlers.server";
import { TOOL_INDEX } from "./registry";
import type { ToolArgs, ToolResult, JsonValue } from "../types";

export const dispatchTool = createServerFn({ method: "POST" })
  .inputValidator((d: { name: string; args?: ToolArgs; enabled?: boolean }) => ({
    name: String(d.name),
    args: (d.args ?? {}) as ToolArgs,
    enabled: d.enabled !== false,
  }))
  .handler(async ({ data }): Promise<ToolResult> => {
    const t0 = Date.now();
    if (!data.enabled) {
      return { ok: false, name: data.name, args: data.args, reason: "tool disabled by user", latencyMs: 0 };
    }
    const spec = TOOL_INDEX[data.name];
    if (!spec || !hasHandler(data.name)) {
      return { ok: false, name: data.name, args: data.args, reason: "unknown tool", latencyMs: 0 };
    }
    // Pre-flight: short-circuit before hitting an upstream API with no key.
    if (spec.auth === "key" && spec.envKey) {
      const v = process.env[spec.envKey];
      if (!v || v.length === 0) {
        return {
          ok: false, name: data.name, args: data.args,
          reason: `missing API key (${spec.envKey})`,
          env: spec.envKey, latencyMs: Date.now() - t0,
        };
      }
    }
    try {
      const result = (await HANDLERS[data.name](data.args)) as JsonValue;
      const latencyMs = Date.now() - t0;
      if (result && typeof result === "object" && !Array.isArray(result) && "error" in result) {
        return {
          ok: false, name: data.name, args: data.args,
          reason: String((result as { error: JsonValue }).error),
          env: spec.envKey, latencyMs,
        };
      }
      return { ok: true, name: data.name, args: data.args, data: result, latencyMs };
    } catch (e) {
      return {
        ok: false, name: data.name, args: data.args,
        reason: (e as Error).message, env: spec.envKey,
        latencyMs: Date.now() - t0,
      };
    }
  });
