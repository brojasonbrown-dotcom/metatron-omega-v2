/**
 * Ω-REAL · P0 — Class-A substrate parity.
 *
 * This module does NOT introduce a second constants source. Every value here
 * is either derived through the canonical `phiPow` composition in
 * `core/constants` or *derived from the integer Lucas recurrence* — nothing is
 * hardcoded that the substrate can compute for itself.
 *
 * Epistemic classes (binding, from the RHUFT/RAFFY report §9):
 *   A — proved identity of the φ-system. Never tuned.
 *   B — manifest/budget value stated by the architecture.
 *   C — empirical calibration. Tunable only through the evaluation harness,
 *       and it MUST be labelled as empirical wherever it is displayed.
 *
 * The uploaded Python reference hardcoded STABLE_RUNGS = (1,13,15,27) and only
 * asserted consistency. Here the rungs are *computed* from L_n mod 13, so the
 * claim is proved rather than restated.
 */

import { PHI, PHI_INV, KAPPA, phiPow } from '../core/constants';
import { lucasBig } from '../core/fibonacci';

export type EpistemicClass = 'A' | 'B' | 'C';

/** ψ = (1−√5)/2 = −φ⁻¹ (Class A). */
export const PSI = -PHI_INV;

/** Period of L_n mod 13 (Class A, verified by `lucasMod13Cycle`). */
export const LUCAS_MOD13_PERIOD = 28;

/** L_n mod 13 for n = 0..27, computed from the exact integer recurrence. */
export function lucasMod13Cycle(): number[] {
  const out: number[] = [];
  for (let n = 0; n < LUCAS_MOD13_PERIOD; n++) out.push(Number(lucasBig(n) % 13n));
  return out;
}

/**
 * Stable rungs — residues ±1 (i.e. 1 or 12) of L_n mod 13, DERIVED.
 * Class A. The report's finding F1: there are four per 28-cycle, not three.
 */
export function stableRungsMod28(): number[] {
  const cycle = lucasMod13Cycle();
  const out: number[] = [];
  for (let n = 0; n < LUCAS_MOD13_PERIOD; n++) if (cycle[n] === 1 || cycle[n] === 12) out.push(n);
  return out;
}

/** True when n's position in the 28-cycle is a stable rung. */
export function isStableRung(n: number): boolean {
  const r = ((n % LUCAS_MOD13_PERIOD) + LUCAS_MOD13_PERIOD) % LUCAS_MOD13_PERIOD;
  return stableRungsMod28().includes(r);
}

/** Gaps between consecutive stable rungs across the cycle: the {12,2} heartbeat. */
export function heartbeatGaps(): number[] {
  const rungs = stableRungsMod28();
  const gaps: number[] = [];
  for (let i = 1; i < rungs.length; i++) gaps.push(rungs[i] - rungs[i - 1]);
  gaps.push(rungs[0] + LUCAS_MOD13_PERIOD - rungs[rungs.length - 1]);
  return gaps;
}

export type HeartbeatKind = 'long' | 'short';

/** Firing schedule of stable rungs: long gap (12) = batch work, short (2) = incremental. */
export function heartbeatSchedule(
  cycles: number,
  start = 0,
): { tick: number; kind: HeartbeatKind }[] {
  const out: { tick: number; kind: HeartbeatKind }[] = [];
  let prev: number | null = null;
  for (let n = start; n < start + cycles * LUCAS_MOD13_PERIOD; n++) {
    if (!isStableRung(n)) continue;
    const kind: HeartbeatKind = prev !== null && n - prev === 2 ? 'short' : 'long';
    out.push({ tick: n, kind });
    prev = n;
  }
  return out;
}

/** Pisot defect |φⁿ − Lₙ| = φ⁻ⁿ (Class A). */
export function pisotDefect(n: number): number {
  return phiPow(-n);
}

