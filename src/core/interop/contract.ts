/**
 * Ω-READY R2 — the interop contract law.
 *
 * Everything the host (RAFFY U v16) hashes, chains, or merges has to be
 * reproducible from our side byte-for-byte. That needs four things declared in
 * exactly one place, which is this file:
 *
 *   1. Canonical CBOR   — deterministic encoding (RFC 8949 §4.2.1 core rules).
 *   2. One hash law     — SHA3-256 is the law. SHA-256 exists only as an
 *                         explicitly named compatibility function; there is no
 *                         silent fallback between them (the host's
 *                         `rumf_sha3_256()` fallback is the exact defect we
 *                         refuse to inherit).
 *   3. HLC v2.1         — hybrid logical clock WITH a node id, monotone even
 *                         when the wall clock moves backwards.
 *   4. Deterministic ids — leaf/event ids derive from content, never from
 *                         Math.random() or Date.now().
 *
 * Pure and dependency-light: @noble/hashes only, no I/O, no globals read at
 * module scope. Safe on the client, in a worker, and under SSR.
 */

import { sha3_256 } from '@noble/hashes/sha3.js';
import { sha256 } from '@noble/hashes/sha2.js';

// ───────────────────────────────────────────────────────────────────────────
// 1. Canonical CBOR
// ───────────────────────────────────────────────────────────────────────────

export type CborValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Uint8Array
  | CborValue[]
  | { [k: string]: CborValue };

const TE = new TextEncoder();
const TD = new TextDecoder();

class Buf {
  private parts: Uint8Array[] = [];
  private len = 0;
  push(b: Uint8Array): void {
    this.parts.push(b);
    this.len += b.length;
  }
  byte(v: number): void {
    this.push(Uint8Array.of(v & 0xff));
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

/** Major-type header with the shortest possible argument (deterministic). */
function head(buf: Buf, major: number, arg: number | bigint): void {
  const m = major << 5;
  const n = typeof arg === 'bigint' ? arg : BigInt(Math.trunc(arg));
  if (n < 0n) throw new RangeError('cbor: negative argument');
  if (n < 24n) {
    buf.byte(m | Number(n));
    return;
  }
  if (n <= 0xffn) {
    buf.byte(m | 24);
    buf.byte(Number(n));
    return;
  }
  if (n <= 0xffffn) {
    buf.byte(m | 25);
    buf.push(Uint8Array.of(Number((n >> 8n) & 0xffn), Number(n & 0xffn)));
    return;
  }
  if (n <= 0xffffffffn) {
    buf.byte(m | 26);
    const b = new Uint8Array(4);
    for (let i = 0; i < 4; i++) b[3 - i] = Number((n >> BigInt(8 * i)) & 0xffn);
    buf.push(b);
    return;
  }
  if (n <= 0xffffffffffffffffn) {
    buf.byte(m | 27);
    const b = new Uint8Array(8);
    for (let i = 0; i < 8; i++) b[7 - i] = Number((n >> BigInt(8 * i)) & 0xffn);
    buf.push(b);
    return;
  }
  throw new RangeError('cbor: argument exceeds 64 bits');
}

/** Deterministic map-key ordering: bytewise lexicographic over the encoded key. */
function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

function encInto(buf: Buf, v: CborValue): void {
  if (v === null) {
    buf.byte(0xf6);
    return;
  }
  if (typeof v === 'boolean') {
    buf.byte(v ? 0xf5 : 0xf4);
    return;
  }
  if (typeof v === 'bigint') {
    if (v >= 0n) head(buf, 0, v);
    else head(buf, 1, -v - 1n);
    return;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      // A sealed record must never carry NaN/±Infinity: the host would read it
      // back as null and the chain would verify over data we never measured.
      throw new TypeError('cbor: non-finite number is not representable');
    }
    if (Number.isInteger(v) && Object.is(v, Math.trunc(v)) && !Object.is(v, -0)) {
      if (v >= 0) head(buf, 0, v);
      else head(buf, 1, -v - 1);
      return;
    }
    // Non-integers use float64 (major 7 / ai 27). Shortest-float shrinking is
    // deliberately NOT applied: one width means one preimage, always.
    buf.byte(0xfb);
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, false);
    buf.push(b);
    return;
  }
  if (typeof v === 'string') {
    const s = TE.encode(v);
    head(buf, 3, s.length);
    buf.push(s);
    return;
  }
  if (v instanceof Uint8Array) {
    head(buf, 2, v.length);
    buf.push(v);
    return;
  }
  if (Array.isArray(v)) {
    head(buf, 4, v.length);
    for (const x of v) encInto(buf, x);
    return;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, CborValue>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined);
    const pairs = keys.map((k) => {
      const kb = new Buf();
      encInto(kb, k);
      return { k, enc: kb.bytes() };
    });
    pairs.sort((a, b) => cmpBytes(a.enc, b.enc));
    head(buf, 5, pairs.length);
    for (const p of pairs) {
      buf.push(p.enc);
      encInto(buf, o[p.k]);
    }
    return;
  }
  throw new TypeError(`cbor: unsupported type ${typeof v}`);
}

