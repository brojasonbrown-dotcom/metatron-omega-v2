/**
 * Ω-REAL · P1 — the φ-delayed memory kernel and innovation-form coherence C(t).
 *
 *   Ψ(t) = (1−λ)Ψ(t−τ) + λΨ(t−2τ) + e(t),   λ = φ⁻²
 *
 * The characteristic polynomial z² − (1−λ)z − λ has roots EXACTLY {1, −φ⁻²}:
 * a unit root (long memory) plus a decaying oscillatory mode.
 *
 * WHY THE INNOVATION FORM MATTERS. Computing coherence on the raw state Ψ
 * saturates at 1 because the unit root dominates — the estimator reports
 * "perfect coherence" for a system that is doing nothing of the kind. That is
 * exactly the class of false reading the warm-coherence pass removed from the
 * dashboard. C(t) is therefore computed on the mean-centred INNOVATION stream:
 *
 *   C(t) = |⟨e(t), e(t−τ)⟩|² / (‖e(t)‖² ‖e(t−τ)‖²)
 *
 * with the analytic expectation E[C] = ρ² + (1−ρ²)/d, ρ = e^(−θ/φ).
 *
 * Abstention is first class: before τ+1 innovations have arrived the kernel
 * returns `null`, never 0. A zero here would be read as "measured incoherence".
 *
 * No allocation on the step path: the ring buffers are owned by the kernel.
 */

import { PHI, PHI_INV, phiPow } from '../core/constants';
import { dcos, dexp, dlog, dsin } from '../core/dmath';

/** λ = φ⁻² (Class A). */
export const KERNEL_LAMBDA = phiPow(-2);

/** The corridor floor the gate compares against: φ⁻². */
export const COHERENCE_GATE = phiPow(-2);

/** Roots of z² − (1−λ)z − λ, computed (not asserted) from the quadratic formula. */
export function kernelRoots(lam = KERNEL_LAMBDA): [number, number] {
  const b = 1 - lam;
  const disc = Math.sqrt(b * b + 4 * lam);
  return [(b + disc) / 2, (b - disc) / 2];
}

/**
 * E[C] = ρ² + (1−ρ²)/d for an OU innovation stream measured across the kernel
 * delay, where ρ = e^(−θ·τ/φ) is the decorrelation over τ DRIVE STEPS.
 *
 * TWO CORRECTIONS to the reference derivation, both measured, not assumed:
 *
 * 1. The τ factor. The kernel correlates e(t) with e(t−τ), so at τ=2 the
 *    stream has decorrelated twice as far and the corridor centre drops from
 *    0.3794 to 0.1993. Omitting τ makes a correctly-behaving kernel look
 *    broken — or, worse, invites tuning the kernel to hit a wrong target.
 *
 * 2. This is the LARGE-d ASYMPTOTE, not the exact finite-d mean. The
 *    magnitude-squared coherence of a single d-dimensional snapshot pair is a
 *    biased estimator; the (1−ρ²)/d term is only the leading correction and
 *    the next term is negative and O(1/d). Measured bias at θ=1, τ=1 (20k
 *    steps, 40 seeds): d=4 −0.033, d=8 −0.021, d=16 −0.012, d=32 −0.0072,
 *    d=64 −0.0039, d=256 −0.0014. So at the operating dimension d=8 the true
 *    mean is ≈0.358, not 0.379.
 *
 * Callers comparing a live reading against this value MUST allow for the
 * finite-d bias at their own d — see `expectedCBias`. Treating the asymptote
 * as exact at d=8 is a ~5% overstatement of expected coherence.
 */
export function analyticExpectedC(theta = 1, d = 8, tauSteps = 1): number {
  const rho = dexp((-theta * tauSteps) / PHI);
  return rho * rho + (1 - rho * rho) / d;
}

