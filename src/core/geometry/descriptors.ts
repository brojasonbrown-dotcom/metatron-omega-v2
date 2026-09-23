/**
 * Deterministic geometry descriptors.
 *
 * Every number below is measured from the parsed primitives with compensated
 * arithmetic — no sampling, no randomness, no model in the loop. Two runs over
 * the same bytes produce bit-identical output, which is what makes these
 * descriptors usable as memory keys rather than as decoration.
 *
 * Channels
 *   ORIENT   14 φ-spaced angular bins (length-weighted) — line strength per axis
 *   DENSITY  φ-octave occupancy pyramid — where material actually sits
 *   LAYOUT   quadtree occupancy bits — spatial signature, LSH-compatible
 *   MOMENT   rotation-invariant radial/angular Fourier moments
 *   TOPO     components, loops, Euler characteristic (union-find)
 *   SYMM     autocorrelation peak over the orientation ring — grids, repeats
 */

import { NeumaierSum } from '@/core/numerics/StableSum';
import { PHI } from '@/core/frameworks/constants';
import type { GeometryDoc } from './parse';

/** 14 orientation bins — matches the engine's Goertzel mode ladder. */
export const ORIENT_BINS = 14;
/** φ-octave pyramid depth for the density channel. */
export const OCTAVES = 5;
/** quadtree depth → 4^Q occupancy cells. */
export const QUAD_DEPTH = 4;
const QUAD_CELLS = 4 ** QUAD_DEPTH;          // 256

export interface GeometryDescriptor {
  kind: string;
  segments: number;
  points: number;
  /** total drawn length in source units */
  length: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  aspect: number;
  /** length-weighted orientation histogram, L1-normalised */
  orientation: Float64Array;
  /** dominant axis in radians [0,π) and the fraction of length on it */
  dominantAngle: number;
  dominantShare: number;
  /** how close the two strongest axes are to orthogonal, 1 = perfect */
  orthogonality: number;
  /** occupancy fraction per φ-octave, coarse → fine */
  density: Float64Array;
  /** fractal-style slope of log(occupied cells) vs log(1/scale) */
  densitySlope: number;
  /** quadtree occupancy bits (QUAD_CELLS) */
  layout: Uint8Array;
  /** rotation-invariant |moment| magnitudes, 8 radial × harmonic 0..3 */
  moments: Float64Array;
  topology: { components: number; nodes: number; edges: number; loops: number; euler: number };
  /** strongest non-trivial autocorrelation peak of the orientation ring */
  symmetry: number;
  symmetryOrder: number;
  entities: Array<{ type: string; count: number }>;
  labels: string[];
  /** fixed-width feature vector for the memory substrate */
  vector: Float64Array;
}

const TAU = Math.PI * 2;

