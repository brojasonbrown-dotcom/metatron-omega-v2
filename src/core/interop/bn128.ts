/**
 * Ω-READY R3 — BigNum128 fixed point: a faithful port of the host merge law.
 *
 * The host (RAFFY U v16) forbids runtime floats in scoring. Every coherence,
 * trust multiplier and merge result is a `BigNum128` — a u128 read as a
 * 10^18-scaled real — and substrates are fused by a **φ-weighted geometric
 * mean** computed through fixed-point base-2 log/exp in Q60
 * (`deploy/rust-api/src/memory_orchestrator/merge.rs`).
 *
 * This file reproduces that arithmetic operation-for-operation in BigInt, so an
 * Ω-produced merge and a host-produced merge are the SAME INTEGER, not "close".
 * Corrections against an earlier draft of this layer, recorded because they
 * matter:
 *
 *   • The host scale is 10^18 decimal, NOT 2^60. Q60 appears only inside
 *     log2/exp2 as the intermediate representation.
 *   • The fusion is a weighted GEOMETRIC mean, not an arithmetic one. A
 *     geometric mean is zero if any substrate is zero — that fail-closed
 *     behaviour is the whole point and must not be softened.
 *   • u128/i128 arithmetic saturates in Rust. Saturation is emulated here;
 *     BigInt would otherwise silently exceed the host's representable range and
 *     produce a value the host can never reproduce.
 *
 * One faithful defect is carried deliberately: `exp2Fix` applies the fractional
 * factor as 2^(−frac) on BOTH branches, so the positive-exponent branch is
 * wrong in the host. It is unreachable for in-range inputs (values ≤ BN_ONE ⇒
 * log2 ≤ 0 ⇒ exponent ≤ 0), and diverging from the host here would break
 * bit-parity, which is the only property this module exists to provide.
 */

/** 10^18 — the host fixed-point scale. */
export const BN_ONE = 1_000_000_000_000_000_000n;
export const U128_MAX = (1n << 128n) - 1n;
export const I128_MAX = (1n << 127n) - 1n;
export const I128_MIN = -(1n << 127n);

/** A u128 interpreted as a 10^18-scaled real in [0, ∞). */
export type BigNum128 = bigint;

/** φ and its inverse powers, scaled by 10^18 — the exact host constants. */
export const PHI_SCALED = 1_618_033_988_749_894_848n;
export const PHI_INV_SCALED = 618_033_988_749_894_848n;
export const PHI_INV2_SCALED = 381_966_011_250_105_151n;
export const PHI_INV3_SCALED = 236_067_977_499_789_696n;

/** log2(10^18) · 2^60 — pre-computed host constant. */
const LOG2_ONE_Q60 = 68_938_602_072_359_301_496n;

const Q60 = 1n << 60n;

// ── saturating primitives ─────────────────────────────────────────────────

export function satMulU128(a: bigint, b: bigint): bigint {
  const r = a * b;
  return r > U128_MAX ? U128_MAX : r;
}

export function satDivU128(a: bigint, b: bigint): bigint {
  if (b === 0n) return U128_MAX; // Rust saturating_div on 0 panics; we clamp loudly high
  return a / b;
}

export function satI128(v: bigint): bigint {
  return v > I128_MAX ? I128_MAX : v < I128_MIN ? I128_MIN : v;
}

/** Rust i128 division truncates toward zero. BigInt `/` already does. */
export function satDivI128(a: bigint, b: bigint): bigint {
  if (b === 0n) return a >= 0n ? I128_MAX : I128_MIN;
  return satI128(a / b);
}

// ── conversions (display edge only) ───────────────────────────────────────

export function bnFromNumber(x: number): BigNum128 {
  if (!Number.isFinite(x)) throw new TypeError('bn128: non-finite input');
  if (x < 0) throw new RangeError('bn128: negative value is not representable');
  // Two-step so the 10^18 scaling keeps the full double mantissa.
  const whole = Math.floor(x);
  const frac = x - whole;
  return BigInt(whole) * BN_ONE + BigInt(Math.round(frac * 1e18));
}

export function bnToNumber(v: BigNum128): number {
  const whole = v / BN_ONE;
  const frac = v - whole * BN_ONE;
  return Number(whole) + Number(frac) / 1e18;
}

/** Exact decimal rendering — never lossy, for logs and evidence rows. */
export function bnToDecimalString(v: BigNum128): string {
  const whole = v / BN_ONE;
  const frac = v - whole * BN_ONE;
  return `${whole}.${frac.toString().padStart(18, '0')}`;
}

/** Clamp into the unit [0, BN_ONE]. */
export function bnClampUnit(v: BigNum128): BigNum128 {
  return v < 0n ? 0n : v > BN_ONE ? BN_ONE : v;
}

/** Host trust multipliers (T5 = 4×, T4 = 2×, T1–T3 = 1×, T0 = ½×). */
export type TrustLevel = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5';

export function trustTier(t: TrustLevel): number { return Number(t.slice(1)); }

export function trustScoreMultiplier(t: TrustLevel): BigNum128 {
  switch (t) {
    case 'T0': return BN_ONE / 2n;
    case 'T1': case 'T2': case 'T3': return BN_ONE;
    case 'T4': return BN_ONE * 2n;
    case 'T5': return BN_ONE * 4n;
  }
}

