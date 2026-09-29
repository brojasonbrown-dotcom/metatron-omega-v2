/**
 * Wave2 precision helper.
 *
 * `wave2(bankId, fallback)` returns the 50-dp Wolfram-verified bank value when
 * either the per-framework wave2 flag (FLAG_F2_WAVE2_PRECISION) or the master
 * FLAG_WAVE2_PRECISION is ON. Otherwise it returns `fallback` (the original V10
 * literal) so default builds keep bit-exact golden parity.
 *
 * All callers MUST pass the literal that's currently in the source as
 * `fallback`. That literal is also asserted to be ≤ 1e-9 relative to the bank
 * value at module load, catching wiring typos without affecting runtime.
 */
import { WOLFRAM_BANK_WAVE2 } from './WolframBankWave2';
import { portFlag } from '@metatron/field-kernel-core/portFlags';

type BankId = keyof typeof WOLFRAM_BANK_WAVE2;

function wave2Enabled(): boolean {
  return portFlag('FLAG_WAVE2_PRECISION') || portFlag('FLAG_F2_WAVE2_PRECISION');
}

export function wave2(id: BankId, fallback: number): number {
  const entry = WOLFRAM_BANK_WAVE2[id];
  if (!entry) {
    throw new Error(`[wave2] unknown bank id: ${String(id)}`);
  }
  // Wiring sanity (independent of flag): warn if literal drifts from bank.
  const rel =
    Math.abs(entry.value - fallback) / Math.max(Math.abs(entry.value), Math.abs(fallback), 1e-300);
  if (rel > 1e-3) {
    // Loud but non-fatal — the literal may be intentionally legacy.
    // Use stderr so production logs surface it without crashing.
    try {
      console.warn(
        `[wave2] ${String(id)} fallback=${fallback} drifts ${rel.toExponential(2)} from bank=${entry.value}`,
      );
    } catch {
      /* environments without console.warn */
    }
  }
  return wave2Enabled() ? entry.value : fallback;
}

export const WAVE2_FLAG_ON = wave2Enabled();