export function describeGeometry(g: GeometryDoc): GeometryDescriptor {
  const s = g.segments;
  const nSeg = Math.floor(s.length / 4);

  // ── bbox over segments and points ──────────────────────────────────────
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < s.length; i += 2) {
    if (s[i] < minX) minX = s[i]; if (s[i] > maxX) maxX = s[i];
    if (s[i + 1] < minY) minY = s[i + 1]; if (s[i + 1] > maxY) maxY = s[i + 1];
  }
  for (let i = 0; i + 1 < g.points.length; i += 3) {
    if (g.points[i] < minX) minX = g.points[i]; if (g.points[i] > maxX) maxX = g.points[i];
    if (g.points[i + 1] < minY) minY = g.points[i + 1]; if (g.points[i + 1] > maxY) maxY = g.points[i + 1];
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }
  const w = Math.max(maxX - minX, 1e-12), h = Math.max(maxY - minY, 1e-12);
  const span = Math.max(w, h);

  // ── orientation histogram, length-weighted ─────────────────────────────
  const orient = new Float64Array(ORIENT_BINS);
  const orientAcc = Array.from({ length: ORIENT_BINS }, () => new NeumaierSum());
  const lenAcc = new NeumaierSum();
  for (let k = 0; k < nSeg; k++) {
    const x1 = s[k * 4], y1 = s[k * 4 + 1], x2 = s[k * 4 + 2], y2 = s[k * 4 + 3];
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy);
    if (!(L > 0)) continue;
    lenAcc.add(L);
    let a = Math.atan2(dy, dx);
    if (a < 0) a += Math.PI;                        // undirected lines
    if (a >= Math.PI) a -= Math.PI;
    const bin = Math.min(ORIENT_BINS - 1, Math.floor((a / Math.PI) * ORIENT_BINS));
    orientAcc[bin].add(L);
  }
  const totalLen = lenAcc.value();
  for (let b = 0; b < ORIENT_BINS; b++) orient[b] = totalLen > 0 ? orientAcc[b].value() / totalLen : 0;

  let d1 = 0, d1i = 0, d2 = 0, d2i = 0;
  for (let b = 0; b < ORIENT_BINS; b++) {
    if (orient[b] > d1) { d2 = d1; d2i = d1i; d1 = orient[b]; d1i = b; }
    else if (orient[b] > d2) { d2 = orient[b]; d2i = b; }
  }
  const angleOf = (b: number) => ((b + 0.5) / ORIENT_BINS) * Math.PI;
  const delta = Math.abs(angleOf(d1i) - angleOf(d2i));
  const orthogonality = d2 > 0 ? 1 - Math.abs(Math.min(delta, Math.PI - delta) - Math.PI / 2) / (Math.PI / 2) : 0;

  // ── φ-octave density pyramid ───────────────────────────────────────────
  const density = new Float64Array(OCTAVES);
  const occCounts: number[] = [];
  for (let o = 0; o < OCTAVES; o++) {
    const n = Math.max(2, Math.round(2 * PHI ** o));      // 2,3,5,8,13 — Fibonacci-like
    const cells = new Uint8Array(n * n);
    markCells(s, g.points, minX, minY, span, n, cells);
    let occ = 0;
    for (let i = 0; i < cells.length; i++) if (cells[i]) occ++;
    density[o] = occ / cells.length;
    occCounts.push(occ);
  }
  // Box-counting slope: log N(ε) vs log(1/ε), least squares over the pyramid.
  let sx = 0, sy = 0, sxx = 0, sxy = 0, m = 0;
  for (let o = 0; o < OCTAVES; o++) {
    if (occCounts[o] <= 0) continue;
    const x = o * Math.log(PHI), y = Math.log(occCounts[o]);
    sx += x; sy += y; sxx += x * x; sxy += x * y; m++;
  }
  const densitySlope = m >= 2 && m * sxx - sx * sx !== 0 ? (m * sxy - sx * sy) / (m * sxx - sx * sx) : 0;

  // ── quadtree occupancy layout ──────────────────────────────────────────
  const side = 2 ** QUAD_DEPTH;
  const layoutCells = new Uint8Array(side * side);
  markCells(s, g.points, minX, minY, span, side, layoutCells);
  const layout = layoutCells.slice(0, QUAD_CELLS);

  // ── rotation-invariant radial/angular moments ──────────────────────────
  const RAD = 8, HARM = 4;
  const moments = new Float64Array(RAD * HARM);
  {
    const cx = minX + w / 2, cy = minY + h / 2;
    const R = Math.max(span / 2, 1e-12);
    const re = new Float64Array(RAD * HARM), im = new Float64Array(RAD * HARM);
    const add = (x: number, y: number, weight: number) => {
      const rx = (x - cx) / R, ry = (y - cy) / R;
      const r = Math.min(1, Math.hypot(rx, ry));
      const th = Math.atan2(ry, rx);
      const ring = Math.min(RAD - 1, Math.floor(r * RAD));
      for (let hIdx = 0; hIdx < HARM; hIdx++) {
        re[ring * HARM + hIdx] += weight * Math.cos(hIdx * th);
        im[ring * HARM + hIdx] += weight * Math.sin(hIdx * th);
      }
    };
    for (let k = 0; k < nSeg; k++) {
      const x1 = s[k * 4], y1 = s[k * 4 + 1], x2 = s[k * 4 + 2], y2 = s[k * 4 + 3];
      const L = Math.hypot(x2 - x1, y2 - y1);
      if (!(L > 0)) continue;
      const steps = 4;
      for (let t = 0; t <= steps; t++) {
        const u = t / steps;
        add(x1 + (x2 - x1) * u, y1 + (y2 - y1) * u, L / (steps + 1));
      }
    }
    for (let i = 0; i + 1 < g.points.length; i += 3) add(g.points[i], g.points[i + 1], 1);
    let norm = 0;
    for (let i = 0; i < moments.length; i++) {
      moments[i] = Math.hypot(re[i], im[i]);
      norm += moments[i] * moments[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < moments.length; i++) moments[i] /= norm;
  }

  // ── topology by union-find over quantised endpoints ────────────────────
  const topology = topologyOf(s, span);

  // ── symmetry: circular autocorrelation of the orientation ring ─────────
  let symmetry = 0, symmetryOrder = 0;
  {
    const mean = orient.reduce((a, b) => a + b, 0) / ORIENT_BINS;
    let denom = 0;
    for (let b = 0; b < ORIENT_BINS; b++) denom += (orient[b] - mean) ** 2;
    for (let lag = 1; lag < ORIENT_BINS; lag++) {
      let acc = 0;
      for (let b = 0; b < ORIENT_BINS; b++) acc += (orient[b] - mean) * (orient[(b + lag) % ORIENT_BINS] - mean);
      const c = denom > 0 ? acc / denom : 0;
      if (c > symmetry) { symmetry = c; symmetryOrder = lag; }
    }
    symmetry = Math.max(0, Math.min(1, symmetry));
  }

  const entities = [...g.entities.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 24)
    .map(([type, count]) => ({ type, count }));

  const desc: GeometryDescriptor = {
    kind: g.kind,
    segments: nSeg,
    points: Math.floor(g.points.length / 3),
    length: totalLen,
    bbox: { minX, minY, maxX, maxY },
    aspect: w / h,
    orientation: orient,
    dominantAngle: angleOf(d1i),
    dominantShare: d1,
    orthogonality,
    density,
    densitySlope,
    layout,
    moments,
    topology,
    symmetry,
    symmetryOrder,
    entities,
    labels: g.labels.slice(0, 64),
    vector: new Float64Array(0),
  };
  desc.vector = featureVector(desc);
  return desc;
}

