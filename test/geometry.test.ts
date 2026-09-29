/**
 * Geometry descriptor contract:
 *   • determinism — identical bytes give bit-identical descriptors
 *   • invariance  — translation must not move the orientation/moment channels
 *   • honesty     — unparseable input fails instead of producing empty chunks
 */
import { describe, it, expect } from 'vitest';
import {
  describeAsset,
  describeGeometry,
  parseGeometry,
  classifyAsset,
  sniffAsset,
} from '@/core/geometry';

const SQUARE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="10" y="10" width="80" height="80"/>
  <line x1="10" y1="10" x2="90" y2="90"/>
  <title>test plate</title>
</svg>`;

const DXF = `0
SECTION
2
ENTITIES
0
LINE
8
WALLS
10
0.0
20
0.0
11
10.0
21
0.0
0
LINE
8
WALLS
10
10.0
20
0.0
11
10.0
21
5.0
0
ENDSEC
0
EOF`;

const IFC = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCCARTESIANPOINT((0.,0.,0.));
#2=IFCCARTESIANPOINT((5.,0.,0.));
#3=IFCCARTESIANPOINT((5.,3.,0.));
#4=IFCWALL('1a2b3c','Wall','External Wall',$,$,$,$,$);
#5=IFCDOOR('9z8y7x','Door','Entrance Door',$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;`;

const OBJ = `v 0 0 0
v 1 0 0
v 1 1 0
f 1 2 3`;

const STL = `solid cube
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid`;

function translateSvg(dx: number, dy: number) {
  return `<svg><rect x="${10 + dx}" y="${10 + dy}" width="80" height="80"/><line x1="${10 + dx}" y1="${10 + dy}" x2="${90 + dx}" y2="${90 + dy}"/></svg>`;
}

describe('geometry — classification', () => {
  it('classifies by extension and by content', () => {
    expect(classifyAsset('https://x/y.dxf')).toBe('dxf');
    expect(classifyAsset('https://x/y.ifc')).toBe('ifc');
    expect(sniffAsset(IFC)).toBe('ifc');
    expect(sniffAsset(SQUARE_SVG)).toBe('svg');
    expect(sniffAsset(STL)).toBe('stl');
    expect(sniffAsset('hello world')).toBe('unknown');
  });
});

describe('geometry — parsing', () => {
  it('extracts real primitives from every supported format', () => {
    expect(parseGeometry(SQUARE_SVG, 'svg').segments.length).toBeGreaterThan(0);
    expect(parseGeometry(DXF, 'dxf').segments.length).toBe(8); // 2 lines × 4
    expect(parseGeometry(OBJ, 'obj').segments.length).toBe(12); // 3 edges × 4
    expect(parseGeometry(STL, 'stl').triangles).toBe(1);
    const ifc = parseGeometry(IFC, 'ifc');
    expect(ifc.entities.get('IFCWALL')).toBe(1);
    expect(ifc.entities.get('IFCDOOR')).toBe(1);
    expect(ifc.labels.some((l) => /Entrance Door/.test(l))).toBe(true);
  });
});

describe('geometry — descriptors', () => {
  it('is deterministic across runs', () => {
    const a = describeGeometry(parseGeometry(SQUARE_SVG, 'svg'));
    const b = describeGeometry(parseGeometry(SQUARE_SVG, 'svg'));
    expect(Array.from(a.vector)).toEqual(Array.from(b.vector));
    expect(Array.from(a.orientation)).toEqual(Array.from(b.orientation));
    expect(a.topology).toEqual(b.topology);
  });

  it('is translation invariant on orientation and moments', () => {
    const a = describeGeometry(parseGeometry(translateSvg(0, 0), 'svg'));
    const b = describeGeometry(parseGeometry(translateSvg(250, -70), 'svg'));
    for (let i = 0; i < a.orientation.length; i++) {
      expect(Math.abs(a.orientation[i] - b.orientation[i])).toBeLessThan(1e-12);
    }
    for (let i = 0; i < a.moments.length; i++) {
      expect(Math.abs(a.moments[i] - b.moments[i])).toBeLessThan(1e-9);
    }
  });

  it('measures axis-aligned drawings as orthogonal with closed loops', () => {
    const d = describeGeometry(
      parseGeometry('<svg><rect x="0" y="0" width="10" height="10"/></svg>', 'svg'),
    );
    expect(d.orthogonality).toBeGreaterThan(0.9);
    expect(d.topology.loops).toBe(1);
    expect(d.topology.components).toBe(1);
  });

  it('produces a unit feature vector', () => {
    const d = describeGeometry(parseGeometry(DXF, 'dxf'));
    let n = 0;
    for (const v of d.vector) n += v * v;
    expect(Math.sqrt(n)).toBeCloseTo(1, 10);
  });
});

describe('geometry — honesty', () => {
  it('fails loudly on unusable input instead of ingesting nothing', () => {
    expect(describeAsset('', 'x.dxf').ok).toBe(false);
    expect(describeAsset('just some prose about doors', 'notes.txt').ok).toBe(false);
    const bad = describeAsset(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
      'empty.svg',
    );
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/no primitives|unrecognised/);
  });

  it('summarises with measured values only', () => {
    const r = describeAsset(IFC, 'model.ifc');
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/IFCWALL×1/);
    expect(r.text).toMatch(/Topology:/);
  });
});