/** Host invalidation quorum per trust tier (T4 = 2-of-4, T5 = 3-of-4). */
export function trustInvalidationQuorum(t: TrustLevel): number {
  switch (t) {
    case 'T0': return 0;
    case 'T1': case 'T2': return 1;
    case 'T3': case 'T4': return 2;
    case 'T5': return 3;
  }
}

// ── Q60 log2 / exp2 (host algorithms, unchanged) ───────────────────────────

/** floor(log2(x)) for a positive BigInt. */
function floorLog2(x: bigint): bigint {
  let n = 0n;
  let v = x;
  while (v > 1n) { v >>= 1n; n++; }
  return n;
}

/** log2(x / BN_ONE) · 2^60, signed Q60. */
export function log2Fix(x: BigNum128): bigint {
  if (x === 0n) return -(60n << 60n);
  if (x === BN_ONE) return 0n;
  const b = floorLog2(x);
  if (b > 60n) throw new RangeError('bn128: log2Fix argument exceeds the host domain');
  let z = b << 60n;
  const shift = 60n - b;
  let r = x << shift;
  for (let i = 1n; i <= 60n; i++) {
    r = (r * r) >> 60n;
    if (r >= 1n << 61n) {
      r >>= 1n;
      z |= 1n << (60n - i);
    }
  }
  return z - LOG2_ONE_Q60;
}

/** Integer square root (floor), Newton's method — the host's `isqrt`. */
export function isqrt(n: bigint): bigint {
  if (n === 0n) return 0n;
  let x = n;
  let y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (x + n / x) >> 1n; }
  return x;
}

let EXP2_CONSTS: bigint[] | null = null;

/** 2^(−2^(i−60)) in Q60 for i = 0..59, built once, exactly as the host does. */
function exp2Constants(): bigint[] {
  if (EXP2_CONSTS) return EXP2_CONSTS;
  const arr = new Array<bigint>(60).fill(0n);
  arr[59] = isqrt(1n << 119n);
  for (let i = 58; i >= 0; i--) arr[i] = isqrt(arr[i + 1] << 60n);
  EXP2_CONSTS = arr;
  return arr;
}

/** 2^(−frac / 2^60) in Q60, frac ∈ [0, 2^60). */
export function exp2Frac(frac: bigint): bigint {
  const consts = exp2Constants();
  let val = Q60;
  for (let i = 0; i < 60; i++) {
    if (((frac >> BigInt(i)) & 1n) === 1n) val = (val * consts[i]) >> 60n;
  }
  return val;
}

/** 2^(e / 2^60) · BN_ONE, saturating — the host's `exp2_fix`, defect included. */
export function exp2Fix(e: bigint): BigNum128 {
  if (e >= 0n) {
    const n = e >> 60n;
    const frac = e & (Q60 - 1n);
    let val = exp2Frac(frac);
    if (n >= 60n) return U128_MAX;
    val <<= n;
    return satDivU128(satMulU128(val, BN_ONE) + (1n << 59n), Q60);
  }
  const eAbs = -e;
  const n = eAbs >> 60n;
  const frac = eAbs & (Q60 - 1n);
  let val = exp2Frac(frac);
  if (n >= 60n) return 0n;
  val >>= n;
  return satDivU128(satMulU128(val, BN_ONE), Q60);
}

// ── the merge law ──────────────────────────────────────────────────────────

export class MergeRangeError extends RangeError {}

/**
 * Weighted geometric mean of three BigNum128 values. Values must lie in
 * [0, BN_ONE]; any zero value collapses the merge to zero (fail-closed).
 */
export function weightedGeometricMean(
  values: readonly [BigNum128, BigNum128, BigNum128],
  weights: readonly [BigNum128, BigNum128, BigNum128],
): BigNum128 {
  for (const v of values) {
    if (v > BN_ONE) throw new MergeRangeError(`coherence out of range: ${v}`);
    if (v < 0n) throw new MergeRangeError(`coherence out of range: ${v}`);
  }
  if (values.some((v) => v === 0n)) return 0n;

  let acc = 0n;
  for (let i = 0; i < 3; i++) {
    const log = log2Fix(values[i]);
    const term = satDivI128(satI128(log * weights[i]), BN_ONE);
    acc = satI128(acc + term);
  }
  const totalWeight = weights[0] + weights[1] + weights[2];
  if (totalWeight === 0n) return 0n;
  const avg = satDivI128(satI128(acc * BN_ONE), totalWeight);
  return exp2Fix(avg);
}

/**
 * The three-substrate φ-weighted merge: brain (φ⁻¹), metatron (φ⁻²), rumf (φ⁻³),
 * each weight further scaled by that substrate's own coherence.
 */
export function phiWeightedGeometricMean(
  values: readonly [BigNum128, BigNum128, BigNum128],
): BigNum128 {
  const weights: [BigNum128, BigNum128, BigNum128] = [
    satDivU128(satMulU128(PHI_INV_SCALED, values[0]), BN_ONE),
    satDivU128(satMulU128(PHI_INV2_SCALED, values[1]), BN_ONE),
    satDivU128(satMulU128(PHI_INV3_SCALED, values[2]), BN_ONE),
  ];
  return weightedGeometricMean(values, weights);
}

/** Named substrate order, so a caller cannot silently transpose two wings. */
export interface SubstrateCoherence {
  readonly brain: BigNum128;
  readonly metatron: BigNum128;
  readonly rumf: BigNum128;
}

export function mergeSubstrates(c: SubstrateCoherence): BigNum128 {
  return phiWeightedGeometricMean([c.brain, c.metatron, c.rumf]);
}