/**
 * Empirically-calibrated magnitude of the finite-d bias of `analyticExpectedC`
 * (Class C). Returns a POSITIVE magnitude; the measured mean sits BELOW the
 * asymptote by roughly this much. Fitted as c/d over the scan above.
 */
export function expectedCBias(d = 8, tauSteps = 1): number {
  const c = tauSteps <= 1 ? 0.17 : 0.07;
  return c / d;
}



export interface KernelStep {
  /** Innovation-form coherence, or null while the estimator is still warming. */
  readonly coherence: number | null;
  /** True only when coherence is measured AND strictly above φ⁻². */
  readonly gateOpen: boolean;
  /** Σ|Ψ|² after the step. */
  readonly energy: number;
  /** Number of innovations seen so far. */
  readonly samples: number;
}

/**
 * Streaming φ-kernel over a d-dimensional complex carrier.
 *
 * `d` defaults to 8 — the dimension the analytic C(t) corridor was calibrated
 * at. (The Python reference defaulted to 14 while calibrating at 8; that
 * mismatch is fixed here rather than reproduced.)
 */
export class PhiCoherenceKernel {
  readonly d: number;
  readonly tauSteps: number;
  readonly lam: number;

  /** Live state Ψ(t), split complex. */
  readonly psiRe: Float64Array;
  readonly psiIm: Float64Array;

  private readonly histRe: Float64Array;
  private readonly histIm: Float64Array;
  private readonly innRe: Float64Array;
  private readonly innIm: Float64Array;
  private readonly cap: number;
  private head = 0;
  private count = 0;

  /** Running mean of the injected innovations (Welford incremental). */
  private readonly innMeanRe: Float64Array;
  private readonly innMeanIm: Float64Array;

  constructor(d = 8, tauSteps = 2, lam = KERNEL_LAMBDA) {
    if (!(d > 0) || !Number.isInteger(d)) throw new Error('kernel dimension must be a positive integer');
    if (!(tauSteps >= 1) || !Number.isInteger(tauSteps)) throw new Error('tauSteps must be an integer >= 1');
    this.d = d;
    this.tauSteps = tauSteps;
    this.lam = lam;
    this.cap = 2 * tauSteps + 1;
    this.psiRe = new Float64Array(d);
    this.psiIm = new Float64Array(d);
    this.histRe = new Float64Array(this.cap * d);
    this.histIm = new Float64Array(this.cap * d);
    this.innRe = new Float64Array(this.cap * d);
    this.innIm = new Float64Array(this.cap * d);
    this.innMeanRe = new Float64Array(d);
    this.innMeanIm = new Float64Array(d);
  }

  /** τ in drive steps for a step size dt against the natural delay φ⁻¹. */
  static fromDt(dt: number, d = 8): PhiCoherenceKernel {
    return new PhiCoherenceKernel(d, Math.max(1, Math.round(dt / PHI_INV)));
  }

  reset(): void {
    this.psiRe.fill(0);
    this.psiIm.fill(0);
    this.histRe.fill(0);
    this.histIm.fill(0);
    this.innRe.fill(0);
    this.innIm.fill(0);
    this.innMeanRe.fill(0);
    this.innMeanIm.fill(0);
    this.head = 0;
    this.count = 0;
  }

  /** Ring slot of the entry `back` steps behind the newest one (0 = newest). */
  private slot(back: number): number {
    return ((this.head - 1 - back) % this.cap + this.cap) % this.cap;
  }

