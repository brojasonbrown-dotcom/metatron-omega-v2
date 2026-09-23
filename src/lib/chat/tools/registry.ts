/**
 * METATRON V11 — Tool registry (full V10-intel arsenal port).
 *
 * Single source of truth for tool metadata. Driven by INTEL_META (135+ tools).
 * The legacy hand-written JSON specs are still loaded so their richer parameter
 * schemas override the minimal intel meta where present.
 *
 * dispatch.functions.ts looks up TOOL_INDEX[name].
 * The Tools-panel Catalog tab renders TOOL_SPECS grouped by category.
 * kimi.ts and Catalog "Try" forms read OPENAI_TOOLS for function-calling.
 */

import abuseipdb from "./specs/abuseipdb.json";
import arxiv from "./specs/arxiv_search.json";
import crossref from "./specs/crossref.json";
import github from "./specs/github_search.json";
import hackernews from "./specs/hackernews.json";
import httpProbe from "./specs/http_probe.json";
import ipfs from "./specs/ipfs.json";
import nasa from "./specs/nasa_donki.json";
import newsapi from "./specs/newsapi.json";
import openweather from "./specs/openweather.json";
import osm from "./specs/osm_geocode.json";
import pubmed from "./specs/pubmed.json";
import reddit from "./specs/reddit.json";
import semScholar from "./specs/semantic_scholar.json";
import shodan from "./specs/shodan_host_search.json";
import virustotal from "./specs/virustotal.json";
import wayback from "./specs/wayback.json";
import wikidata from "./specs/wikidata.json";
import wolfram from "./specs/wolfram.json";

import { INTEL_META, type IntelToolMeta } from "./intelMeta";

export interface ToolSpec {
  name: string;
  description: string;
  category: string;
  /** V10 intel_action key — kept for reference; V11 dispatches by `name`. */
  intel_action?: string;
  auth: "none" | "key" | "demo";
  rate_limit_per_min?: number;
  timeout_ms?: number;
  parameters: Record<string, unknown>;
  /** ENV var name required when auth === 'key' (set by V11 registry). */
  envKey?: string;
}

const RICH_JSON_SPECS = [
  abuseipdb, arxiv, crossref, github, hackernews, httpProbe, ipfs,
  nasa, newsapi, openweather, osm, pubmed, reddit, semScholar,
  shodan, virustotal, wayback, wikidata, wolfram,
] as Array<Partial<ToolSpec> & { name: string }>;

const RICH_BY_NAME: Record<string, Partial<ToolSpec>> = Object.fromEntries(
  RICH_JSON_SPECS.map((s) => [s.name, s]),
);

function metaToSpec(m: IntelToolMeta): ToolSpec {
  const rich = RICH_BY_NAME[m.name] ?? {};
  return {
    name: m.name,
    description: rich.description ?? m.description,
    category: m.category,
    auth: rich.auth ?? m.auth,
    envKey: m.envKey ?? rich.envKey,
    parameters: (rich.parameters as Record<string, unknown>) ?? m.parameters,
    rate_limit_per_min: rich.rate_limit_per_min,
    timeout_ms: rich.timeout_ms,
    intel_action: rich.intel_action ?? m.name,
  };
}

export const TOOL_SPECS: ToolSpec[] = INTEL_META.map(metaToSpec);

export const TOOL_INDEX: Record<string, ToolSpec> = Object.fromEntries(
  TOOL_SPECS.map((s) => [s.name, s]),
);

/** OpenAI-format tools array for direct Kimi / GPT tool-calling. */
export const OPENAI_TOOLS = TOOL_SPECS.map((s) => ({
  type: "function" as const,
  function: { name: s.name, description: s.description, parameters: s.parameters },
}));

export function listToolNames(): string[] {
  return TOOL_SPECS.map((s) => s.name);
}

export function toolsByCategory(): Record<string, ToolSpec[]> {
  const out: Record<string, ToolSpec[]> = {};
  for (const s of TOOL_SPECS) {
    (out[s.category] ??= []).push(s);
  }
  return out;
}
