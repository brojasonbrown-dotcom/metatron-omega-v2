/**
 * dmath — the deterministic transcendental bank.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * ECMAScript leaves `Math.sin`, `Math.cos`, `Math.exp`, `Math.log`, `Math.pow`,
 * `Math.hypot`, `Math.atan2` and friends *implementation-approximated*: the spec
 * only asks for "an implementation-approximated value". V8 and JavaScriptCore
 * genuinely disagree in the last ulp, and that is enough to move a 1000-tick
 * state hash. An engine whose Law is bit-exact determinism therefore cannot
 * call them on any path that reaches state.
 *
 * Everything below is built from IEEE-754 operations that ARE exactly specified:
 * `+  -  *  /  Math.sqrt  Math.abs  Math.floor` and bit-level reinterpretation.
 * Two conforming engines must produce identical bits for identical inputs.
 *
 * Accuracy target is <= 2 ulp relative on the domains the engine uses; the
 * accompanying gate (test/s6-dmath.test.ts) measures it against the host libm
 * rather than assuming it.
 */

/* ── exactly representable splits (Cody–Waite) ────────────────────────────── */

const PI_HI = 3.141592653589793; // double(π)
const PI_LO = 1.2246467991473532e-16; // π − double(π)
const TWO_PI_HI = 6.283185307179586;
const TWO_PI_LO = 2.4492935982947064e-16;
const HALF_PI = 1.5707963267948966;

/** π/2 split into 33-bit chunks (fdlibm) — keeps range reduction exact. */
const PIO2_1 = 1.5707963267341256;
const PIO2_2 = 6.077100506303966e-11;
const PIO2_3 = 2.0222662487116645e-21;
const PIO2_3T = 8.478427660368898e-32;

const LN2_HI = 0.6931471803691238; // upper 32 bits of ln2
const LN2_LO = 1.9082149292705877e-10; // ln2 − LN2_HI
const LOG2E = 1.4426950408889634;

const scratch = new DataView(new ArrayBuffer(8));

/** Exact 2^k for integer k in [-1074, 1023], built from the exponent field. */
export function pow2i(k: number): number {
  if (k >= 1024) return Number.POSITIVE_INFINITY;
  if (k >= -1022) {
    scratch.setBigUint64(0, BigInt(k + 1023) << 52n);
    return scratch.getFloat64(0);
  }
  // subnormal range: build 2^-1022 then halve exactly
  scratch.setBigUint64(0, 1n << 52n);
  let v = scratch.getFloat64(0);
  for (let i = -1022; i > k; i--) v *= 0.5;
  return v;
}

/** Split a finite positive x into mantissa m ∈ [1,2) and exponent e (x = m·2^e). */
function frexp2(x: number): { m: number; e: number } {
  scratch.setFloat64(0, x);
  const bits = scratch.getBigUint64(0);
  let e = Number((bits >> 52n) & 0x7ffn);
  if (e === 0) {
    // subnormal — normalise by an exact power of two
    const scaled = x * 18014398509481984; // 2^54
    scratch.setFloat64(0, scaled);
    const b2 = scratch.getBigUint64(0);
    e = Number((b2 >> 52n) & 0x7ffn) - 54;
    scratch.setBigUint64(0, (b2 & 0x000fffffffffffffn) | (1023n << 52n));
    return { m: scratch.getFloat64(0), e: e - 1023 };
  }
  scratch.setBigUint64(0, (bits & 0x000fffffffffffffn) | (1023n << 52n));
  return { m: scratch.getFloat64(0), e: e - 1023 };
}

/* ── series coefficient banks (built once, from exact integer factorials) ── */

/** 1/(2j+1)! for j = 0..8 — the odd (sine) series. */
const SIN_C = (() => {
  const c: number[] = [];
  let f = 1;
  for (let j = 0; j <= 8; j++) {
    const k = 2 * j + 1;
    if (j > 0) f = f * (k - 1) * k;
    c.push((j % 2 === 0 ? 1 : -1) / f);
  }
  return c;
})();