/** Rasterise segments and points into an n×n occupancy grid (Bresenham-free, exact DDA). */
function markCells(
  seg: Float64Array, pts: Float64Array,
  minX: number, minY: number, span: number, n: number, cells: Uint8Array,
): void {
  const put = (x: number, y: number) => {
    const cx = Math.min(n - 1, Math.max(0, Math.floor(((x - minX) / span) * n)));
    const cy = Math.min(n - 1, Math.max(0, Math.floor(((y - minY) / span) * n)));
    cells[cy * n + cx] = 1;
  };
  const nSeg = Math.floor(seg.length / 4);
  for (let k = 0; k < nSeg; k++) {
    const x1 = seg[k * 4], y1 = seg[k * 4 + 1], x2 = seg[k * 4 + 2], y2 = seg[k * 4 + 3];
    const steps = Math.min(512, Math.max(1, Math.ceil((Math.hypot(x2 - x1, y2 - y1) / span) * n * 2)));
    for (let t = 0; t <= steps; t++) {
      const u = t / steps;
      put(x1 + (x2 - x1) * u, y1 + (y2 - y1) * u);
    }
  }
  for (let i = 0; i + 1 < pts.length; i += 3) put(pts[i], pts[i + 1]);
}

/** Components / loops via union-find on endpoints quantised to span/2048. */
function topologyOf(seg: Float64Array, span: number): GeometryDescriptor['topology'] {
  const nSeg = Math.floor(seg.length / 4);
  if (nSeg === 0) return { components: 0, nodes: 0, edges: 0, loops: 0, euler: 0 };
  const q = span / 2048 || 1e-9;
  const key = (x: number, y: number) => `${Math.round(x / q)}:${Math.round(y / q)}`;
  const id = new Map<string, number>();
  const parent: number[] = [];
  const idx = (k: string) => {
    let v = id.get(k);
    if (v === undefined) { v = parent.length; id.set(k, v); parent.push(v); }
    return v;
  };
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  let edges = 0;
  const seen = new Set<string>();
  for (let k = 0; k < nSeg; k++) {
    const a = idx(key(seg[k * 4], seg[k * 4 + 1]));
    const b = idx(key(seg[k * 4 + 2], seg[k * 4 + 3]));
    if (a === b) continue;
    const ek = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(ek)) continue;                 // multi-edges counted once
    seen.add(ek);
    union(a, b);
    edges++;
  }
  const nodes = parent.length;
  const roots = new Set<number>();
  for (let i = 0; i < nodes; i++) roots.add(find(i));
  const components = roots.size;
  const loops = Math.max(0, edges - nodes + components);
  return { components, nodes, edges, loops, euler: nodes - edges };
}

