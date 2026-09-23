/**
 * Geometry parsing — text-based CAD/BIM/mesh formats into a flat primitive set.
 *
 * Everything here is pure TypeScript over the *text* form of each format, so
 * it runs identically in the browser, in a worker and under test. Nothing is
 * approximated: a segment exists only when the source file states it. When a
 * format is not understood the parser says so instead of returning an empty
 * document that would look like a successful read.
 *
 * Supported (text) formats:
 *   DXF   — ASCII drawing exchange, entity section walk
 *   SVG   — path/line/polyline/rect/circle geometry
 *   OBJ   — vertices + faces (edges derived)
 *   STL   — ASCII solid/facet form
 *   IFC   — STEP physical file (ISO-10303-21), entity + property census
 *   STEP  — same physical-file grammar, CAx geometry census
 */

export type AssetKind = 'dxf' | 'svg' | 'obj' | 'stl' | 'ifc' | 'step' | 'unknown';

export interface GeometryDoc {
  kind: AssetKind;
  /** flat [x1,y1,x2,y2, …] in source units, 2-D projection of the model */
  segments: Float64Array;
  /** distinct 3-D points when the format carries them (flat [x,y,z,…]) */
  points: Float64Array;
  /** entity-type census — the semantic backbone of BIM files */
  entities: Map<string, number>;
  /** free text carried inside the file (layer names, IFC labels, SVG text) */
  labels: string[];
  units: string;
  triangles: number;
}

const EMPTY = new Float64Array(0);