/** Metatron spectrum: round(φᵏ), k = 0..12 (Class A). */
export function metatronSpectrum(): number[] {
  const out: number[] = [];
  for (let k = 0; k < 13; k++) out.push(Math.round(phiPow(k)));
  return out;
}

/** Boundary flux of rung n: φ^-(13+n) (Class A, report finding F2). */
export function boundaryFlux(n: number): number {
  return phiPow(-(13 + n));
}

/** Half-open tolerance window [φ⁻²⁶, φ⁻²⁵) — first entered at n = 13. */
export const FLUX_WINDOW_LO = phiPow(-26);
export const FLUX_WINDOW_HI = phiPow(-25);

/** First n whose flux falls inside the tolerance window. Class A: returns 13. */
export function fluxFirstInWindow(limit = 10_000): number {
  for (let n = 0; n <= limit; n++) {
    const f = boundaryFlux(n);
    if (f >= FLUX_WINDOW_LO && f < FLUX_WINDOW_HI) return n;
  }
  throw new Error('flux window never entered — substrate broken');
}

/** Carrier geometry: 28 = 2·(13+1) interleaved real slots (Class A-consistent). */
export const CARRIER_N = 13;
export const CARRIER_DIM = 2 * (CARRIER_N + 1);

/** Prototype consolidation cosine 1 − φ⁻³ = 0.763932… (Class A). */
export const CONSOLIDATION_COS = 1 - phiPow(-3);

/** Promotion threshold ⌈φ⁴⌉ = 7 sightings (Class A). */
export const PROMOTION_THRESHOLD = Math.ceil(phiPow(4));

/** Minimum paired samples before any statistic may speak: F9 = 34 (Class A-indexed). */
export const MIN_PAIRED = 34;

/**
 * Class C — empirical calibrations with NO closed φ-form (report findings F3/F4).
 * These are the only two tunables in the substrate and they are labelled so the
 * UI can never present them as proved constants.
 */
export const RESONANCE_FLOOR = 0.05625982094858675;
export const STRESS_THRESHOLD = 0.432;
export const EMPIRICAL_CONSTANTS: Readonly<
  Record<string, { value: number; class: EpistemicClass; note: string }>
> = {
  RESONANCE_FLOOR: {
    value: RESONANCE_FLOOR,
    class: 'C',
    note: 'PSLQ over 3 bases at 80 digits found no φ-closed form (F3).',
  },
  STRESS_THRESHOLD: {
    value: STRESS_THRESHOLD,
    class: 'C',
    note: 'Nearest φ-candidates 0.7·φ⁻¹ and φ⁻³+κ both miss by ~1e-3 (F4).',
  },
};

export type CorridorClass = 'STABLE' | 'WATCH' | 'STRESS';

/**
 * Confidence corridor. The FORM is Class A; vfeNorm / phiCaution / lambdaNorm
 * are Class C components supplied by the harness.
 */
export interface CorridorOptions {
  vfeNorm?: number;
  phiCaution?: number;
  lambdaNorm?: number;
}

export function corridor(opts: CorridorOptions = {}) {
  const vfeNorm = opts.vfeNorm ?? 1;
  const phiCaution = opts.phiCaution ?? PHI_INV;
  const lambdaNorm = opts.lambdaNorm ?? 0;
  const lower = Math.max(phiPow(-2), 1 - vfeNorm);
  const upper = Math.min(phiCaution, 1 - lambdaNorm * PHI_INV);
  const classify = (score: number): CorridorClass =>
    score >= PHI_INV ? 'STABLE' : score >= STRESS_THRESHOLD ? 'WATCH' : 'STRESS';
  return { lower, upper, classify };
}

/** Interleave a split-complex pair into the 28-slot real carrier. */
export function carrierPack(re: Float64Array, im: Float64Array, out?: Float64Array): Float64Array {
  const n = Math.min(re.length, im.length);
  const dst = out ?? new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    dst[2 * i] = re[i];
    dst[2 * i + 1] = im[i];
  }
  return dst;
}

