/**
 * Self pack — the bridge that makes the machine's own structure readable by
 * the model.
 *
 * Like the memory pack, the truth lives in the browser tab: the Ω engine
 * worker, the memory substrate and the knowledge corpus are all client-side.
 * The client builds a registry before the turn and ships it; the server
 * injects it as the L0 SELF layer and exposes tools over it.
 *
 * The hard rule encoded here: every module carries a liveness state, and a
 * module that is not `live` must never be described as working.
 */

import type { SelfRegistry, SelfTestRun, SelfModule } from '@/core/self/types';
import type { GenomeHealth, MeaningReport, RetrievalReport } from '@/core/knowledge/genome';
import type { CrossMap } from '@/core/self/crossMap';
import { ATLAS_BY_ID, CAPABILITY_ATLAS } from '@/core/self/atlas';

export interface SelfPack {
  builtAt: number;
  registry: SelfRegistry;
  genome: GenomeHealth | null;
  meaning: MeaningReport | null;
  retrieval: RetrievalReport | null;
  /** most recent self-test run, or null when nothing has been executed */
  lastTest: SelfTestRun | null;
  /** Ω-MAP — structural atlas joined with live state (null on older clients) */
  map?: CrossMap | null;
}


function fmt(v: number | string | null, unit?: string): string {
  if (v === null) return 'n/a';
  if (typeof v === 'string') return v;
  const s = Number.isInteger(v) ? String(v) : v.toFixed(4);
  return unit ? `${s} ${unit}` : s;
}

function moduleLine(m: SelfModule): string {
  const metrics = m.metrics.length
    ? m.metrics.map((x) => `${x.label}=${fmt(x.value, x.unit)}`).join(' · ')
    : 'no metrics readable';
  return `- ${m.id} [${m.state.toUpperCase()}] ${m.title}
    purpose: ${m.purpose}
    contract: ${m.contract}
    evidence: ${m.detail} (source ${m.source})
    metrics: ${metrics}`;
}

/** The L0 SELF block injected into the system prompt. */
export function buildSelfBlock(pack: SelfPack | null | undefined): string {
  if (!pack) {
    return `SELF MODEL: unavailable this turn (the client shipped no self pack).
Do not describe your own modules, engines, memories or genomes as running or
not running — you have no evidence either way this turn. Say exactly that.`;
  }
  const c = pack.registry.counts;
  const head = `SELF MODEL (L0 — measured on-device this turn)
modules: ${pack.registry.modules.length} total · ${c.live} live · ${c.dormant} dormant · ${c.absent} absent · ${c.stale} stale
tools: self_describe (one module in full), self_test (execute deterministic checks), genome_health (vector-space audit)`;

  const body = pack.registry.modules.map(moduleLine).join('\n');

  const genome = pack.genome
    ? `GENOME (${pack.genome.version}, dim ${pack.genome.dim}): chunks=${pack.genome.chunks} sampled=${pack.genome.sampled} fill=${pack.genome.fill.toFixed(4)} norm=${pack.genome.norm.toFixed(4)} anisotropy=${pack.genome.anisotropy.toFixed(4)} barcodeFalsePositive=${pack.genome.barcodeFalsePositive.toFixed(4)} reencodeExact=${pack.genome.reencodeExact} drifted=${pack.genome.driftedChunks} crossModal=${pack.genome.crossModal}`
    : 'GENOME: not measured this turn (corpus empty or unavailable).';

  const meaning = pack.meaning && pack.meaning.terms > 0
    ? `MEANING CORRELATION: ${pack.meaning.terms} concept(s) probed, mean term precision ${pack.meaning.meanPrecision.toFixed(3)}, mean field agreement ${pack.meaning.meanFieldAgreement.toFixed(3)}.`
    : 'MEANING CORRELATION: not measured (no concepts in the graph).';

  const retrieval = pack.retrieval && pack.retrieval.probes > 0
    ? `SELF-RETRIEVAL: ${pack.retrieval.probes} probe(s), top1 ${pack.retrieval.top1.toFixed(3)}, top5 ${pack.retrieval.top5.toFixed(3)}.`
    : 'SELF-RETRIEVAL: not measured (corpus empty).';

  const test = pack.lastTest
    ? `LAST SELF-TEST: scope=${pack.lastTest.scope} ${pack.lastTest.passed} passed / ${pack.lastTest.failed} failed, ${Math.round((Date.now() - pack.lastTest.at) / 1000)}s ago, ${pack.lastTest.ms}ms.
${pack.lastTest.results.map((r) => `  · ${r.id} ${r.name}: ${r.passed ? 'PASS' : 'FAIL'} — measured ${r.measured}; expected ${r.expected} (${r.ms}ms)`).join('\n')}`
    : 'LAST SELF-TEST: none executed. Any claim that an internal module "works" is UNTESTED until self_test returns a result.';

  const map = pack.map ? buildMapBlock(pack.map) : 'STRUCTURAL MAP: not shipped this turn — do not reason about module wiring.';

  return `${head}

${body}

${genome}
${meaning}
${retrieval}

${map}

${test}`;
}