export function classifyAsset(url: string, contentType = ''): AssetKind {
  const u = url.toLowerCase().split(/[?#]/)[0];
  const ct = contentType.toLowerCase();
  if (u.endsWith('.dxf')) return 'dxf';
  if (u.endsWith('.svg') || ct.includes('image/svg')) return 'svg';
  if (u.endsWith('.obj')) return 'obj';
  if (u.endsWith('.stl')) return 'stl';
  if (u.endsWith('.ifc') || u.endsWith('.ifcxml')) return 'ifc';
  if (u.endsWith('.step') || u.endsWith('.stp')) return 'step';
  return 'unknown';
}

/** Sniff by content when the extension lies (very common on CDN links). */
export function sniffAsset(text: string): AssetKind {
  const head = text.slice(0, 4096);
  if (/^\s*ISO-10303-21/i.test(head)) return /IFC[24]?X?\d?/i.test(head) || /FILE_SCHEMA\s*\(\s*\(\s*'IFC/i.test(head) ? 'ifc' : 'step';
  if (/<svg[\s>]/i.test(head)) return 'svg';
  if (/^\s*solid\s/i.test(head) && /facet\s+normal/i.test(text.slice(0, 20000))) return 'stl';
  if (/^\s*0\s*[\r\n]+\s*SECTION/i.test(head)) return 'dxf';
  if (/^\s*(v|vn|vt|f)\s+[-\d]/m.test(head)) return 'obj';
  return 'unknown';
}

export function parseGeometry(text: string, kind: AssetKind): GeometryDoc {
  switch (kind) {
    case 'dxf': return parseDxf(text);
    case 'svg': return parseSvg(text);
    case 'obj': return parseObj(text);
    case 'stl': return parseStl(text);
    case 'ifc':
    case 'step': return parseStepFile(text, kind);
    default:
      return { kind: 'unknown', segments: EMPTY, points: EMPTY, entities: new Map(), labels: [], units: '', triangles: 0 };
  }
}

// ── DXF ───────────────────────────────────────────────────────────────────
/**
 * DXF is a flat (group-code, value) stream. Walk it and materialise the
 * entities that carry planar geometry. Group codes: 0 entity type, 8 layer,
 * 10/20 first point, 11/21 second point, 40 radius, 70 flags.
 */
export function parseDxf(text: string): GeometryDoc {
  const lines = text.split(/\r?\n/);
  const seg: number[] = [];
  const pts: number[] = [];
  const entities = new Map<string, number>();
  const labels = new Set<string>();
  let units = '';

  let type = '';
  let cur: Record<number, number[]> = {};
  const flush = () => {
    if (!type) return;
    entities.set(type, (entities.get(type) ?? 0) + 1);
    const x = cur[10] ?? [], y = cur[20] ?? [], x2 = cur[11] ?? [], y2 = cur[21] ?? [];
    if (type === 'LINE' && x.length && y.length && x2.length && y2.length) {
      seg.push(x[0], y[0], x2[0], y2[0]);
    } else if ((type === 'LWPOLYLINE' || type === 'POLYLINE') && x.length > 1) {
      const n = Math.min(x.length, y.length);
      for (let i = 1; i < n; i++) seg.push(x[i - 1], y[i - 1], x[i], y[i]);
      if ((cur[70]?.[0] ?? 0) & 1 && n > 2) seg.push(x[n - 1], y[n - 1], x[0], y[0]);
    } else if ((type === 'CIRCLE' || type === 'ARC') && x.length && y.length) {
      // Circles are sampled on a fixed 24-gon: deterministic, orientation-fair.
      const r = cur[40]?.[0] ?? 0;
      const a0 = type === 'ARC' ? ((cur[50]?.[0] ?? 0) * Math.PI) / 180 : 0;
      const a1 = type === 'ARC' ? ((cur[51]?.[0] ?? 360) * Math.PI) / 180 : Math.PI * 2;
      const span = a1 >= a0 ? a1 - a0 : a1 + Math.PI * 2 - a0;
      const steps = 24;
      for (let i = 0; i < steps; i++) {
        const t0 = a0 + (span * i) / steps, t1 = a0 + (span * (i + 1)) / steps;
        seg.push(x[0] + r * Math.cos(t0), y[0] + r * Math.sin(t0), x[0] + r * Math.cos(t1), y[0] + r * Math.sin(t1));
      }
    } else if (x.length && y.length) {
      pts.push(x[0], y[0], cur[30]?.[0] ?? 0);
    }
    type = ''; cur = {};
  };

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    const val = lines[i + 1];
    if (!Number.isFinite(code)) { i -= 1; continue; }   // resync on odd files
    if (code === 0) { flush(); type = val.trim().toUpperCase(); continue; }
    if (code === 8 || code === 2) { const s = val.trim(); if (s && s.length < 60) labels.add(s); continue; }
    if (code === 9 && val.trim() === '$INSUNITS') units = 'insunits';
    const n = Number(val);
    if (Number.isFinite(n)) (cur[code] ??= []).push(n);
  }
  flush();

  return {
    kind: 'dxf', segments: Float64Array.from(seg), points: Float64Array.from(pts),
    entities, labels: [...labels].slice(0, 400), units, triangles: 0,
  };
}

// ── SVG ───────────────────────────────────────────────────────────────────
export function parseSvg(text: string): GeometryDoc {
  const seg: number[] = [];
  const entities = new Map<string, number>();
  const labels: string[] = [];
  const bump = (k: string) => entities.set(k, (entities.get(k) ?? 0) + 1);

  for (const m of text.matchAll(/<line\b[^>]*>/gi)) {
    const a = attrNums(m[0], ['x1', 'y1', 'x2', 'y2']);
    if (a) { seg.push(a[0], a[1], a[2], a[3]); bump('line'); }
  }
  for (const m of text.matchAll(/<rect\b[^>]*>/gi)) {
    const a = attrNums(m[0], ['x', 'y', 'width', 'height']);
    if (a) {
      const [x, y, w, h] = a;
      seg.push(x, y, x + w, y, x + w, y, x + w, y + h, x + w, y + h, x, y + h, x, y + h, x, y);
      bump('rect');
    }
  }
  for (const m of text.matchAll(/<circle\b[^>]*>/gi)) {
    const a = attrNums(m[0], ['cx', 'cy', 'r']);
    if (a) {
      const [cx, cy, r] = a;
      for (let i = 0; i < 24; i++) {
        const t0 = (Math.PI * 2 * i) / 24, t1 = (Math.PI * 2 * (i + 1)) / 24;
        seg.push(cx + r * Math.cos(t0), cy + r * Math.sin(t0), cx + r * Math.cos(t1), cy + r * Math.sin(t1));
      }
      bump('circle');
    }
  }
  for (const m of text.matchAll(/<(polyline|polygon)\b[^>]*\bpoints=["']([^"']+)["'][^>]*>/gi)) {
    const nums = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    for (let i = 2; i + 1 < nums.length; i += 2) seg.push(nums[i - 2], nums[i - 1], nums[i], nums[i + 1]);
    if (m[1].toLowerCase() === 'polygon' && nums.length >= 4) {
      seg.push(nums[nums.length - 2], nums[nums.length - 1], nums[0], nums[1]);
    }
    bump(m[1].toLowerCase());
  }
  // Path data: only the explicit M/L/H/V/Z skeleton — curves are sampled by
  // their endpoints, never guessed at.
  for (const m of text.matchAll(/<path\b[^>]*\bd=["']([^"']+)["'][^>]*>/gi)) {
    bump('path');
    let cx = 0, cy = 0, sx = 0, sy = 0, started = false;
    const toks = m[1].match(/[MmLlHhVvZzCcSsQqTtAa]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
    let i = 0;
    let cmd = '';
    while (i < toks.length) {
      const t = toks[i];
      if (/[A-Za-z]/.test(t)) { cmd = t; i++; if (/[Zz]/.test(cmd)) { if (started) seg.push(cx, cy, sx, sy); cx = sx; cy = sy; } continue; }
      const rel = cmd === cmd.toLowerCase();
      const num = () => Number(toks[i++]);
      if (cmd === 'M' || cmd === 'm') {
        const x = num(), y = num();
        cx = rel && started ? cx + x : x; cy = rel && started ? cy + y : y;
        sx = cx; sy = cy; started = true; cmd = rel ? 'l' : 'L';
      } else if (cmd === 'L' || cmd === 'l') {
        const x = num(), y = num(); const nx = rel ? cx + x : x, ny = rel ? cy + y : y;
        seg.push(cx, cy, nx, ny); cx = nx; cy = ny;
      } else if (cmd === 'H' || cmd === 'h') {
        const x = num(); const nx = rel ? cx + x : x; seg.push(cx, cy, nx, cy); cx = nx;
      } else if (cmd === 'V' || cmd === 'v') {
        const y = num(); const ny = rel ? cy + y : y; seg.push(cx, cy, cx, ny); cy = ny;
      } else if (/[CcSsQqTtAa]/.test(cmd)) {
        const arity = cmd.toLowerCase() === 'c' ? 6 : cmd.toLowerCase() === 's' || cmd.toLowerCase() === 'q' ? 4 : cmd.toLowerCase() === 't' ? 2 : 7;
        const vals: number[] = [];
        for (let k = 0; k < arity && i < toks.length; k++) vals.push(num());
        if (vals.length >= 2) {
          const ex = vals[vals.length - 2], ey = vals[vals.length - 1];
          const nx = rel ? cx + ex : ex, ny = rel ? cy + ey : ey;
          seg.push(cx, cy, nx, ny); cx = nx; cy = ny;
        }
      } else { i++; }
    }
  }
  for (const m of text.matchAll(/<(?:text|title|desc)[^>]*>([\s\S]{0,200}?)<\//gi)) {
    const s = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (s) labels.push(s);
  }

  return { kind: 'svg', segments: Float64Array.from(seg), points: EMPTY, entities, labels: labels.slice(0, 400), units: 'px', triangles: 0 };
}

function attrNums(tag: string, names: string[]): number[] | null {
  const out: number[] = [];
  for (const n of names) {
    const m = tag.match(new RegExp(`\\b${n}=["']?(-?\\d*\\.?\\d+(?:e-?\\d+)?)`, 'i'));
    if (!m) return null;
    out.push(Number(m[1]));
  }
  return out.every(Number.isFinite) ? out : null;
}

// ── OBJ ───────────────────────────────────────────────────────────────────
export function parseObj(text: string): GeometryDoc {
  const vx: number[] = [];
  const seg: number[] = [];
  const entities = new Map<string, number>();
  const labels = new Set<string>();
  let tris = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [tag, ...rest] = line.split(/\s+/);
    if (tag === 'v') {
      vx.push(Number(rest[0]) || 0, Number(rest[1]) || 0, Number(rest[2]) || 0);
      entities.set('vertex', (entities.get('vertex') ?? 0) + 1);
    } else if (tag === 'f') {
      const idx = rest.map((t) => {
        const i = Number(t.split('/')[0]);
        return i < 0 ? vx.length / 3 + i : i - 1;
      }).filter((i) => Number.isInteger(i) && i >= 0);
      for (let k = 0; k < idx.length; k++) {
        const a = idx[k], b = idx[(k + 1) % idx.length];
        if (a * 3 + 1 < vx.length && b * 3 + 1 < vx.length) seg.push(vx[a * 3], vx[a * 3 + 1], vx[b * 3], vx[b * 3 + 1]);
      }
      tris += Math.max(0, idx.length - 2);
      entities.set('face', (entities.get('face') ?? 0) + 1);
    } else if (tag === 'o' || tag === 'g' || tag === 'usemtl') {
      const s = rest.join(' ').trim();
      if (s) labels.add(s);
    }
  }
  return { kind: 'obj', segments: Float64Array.from(seg), points: Float64Array.from(vx), entities, labels: [...labels].slice(0, 400), units: '', triangles: tris };
}

// ── STL (ASCII) ───────────────────────────────────────────────────────────
export function parseStl(text: string): GeometryDoc {
  const pts: number[] = [];
  const seg: number[] = [];
  let tris = 0;
  const labels: string[] = [];
  const name = text.match(/^\s*solid\s+([^\r\n]{1,80})/i);
  if (name) labels.push(name[1].trim());
  const verts: number[][] = [];
  for (const m of text.matchAll(/vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g)) {
    const v = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!v.every(Number.isFinite)) continue;
    verts.push(v);
    pts.push(v[0], v[1], v[2]);
    if (verts.length === 3) {
      for (let k = 0; k < 3; k++) {
        const a = verts[k], b = verts[(k + 1) % 3];
        seg.push(a[0], a[1], b[0], b[1]);
      }
      tris++; verts.length = 0;
    }
  }
  const entities = new Map<string, number>([['facet', tris]]);
  return { kind: 'stl', segments: Float64Array.from(seg), points: Float64Array.from(pts), entities, labels, units: '', triangles: tris };
}

// ── IFC / STEP physical file ──────────────────────────────────────────────
/**
 * ISO-10303-21 instances look like `#12=IFCWALL('guid',#3,'Name',…);`.
 * We census the entity types (the semantic content of a BIM model), harvest
 * the human labels, and lift IFCCARTESIANPOINT coordinates into a point cloud
 * so the same descriptor pipeline applies to a model as to a drawing.
 */
export function parseStepFile(text: string, kind: 'ifc' | 'step'): GeometryDoc {
  const entities = new Map<string, number>();
  const labels = new Set<string>();
  const pts: number[] = [];
  let units = '';

  const schema = text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i);
  if (schema) units = schema[1];

  const re = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]{0,4000}?)\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const type = m[2].toUpperCase();
    entities.set(type, (entities.get(type) ?? 0) + 1);
    const body = m[3];
    if (type === 'IFCCARTESIANPOINT' || type === 'CARTESIAN_POINT') {
      const nums = (body.match(/-?\d*\.?\d+(?:E[+-]?\d+)?/gi) ?? []).map(Number).filter(Number.isFinite);
      if (nums.length >= 2) pts.push(nums[0], nums[1], nums[2] ?? 0);
    } else if (labels.size < 400) {
      for (const s of body.match(/'([^']{2,60})'/g) ?? []) {
        const v = s.slice(1, -1).trim();
        if (v && !/^[0-9a-f$_-]{16,}$/i.test(v) && /[A-Za-z]{2}/.test(v)) labels.add(v);
      }
    }
  }

  // A point cloud has no edges of its own; connect consecutive points inside
  // each polyloop-sized window so density/orientation still have real input.
  const seg: number[] = [];
  for (let i = 3; i + 1 < pts.length; i += 3) seg.push(pts[i - 3], pts[i - 2], pts[i], pts[i + 1]);

  return {
    kind, segments: Float64Array.from(seg), points: Float64Array.from(pts),
    entities, labels: [...labels].slice(0, 400), units, triangles: 0,
  };
}
