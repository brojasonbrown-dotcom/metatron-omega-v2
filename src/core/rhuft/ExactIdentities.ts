/**
 * RHUFT — EXACT IDENTITY BANK (60 significant digits, BigInt fixed point)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Stage 6 of the Absolute plan: cross-check every φ-identity the engine
 * leans on at a precision far beyond float64, so a claim can never pass
 * because of rounding.
 *
 * Arithmetic is fixed point on BigInt with a 70-digit scale (10 guard
 * digits below the 60 we report). √5 is computed by integer Newton
 * iteration, so φ = (1+√5)/2 is exact to the last guard digit.
 *
 * Every identity returns:
 *   • `residual`   — |lhs − rhs| as a decimal string (60 digits)
 *   • `exact`      — residual is at or below one unit in the 60th digit
 *   • `cls`        — A (proven exact), B (numerical coincidence), C (failed)
 *
 * A "coincidence" identity (α⁻¹, T_CMB) is NOT expected to be exact; it
 * reports its relative miss in ppm and is classified B or C accordingly.
 * The bank never upgrades a coincidence to a derivation.
 *
 * Pure module: no engine imports, no I/O, evaluated lazily and cached.
 */

export type IdentityClass = 'A' | 'B' | 'C';

/** Guard scale: 90 decimal places (30 guard digits below the 60 reported). */
const DIGITS = 90;
/** Reported precision. */
export const REPORT_DIGITS = 60;
const S = 10n ** BigInt(DIGITS);
/** One unit in the last reported digit. */
const ULP = 10n ** BigInt(DIGITS - REPORT_DIGITS);

const mul = (a: bigint, b: bigint): bigint => (a * b) / S;
const div = (a: bigint, b: bigint): bigint => (a * S) / b;
const abs = (a: bigint): bigint => (a < 0n ? -a : a);

/** Integer square root (Newton, exact floor). */
function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('isqrt: negative');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** √v for a fixed-point v. */
function fsqrt(v: bigint): bigint {
  return isqrt(v * S);
}

function fpow(base: bigint, n: number): bigint {
  let r = S;
  let b = base;
  let e = Math.abs(n);
  while (e > 0) {
    if (e & 1) r = mul(r, b);
    b = mul(b, b);
    e >>= 1;
  }
  return n < 0 ? div(S, r) : r;
}