/** 1/(2j)! for j = 0..8 — the even (cosine) series. */
const COS_C = (() => {
  const c: number[] = [];
  let f = 1;
  for (let j = 0; j <= 8; j++) {
    const k = 2 * j;
    if (j > 0) f = f * (k - 1) * k;
    c.push((j % 2 === 0 ? 1 : -1) / f);
  }
  return c;
})();

/** 1/k! for k = 0..17 — the exponential series. */
const EXP_C = (() => {
  const c: number[] = [];
  let f = 1;
  for (let k = 0; k <= 17; k++) {
    if (k > 0) f *= k;
    c.push(1 / f);
  }
  return c;
})();

/** 1/(2j+1) for j = 0..N — the atanh/atan series. */
function oddRecip(n: number): number[] {
  const c: number[] = [];
  for (let j = 0; j <= n; j++) c.push(1 / (2 * j + 1));
  return c;
}
const ATANH_C = oddRecip(12);
/** alternating 1/(2j+1) for atan. */
const ATAN_C = oddRecip(22).map((v, j) => (j % 2 === 0 ? v : -v));

/** Horner over an even-power polynomial: Σ c_j z^j, fixed index order. */
function horner(c: readonly number[], z: number): number {
  let s = c[c.length - 1];
  for (let j = c.length - 2; j >= 0; j--) s = c[j] + z * s;
  return s;
}

/* ── sin / cos ────────────────────────────────────────────────────────────── */

/** Taylor kernel for sin on |r| <= π/4. */
function sinKernel(r: number): number {
  const z = r * r;
  return r * horner(SIN_C, z);
}

/** Taylor kernel for cos on |r| <= π/4. */
function cosKernel(r: number): number {
  const z = r * r;
  return horner(COS_C, z);
}

/**
 * Range reduction: x = k·(π/2) + r with |r| <= π/4, using a two-word π/2 so the
 * reduction stays accurate for the magnitudes the engine uses (|x| < 2^30).
 */
function reduceQuadrant(x: number): { k: number; r: number } {
  const kf = Math.floor(x * (2 / PI_HI) + 0.5);
  // fdlibm-style chunked π/2: each chunk holds 33 mantissa bits, so kf·chunk is
  // exact for |kf| < 2^20 and the residual keeps full precision out to |x| ~ 1e6.
  let r = x - kf * PIO2_1;
  r -= kf * PIO2_2;
  r -= kf * PIO2_3;
  r -= kf * PIO2_3T;
  let k = kf - Math.floor(kf / 4) * 4; // k mod 4, exact for |kf| < 2^52
  if (k < 0) k += 4;
  return { k, r };
}

export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (x === 0) return x; // preserves -0
  const { k, r } = reduceQuadrant(x);
  switch (k) {
    case 0:
      return sinKernel(r);
    case 1:
      return cosKernel(r);
    case 2:
      return -sinKernel(r);
    default:
      return -cosKernel(r);
  }
}

export function dcos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const { k, r } = reduceQuadrant(x);
  switch (k) {
    case 0:
      return cosKernel(r);
    case 1:
      return -sinKernel(r);
    case 2:
      return -cosKernel(r);
    default:
      return sinKernel(r);
  }
}

/* ── exp / log ────────────────────────────────────────────────────────────── */

export function dexp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.782712893384) return Number.POSITIVE_INFINITY;
  if (x < -745.1332191019411) return 0;
  const k = Math.floor(x * LOG2E + 0.5);
  const r = x - k * LN2_HI - k * LN2_LO;
  let s = EXP_C[EXP_C.length - 1];
  for (let j = EXP_C.length - 2; j >= 0; j--) s = EXP_C[j] + r * s;
  return s * pow2i(k);
}

export function dlog(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return Number.NEGATIVE_INFINITY;
  if (!Number.isFinite(x)) return x;
  let { m, e } = frexp2(x);
  if (m > 1.4142135623730951) {
    m *= 0.5;
    e += 1;
  }
  // atanh series in s = (m-1)/(m+1), |s| <= 0.1716
  const s = (m - 1) / (m + 1);
  const z = s * s;
  return 2 * s * horner(ATANH_C, z) + e * LN2_HI + e * LN2_LO;
}

