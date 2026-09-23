/**
 * Residue fingerprints — the rigorous half of "gematria".
 *
 * THE ONE LAW: a digit pattern is data; a digit *meaning* is numerology.
 * We compute and report the former and never assert the latter. Every
 * reported coincidence carries a null-model p-value.
 *
 * Theorem (base-b digital root): dr_b(n) = ((n−1) mod (b−1)) + 1 ≡ n (mod b−1).
 * So the multi-base digital-root vector is exactly the residue fingerprint of
 * n across the moduli (b−1). By CRT it identifies n uniquely below
 * lcm(b₁−1, b₂−1, …) — a reversible hash, not a mystical one.
 */

/** Bases used for the canonical fingerprint. b−1 = 1,2,6,9,11,15,35,59. */
export const FINGERPRINT_BASES = [2, 3, 7, 10, 12, 16, 36, 60] as const;

/** dr_b(n) for n ≥ 1. dr_b(0) = 0. */
export function digitalRoot(n: number, base = 10): number {
  if (base < 2) throw new RangeError('digitalRoot: base ≥ 2');
  const m = Math.abs(Math.trunc(n));
  if (m === 0) return 0;
  if (base === 2) return 1;
  return ((m - 1) % (base - 1)) + 1;
}

/** Digits of n in base b, most-significant first. */
export function digits(n: number, base = 10): number[] {
  let m = Math.abs(Math.trunc(n));
  if (m === 0) return [0];
  const out: number[] = [];
  while (m > 0) { out.push(m % base); m = Math.floor(m / base); }
  return out.reverse();
}

/** One digit-sum step in base b. */
export function digitSum(n: number, base = 10): number {
  return digits(n, base).reduce((a, d) => a + d, 0);
}


export interface Fingerprint {
  readonly n: number;
  /** dr_b for each base in FINGERPRINT_BASES. */
  readonly roots: number[];
  /** Compact canonical key, e.g. "1-2-5-8-3-1-30-11". */
  readonly key: string;
}

export function fingerprint(n: number, bases: readonly number[] = FINGERPRINT_BASES): Fingerprint {
  const roots = bases.map((b) => digitalRoot(n, b));
  return { n, roots, key: roots.join('-') };
}

function gcd(a: number, b: number): number { return b === 0 ? a : gcd(b, a % b); }

/** lcm of (b−1) over the fingerprint bases — the CRT uniqueness modulus. */
export function crtModulus(bases: readonly number[] = FINGERPRINT_BASES): number {
  return bases.reduce((m, b) => (m / gcd(m, b - 1)) * (b - 1), 1);
}

/**
 * Honest collision statistic. Under a uniform null, the chance that two
 * distinct integers share a fingerprint is 1/M with M = crtModulus. For
 * `observed` collisions among `pairs` comparisons the expected count is
 * pairs/M; we return a Poisson upper-tail p-value.
 */
export function collisionPValue(observed: number, pairs: number, modulus = crtModulus()): number {
  const lambda = pairs / modulus;
  if (observed <= 0) return 1;
  // P(X ≥ observed) = 1 − Σ_{k<observed} e^{−λ} λᵏ / k!
  let term = Math.exp(-lambda);
  let cum = term;
  for (let k = 1; k < observed; k++) { term = (term * lambda) / k; cum += term; }
  return Math.max(0, Math.min(1, 1 - cum));
}