/**
 * Fixed-width feature vector: orientation ‖ density ‖ moments ‖ scalars ‖
 * layout-projection. Bounded, unit-normalised, safe to blend with the text
 * hash vector.
 */
export function featureVector(d: GeometryDescriptor): Float64Array {
  const scalars = [
    clamp01(d.dominantShare),
    clamp01(d.orthogonality),
    clamp01(d.symmetry),
    d.symmetryOrder / ORIENT_BINS,
    clamp01(d.densitySlope / 2),
    squash(Math.log1p(d.segments) / 12),
    squash(Math.log1p(d.points) / 12),
    squash(Math.log1p(d.topology.loops) / 10),
    squash(Math.log1p(d.topology.components) / 10),
    clamp01(d.aspect / (1 + d.aspect)),
  ];
  // 32-way projection of the quadtree occupancy — preserves coarse layout
  // without exploding the width.
  const proj = new Float64Array(32);
  for (let i = 0; i < d.layout.length; i++) if (d.layout[i]) proj[i % 32] += 1;
  const projMax = Math.max(1, ...proj);
  for (let i = 0; i < 32; i++) proj[i] /= projMax;

  const out = new Float64Array(ORIENT_BINS + OCTAVES + d.moments.length + scalars.length + 32);
  let o = 0;
  out.set(d.orientation, o); o += ORIENT_BINS;
  out.set(d.density, o); o += OCTAVES;
  out.set(d.moments, o); o += d.moments.length;
  for (const v of scalars) out[o++] = v;
  out.set(proj, o);

  let n = 0;
  for (let i = 0; i < out.length; i++) n += out[i] * out[i];
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const squash = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/**
 * Human/LLM-readable summary. This is the text that enters the corpus, so it
 * has to state measurements only — every value below came from the file.
 */
export function summariseGeometry(d: GeometryDescriptor, title: string): string {
  const deg = (r: number) => `${((r * 180) / Math.PI).toFixed(1)}°`;
  const ent = d.entities.slice(0, 12).map((e) => `${e.type}×${e.count}`).join(', ');
  const dens = Array.from(d.density).map((x) => x.toFixed(3)).join(' / ');
  const orient = Array.from(d.orientation)
    .map((v, i) => (v > 0.03 ? `${deg(((i + 0.5) / ORIENT_BINS) * Math.PI)}:${(v * 100).toFixed(0)}%` : ''))
    .filter(Boolean).join(' ');
  return [
    `GEOMETRY ${d.kind.toUpperCase()} — ${title}`,
    `Primitives: ${d.segments} segments, ${d.points} points, total drawn length ${d.length.toFixed(3)}.`,
    `Extent: ${(d.bbox.maxX - d.bbox.minX).toFixed(3)} × ${(d.bbox.maxY - d.bbox.minY).toFixed(3)} (aspect ${d.aspect.toFixed(3)}).`,
    `Line strength by axis: ${orient || 'diffuse'}. Dominant axis ${deg(d.dominantAngle)} carrying ${(d.dominantShare * 100).toFixed(1)}% of length; orthogonality ${d.orthogonality.toFixed(3)}.`,
    `Density pyramid (φ-octaves, coarse→fine): ${dens}; box-count slope ${d.densitySlope.toFixed(3)}.`,
    `Topology: ${d.topology.components} components, ${d.topology.nodes} nodes, ${d.topology.edges} edges, ${d.topology.loops} independent loops, Euler ${d.topology.euler}.`,
    `Repetition: autocorrelation peak ${d.symmetry.toFixed(3)} at order ${d.symmetryOrder}.`,
    ent ? `Entities: ${ent}.` : '',
    d.labels.length ? `Labels: ${d.labels.slice(0, 40).join('; ')}.` : '',
  ].filter(Boolean).join('\n');
}
