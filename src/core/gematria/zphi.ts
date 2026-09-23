/**
 * Z[φ] — the exact golden ring.
 *
 *   z = a + bφ    with a, b ∈ ℤ    and    φ² = φ + 1
 *
 * Closed under +, −, ×. Multiplicative norm N(a+bφ) = a² + ab − b²
 * (verified in packages/brain-core/src/formal — φ³ = 2φ + 1 etc.).
 *
 * Everything here is integer arithmetic: below the exact horizon
 * (|a|,|b| < 2^53) φ-powers carry ZERO rounding error, unlike the
 * Math.pow(PHI, n) path used elsewhere for display values.
 */

export const PHI = 1.618033988749895;
export const PHI_INV = 0.6180339887498949;

/** Largest n for which φⁿ = F(n−1) + F(n)·φ stays inside float64 integers. */
export const PHI_EXACT_HORIZON = 76;

export interface ZPhi {
  /** rational part */
  readonly a: number;
  /** φ coefficient */
  readonly b: number;
}

export function zphi(a: number, b = 0): ZPhi {
  return { a: Math.trunc(a), b: Math.trunc(b) };
}

export const ZPHI_ZERO: ZPhi = { a: 0, b: 0 };
export const ZPHI_ONE: ZPhi = { a: 1, b: 0 };
export const ZPHI_PHI: ZPhi = { a: 0, b: 1 };

export function zAdd(x: ZPhi, y: ZPhi): ZPhi {
  return { a: x.a + y.a, b: x.b + y.b };
}

export function zSub(x: ZPhi, y: ZPhi): ZPhi {
  return { a: x.a - y.a, b: x.b - y.b };
}

/** (a₁+b₁φ)(a₂+b₂φ) = (a₁a₂ + b₁b₂) + (a₁b₂ + a₂b₁ + b₁b₂)φ   [uses φ² = φ+1] */
export function zMul(x: ZPhi, y: ZPhi): ZPhi {
  return {
    a: x.a * y.a + x.b * y.b,
    b: x.a * y.b + y.a * x.b + x.b * y.b,
  };
}

/** Exact multiplicative norm. N(xy) = N(x)N(y). */
export function zNorm(x: ZPhi): number {
  return x.a * x.a + x.a * x.b - x.b * x.b;
}

export function zEq(x: ZPhi, y: ZPhi): boolean {
  return x.a === y.a && x.b === y.b;
}

/** Float value of a+bφ — only for display / final projection. */
export function zValue(x: ZPhi): number {
  return x.a + x.b * PHI;
}

/** Fibonacci numbers F(0)=0, F(1)=1 — memoised, integer-exact to F(78). */
const FIB: number[] = [0, 1];
export function fib(n: number): number {
  if (n < 0) throw new RangeError('fib: n < 0');
  while (FIB.length <= n) FIB.push(FIB[FIB.length - 1] + FIB[FIB.length - 2]);
  return FIB[n];
}

/** Exact φⁿ = F(n−1) + F(n)·φ for 0 ≤ n ≤ PHI_EXACT_HORIZON. */
export function zPow(n: number): ZPhi {
  if (n < 0) {
    // φ⁻ⁿ = (−1)ⁿ (F(n+1) − F(n)φ)
    const m = -n;
    const sign = m % 2 === 0 ? 1 : -1;
    return { a: sign * fib(m + 1), b: -sign * fib(m) };
  }
  return { a: n === 0 ? 1 : fib(n - 1), b: fib(n) };
}

/** True when the value is still representable without drift. */
export function zIsExact(x: ZPhi): boolean {
  return Number.isSafeInteger(x.a) && Number.isSafeInteger(x.b);
}