/** Ω-MAP block: structure and unused pairings, kept strictly apart from capability. */
function buildMapBlock(m: CrossMap): string {
  const c = m.counts;
  const layers = Object.entries(m.layers).sort().map(([k, v]) => `${k}:${v}`).join(' · ');
  const edges = m.edges
    .map((e) => `  · ${e.from} → ${e.to} [${e.status.toUpperCase()}] ${e.kinds.join(',') || 'no shared port kind'} (${e.why})`)
    .join('\n');
  const opps = m.opportunities.slice(0, 8)
    .map((o) => `  · [SPEC] ${o.from} → ${o.to} via ${o.via} (${o.kind}) — ${o.because} Requires: ${o.requires}`)
    .join('\n');
  const gaps = m.gaps.length
    ? m.gaps.map((g) => `  · ${g.module}.${g.port} (${g.kind}, ${g.direction}) — ${g.why}`).join('\n')
    : '  · none';
  const orphan = m.orphans.atlasOnly.length || m.orphans.registryOnly.length
    ? `\nATLAS DRIFT: atlas-only [${m.orphans.atlasOnly.join(', ')}] registry-only [${m.orphans.registryOnly.join(', ')}] — the map disagrees with the runtime; say so before using it.`
    : '';

  return `STRUCTURAL MAP (Ω-MAP — atlas joined with the live registry)
layers: ${layers}
declared edges: ${c.wired} wired · ${c.cold} cold · ${c.broken} broken · ${c.unknown} unknown
${edges}
UNUSED PAIRINGS (${c.opportunities} port-compatible, undeclared — HYPOTHESES, not features.
Never describe one as something you can do; describe it as something that could be built):
${opps || '  · none'}
PORT GAPS (${c.gaps}):
${gaps}
Tool: self_map({ module?, kind? }) returns the full atlas entry, its edges, gaps and unused pairings.${orphan}`;
}


export interface SelfToolResult { ok: boolean; [k: string]: unknown }

