/**
 * Parse <<TOOL: name | k=v | k=v>> markers out of a model message.
 * V10 parity. Returns markers + text with markers stripped.
 */
import type { ToolArgs, ToolCall } from "./types";

const RE = /<<TOOL:\s*([a-z0-9_]+)((?:\s*\|\s*[^>]+?)*)>>/gi;

export function parseToolMarkers(text: string): { calls: ToolCall[]; stripped: string } {
  const calls: ToolCall[] = [];
  let stripped = text;
  for (const m of text.matchAll(RE)) {
    const name = m[1];
    const args: ToolArgs = {};
    const tail = m[2] ?? "";
    for (const part of tail.split("|").map((p) => p.trim()).filter(Boolean)) {
      const eq = part.indexOf("=");
      if (eq < 0) continue;
      const k = part.slice(0, eq).trim();
      let v: string | number | boolean = part.slice(eq + 1).trim();
      if (v === "true") v = true;
      else if (v === "false") v = false;
      else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
      args[k] = v;
    }
    calls.push({ name, args });
    stripped = stripped.replace(m[0], "");
  }
  return { calls, stripped: stripped.trim() };
}
