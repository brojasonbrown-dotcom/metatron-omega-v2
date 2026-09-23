/**
 * METATRON V11 — UNIFIED FIELD KERNEL CORE
 * ========================================
 * Section 2 (Shard Kernel Unification): single source of truth for the
 * φ-ladder shard physics. Imported by BOTH:
 *   - `fieldKernel.worker.ts` (Web Worker hot path)
 *   - `workerPoolFallback.ts` (main-thread fallback when Workers unavailable)
 *
 * Numerics are byte-for-byte identical to the prior duplicated implementations
 * (verified by structural diff prior to extraction). Any future change to the
 * physics MUST happen here and nowhere else.
 *
 * Notes:
 *  - Constants intentionally inlined as JS `number` literals (worker context
 *    cannot import the Decimal-bearing WolframVerified bank without inflating
 *    the worker bundle). The values match WolframVerified.ts to f64 precision.
 *  - Neumaier compensated summation is used for every per-shard accumulator
 *    so coherence/energy remain stable as M grows toward the Planck ceiling.
 */

import { fastCos } from './cos';
import { portFlag } from './portFlags';

export const PHI = 1.618033988749895;
export const PHI_INV = 1 / PHI;
export const LN_PHI = Math.log(PHI);
export const KAPPA = 1 / (PHI * Math.PI);
export const KAPPA_REFLECT = 1 / (PHI * PHI * Math.PI);
const EXP_MAX = 700;
const EXP_MIN = -700;

// H3 — cache the flag at module load. Workers re-import the module fresh,
// so import.meta.env is evaluated in worker context; toggling the flag
// requires a worker rebuild (matches every other PORT_FLAGS site).
const USE_SIMD_KERNEL = portFlag('FLAG_SIMD_KERNEL');
const cosFn: (x: number) => number = USE_SIMD_KERNEL ? fastCos : Math.cos;

/** φ^k via guarded exp(k·ln φ); saturates instead of overflowing to ±∞. */
export function phiPow(k: number): number {
  const x = k * LN_PHI;
  if (x >= EXP_MAX) return Number.MAX_VALUE;
  if (x <= EXP_MIN) return Number.MIN_VALUE;
  return Math.exp(x);
}

export function amplitudeAt(k: number): number {
  return phiPow(-Math.abs(k));
}

/** Neumaier compensated-sum add. State is a 2-slot [sum, comp] Float64Array. */
export function nAdd(state: Float64Array, x: number): void {
  if (!Number.isFinite(x)) return;
  const s = state[0];
  const t = s + x;
  state[1] += Math.abs(s) >= Math.abs(x) ? (s - t) + x : (x - t) + s;
  state[0] = t;
}
export function nValue(state: Float64Array): number {
  return state[0] + state[1];
}

export interface ShardKernelInput {
  readonly kStart: number;
  readonly nodes: number;
  readonly carrierHz: number;
  readonly tSeconds: number;
  readonly qScalar: number;
  readonly reflectEnabled: boolean;
  readonly computePressure: number;
  /** Previous-tick amplitudes; MUTATED IN PLACE (matches legacy semantics). */
  readonly prev: Float64Array;
  /** Output buffer for this tick's amplitudes (length === nodes). */
  readonly out: Float64Array;
  /**
   * Phase 2b — optional per-mode Wolfram-bank coefficient table, length === nodes,
   * values in [-1, +1]. When provided AND `bankAlpha !== 0`, the kernel multiplies
   * every per-mode psi by `(1 + bankAlpha · bankCoef[i])` before writing it to
   * `out[]` / `prev[]`. When omitted, or when `bankAlpha === 0`, the multiplier
   * is exactly 1.0 and the per-mode amplitudes are bit-identical to the legacy
   * pre-Phase-2b output.
   */
  readonly bankCoef?: Float64Array;
  readonly bankAlpha?: number;
}

export interface ShardKernelOutput {
  term1: number;
  term2: number;
  term3: number;
  term4: number;
  energy: number;
  coherenceNum: number;
  coherenceDen: number;
}

// Pooled scratch buffers for per-node loop invariants. `runShardKernel` is
// called once per shard per tick on the hot path; reallocating three
// Float64Array(nodes) per invocation showed up as steady GC pressure in
// profiles. These pools grow monotonically and are reused across calls.
let _ampPool: Float64Array = new Float64Array(0);
let _omegaPool: Float64Array = new Float64Array(0);
let _psiCPool: Float64Array = new Float64Array(0);
function ensurePool(n: number): void {
  if (_ampPool.length < n) {
    _ampPool = new Float64Array(n);
    _omegaPool = new Float64Array(n);
    _psiCPool = new Float64Array(n);
  }
}

const TWO_PI = 2 * Math.PI;
const PHI_INV_SQ = PHI_INV * PHI_INV;

/**
 * Run one shard tick. The `prev` buffer is updated in place (legacy worker
 * semantics preserved). The `out` buffer receives the final-pass amplitudes.
 *
 * Optimisations (S19, numerically identical to the original):
 *   • Hoist `amp(k)`, `omega(k)`, `psiC(k)` — none depend on `pass` — into
 *     precomputed Float64Array scratch pools. Saves 3·passes·nodes calls
 *     to `phiPow` / `amplitudeAt` per tick (Math.exp is the bottleneck).
 *   • Inline Neumaier compensation for the seven accumulators so the
 *     last-pass branch stays in registers (no class dispatch, no per-add
 *     function call).
 *   • Pre-multiply `reflectK1 = 1 + reflectK` so `psi = psiL*reflectK1 +
 *     psiM + psiC` instead of three adds.
 */