/** Render a fixed-point value with `places` decimals (truncating guards). */
function fmt(v: bigint, places = REPORT_DIGITS): string {
  const neg = v < 0n;
  const a = abs(v);
  const whole = a / S;
  const frac = (a % S).toString().padStart(DIGITS, '0').slice(0, places);
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** Shortest scientific rendering for tiny residuals. */
function fmtCompact(v: bigint): string {
  if (v === 0n) return '0';
  const a = abs(v);
  const s = a.toString().padStart(DIGITS + 1, '0');
  const whole = s.slice(0, s.length - DIGITS);
  const frac = s.slice(s.length - DIGITS);
  if (whole !== '0'.repeat(whole.length)) return fmt(v, 20);
  let lead = 0;
  while (lead < frac.length && frac[lead] === '0') lead++;
  if (lead >= frac.length) return '0';
  const mantissa = frac.slice(lead, lead + 6);
  return `${v < 0n ? '-' : ''}${mantissa[0]}.${mantissa.slice(1)}e-${lead + 1}`;
}

// ───────────────────────── exact constants ─────────────────────────

/** √5 to 70 places. */
export const SQRT5_FP: bigint = fsqrt(5n * S);
/** φ = (1+√5)/2 to 70 places. */
export const PHI_FP: bigint = (S + SQRT5_FP) / 2n;
/** ψ = −1/φ = (1−√5)/2. */
export const PSI_FP: bigint = (S - SQRT5_FP) / 2n;

/** φ to 60 reported digits, as a string. */
export const PHI_60 = fmt(PHI_FP);
export const SQRT5_60 = fmt(SQRT5_FP);

// ───────────────────────── integer Lucas / Fibonacci ─────────────────────────

/** Exact Lucas numbers via BigInt recurrence. */
export function lucasBig(n: number): bigint {
  let a = 2n,
    b = 1n;
  for (let i = 0; i < n; i++) {
    const t = a + b;
    a = b;
    b = t;
  }
  return a;
}
/** Exact Fibonacci numbers via BigInt recurrence. */
export function fibBig(n: number): bigint {
  let a = 0n,
    b = 1n;
  for (let i = 0; i < n; i++) {
    const t = a + b;
    a = b;
    b = t;
  }
  return a;
}

// ───────────────────────── identity records ─────────────────────────

export interface IdentityCheck {
  readonly id: string;
  readonly statement: string;
  readonly lhs: string;
  readonly rhs: string;
  /** |lhs − rhs| rendered compactly. */
  readonly residual: string;
  /** Relative miss in parts per million (0 for exact identities). */
  readonly ppm: number;
  readonly exact: boolean;
  readonly cls: IdentityClass;
  readonly note?: string;
}

function exactCheck(
  id: string,
  statement: string,
  lhs: bigint,
  rhs: bigint,
  note?: string,
): IdentityCheck {
  const r = abs(lhs - rhs);
  const exact = r <= ULP;
  const denom = abs(rhs) > 0n ? abs(rhs) : S;
  const ppm = Number((r * 1_000_000n * 1_000_000n) / denom) / 1e6;
  return {
    id,
    statement,
    lhs: fmt(lhs, 40),
    rhs: fmt(rhs, 40),
    residual: fmtCompact(lhs - rhs),
    ppm,
    exact,
    cls: exact ? 'A' : 'C',
    note,
  };
}

function coincidence(
  id: string,
  statement: string,
  lhs: bigint,
  rhs: bigint,
  ppmTolerance: number,
  note?: string,
): IdentityCheck {
  const r = abs(lhs - rhs);
  const denom = abs(rhs) > 0n ? abs(rhs) : S;
  const ppm = Number((r * 1_000_000n * 1_000_000n) / denom) / 1e6;
  return {
    id,
    statement,
    lhs: fmt(lhs, 30),
    rhs: fmt(rhs, 30),
    residual: fmtCompact(lhs - rhs),
    ppm,
    exact: false,
    cls: ppm <= ppmTolerance ? 'B' : 'C',
    note,
  };
}

/** Decimal literal → fixed point (string form keeps every digit given). */
function lit(s: string): bigint {
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [w, f = ''] = body.split('.');
  const frac = (f + '0'.repeat(DIGITS)).slice(0, DIGITS);
  const v = BigInt(w) * S + BigInt(frac);
  return neg ? -v : v;
}

let _bank: readonly IdentityCheck[] | null = null;

/** Run (once) and cache the full 60-digit identity bank. */
export function identityBank(): readonly IdentityCheck[] {
  if (_bank) return _bank;
  const phi = PHI_FP;
  const out: IdentityCheck[] = [];

  // ── A: the defining ring relations ──
  out.push(exactCheck('phi2', 'φ² = φ + 1', mul(phi, phi), phi + S));
  out.push(exactCheck('phi3', 'φ³ = 2φ + 1', fpow(phi, 3), 2n * phi + S));
  out.push(exactCheck('phi4', 'φ⁴ = 3φ + 2', fpow(phi, 4), 3n * phi + 2n * S));
  out.push(exactCheck('phiinv', 'φ⁻¹ = φ − 1', div(S, phi), phi - S));
  out.push(
    exactCheck(
      'phisum',
      'φ⁻¹ + φ⁻² = 1',
      div(S, phi) + fpow(phi, -2),
      S,
      'the closure identity every rung damping leans on',
    ),
  );
  out.push(exactCheck('sqrt5', '√5 = 2φ − 1', SQRT5_FP, 2n * phi - S));
  out.push(exactCheck('psi', 'ψ = −1/φ  (ψ = (1−√5)/2)', PSI_FP, -div(S, phi)));

  // ── A: Binet / Lucas closed forms at the ladder's working indices ──
  for (const n of [13, 21, 28, 55]) {
    out.push(
      exactCheck(
        `lucas${n}`,
        `L_${n} = φ^${n} + ψ^${n}`,
        fpow(phi, n) + fpow(PSI_FP, n),
        lucasBig(n) * S,
        'Lucas closure oracle — integer target',
      ),
    );
  }
  for (const n of [13, 55]) {
    out.push(
      exactCheck(
        `binet${n}`,
        `F_${n} = (φ^${n} − ψ^${n})/√5`,
        div(fpow(phi, n) - fpow(PSI_FP, n), SQRT5_FP),
        fibBig(n) * S,
      ),
    );
  }

  // ── A: golden-angle and geometric identities used by the eigensolvers ──
  out.push(
    exactCheck(
      'goldenangle',
      '360/φ² = 720 − 360φ  (golden angle, degrees)',
      div(lit('360'), mul(phi, phi)),
      lit('720') - mul(lit('360'), phi),
      'closed form of the spiral operator’s generator — exact, not a decimal literal',
    ),
  );

  // ── B/C: numerical coincidences, never derivations ──
  out.push(
    coincidence(
      'alphaInv',
      '360/φ² − 2/φ³  vs  α⁻¹ = 137.035999177',
      div(lit('360'), mul(phi, phi)) - div(2n * S, fpow(phi, 3)),
      lit('137.035999177'),
      10,
      'CODATA 2022 α⁻¹; a few-ppm coincidence, NOT a derivation',
    ),
  );
  out.push(
    coincidence(
      'alphaClaim',
      'corpus claim α⁻¹ = 13φ/√13 + 1/2',
      div(mul(lit('13'), phi), fsqrt(lit('13'))) + S / 2n,
      lit('137.035999177'),
      10,
      'fails by orders of magnitude — recorded so the claim cannot resurface',
    ),
  );

  _bank = Object.freeze(out);
  return _bank;
}

export interface IdentityBankSummary {
  readonly total: number;
  readonly exactPassed: number;
  readonly exactFailed: number;
  readonly coincidences: number;
  readonly failures: readonly string[];
  readonly digits: number;
  readonly phi: string;
  readonly sqrt5: string;
}

export function identityBankSummary(): IdentityBankSummary {
  const bank = identityBank();
  const exactOnes = bank.filter(
    (b) => b.cls !== 'B' && b.id !== 'alphaClaim' && b.id !== 'alphaInv',
  );
  const failures = bank.filter((b) => b.cls === 'C').map((b) => b.id);
  return {
    total: bank.length,
    exactPassed: exactOnes.filter((b) => b.exact).length,
    exactFailed: exactOnes.filter((b) => !b.exact).length,
    coincidences: bank.filter((b) => b.cls === 'B').length,
    failures,
    digits: REPORT_DIGITS,
    phi: PHI_60,
    sqrt5: SQRT5_60,
  };
}
