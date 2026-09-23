/**
 * Ω-OPERATOR N5′ — banded mode coupling on the φ ladder.
 *
 * `learn/spectralFilter.ts` is already a *complex* diagonal operator
 * (α_k = ρ_k e^{iψ_k}, ρ_k ≤ φ⁻¹). Making it "more complex" buys nothing: a
 * diagonal operator, however rich per entry, can never move energy between
 * modes. Every nonlinear field behaviour worth the name lives in the
 * off-diagonal.
 *
 * So this is the missing capacity: a banded coupling `C` on the Fibonacci
 * neighbour stencil (k ↔ k±1, k ↔ k±2 — the φ recurrence), applied as
 *
 *   c' = (D + g·C) c
 *
 * with `D` the existing filter and `g` a gate whose **default is 0**. At g = 0
 * the result is bit-identical to the filter alone, so a default build cannot
 * regress the S0 oracle — that is structural, not a test outcome.
 *
 * Stability is constructed, not asserted. `C` is Hermitian by construction
 * (C_kj = conj(C_jk)), so ‖C‖₂ ≤ ‖C‖_∞ = max row absolute sum, and every row
 * sum is clamped to `rhoC` through the same surjective algebraic sigmoid used
 * elsewhere. Hence, for any parameter value the optimiser can ever reach,
 *
 *   ‖D + gC‖₂  ≤  ρ_max + g·ρ_C
 *
 * which is the number that enters the Jury ledger. With the default ρ_C = φ⁻²
 * and g ≤ φ⁻¹ the coupling contributes at most φ⁻³ ≈ 0.236.
 */

import { algSigmoid } from '../learn/params';
import { dcos, dsin } from '../core/dmath';
import { PHI_INV } from '../core/constants';

/** Default coupling ceiling: φ⁻² — one rung below the filter's own clamp. */
export const COUPLING_RHO_MAX = PHI_INV * PHI_INV;

/** Band offsets: the Fibonacci recurrence stencil. */
export const COUPLING_OFFSETS = [1, 2] as const;

export interface CouplingCertificate {
  readonly kind: 'ModeCoupling';
  /** Guaranteed ‖C‖₂ upper bound (max Hermitian row sum). */
  readonly rho: number;
  /** Contribution to the Jury ledger at the given gate. */
  readonly gated: number;
  readonly gate: number;
  readonly admissible: boolean;
}

export class ModeCoupling {
  readonly kind = 'ModeCoupling';
  readonly modes: number;
  readonly rhoC: number;
  /**
   * raw layout, per band offset d ∈ {1,2}, per start index k:
   *   [mag, phase] — the upper-triangular entry C_{k,k+d}; the lower entry is
   *   its conjugate, which makes C Hermitian.
   */
  readonly raw: Float64Array;
  private readonly pairs: { a: number; b: number; slot: number }[] = [];

  constructor(modes: number, rhoC = COUPLING_RHO_MAX) {
    if (!Number.isInteger(modes) || modes <= 0) throw new RangeError(`ModeCoupling: modes must be a positive integer, got ${modes}`);
    if (!(rhoC > 0) || !(rhoC < 1)) throw new RangeError(`ModeCoupling: rhoC must lie in (0,1), got ${rhoC}`);
    this.modes = modes;
    this.rhoC = rhoC;
    let slot = 0;
    for (const d of COUPLING_OFFSETS) {
      for (let a = 0; a + d < modes; a++) {
        this.pairs.push({ a, b: a + d, slot });
        slot += 2;
      }
    }
    this.raw = new Float64Array(slot);
  }

  get size(): number {
    return this.raw.length;
  }

  /**
   * Per-entry magnitude budget. Each mode touches at most 2·|offsets| = 4
   * neighbours, so dividing the ceiling by that fan-out guarantees every row
   * sum is ≤ rhoC without ever needing a runtime renormalisation pass.
   */
  private get budget(): number {
    return this.rhoC / (2 * COUPLING_OFFSETS.length);
  }

  magnitude(pairIndex: number): number {
    return this.budget * Math.abs(algSigmoid(this.raw[this.pairs[pairIndex].slot]));
  }

  phase(pairIndex: number): number {
    return Math.PI * algSigmoid(this.raw[this.pairs[pairIndex].slot + 1]);
  }

  /** Number of coupled pairs (upper-triangular band entries). */
  get pairCount(): number {
    return this.pairs.length;
  }

  /** The realised max Hermitian row sum — the true ‖C‖₂ bound for this state. */
  rowBound(): number {
    const rows = new Float64Array(this.modes);
    for (let i = 0; i < this.pairs.length; i++) {
      const m = this.magnitude(i);
      rows[this.pairs[i].a] += m;
      rows[this.pairs[i].b] += m;
    }
    let max = 0;
    for (let i = 0; i < this.modes; i++) if (rows[i] > max) max = rows[i];
    return max;
  }

  certificate(gate: number, filterRho: number): CouplingCertificate {
    const rho = this.rowBound();
    const gated = Math.abs(gate) * rho;
    return {
      kind: 'ModeCoupling',
      rho,
      gated,
      gate,
      admissible: filterRho + gated < 1,
    };
  }

  /**
   * Add g·C·c into (outRe,outIm). At `gate === 0` this returns immediately and
   * touches nothing — the byte-identical default path.
   */
  apply(cRe: ArrayLike<number>, cIm: ArrayLike<number>, outRe: Float64Array, outIm: Float64Array, gate: number): void {
    if (gate === 0) return;
    if (outRe.length < this.modes || outIm.length < this.modes) {
      throw new RangeError(`ModeCoupling.apply: output shorter than the mode ladder (${this.modes})`);
    }
    for (let i = 0; i < this.pairs.length; i++) {
      const { a, b } = this.pairs[i];
      const m = this.magnitude(i) * gate;
      if (m === 0) continue;
      const ph = this.phase(i);
      const wr = m * dcos(ph);
      const wi = m * dsin(ph);
      // out_a += C_ab · c_b, with C_ab = w
      outRe[a] += wr * cRe[b] - wi * cIm[b];
      outIm[a] += wr * cIm[b] + wi * cRe[b];
      // out_b += conj(w) · c_a  (Hermitian partner)
      outRe[b] += wr * cRe[a] + wi * cIm[a];
      outIm[b] += wr * cIm[a] - wi * cRe[a];
    }
  }
}