export function runSelfTool(
  name: string,
  args: Record<string, unknown>,
  pack: SelfPack | null | undefined,
): SelfToolResult {
  if (!pack) return { ok: false, error: 'self pack not available this turn — no evidence about internal modules' };

  if (name === 'self_describe') {
    const id = String(args.module ?? '').trim();
    if (!id) {
      return {
        ok: true,
        counts: pack.registry.counts,
        modules: pack.registry.modules.map((m) => ({ id: m.id, state: m.state, title: m.title, detail: m.detail })),
      };
    }
    const found = pack.registry.modules.find((m) => m.id === id || m.id.endsWith(`.${id}`));
    if (!found) {
      return { ok: false, error: `no module '${id}'`, available: pack.registry.modules.map((m) => m.id) };
    }
    return { ok: true, ...found };
  }

  if (name === 'self_map') {
    const m = pack.map;
    if (!m) return { ok: false, error: 'no structural map shipped this turn — no evidence about wiring' };
    const id = String(args.module ?? '').trim();
    const kind = String(args.kind ?? '').trim();
    if (!id) {
      return {
        ok: true,
        note: 'opportunities are SPEC hypotheses about what could be built, never capabilities',
        layers: m.layers,
        counts: m.counts,
        states: m.states,
        edges: m.edges,
        gaps: m.gaps,
        opportunities: kind ? m.opportunities.filter((o) => o.kind === kind) : m.opportunities.slice(0, 20),
        orphans: m.orphans,
        modules: CAPABILITY_ATLAS.map((e) => ({ id: e.id, layer: e.layer, does: e.does })),
      };
    }
    const entry = ATLAS_BY_ID.get(id) ?? CAPABILITY_ATLAS.find((e) => e.id.endsWith(`.${id}`));
    if (!entry) return { ok: false, error: `no atlas entry '${id}'`, available: CAPABILITY_ATLAS.map((e) => e.id) };
    return {
      ok: true,
      note: 'affordances and opportunities are SPEC hypotheses, not capabilities',
      entry,
      state: m.states[entry.id] ?? 'unknown',
      edges: m.edges.filter((e) => e.from === entry.id || e.to === entry.id),
      gaps: m.gaps.filter((g) => g.module === entry.id),
      opportunities: m.opportunities.filter((o) => o.from === entry.id || o.to === entry.id),
    };
  }


  if (name === 'genome_health') {
    if (!pack.genome) return { ok: false, error: 'genome not measurable this turn (corpus empty)' };
    return { ok: true, genome: pack.genome, meaning: pack.meaning, retrieval: pack.retrieval };
  }

  if (name === 'self_test') {
    if (!pack.lastTest) {
      return {
        ok: false,
        error: 'no self-test has been executed. Cheap checks run automatically each turn; heavy checks (engine replay determinism) must be started from the SELF deck.',
      };
    }
    const id = String(args.module ?? '').trim();
    const results = id
      ? pack.lastTest.results.filter((r) => r.id === id || r.id.startsWith(id))
      : pack.lastTest.results;
    return {
      ok: true,
      scope: pack.lastTest.scope,
      ranAt: pack.lastTest.at,
      ageSeconds: Math.round((Date.now() - pack.lastTest.at) / 1000),
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      results,
    };
  }

  return { ok: false, error: `unknown self tool ${name}` };
}

export const SELF_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'self_describe',
      description:
        "Describe the machine's own modules: what each one is for, the contract it must satisfy, whether it is live/dormant/absent, and its measured metrics. Call with no argument for the full list, or with a module id for one entry. Use this BEFORE claiming any internal capability.",
      parameters: {
        type: 'object',
        properties: { module: { type: 'string', description: 'module id, e.g. engine.field, memory.substrate, knowledge.corpus' } },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'self_test',
      description:
        'Return the deterministic self-test results measured on-device (determinism replays, memory round-trip, encoder stability, recall harness). Use it to back any claim that an internal module works; if it returns no run, say the module is untested.',
      parameters: {
        type: 'object',
        properties: { module: { type: 'string', description: 'optional module id filter' } },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'genome_health',
      description:
        'Audit of the vector genome space: dimension, fill, norm, anisotropy, LSH false-positive rate, re-encode exactness, cross-modal counts, concept-meaning precision and self-retrieval rates.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'self_map',
      description:
        "Structural map of the machine: each module's layer, ports (what it consumes/emits, unit, native Hz), dependencies, declared wiring classified as wired/cold/broken, port gaps, and port-compatible pairings that are NOT wired yet. The unused pairings are SPEC hypotheses about what could be built — never present them as existing abilities. Use this to reason about how modules could combine.",
      parameters: {
        type: 'object',
        properties: {
          module: { type: 'string', description: 'atlas id, e.g. engine.field, memory.substrate, knowledge.genome' },
          kind: { type: 'string', description: 'optional port kind filter, e.g. field-frame, series, vector, text' },
        },
      },
    },
  },
];


export const SELF_TOOL_NAMES = new Set(SELF_TOOLS.map((t) => t.function.name));