  /** Advance one τ with the given innovation. Returns the measured report. */
  step(innRe: Float64Array, innIm: Float64Array): KernelStep {
    const d = this.d;
    if (innRe.length !== d || innIm.length !== d) throw new Error('innovation has wrong dimension');

    const haveA = this.count >= this.tauSteps;
    const haveB = this.count >= 2 * this.tauSteps;
    const sa = haveA ? this.slot(this.tauSteps - 1) * d : -1;
    const sb = haveB ? this.slot(2 * this.tauSteps - 1) * d : -1;
    const g = 1 - this.lam;

    for (let i = 0; i < d; i++) {
      const ar = haveA ? this.histRe[sa + i] : 0;
      const ai = haveA ? this.histIm[sa + i] : 0;
      const br = haveB ? this.histRe[sb + i] : 0;
      const bi = haveB ? this.histIm[sb + i] : 0;
      this.psiRe[i] = g * ar + this.lam * br + innRe[i];
      this.psiIm[i] = g * ai + this.lam * bi + innIm[i];
    }

    const base = this.head * d;
    this.histRe.set(this.psiRe, base);
    this.histIm.set(this.psiIm, base);
    this.innRe.set(innRe, base);
    this.innIm.set(innIm, base);
    this.head = (this.head + 1) % this.cap;
    this.count++;

    const n = this.count;
    for (let i = 0; i < d; i++) {
      this.innMeanRe[i] += (innRe[i] - this.innMeanRe[i]) / n;
      this.innMeanIm[i] += (innIm[i] - this.innMeanIm[i]) / n;
    }

    let energy = 0;
    for (let i = 0; i < d; i++) energy += this.psiRe[i] * this.psiRe[i] + this.psiIm[i] * this.psiIm[i];

    const coherence = this.coherence();
    return {
      coherence,
      gateOpen: coherence !== null && coherence > COHERENCE_GATE,
      energy,
      samples: this.count,
    };
  }

  /**
   * Innovation-form C(t). Returns null (abstain) until τ+1 innovations exist
   * or when either innovation has zero centred norm — never a fabricated 0.
   */
  coherence(): number | null {
    if (this.count < this.tauSteps + 1) return null;
    const d = this.d;
    const now = this.slot(0) * d;
    const lag = this.slot(this.tauSteps) * d;
    let dotRe = 0;
    let dotIm = 0;
    let nn = 0;
    let ll = 0;
    for (let i = 0; i < d; i++) {
      const ar = this.innRe[now + i] - this.innMeanRe[i];
      const ai = this.innIm[now + i] - this.innMeanIm[i];
      const br = this.innRe[lag + i] - this.innMeanRe[i];
      const bi = this.innIm[lag + i] - this.innMeanIm[i];
      // ⟨a,b⟩ = Σ conj(a)·b
      dotRe += ar * br + ai * bi;
      dotIm += ar * bi - ai * br;
      nn += ar * ar + ai * ai;
      ll += br * br + bi * bi;
    }
    const den = nn * ll;
    if (!(den > 0)) return null;
    const c = (dotRe * dotRe + dotIm * dotIm) / den;
    return Math.min(1, Math.max(0, c));
  }

  /** The corridor gate: measured C(t) strictly above φ⁻². */
  gateOpen(): boolean {
    const c = this.coherence();
    return c !== null && c > COHERENCE_GATE;
  }
}

/**
 * Deterministic Ornstein–Uhlenbeck innovation source used to certify the
 * analytic corridor. `rand` must return uniforms in [0,1); the caller owns the
 * seed so every certification run is reproducible.
 */
export function ouInnovation(
  rand: () => number,
  re: Float64Array,
  im: Float64Array,
  theta = 1,
  fresh = false,
): void {
  const rho = dexp(-theta / PHI);
  const sigma = Math.sqrt(1 - rho * rho);
  const d = re.length;
  for (let i = 0; i < d; i++) {
    // Box–Muller, unit variance per complex dimension.
    const u1 = Math.max(rand(), Number.MIN_VALUE);
    const u2 = rand();
    const r = Math.sqrt(-2 * dlog(u1));
    const nr = (r * dcos(2 * Math.PI * u2)) / Math.SQRT2;
    const ni = (r * dsin(2 * Math.PI * u2)) / Math.SQRT2;
    if (fresh) {
      re[i] = nr;
      im[i] = ni;
    } else {
      re[i] = rho * re[i] + sigma * nr;
      im[i] = rho * im[i] + sigma * ni;
    }
  }
}