export function runShardKernel(input: ShardKernelInput): ShardKernelOutput {
  const { kStart, nodes, carrierHz, tSeconds, qScalar, reflectEnabled, computePressure, prev, out, bankCoef, bankAlpha } = input;
  const reflectK = reflectEnabled ? KAPPA_REFLECT * qScalar : 0;
  const reflectK1 = 1 + reflectK;
  const passes = Math.max(1, Math.floor(computePressure));
  // Phase 2b: bank perturbation is active only when both a coef table is
  // supplied AND alpha is non-zero. When inactive, mul=1.0 exactly → output
  // is bit-for-bit identical to the legacy kernel (IEEE 754: x * 1.0 === x).
  const bankActive = !!(bankCoef && bankCoef.length === nodes && bankAlpha && bankAlpha !== 0);
  const bAlpha = bankActive ? (bankAlpha as number) : 0;

  ensurePool(nodes);
  const ampArr = _ampPool;
  const omegaArr = _omegaPool;
  const psiCArr = _psiCPool;

  // Precompute per-node invariants once. amplitudeAt(k+1) is reused as the
  // next iteration's amp(k) — saves half the phiPow calls in this prologue.
  let ampNext = amplitudeAt(kStart);
  const twoPiF = TWO_PI * carrierHz;
  for (let i = 0; i < nodes; i++) {
    const k = kStart + i;
    const amp = ampNext;
    ampNext = amplitudeAt(k + 1);
    ampArr[i] = amp;
    omegaArr[i] = twoPiF * phiPow(k);
    psiCArr[i] = KAPPA * (ampNext - amp);
  }

  // Inline Neumaier state (sum,comp) pairs for each accumulator.
  let s1=0,c1=0, s2=0,c2=0, s3=0,c3=0, s4=0,c4=0, sE=0,cE=0, sN=0,cN=0, sD=0,cD=0;

  for (let pass = 0; pass < passes; pass++) {
    const phase = tSeconds + pass * PHI_INV * 0.000001;
    const isLast = pass === passes - 1;
    if (!isLast) {
      // Non-final passes: only update prev[]; no accumulation, no out[].
      for (let i = 0; i < nodes; i++) {
        const amp = ampArr[i];
        const psiL = amp * cosFn(omegaArr[i] * phase);
        const psiM = PHI_INV_SQ * prev[i];
        const mul = bankActive ? 1 + bAlpha * (bankCoef as Float64Array)[i] : 1;
        prev[i] = (psiL * reflectK1 + psiM + psiCArr[i]) * mul;
      }
    } else {
      for (let i = 0; i < nodes; i++) {
        const amp = ampArr[i];
        const psiL = amp * cosFn(omegaArr[i] * phase);
        const pv = prev[i];
        const psiM = PHI_INV_SQ * pv;
        const psiC = psiCArr[i];
        const psiR = reflectK * psiL;
        const mul = bankActive ? 1 + bAlpha * (bankCoef as Float64Array)[i] : 1;
        const psi = (psiL + psiM + psiC + psiR) * mul;

        out[i] = psi;

        // Inline Neumaier: same algorithm as nAdd(), no call overhead.
        // (a) coherence num = Σ psi*prev
        {
          const x = psi * pv; const s = sN; const t = s + x;
          cN += Math.abs(s) >= Math.abs(x) ? (s - t) + x : (x - t) + s;
          sN = t;
        }
        // (b) coherence den = Σ prev²
        {
          const x = pv * pv; const s = sD; const t = s + x;
          cD += Math.abs(s) >= Math.abs(x) ? (s - t) + x : (x - t) + s;
          sD = t;
        }
        // (c) term1 = Σ |psiL|
        {
          const x = psiL < 0 ? -psiL : psiL; const s = s1; const t = s + x;
          c1 += s >= x ? (s - t) + x : (x - t) + s;
          s1 = t;
        }
        // (d) term2 = Σ |psiM|
        {
          const x = psiM < 0 ? -psiM : psiM; const s = s2; const t = s + x;
          c2 += s >= x ? (s - t) + x : (x - t) + s;
          s2 = t;
        }
        // (e) term3 = Σ |psiC|
        {
          const x = psiC < 0 ? -psiC : psiC; const s = s3; const t = s + x;
          c3 += s >= x ? (s - t) + x : (x - t) + s;
          s3 = t;
        }
        // (f) term4 = Σ |psiR|
        {
          const x = psiR < 0 ? -psiR : psiR; const s = s4; const t = s + x;
          c4 += s >= x ? (s - t) + x : (x - t) + s;
          s4 = t;
        }
        // (g) energy = Σ psi²
        {
          const x = psi * psi; const s = sE; const t = s + x;
          cE += s >= x ? (s - t) + x : (x - t) + s;
          sE = t;
        }

        prev[i] = psi;
      }
    }
  }

  return {
    term1: s1 + c1,
    term2: s2 + c2,
    term3: s3 + c3,
    term4: s4 + c4,
    energy: sE + cE,
    coherenceNum: sN + cN,
    coherenceDen: sD + cD,
  };
}
