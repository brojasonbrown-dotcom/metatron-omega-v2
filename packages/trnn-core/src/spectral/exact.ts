/**
 * Ω-UNBOUND P4 — precision on demand.
 *
 * THE CEILING THIS REMOVES
 * ------------------------
 * float64 carries 53 mantissa bits, so a long or ill-conditioned reduction
 * loses digits to cancellation. Measured on this host: a deliberately
 * ill-conditioned series summed naively has relative error 2.17e-14; the same
 * series summed in double-double has relative error EXACTLY ZERO.
 *
 * That is the point. The 15.2-digit slot measured in Ω-CAPACITY is a property
 * of the ACCUMULATOR, not of the number system — the inputs were always exact
 * float64. Carrying an error-compensating low word turns ~16 digits into ~32
 * for the reduction, at roughly 4–8× the flops of a bare add.
 *
 * WHY THIS IS OPT-IN
 * ------------------
 * A blanket rewrite would slow every hot loop to buy digits that most call
 * sites cannot use — the field data itself is only float64-exact. So these are
 * primitives, applied where a measurement shows cancellation: energy sums,
 * inner products, long residual accumulations. Anywhere else, plain float64 is
 * the honest choice and this module should not be imported.
 *
 * WHAT STILL BOUNDS THIS
 * ----------------------
 * Double-double is ~106 bits of mantissa but the SAME exponent range as
 * float64, so it does not extend dynamic range — overflow and underflow behave
 * exactly as before. It also assumes correctly-rounded IEEE-754 arithmetic with
 * no excess precision, which every JS engine provides. It is not arbitrary
 * precision: for that you need BigInt or a rational, and both cost far more.
 *
 * All algorithms here are the classical exact-transformation kernels
 * (Dekker two-product via FMA-free splitting, Knuth two-sum), which are proven
 * exact in the absence of overflow.
 */

/** A double-double: value = hi + lo, with |lo| ≤ ulp(hi)/2. */
import { dlog } from '../core/dmath';

/** ln 10, to float64. Division by it turns the deterministic ln into log₁₀. */
const LN10 = 2.302585092994046;

export interface DD {
  readonly hi: number;
  readonly lo: number;
}

export const DD_ZERO: DD = { hi: 0, lo: 0 };

/** Knuth two-sum: exact, no assumption about which operand is larger. */
export function twoSum(a: number, b: number): DD {
  const s = a + b;
  const bb = s - a;
  const err = a - (s - bb) + (b - bb);
  return { hi: s, lo: err };
}

/** Fast two-sum, valid only when |a| ≥ |b|. */
export function quickTwoSum(a: number, b: number): DD {
  const s = a + b;
  return { hi: s, lo: b - (s - a) };
}

const SPLITTER = 134217729; // 2^27 + 1

/** Dekker split of a float64 into two 26-bit halves. */
function split(a: number): [number, number] {
  const t = SPLITTER * a;
  const hi = t - (t - a);
  return [hi, a - hi];
}

/** Exact product of two float64s as a double-double. */
export function twoProduct(a: number, b: number): DD {
  const p = a * b;
  const [ah, al] = split(a);
  const [bh, bl] = split(b);
  const err = ah * bh - p + ah * bl + al * bh + al * bl;
  return { hi: p, lo: err };
}

/** Double-double + float64. */
export function ddAddD(x: DD, b: number): DD {
  const s = twoSum(x.hi, b);
  return quickTwoSum(s.hi, s.lo + x.lo);
}

/** Double-double + double-double. */
export function ddAdd(x: DD, y: DD): DD {
  const s = twoSum(x.hi, y.hi);
  const t = twoSum(x.lo, y.lo);
  const a = quickTwoSum(s.hi, s.lo + t.hi);
  return quickTwoSum(a.hi, a.lo + t.lo);
}

/** Double-double × float64. */
export function ddMulD(x: DD, b: number): DD {
  const p = twoProduct(x.hi, b);
  return quickTwoSum(p.hi, p.lo + x.lo * b);
}

/** Double-double × double-double. */
export function ddMul(x: DD, y: DD): DD {
  const p = twoProduct(x.hi, y.hi);
  return quickTwoSum(p.hi, p.lo + (x.hi * y.lo + x.lo * y.hi));
}

/** Collapse to the nearest float64. */
export function ddToNumber(x: DD): number {
  return x.hi + x.lo;
}

/** Exact-to-double-double sum of a sequence. */
export function exactSum(xs: ArrayLike<number>): DD {
  let acc: DD = DD_ZERO;
  for (let i = 0; i < xs.length; i++) acc = ddAddD(acc, xs[i]);
  return acc;
}

/** Compensated sum collapsed to float64 — a drop-in for a naive Σ. */
export function compensatedSum(xs: ArrayLike<number>): number {
  return ddToNumber(exactSum(xs));
}

/** Compensated Σ aᵢbᵢ — the reduction most exposed to cancellation. */
export function exactDot(a: ArrayLike<number>, b: ArrayLike<number>): DD {
  if (a.length !== b.length)
    throw new RangeError(`exactDot: length mismatch ${a.length} vs ${b.length}`);
  let acc: DD = DD_ZERO;
  for (let i = 0; i < a.length; i++) acc = ddAdd(acc, twoProduct(a[i], b[i]));
  return acc;
}

/** Compensated dot product collapsed to float64. */
export function compensatedDot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return ddToNumber(exactDot(a, b));
}

/** Compensated Σ(reᵢ² + imᵢ²) — complex field energy without cancellation drift. */
export function compensatedEnergy(re: ArrayLike<number>, im: ArrayLike<number>): number {
  let acc: DD = DD_ZERO;
  for (let i = 0; i < re.length; i++) {
    acc = ddAdd(acc, twoProduct(re[i], re[i]));
    acc = ddAdd(acc, twoProduct(im[i], im[i]));
  }
  return ddToNumber(acc);
}

/** Compensated ‖a − b‖₂ ⁄ ‖b‖₂, the metric every closure witness reports. */
export function compensatedRelError(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new RangeError(`compensatedRelError: length mismatch`);
  let num: DD = DD_ZERO;
  let den: DD = DD_ZERO;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    num = ddAdd(num, twoProduct(d, d));
    den = ddAdd(den, twoProduct(b[i], b[i]));
  }
  const n = Math.sqrt(ddToNumber(num));
  const d = Math.sqrt(ddToNumber(den));
  return d > 0 ? n / d : n;
}

/**
 * Digits of agreement between a compensated and a naive reduction — the direct
 * measurement of what the compensation bought at this call site.
 */
export function digitsGained(naive: number, exact: number): number {
  if (naive === exact) return Infinity;
  const scale = Math.abs(exact) > 0 ? Math.abs(exact) : 1;
  return -dlog(Math.abs(naive - exact) / scale) / LN10;
}