/** Canonical CBOR bytes. Equal data ⇒ identical bytes, always. */
export function encodeCbor(value: CborValue): Uint8Array {
  const b = new Buf();
  encInto(b, value);
  return b.bytes();
}

class Reader {
  constructor(
    private b: Uint8Array,
    private i = 0,
  ) {}
  private u8(): number {
    if (this.i >= this.b.length) throw new RangeError('cbor: truncated');
    return this.b[this.i++];
  }
  private argOf(ai: number): bigint {
    if (ai < 24) return BigInt(ai);
    if (ai === 24) return BigInt(this.u8());
    if (ai === 25) return (BigInt(this.u8()) << 8n) | BigInt(this.u8());
    if (ai === 26) {
      let n = 0n;
      for (let k = 0; k < 4; k++) n = (n << 8n) | BigInt(this.u8());
      return n;
    }
    if (ai === 27) {
      let n = 0n;
      for (let k = 0; k < 8; k++) n = (n << 8n) | BigInt(this.u8());
      return n;
    }
    throw new RangeError(`cbor: unsupported additional info ${ai}`);
  }
  private raw(n: number): Uint8Array {
    if (this.i + n > this.b.length) throw new RangeError('cbor: truncated');
    const out = this.b.slice(this.i, this.i + n);
    this.i += n;
    return out;
  }
  value(): CborValue {
    const ib = this.u8();
    const major = ib >> 5;
    const ai = ib & 0x1f;
    switch (major) {
      case 0: {
        const n = this.argOf(ai);
        return n <= 9007199254740991n ? Number(n) : n;
      }
      case 1: {
        const n = -1n - this.argOf(ai);
        return n >= -9007199254740991n ? Number(n) : n;
      }
      case 2:
        return this.raw(Number(this.argOf(ai)));
      case 3:
        return TD.decode(this.raw(Number(this.argOf(ai))));
      case 4: {
        const n = Number(this.argOf(ai));
        const arr: CborValue[] = [];
        for (let k = 0; k < n; k++) arr.push(this.value());
        return arr;
      }
      case 5: {
        const n = Number(this.argOf(ai));
        const o: Record<string, CborValue> = {};
        for (let k = 0; k < n; k++) {
          const key = this.value();
          if (typeof key !== 'string') throw new TypeError('cbor: non-string map key');
          o[key] = this.value();
        }
        return o;
      }
      case 7: {
        if (ai === 20) return false;
        if (ai === 21) return true;
        if (ai === 22) return null;
        if (ai === 27) {
          const b = this.raw(8);
          return new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, false);
        }
        throw new RangeError(`cbor: unsupported simple value ${ai}`);
      }
      default:
        throw new RangeError(`cbor: unsupported major type ${major}`);
    }
  }
  done(): boolean {
    return this.i === this.b.length;
  }
}

/** Decode canonical CBOR. Trailing bytes are an error, not ignored. */
export function decodeCbor(bytes: Uint8Array): CborValue {
  const r = new Reader(bytes);
  const v = r.value();
  if (!r.done()) throw new RangeError('cbor: trailing bytes');
  return v;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. The hash law
// ───────────────────────────────────────────────────────────────────────────

/** The declared hash law of every Ω↔host artefact. */
export const HASH_LAW = 'sha3-256' as const;
export type HashLaw = typeof HASH_LAW | 'sha-256';

export function toHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

export function fromHex(s: string): Uint8Array {
  if (s.length % 2 !== 0) throw new RangeError('fromHex: odd length');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const v = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(v)) throw new RangeError('fromHex: invalid hex');
    out[i] = v;
  }
  return out;
}

/** The law. Use this everywhere unless a host row demands the legacy digest. */
export function hash(bytes: Uint8Array): Uint8Array {
  return sha3_256(bytes);
}
export function hashHex(bytes: Uint8Array): string {
  return toHex(hash(bytes));
}

