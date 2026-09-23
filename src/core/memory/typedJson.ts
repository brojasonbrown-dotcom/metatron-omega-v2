/**
 * typedJson — JSON-transport coercion for typed-array payloads.
 *
 * Why this exists: `JSON.stringify(new Int32Array([1,2]))` renders `{"0":1,"1":2}`,
 * and `new Int32Array({"0":1,"1":2})` yields a ZERO-length array. Any snapshot
 * layer that stores typed arrays and is restored from parsed JSON therefore
 * loses its payload silently — the snapshot shrinks instead of round-tripping.
 *
 * These helpers accept the three shapes a snapshot can legitimately arrive in
 * (typed array, plain number[], JSON index-keyed object) and always produce a
 * real typed array. Unknown shapes produce an empty array — never a partial or
 * fabricated one.
 */

function toNumbers(v: unknown): number[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v as number[];
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
  if (typeof v === 'object') {
    const rec = v as Record<string, unknown>;
    // Array-like ({ length, 0, 1, ... }) or JSON-rendered typed array ({ "0": … }).
    const len = typeof rec['length'] === 'number'
      ? (rec['length'] as number)
      : Object.keys(rec).reduce((m, k) => {
          const i = Number(k);
          return Number.isInteger(i) && i >= 0 ? Math.max(m, i + 1) : m;
        }, 0);
    const out = new Array<number>(len);
    for (let i = 0; i < len; i++) {
      const x = rec[String(i)];
      out[i] = typeof x === 'number' ? x : Number(x ?? 0);
    }
    return out;
  }
  return [];
}

export function toInt32Array(v: unknown): Int32Array {
  return v instanceof Int32Array ? new Int32Array(v) : Int32Array.from(toNumbers(v));
}

export function toFloat64Array(v: unknown): Float64Array {
  return v instanceof Float64Array ? new Float64Array(v) : Float64Array.from(toNumbers(v));
}
