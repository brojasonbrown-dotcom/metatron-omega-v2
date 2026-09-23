/**
 * Ω-MAP — cross-correlation of the atlas against live state.
 *
 * The atlas says what exists structurally; the registry says what is running.
 * Joining them yields three separate, non-overlapping readings:
 *
 *   edges         declared wiring, classified by the liveness of both ends
 *   gaps          outputs nobody consumes / inputs nobody supplies
 *   opportunities port-compatible pairs that are NOT declared as feeds — the
 *                 only honest definition of "unused potential" available here
 *
 * Everything is derived, sorted and clock-free: same atlas + same registry
 * produces a byte-identical result.
 */

import type { AtlasEntry, AtlasPort, PortKind } from './atlas';
import { CAPABILITY_ATLAS } from './atlas';
import type { LiveState, SelfRegistry } from './types';

export type EdgeStatus = 'wired' | 'cold' | 'broken' | 'unknown';

export interface MapEdge {
  from: string;
  to: string;
  /** the port kinds that justify this edge, sorted */
  kinds: PortKind[];
  fromState: LiveState | 'unknown';
  toState: LiveState | 'unknown';
  status: EdgeStatus;
  /** verbatim reason for the classification */
  why: string;
}

export interface MapGap {
  module: string;
  port: string;
  kind: PortKind;
  direction: 'output' | 'input';
  why: string;
}

export interface MapOpportunity {
  from: string;
  to: string;
  kind: PortKind;
  /** producing port → consuming port */
  via: string;
  /** why this pairing is mechanically possible */
  because: string;
  /** what would have to be built or shown first */
  requires: string;
  /** both ends live > one live > neither; higher is more actionable */
  score: number;
  label: 'SPEC';
}

export interface CrossMap {
  /** module id → live state, or 'unknown' when the registry has no entry */
  states: Record<string, LiveState | 'unknown'>;
  layers: Record<string, number>;
  edges: MapEdge[];
  gaps: MapGap[];
  opportunities: MapOpportunity[];
  counts: { wired: number; cold: number; broken: number; unknown: number; gaps: number; opportunities: number };
  /** ids in the atlas but not the registry, and vice versa — always empty in a healthy build */
  orphans: { atlasOnly: string[]; registryOnly: string[] };
}

const RANK: Record<LiveState | 'unknown', number> = {
  live: 3, stale: 2, dormant: 1, absent: 0, unknown: 0,
};

function classify(a: LiveState | 'unknown', b: LiveState | 'unknown'): { status: EdgeStatus; why: string } {
  if (a === 'unknown' || b === 'unknown') return { status: 'unknown', why: 'an endpoint has no registry reading' };
  if (a === 'absent' || b === 'absent') return { status: 'broken', why: 'an endpoint is absent from this runtime' };
  if (a === 'live' && b === 'live') return { status: 'wired', why: 'both endpoints are live' };
  if (a === 'stale' || b === 'stale') return { status: 'cold', why: 'an endpoint advanced earlier but is not current' };
  return { status: 'cold', why: 'an endpoint is dormant' };
}

/** Kinds a module accepts, and the port name for each. */
function inputIndex(e: AtlasEntry): Map<PortKind, AtlasPort> {
  const m = new Map<PortKind, AtlasPort>();
  for (const p of e.inputs) if (!m.has(p.kind)) m.set(p.kind, p);
  return m;
}

function rateNote(out: AtlasPort, into: AtlasPort): string {
  if (out.hz === null || into.hz === null) return 'event-driven on at least one side';
  if (out.hz === into.hz) return `matched native rate ${out.hz} Hz`;
  return `rate mismatch ${out.hz} Hz → ${into.hz} Hz, needs decimation or alignment`;
}