/**
 * Legacy SHA-256, for host columns that were written under the old digest.
 * Named on purpose: a caller has to say "legacy" out loud. Never called as a
 * fallback when SHA3 is unavailable — SHA3 is always available here.
 */
export function hashLegacySha256(bytes: Uint8Array): Uint8Array {
  return sha256(bytes);
}
export function hashLegacySha256Hex(bytes: Uint8Array): string {
  return toHex(sha256(bytes));
}

/** Hash a value under the law, through canonical CBOR. */
export function hashValue(value: CborValue): Uint8Array {
  return hash(encodeCbor(value));
}
export function hashValueHex(value: CborValue): string {
  return toHex(hashValue(value));
}

/** Which digest produced a hex string, when a row does not say. */
export function hashLawOfHex(hex: string): HashLaw | null {
  return hex.length === 64 ? HASH_LAW : null; // both are 32 bytes — length cannot disambiguate
}

// ───────────────────────────────────────────────────────────────────────────
// 3. HLC v2.1 (with node id)
// ───────────────────────────────────────────────────────────────────────────

export interface Hlc {
  /** Physical component, milliseconds. */
  readonly wall: number;
  /** Logical counter, breaking ties inside one millisecond. */
  readonly counter: number;
  /** Node identity — an HLC without one cannot be ordered across replicas. */
  readonly node: string;
}

export function hlcZero(node: string): Hlc {
  if (!node) throw new TypeError('hlc: node id is required (v2.1)');
  return { wall: 0, counter: 0, node };
}

/**
 * Advance a local clock. `now` is passed in, never read here, so replays
 * reproduce. Monotone by construction: a backwards wall clock only bumps the
 * counter, it can never move an HLC backwards.
 */
export function hlcTick(prev: Hlc, now: number): Hlc {
  const wall = Math.max(prev.wall, Math.trunc(now));
  return wall === prev.wall
    ? { wall, counter: prev.counter + 1, node: prev.node }
    : { wall, counter: 0, node: prev.node };
}

/** Merge a received HLC into the local one (Lamport-style, node preserved). */
export function hlcMerge(local: Hlc, remote: Hlc, now: number): Hlc {
  const wall = Math.max(local.wall, remote.wall, Math.trunc(now));
  let counter: number;
  if (wall === local.wall && wall === remote.wall)
    counter = Math.max(local.counter, remote.counter) + 1;
  else if (wall === local.wall) counter = local.counter + 1;
  else if (wall === remote.wall) counter = remote.counter + 1;
  else counter = 0;
  return { wall, counter, node: local.node };
}

/** Total order: wall, then counter, then node id. */
export function hlcCompare(a: Hlc, b: Hlc): number {
  if (a.wall !== b.wall) return a.wall - b.wall;
  if (a.counter !== b.counter) return a.counter - b.counter;
  return a.node < b.node ? -1 : a.node > b.node ? 1 : 0;
}

/** Sortable wire form: `wall-counter-node`, zero-padded so string sort == order. */
export function hlcEncode(h: Hlc): string {
  return `${h.wall.toString().padStart(15, '0')}-${h.counter.toString().padStart(6, '0')}-${h.node}`;
}

export function hlcDecode(s: string): Hlc {
  const i = s.indexOf('-');
  const j = s.indexOf('-', i + 1);
  if (i < 0 || j < 0) throw new TypeError('hlc: malformed encoding');
  const wall = Number.parseInt(s.slice(0, i), 10);
  const counter = Number.parseInt(s.slice(i + 1, j), 10);
  const node = s.slice(j + 1);
  if (!Number.isFinite(wall) || !Number.isFinite(counter) || !node) {
    throw new TypeError('hlc: malformed encoding');
  }
  return { wall, counter, node };
}

// ───────────────────────────────────────────────────────────────────────────
// 4. Deterministic ids
// ───────────────────────────────────────────────────────────────────────────

/**
 * Content-derived id. Same (kind, hlc, payload) ⇒ same id, on any machine, in
 * any process, forever. This replaces every `Math.random()`-derived evidence id
 * (the host's own defect) at our boundary.
 */
export function deterministicId(kind: string, hlc: Hlc, payload: CborValue): string {
  const digest = hashValue({ k: kind, t: hlcEncode(hlc), p: payload });
  return `${kind}_${toHex(digest).slice(0, 32)}`;
}

/** Interop layer version, stamped into every envelope we emit. */
export const INTEROP_VERSION = 'omega-interop/1' as const;
