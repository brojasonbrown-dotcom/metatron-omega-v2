/**
 * Framework ⇄ Wave2 bank provenance lock.
 *
 * Module-load guard: every framework literal whose IEEE-754 value is bit-exact
 * with the high-precision Wave2 bank MUST stay in lock. Any future drift on
 * either side throws immediately, surfacing the desync before it can poison a
 * golden hash.
 *
 * This is provenance wiring only — no math path swap. All framework golden
 * hashes are therefore preserved bit-for-bit.
 *
 * Truncated literals (cannot be swapped without breaking V10 parity) are
 * handled separately under FLAG_F2_WAVE2_PRECISION and its per-framework
 * siblings, each gated by their own *.wave2.golden.json.
 */
import { WOLFRAM_BANK_WAVE2 } from './WolframBankWave2';

const B = WOLFRAM_BANK_WAVE2;

/** (framework, label, literal-in-source, bank-value) — exact bit match required. */
const PROVENANCE_LOCK: ReadonlyArray<readonly [string, string, number, number]> = [
  // ---- F1 Septenary ----
  ['F1', 'SILVER',            2.414213562373095,  B.SILVER.value],
  // ---- F2 Quantum ----
  ['F2', 'ALPHA_INV_CODATA',  137.035999084,      B.ALPHA_INV_CODATA.value],
  ['F2', 'PLANCK_LENGTH',     1.616255e-35,       B.PLANCK_LEN.value],
  ['F2', 'PLANCK_TIME',       5.391247e-44,       B.PLANCK_TIME.value],
  // ---- F3 Atomic ----
  ['F3', 'SILVER',            2.414213562373095,  B.SILVER.value],
  ['F3', 'BOHR_RADIUS',       5.29177210903e-11,  B.BOHR_RADIUS.value],
  // ---- F5 Color/Music ----
  ['F5', 'PYTHAGOREAN_COMMA', 1.0136432647705078, B.PYTH_COMMA.value],
  ['F5', 'PERFECT_FIFTH_CENTS', 701.9550008653874, B.FIFTH_CENTS.value],
  ['F5', 'MINOR_SIXTH_CENTS', 813.6862861351652,  B.M6_CENTS.value],
  // ---- F7 Galactic ----
  ['F7', 'PHI_CUBED',         4.23606797749979,   B.PHI_CUBED.value],
  // ---- F9 HyperGalactic ----
  ['F9', 'CMB_TEMP_K',        2.72548,            B.CMB_TEMP.value],
  ['F9', 'ADS_CFT_PSI_SQ',    5.82842712474619,   B.PSI_SQ.value],
  ['F9', 'PSI_DAMP_TARGET',   0.7071067811865476, B.INV_SQRT2.value],
] as const;

for (const [fw, name, lit, bank] of PROVENANCE_LOCK) {
  if (lit !== bank) {
    throw new Error(
      `[FrameworkProvenance] drift on ${fw}.${name}: source=${lit} bank=${bank}. ` +
      `Either resync the framework literal or regenerate WolframBankWave2.ts.`,
    );
  }
}

export const F2_PROVENANCE_OK = true as const;
export const FRAMEWORK_PROVENANCE_OK = true as const;