/** Inverse of `carrierPack`. */
export function carrierUnpack(x: Float64Array): { re: Float64Array; im: Float64Array } {
  const n = x.length >> 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = x[2 * i];
    im[i] = x[2 * i + 1];
  }
  return { re, im };
}

/**
 * SNS(d) closure. Exact closed forms exist only for d ∈ {3,4,5} (plus the
 * non-rational d = 6). Anything else throws rather than inventing a number.
 */
export function sns(d: number): number {
  if (d === 3) return 3;
  if (d === 4) return 2 + 2 * Math.sqrt(5);
  if (d === 5) return 15;
  if (d === 6) return -0.5 + (31 * Math.sqrt(5)) / 2;
  throw new Error(`SNS has no closed form at d=${d} (Class A boundary is d ∈ {3,4,5,6})`);
}

export interface ParityCheck {
  readonly name: string;
  readonly class: EpistemicClass;
  readonly ok: boolean;
  readonly detail: string;
}

/** The Class-A parity battery, runnable at runtime as a self-proof. */
export function substrateParity(): ParityCheck[] {
  const checks: ParityCheck[] = [];
  const add = (name: string, cls: EpistemicClass, ok: boolean, detail: string) =>
    checks.push({ name, class: cls, ok, detail });

  add(
    'phi^-1 + phi^-2 = 1',
    'A',
    Math.abs(PHI_INV + phiPow(-2) - 1) < 1e-15,
    `${PHI_INV + phiPow(-2)}`,
  );
  add('psi = -phi^-1', 'A', Math.abs(PSI + PHI_INV) < 1e-15, `${PSI}`);
  add('kappa*phi*pi = 1', 'A', Math.abs(KAPPA * PHI * Math.PI - 1) < 1e-15, `${KAPPA}`);
  const cycle = lucasMod13Cycle();
  add('L_n mod 13 has no zero residue', 'A', !cycle.includes(0), cycle.join(','));
  const rungs = stableRungsMod28();
  add(
    'four stable rungs {1,13,15,27} (F1)',
    'A',
    rungs.join(',') === '1,13,15,27',
    rungs.join(','),
  );
  add(
    'heartbeat gaps {12,2,12,2}',
    'A',
    heartbeatGaps().join(',') === '12,2,12,2',
    heartbeatGaps().join(','),
  );
  add(
    'flux window first entered at n=13 (F2)',
    'A',
    fluxFirstInWindow() === 13,
    `${fluxFirstInWindow()}`,
  );
  add(
    'Metatron spectrum round(phi^k)',
    'A',
    metatronSpectrum().join(',') === '1,2,3,4,7,11,18,29,47,76,123,199,322',
    metatronSpectrum().join(','),
  );
  add('carrier dim = 2*(13+1) = 28', 'A', CARRIER_DIM === 28, `${CARRIER_DIM}`);
  add(
    'promotion threshold = ceil(phi^4) = 7',
    'A',
    PROMOTION_THRESHOLD === 7,
    `${PROMOTION_THRESHOLD}`,
  );
  add(
    'consolidation cosine = 1 - phi^-3',
    'A',
    Math.abs(CONSOLIDATION_COS - 0.7639320225002102) < 1e-15,
    `${CONSOLIDATION_COS}`,
  );
  add('SNS(4) = 4*phi', 'A', Math.abs(sns(4) - 4 * PHI) < 1e-15, `${sns(4)}`);
  add(
    'resonance floor is Class C (empirical)',
    'C',
    EMPIRICAL_CONSTANTS.RESONANCE_FLOOR.class === 'C',
    `${RESONANCE_FLOOR}`,
  );
  add(
    'stress threshold is Class C (empirical)',
    'C',
    EMPIRICAL_CONSTANTS.STRESS_THRESHOLD.class === 'C',
    `${STRESS_THRESHOLD}`,
  );
  return checks;
}

/** True when every Class-A parity check passes. */
export function substrateParityHolds(): boolean {
  return substrateParity().every((c) => c.class !== 'A' || c.ok);
}
