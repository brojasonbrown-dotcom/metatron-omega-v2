/**
 * RHUFT — LUCAS CLOSURE THEORY
 * ════════════════════════════
 * The exact arithmetic behind the framework's central *proven* result:
 *
 *   φⁿ = Lₙ − ψⁿ           (Binet / Pisot identity, ψ = (1−√5)/2)
 *
 * Consequences, all Class A (exact, machine- and symbolically verified):
 *
 *  1. The 13-fold toroidal closure defect at rung n is EXACTLY |ψ|ⁿ.
 *     At the Metatron shell n = 13 this is 1.9194×10⁻³ (0.19%) — the
 *     "harmonic gap" the source corpus postulated is a theorem here.
 *
 *  2. Exact closure is IMPOSSIBLE: 13 ∤ Lₙ for every n. The Lucas
 *     sequence mod 13 is periodic with period 28 and its cycle contains
 *     no zero. Verified exhaustively at construction.
 *
 *  3. Maximally stable (minimally open) rungs are those with residue 1,
 *     i.e. Lₙ ≡ ±1 (mod 13), which happens exactly for
 *     n ≡ 1, 13, 15, 27 (mod 28)  →  1, 13, 15, 27, 29, 41, 43, 55, 57, …
 *   (the source corpus lists {1, 13, 15}; recomputation adds 27 — verified
 *    over four full periods by `proveClosure`.)
 *     The gap pattern alternates 12, 2 — a double-heartbeat.
 *
 *  4. Boundary flux at harmonic n is κ·φ⁻ⁿ with κ = φ; the exact identity
 *     flux(13) = φ⁻²⁶ = 3.6840146919005873×10⁻⁶.
 *
 * This module is PURE: BigInt-exact integer arithmetic, memoized, zero
 * side effects, no engine imports. It is the closure oracle every other
 * RHUFT surface consults instead of hardcoding "13" anywhere.
 */

export const CLOSURE_MODULUS = 13;
/** Period of the Lucas sequence modulo 13 (Pisano-type period). */
export const LUCAS_MOD13_PERIOD = 28;

/** φ and its conjugate ψ, to full float64 precision. */
export const PHI_EXACT = 1.618033988749894848204586834365638117720;
export const PSI_EXACT = -0.618033988749894848204586834365638117720;

// ───────────────────────── exact integer sequences ─────────────────────────

const _lucas: bigint[] = [2n, 1n];
const _fib: bigint[] = [0n, 1n];

/** Exact Lucas number Lₙ (n ≥ 0). Memoized, BigInt — never lossy. */
export function lucas(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`lucas: n=${n} must be a non-negative integer`);
  while (_lucas.length <= n) _lucas.push(_lucas[_lucas.length - 1] + _lucas[_lucas.length - 2]);
  return _lucas[n];
}

/** Exact Fibonacci number Fₙ (n ≥ 0). Memoized, BigInt. */
export function fib(n: number): bigint {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`fib: n=${n} must be a non-negative integer`);
  while (_fib.length <= n) _fib.push(_fib[_fib.length - 1] + _fib[_fib.length - 2]);
  return _fib[n];
}

// ───────────────────────── closure residues ─────────────────────────

/** Raw residue Lₙ mod 13 ∈ [0, 12]. Never 0 (theorem 2). */
export function lucasMod13(n: number): number {
  return Number(lucas(n % LUCAS_MOD13_PERIOD) % BigInt(CLOSURE_MODULUS));
}

/**
 * Closure residue r(n) = min(Lₙ mod 13, 13 − Lₙ mod 13) ∈ [1, 6].
 * The *openness* of the 13-fold winding at rung n. r = 1 is maximal
 * stability; r = 6 is maximal frustration.
 */
export function closureResidue(n: number): number {
  const m = lucasMod13(n);
  return Math.min(m, CLOSURE_MODULUS - m);
}

/** True when rung n is Lucas-stable: r(n) = 1 ⇔ n ≡ 1, 13, 15, 27 (mod 28). */
export function isLucasStable(n: number): boolean {
  return closureResidue(n) === 1;
}

/** Normalised stability ∈ (0,1]: 1 at r=1, decaying φ-geometrically with r. */
export function closureStability(n: number): number {
  return Math.pow(1 / PHI_EXACT, closureResidue(n) - 1);
}

/**
 * Pisot closure defect |φⁿ − Lₙ| = |ψ|ⁿ. Exact in the limit of float64;
 * this is the irreducible gap Δ_gap the framework identifies with
 * inertia / uncertainty / entropy.
 */
