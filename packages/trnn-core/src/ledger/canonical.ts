/**
 * Canonical JSON — the serialisation the ledger hashes and signs.
 *
 * Two objects that are equal as data MUST produce byte-identical output, or a
 * signature verifies today and fails tomorrow for no reason but key order.
 * Rules: object keys sorted by UTF-16 code unit, no insignificant whitespace,
 * `undefined` members dropped, and non-finite numbers rejected outright
 * (JSON.stringify turns NaN into null, which would silently corrupt a sealed
 * record rather than fail loudly).
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function canonicalJson(value: unknown): string {
  return enc(value);
}

function enc(v: unknown): string {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(v as number)) {
      throw new TypeError('canonicalJson: non-finite number is not representable');
    }
    return Object.is(v, -0) ? '0' : JSON.stringify(v);
  }
  if (t === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map((x) => enc(x === undefined ? null : x)).join(',') + ']';
  if (v instanceof Uint8Array) return JSON.stringify(bytesToBase64(v));
  if (t === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + enc(o[k])).join(',') + '}';
  }
  throw new TypeError(`canonicalJson: unsupported type ${t}`);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without relying on btoa/Buffer — same result in browser and worker. */
export function bytesToBase64(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const c0 = b[i], c1 = b[i + 1], c2 = b[i + 2];
    out += B64[c0 >> 2];
    out += B64[((c0 & 3) << 4) | ((c1 ?? 0) >> 4)];
    out += i + 1 < b.length ? B64[(((c1 as number) & 15) << 2) | ((c2 ?? 0) >> 6)] : '=';
    out += i + 2 < b.length ? B64[(c2 as number) & 63] : '=';
  }
  return out;
}

export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64.indexOf(clean[i]);
    if (v < 0) throw new TypeError('base64ToBytes: invalid character');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out;
}

const TE = new TextEncoder();
const TD = new TextDecoder();

export function utf8(s: string): Uint8Array { return TE.encode(s); }
export function fromUtf8(b: Uint8Array): string { return TD.decode(b); }
