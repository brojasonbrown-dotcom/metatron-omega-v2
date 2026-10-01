/**
 * P0.3 — determinism freeze. Digests live only in docs/FROZEN.md; this test
 * reads them from there. Parity values pin exact IEEE-754 bit patterns.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  datan2,
  dcos,
  dexp,
  dlog,
  dlog1p,
  dpow,
  dpowi,
  dsin,
  dtanh,
} from '../../packages/trnn-core/src/core/dmath';
import { neumaierSum } from '../../src/core/numerics/StableSum';

function normalised(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n');
}

function bits(x: number): string {
  const v = new DataView(new ArrayBuffer(8));
  v.setFloat64(0, x);
  return v.getBigUint64(0).toString(16).padStart(16, '0');
}

const doc = readFileSync('docs/FROZEN.md', 'utf8');
const table = doc.slice(doc.indexOf('frozen-table:start'), doc.indexOf('frozen-table:end'));
const rows = [...table.matchAll(/^\| `([^`]+)`\s*\| `([0-9a-f]{64})`\s*\|/gm)].map((m) => ({
  path: m[1],
  sha: m[2],
}));

describe('P0.3 frozen files', () => {
  it('lists the eleven frozen files', () => {
    expect(rows.length).toBe(11);
  });
  for (const r of rows) {
    it(`unchanged: ${r.path}`, () => {
      expect(createHash('sha256').update(normalised(r.path)).digest('hex')).toBe(r.sha);
    });
  }
});

describe('P0.3 bit parity', () => {
  const cases: [string, () => number, string][] = [
    ['dsin(1.2345)', () => dsin(1.2345), '3fee351c8409f41d'],
    ['dcos(-7.5)', () => dcos(-7.5), '3fd62f45e66f5c2f'],
    ['dexp(0.7)', () => dexp(0.7), '40001c2a61268987'],
    ['dlog(3.3)', () => dlog(3.3), '3ff31a4e7240c777'],
    ['dlog1p(1e-9)', () => dlog1p(1e-9), '3e112e0be801f1d9'],
    ['dpow(phi,-24)', () => dpow(1.618033988749895, -24), '3ee43a0d9e9f0077'],
    ['dpow(2.5,0.3)', () => dpow(2.5, 0.3), '3ff50fe6c94a6e58'],
    ['dpowi(1.1,17)', () => dpowi(1.1, 17), '401437c70ef2980e'],
    ['datan2(-0.3,0.8)', () => datan2(-0.3, 0.8), 'bfd6f61941e4deee'],
    ['dtanh(0.42)', () => dtanh(0.42), '3fd9674ee60feef4'],
    ['neumaier cancellation', () => neumaierSum([1, 1e100, 1, -1e100]), '4000000000000000'],
    ['neumaier 0.1 x10', () => neumaierSum(new Array(10).fill(0.1)), '3ff0000000000000'],
  ];
  for (const [name, f, hex] of cases) {
    it(name, () => {
      expect(bits(f())).toBe(hex);
    });
  }
});
