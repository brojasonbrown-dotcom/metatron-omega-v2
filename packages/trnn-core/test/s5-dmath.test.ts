/**
 * Gate S5.1 — the deterministic transcendental bank.
 *
 * Two properties are measured, never assumed:
 *   1. ACCURACY — every function is within a few ulp of the host libm across
 *      the domains the engine actually uses.
 *   2. PURITY  — the implementation only uses IEEE-exact primitives, so two
 *      conforming engines must agree bit for bit. The static check below
 *      guards that: no Math.<transcendental> may appear in dmath's own source
 *      or anywhere else in the engine.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dacos,
  dasin,
  datan,
  datan2,
  datanh,
  dcos,
  dexp,
  dlog,
  dlog1p,
  dmag,
  dpow,
  dpowi,
  dsin,
  dtanh,
  pow2i,
} from '../src/core/dmath';

const lin = (n: number, a: number, b: number) =>
  Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

function maxRelErr(f: (x: number) => number, g: (x: number) => number, xs: number[]): number {
  let worst = 0;
  for (const x of xs) {
    const a = f(x);
    const b = g(x);
    const scale = Math.max(Math.abs(b), 1e-12);
    const e = Math.abs(a - b) / scale;
    if (e > worst) worst = e;
  }
  return worst;
}

const ULP = 2.220446049250313e-16;

describe('S5.1 — deterministic transcendental bank', () => {
  it('sin/cos match libm to <= 4 ulp on the engine range', () => {
    expect(maxRelErr(dsin, Math.sin, lin(4001, -100, 100))).toBeLessThan(4 * ULP);
    expect(maxRelErr(dcos, Math.cos, lin(4001, -100, 100))).toBeLessThan(4 * ULP);
  });

  it('trig range reduction survives large arguments', () => {
    expect(maxRelErr(dsin, Math.sin, lin(2001, -1e6, 1e6))).toBeLessThan(8 * ULP);
    expect(maxRelErr(dcos, Math.cos, lin(2001, -1e6, 1e6))).toBeLessThan(8 * ULP);
  });

  it('exp/log/log1p match libm to <= 4 ulp', () => {
    expect(maxRelErr(dexp, Math.exp, lin(2001, -700, 700))).toBeLessThan(4 * ULP);
    expect(maxRelErr(dlog, Math.log, lin(2001, 1e-8, 1e8))).toBeLessThan(4 * ULP);
    expect(maxRelErr(dlog1p, Math.log1p, lin(2001, -0.9, 10))).toBeLessThan(4 * ULP);
  });

  it('inverse trig and tanh match libm', () => {
    expect(maxRelErr(datan, Math.atan, lin(4001, -1000, 1000))).toBeLessThan(4 * ULP);
    expect(maxRelErr(dacos, Math.acos, lin(2001, -0.999, 0.999))).toBeLessThan(64 * ULP);
    expect(maxRelErr(dasin, Math.asin, lin(2001, -0.999, 0.999))).toBeLessThan(64 * ULP);
    expect(maxRelErr(datanh, Math.atanh, lin(2001, -0.99, 0.99))).toBeLessThan(64 * ULP);
    expect(maxRelErr(dtanh, Math.tanh, lin(2001, -19, 19))).toBeLessThan(8 * ULP);
    expect(Math.abs(datan2(1, -1) - Math.atan2(1, -1))).toBeLessThan(4 * ULP);
    expect(dmag(3, 4)).toBe(5);
  });

  it('pow is exact on integer exponents and accurate on the φ ladder', () => {
    expect(dpowi(2, 10)).toBe(1024);
    expect(dpow(2, 53)).toBe(9007199254740992);
    const phi = 1.618033988749895;
    expect(maxRelErr((k) => dpow(phi, k), (k) => Math.pow(phi, k), lin(301, -150, 150))).toBeLessThan(
      64 * ULP,
    );
    expect(maxRelErr((k) => dpow(2.5, k), (k) => Math.pow(2.5, k), lin(2001, -30.5, 30.5))).toBeLessThan(
      32 * ULP,
    );
  });

  it('pow2i is bit-exact across the whole binade range', () => {
    for (let k = -1074; k <= 1023; k++) expect(pow2i(k)).toBe(Math.pow(2, k));
  });

  it('is odd/even and sign-consistent (structural identities)', () => {
    for (const x of lin(501, -30, 30)) {
      expect(dsin(-x)).toBe(-dsin(x));
      expect(dcos(-x)).toBe(dcos(x));
      const s = dsin(x);
      const c = dcos(x);
      expect(Math.abs(s * s + c * c - 1)).toBeLessThan(8 * ULP);
    }
  });

  it('no implementation-approximated Math call survives in the engine', () => {
    const banned = /Math\.(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt|sinh|cosh|tanh|random)\s*\(/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!p.endsWith('.ts')) continue;
        const src = readFileSync(p, 'utf8');
        src.split('\n').forEach((line, i) => {
          const t = line.trim();
          if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
          if (banned.test(line)) offenders.push(`${p}:${i + 1}: ${t}`);
        });
      }
    };
    walk(join(import.meta.dirname, '..', 'src'));
    expect(offenders).toEqual([]);
  });
});
