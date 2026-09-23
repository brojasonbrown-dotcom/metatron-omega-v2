/**
 * Fibonacci / Lucas arithmetic.
 *
 * Exact (BigInt) for the stability law and the ladder; float64 for the small
 * profile sizes actually used to allocate lattices.
 */

const FIB_CACHE: bigint[] = [0n, 1n];
const LUC_CACHE: bigint[] = [2n, 1n];

export function fibBig(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`fibBig: bad n ${n}`);
  while (FIB_CACHE.length <= n) FIB_CACHE.push(FIB_CACHE[FIB_CACHE.length - 1] + FIB_CACHE[FIB_CACHE.length - 2]);
  return FIB_CACHE[n];
}

export function lucasBig(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`lucasBig: bad n ${n}`);
  while (LUC_CACHE.length <= n) LUC_CACHE.push(LUC_CACHE[LUC_CACHE.length - 1] + LUC_CACHE[LUC_CACHE.length - 2]);
  return LUC_CACHE[n];
}

/** Float64 Fibonacci; exact up to F(78). */
export function fib(n: number): number {
  return Number(fibBig(n));
}

/** Node-count profiles: nodes per torus are Fibonacci numbers (BRAINMAP 2.2). */
export const PROFILES = {
  PICO: 144,
  BASE: 987,
  CORE: 2584,
  GRAND: 6765,
  COSMIC: 75025,
  TRANSFINITE: 832040,
  ABSOLUTE: 2178309,
} as const;

export type ProfileName = keyof typeof PROFILES;
export const PROFILE_ORDER: readonly ProfileName[] = [
  'PICO',
  'BASE',
  'CORE',
  'GRAND',
  'COSMIC',
  'TRANSFINITE',
  'ABSOLUTE',
];

/** Largest Fibonacci number <= n (>= 1 for any n >= 1). */
export function largestFibonacciAtMost(n: number): number {
  let best = 1;
  for (let k = 2; k <= 90; k++) {
    const f = fib(k);
    if (f > n) break;
    best = f;
  }
  return best;
}

/** True when N is a Fibonacci number (profiles must be). */
export function isFibonacci(n: number): boolean {
  for (let k = 0; k <= 90; k++) {
    const f = fib(k);
    if (f === n) return true;
    if (f > n) return false;
  }
  return false;
}