export function crossMap(
  registry: SelfRegistry | null,
  atlas: readonly AtlasEntry[] = CAPABILITY_ATLAS,
): CrossMap {
  const states: Record<string, LiveState | 'unknown'> = {};
  const regIds = new Set<string>();
  for (const m of registry?.modules ?? []) regIds.add(m.id);
  for (const e of atlas) {
    const found = registry?.modules.find((m) => m.id === e.id);
    states[e.id] = found ? found.state : 'unknown';
  }

  const layers: Record<string, number> = {};
  for (const e of atlas) layers[e.layer] = (layers[e.layer] ?? 0) + 1;

  const byId = new Map(atlas.map((e) => [e.id, e]));

  // ── declared edges ──────────────────────────────────────────────────────
  const edges: MapEdge[] = [];
  for (const e of atlas) {
    for (const to of e.feeds) {
      if (to === e.id) continue;
      const target = byId.get(to);
      const kinds = target
        ? Array.from(new Set(
            e.outputs
              .filter((o) => target.inputs.some((i) => i.kind === o.kind))
              .map((o) => o.kind),
          )).sort()
        : [];
      const a = states[e.id] ?? 'unknown';
      const b = states[to] ?? 'unknown';
      const { status, why } = classify(a, b);
      edges.push({ from: e.id, to, kinds, fromState: a, toState: b, status, why });
    }
  }
  edges.sort((x, y) => (x.from + '→' + x.to).localeCompare(y.from + '→' + y.to));

  // ── gaps ────────────────────────────────────────────────────────────────
  const consumedKinds = new Set<PortKind>();
  const producedKinds = new Set<PortKind>();
  for (const e of atlas) {
    for (const i of e.inputs) consumedKinds.add(i.kind);
    for (const o of e.outputs) producedKinds.add(o.kind);
  }
  const gaps: MapGap[] = [];
  for (const e of atlas) {
    for (const o of e.outputs) {
      if (!consumedKinds.has(o.kind)) {
        gaps.push({ module: e.id, port: o.name, kind: o.kind, direction: 'output', why: 'no module in the atlas accepts this kind' });
      }
    }
    for (const i of e.inputs) {
      if (!producedKinds.has(i.kind)) {
        gaps.push({ module: e.id, port: i.name, kind: i.kind, direction: 'input', why: 'no module in the atlas emits this kind' });
      }
    }
  }
  gaps.sort((x, y) => (x.module + x.port).localeCompare(y.module + y.port));

  // ── opportunities: port-compatible but undeclared ───────────────────────
  const declared = new Set(edges.map((e) => `${e.from}→${e.to}`));
  const opportunities: MapOpportunity[] = [];
  for (const from of atlas) {
    for (const to of atlas) {
      if (from.id === to.id) continue;
      if (declared.has(`${from.id}→${to.id}`)) continue;
      const accepts = inputIndex(to);
      for (const out of from.outputs) {
        const into = accepts.get(out.kind);
        if (!into) continue;
        const a = states[from.id] ?? 'unknown';
        const b = states[to.id] ?? 'unknown';
        const score = RANK[a] + RANK[b] + (out.hz !== null && out.hz === into.hz ? 1 : 0);
        opportunities.push({
          from: from.id,
          to: to.id,
          kind: out.kind,
          via: `${out.name} → ${into.name}`,
          because: `${from.id} emits ${out.kind} (${out.what}) and ${to.id} accepts ${out.kind} (${into.what}); ${rateNote(out, into)}.`,
          requires: to.limits[0] ?? 'no declared constraint on the consuming side',
          score,
          label: 'SPEC',
        });
      }
    }
  }
  opportunities.sort((x, y) =>
    y.score - x.score || (x.from + x.to + x.kind).localeCompare(y.from + y.to + y.kind));

  const counts = {
    wired: edges.filter((e) => e.status === 'wired').length,
    cold: edges.filter((e) => e.status === 'cold').length,
    broken: edges.filter((e) => e.status === 'broken').length,
    unknown: edges.filter((e) => e.status === 'unknown').length,
    gaps: gaps.length,
    opportunities: opportunities.length,
  };

  const atlasIds = new Set(atlas.map((e) => e.id));
  const orphans = {
    atlasOnly: [...atlasIds].filter((id) => registry && !regIds.has(id)).sort(),
    registryOnly: [...regIds].filter((id) => !atlasIds.has(id)).sort(),
  };

  return { states, layers, edges, gaps, opportunities, counts, orphans };
}