export function dlog1p(x: number): number {
  if (x > -0.25 && x < 0.5) {
    const s = x / (2 + x);
    const z = s * s;
    return 2 * s * horner(ATANH_C, z);
  }
  return dlog(1 + x);
}

/* ── pow ──────────────────────────────────────────────────────────────────── */

/** Exact-as-possible integer power by binary exponentiation. */
export function dpowi(base: number, n: number): number {
  let e = Math.abs(n | 0);
  let b = base;
  let acc = 1;
  while (e > 0) {
    if (e & 1) acc *= b;
    b *= b;
    e >>= 1;
  }
  return n < 0 ? 1 / acc : acc;
}

/**
 * Deterministic pow. Integer exponents take the exact binary-exponentiation
 * path (this is what the φ ladder uses); everything else goes through
 * exp(y·log x), split so the product y·log x keeps its low word.
 */
export function dpow(x: number, y: number): number {
  if (y === 0) return 1;
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (Number.isInteger(y) && Math.abs(y) <= 1024) return dpowi(x, y);
  if (x === 0) return y > 0 ? 0 : Number.POSITIVE_INFINITY;
  if (x < 0) return NaN; // non-integer power of a negative base
  // two-word split of log x so the multiply by y does not shed the tail
  const l = dlog(x);
  const lh = splitHi(l);
  const ll = l - lh;
  const yh = splitHi(y);
  const yl = y - yh;
  const p = yh * lh;
  const q = yh * ll + yl * lh + yl * ll;
  return dexp(p) * dexp(q);
}

/** Drop the low 26 bits of the mantissa — exact, used for two-word products. */
function splitHi(v: number): number {
  const big = v * 134217729; // 2^27 + 1
  return big - (big - v);
}

/* ── inverse trig / hyperbolic ────────────────────────────────────────────── */

/** atan on the whole real line, via the |t| <= tan(π/12) core and identities. */
export function datan(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const sign = x < 0 ? -1 : 1;
  let t = Math.abs(x);
  if (!Number.isFinite(t)) return sign * HALF_PI;
  let offset = 0;
  if (t > 1) {
    t = 1 / t;
    offset = HALF_PI;
  }
  const flip = offset !== 0 ? -1 : 1;
  if (t > 0.2679491924311227) {
    // tan(π/12): fold with atan(t) = π/6 + atan((t·√3 − 1)/(t + √3))
    const SQ3 = 1.7320508075688772;
    const t2 = (t * SQ3 - 1) / (t + SQ3);
    const core = atanCore(t2) + 0.5235987755982988;
    return sign * (offset + flip * core);
  }
  return sign * (offset + flip * atanCore(t));
}

function atanCore(t: number): number {
  const z = t * t;
  return t * horner(ATAN_C, z);
}

export function datan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI_HI : datan(y / x) - PI_HI;
  return y > 0 ? HALF_PI : -HALF_PI;
}

export function dacos(x: number): number {
  if (x >= 1) return 0;
  if (x <= -1) return PI_HI + PI_LO;
  return datan2(Math.sqrt(1 - x * x), x);
}

export function dasin(x: number): number {
  if (x >= 1) return HALF_PI;
  if (x <= -1) return -HALF_PI;
  return datan2(x, Math.sqrt(1 - x * x));
}

export function datanh(x: number): number {
  if (x >= 1) return Number.POSITIVE_INFINITY;
  if (x <= -1) return Number.NEGATIVE_INFINITY;
  return 0.5 * dlog1p((2 * x) / (1 - x));
}

export function dtanh(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return -1;
  const e = dexp(2 * x);
  return (e - 1) / (e + 1);
}

/** |a + bi| without the implementation-defined Math.hypot. */
export function dmag(a: number, b: number): number {
  return Math.sqrt(a * a + b * b);
}
