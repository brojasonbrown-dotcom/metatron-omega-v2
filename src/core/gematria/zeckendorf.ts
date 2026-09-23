/**
 * Zeckendorf addressing — every positive integer is a UNIQUE sum of
 * non-consecutive Fibonacci numbers (F₂=1, F₃=2, F₄=3, F₅=5, …).
 *
 * Greedy decomposition is provably optimal and unique, which makes this a
 * canonical, reversible, self-similar address for memory slots and concept
 * ids. Fibonacci coding (bits + terminating 1) is a complete prefix code.
 *
 * Honest note: Fibonacci coding is asymptotically slightly less dense than
 * plain binary. We use it where the φ-cadence alignment matters, not as a
 * compression claim.
 */

import { fib } from './zphi';

/** Indices k (into F) such that Σ F(k) = n, descending, no two consecutive. */
export function zeckendorf(n: number): number[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('zeckendorf: need n ≥ 0');
  if (n === 0) return [];
  let k = 2;
  while (fib(k + 1) <= n) k++;
  const out: number[] = [];
  let rest = n;
  while (rest > 0 && k >= 2) {
    const f = fib(k);
    if (f <= rest) {
      out.push(k);
      rest -= f;
      k -= 2; // non-consecutive by construction
    } else {
      k -= 1;
    }
  }
  return out;
}

/** Inverse of `zeckendorf`. */
export function unzeckendorf(indices: readonly number[]): number {
  let s = 0;
  for (const k of indices) s += fib(k);
  return s;
}

/**
 * Fibonacci prefix code: LSB-first bits over F₂… with a terminating extra 1.
 * e.g. 1 → "11", 2 → "011", 3 → "0011", 4 → "1011".
 */
export function fibCode(n: number): string {
  if (n <= 0) throw new RangeError('fibCode: need n ≥ 1');
  const idx = zeckendorf(n);
  const top = idx[0];
  const bits = new Array<string>(top - 1).fill('0');
  for (const k of idx) bits[k - 2] = '1';
  return bits.join('') + '1';
}

export function fibDecode(code: string): number {
  const end = code.indexOf('11');
  const body = end >= 0 ? code.slice(0, end + 1) : code;
  let s = 0;
  for (let i = 0; i < body.length; i++) if (body[i] === '1') s += fib(i + 2);
  return s;
}

/**
 * Zeckendorf address string — stable, sortable, human-readable slot key.
 * "z:8+5+2" style, descending. Deterministic across runs and devices.
 */
export function zeckAddress(n: number): string {
  const idx = zeckendorf(n);
  if (idx.length === 0) return 'z:0';
  return 'z:' + idx.map((k) => fib(k)).join('+');
}

/**
 * Self-similarity depth of n's Zeckendorf code: number of index gaps equal
 * to 2 (the tightest legal packing). A pure structural feature — no meaning
 * is attached to it.
 */
export function zeckDensity(n: number): number {
  const idx = zeckendorf(n);
  if (idx.length < 2) return 0;
  let tight = 0;
  for (let i = 1; i < idx.length; i++) if (idx[i - 1] - idx[i] === 2) tight++;
  return tight / (idx.length - 1);
}