export function pisotDefect(n: number): number {
  return Math.pow(Math.abs(PSI_EXACT), n);
}

/** Boundary flux at harmonic n: κφ⁻ⁿ with κ = φ, i.e. φ^(1−n)... */
export function boundaryFlux(n: number, kappa = PHI_EXACT): number {
  return kappa * Math.pow(PHI_EXACT, -n);
}

/**
 * The appendix validator flux: |κ · φ^(-2n)| with κ = φ⁻¹³·φ¹³ normalisation.
 * Yields the exact identity flux(13) = φ⁻²⁶ = 3.6840146919005873e-6.
 */
export function validatorFlux(n: number): number {
  return Math.pow(PHI_EXACT, -2 * n);
}

export const FLUX_13_EXACT = Math.pow(PHI_EXACT, -26);

/** Stable rungs ≤ nMax, in ascending order. */
export function stableRungs(nMax: number): number[] {
  const out: number[] = [];
  for (let n = 0; n <= nMax; n++) if (isLucasStable(n)) out.push(n);
  return out;
}

export interface ClosureRecord {
  readonly n: number;
  readonly lucasMod: number;
  readonly residue: number;
  readonly stable: boolean;
  readonly stability: number;
  readonly defect: number;
  readonly flux: number;
}

export function closureRecord(n: number): ClosureRecord {
  const lucasMod = lucasMod13(n);
  const residue = Math.min(lucasMod, CLOSURE_MODULUS - lucasMod);
  return {
    n,
    lucasMod,
    residue,
    stable: residue === 1,
    stability: Math.pow(1 / PHI_EXACT, residue - 1),
    defect: pisotDefect(n),
    flux: validatorFlux(n),
  };
}

/** The full 28-term residue cycle — the closure fingerprint of the theory. */
export const RESIDUE_CYCLE: readonly number[] = Object.freeze(
  Array.from({ length: LUCAS_MOD13_PERIOD }, (_, i) => closureResidue(i)),
);

// ───────────────────────── self-check (Class A gate) ─────────────────────────

export interface ClosureProof {
  readonly periodConfirmed: boolean;
  readonly noZeroResidue: boolean;
  readonly stableCongruence: boolean;
  readonly flux13Exact: boolean;
  readonly l13: string;
  readonly valid: boolean;
}

/**
 * Recomputes every claim this module rests on. Cheap (O(period)) and pure,
 * so callers can gate on it at runtime rather than trusting a comment.
 */
export function proveClosure(): ClosureProof {
  // period 28: L(n+28) ≡ L(n) (mod 13) for a full extra cycle
  let periodConfirmed = true;
  for (let n = 0; n < LUCAS_MOD13_PERIOD * 2; n++) {
    const a = Number(lucas(n) % 13n);
    const b = Number(lucas(n + LUCAS_MOD13_PERIOD) % 13n);
    if (a !== b) { periodConfirmed = false; break; }
  }
  // no zero in the cycle ⇒ 13 never divides a Lucas number
  let noZeroResidue = true;
  for (let n = 0; n < LUCAS_MOD13_PERIOD; n++) {
    if (Number(lucas(n) % 13n) === 0) { noZeroResidue = false; break; }
  }
  // stable set is exactly n ≡ 1, 13, 15, 27 (mod 28)
  let stableCongruence = true;
  for (let n = 0; n < LUCAS_MOD13_PERIOD * 4; n++) {
    const m = n % LUCAS_MOD13_PERIOD;
    const expected = m === 1 || m === 13 || m === 15 || m === 27;
    if (isLucasStable(n) !== expected) { stableCongruence = false; break; }
  }
  const flux13Exact = Math.abs(validatorFlux(13) - 3.6840146919005873e-6) < 1e-20;

  return {
    periodConfirmed,
    noZeroResidue,
    stableCongruence,
    flux13Exact,
    l13: lucas(13).toString(),
    valid: periodConfirmed && noZeroResidue && stableCongruence && flux13Exact && lucas(13) === 521n,
  };
}

/** Module-load assertion — a broken closure oracle must fail loudly. */
const _proof = proveClosure();
if (!_proof.valid) {
  throw new Error(`LucasClosure: closure proof failed ${JSON.stringify(_proof)}`);
}
export const CLOSURE_PROOF: ClosureProof = Object.freeze(_proof);
