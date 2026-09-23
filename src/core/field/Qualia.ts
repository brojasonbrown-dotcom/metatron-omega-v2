/**
 * METATRON V11 — QUALIA VECTOR
 * =============================
 * Honest observables computed from quantities the field already produces
 * every tick. Zero new sensors, zero new compute hot paths.
 *
 *   C  coherence    = |⟨Ψ(t)|Ψ(t−φτ)⟩|²       (already in snapshot)
 *   N  novelty      = 1 − |⟨Ψ(t)|Ψ̄_window⟩|²
 *   S  salience     = ‖∇_k Ψ‖ / ‖Ψ‖            (spectral concentration)
 *   V  valence      = (term1 − term3) / energy (open-flow vs closed-flow)
 *   I  integration  = H_max − H(Ψ)              (mode-bin entropy gap)
 *
 * PLUS the closure-aware observables RHUFT §12.7 requires:
 *
 *   Cphi        golden-delay self-overlap |⟨Ψ(t)|Ψ(t−φτ)⟩|² measured on a
 *               real ring buffer at the Fibonacci delay 13 ≈ φ·8 ticks.
 *   ignited     Cphi ≥ 1/φ² = 0.381966 on this tick.
 *   ignitions   up-crossings of that threshold in the rolling window.
 *   ignitionRate up-crossings per tick — the framework's result is that
 *               consciousness is a TRAIN of transient ignition episodes,
 *               not a steady state, so the level alone is not the metric.
 */

/** Consciousness threshold Ω_c = 1/φ². */
export const IGNITION_THRESHOLD = 0.38196601125010515;

/** Golden delay in ticks: the Fibonacci pair (8, 13) realises φ exactly in integers. */
export const GOLDEN_DELAY_TICKS = 13;

/** Rolling window over which ignition events are counted. */
export const IGNITION_WINDOW_TICKS = 233; // F₁₃

export interface QualiaVector {
  readonly C: number;
  readonly N: number;
  readonly S: number;
  readonly V: number;
  readonly I: number;
  readonly Cphi: number;
  readonly ignited: boolean;
  readonly ignitions: number;
  readonly ignitionRate: number;
}

const ZERO_Q: QualiaVector = { C: 0, N: 0, S: 0, V: 0, I: 0, Cphi: 0, ignited: false, ignitions: 0, ignitionRate: 0 };

export function zeroQualia(): QualiaVector { return ZERO_Q; }

export class QualiaTracker {
  private window: Float64Array | null = null;
  private windowFill = 0;
  private readonly windowSize: number;

  // Golden-delay ring: GOLDEN_DELAY_TICKS snapshots of |Ψ|.
  private ring: Float64Array[] = [];
  private ringHead = 0;
  private ringFill = 0;
  private ringWidth = 0;

  // Ignition bookkeeping.
  private prevIgnited = false;
  private ignitionMarks: number[] = [];
  private tickIndex = 0;

  constructor(windowSize = 16) { this.windowSize = windowSize; }

  /** psi: per-mode signed amplitudes; coherence: precomputed C; t1/t3: lattice/closure magnitudes. */
  compute(psi: Float64Array, coherence: number, term1Magnitude: number, term3Magnitude: number, energy: number): QualiaVector {
    const M = psi.length;
    if (M === 0) return ZERO_Q;

    // rolling mean of |psi|
    if (!this.window || this.window.length !== M) { this.window = new Float64Array(M); this.windowFill = 0; }
    const decay = 1 - 1 / Math.max(2, this.windowSize);
    let dot = 0; let normPsi = 0; let normMean = 0;
    for (let i = 0; i < M; i++) {
      const a = Math.abs(psi[i]);
      this.window[i] = decay * this.window[i] + (1 - decay) * a;
      dot += a * this.window[i];
      normPsi += a * a;
      normMean += this.window[i] * this.window[i];
    }
    this.windowFill = Math.min(this.windowFill + 1, this.windowSize);
    const cosSq = normPsi > 0 && normMean > 0 ? (dot * dot) / (normPsi * normMean) : 0;
    const N = Math.max(0, Math.min(1, 1 - cosSq));

    // salience = ‖∇_k Ψ‖ / ‖Ψ‖
    let gradSq = 0;
    for (let i = 1; i < M; i++) { const d = psi[i] - psi[i - 1]; gradSq += d * d; }
    const S = normPsi > 0 ? Math.sqrt(gradSq / normPsi) : 0;

    // valence
    const V = energy > 0 ? Math.max(-1, Math.min(1, (term1Magnitude - term3Magnitude) / energy)) : 0;

    // integration: H_max − H(p)  where p_i = |psi_i|² / ‖Ψ‖²
    let H = 0;
    if (normPsi > 0) {
      for (let i = 0; i < M; i++) {
        const p = (psi[i] * psi[i]) / normPsi;
        if (p > 0) H -= p * Math.log(p);
      }
    }
    const I = Math.log(M) - H;

    const Cphi = this.goldenDelayOverlap(psi, normPsi);
    const ignited = Cphi >= IGNITION_THRESHOLD;
    this.tickIndex++;
    if (ignited && !this.prevIgnited) this.ignitionMarks.push(this.tickIndex);
    this.prevIgnited = ignited;
    const cutoff = this.tickIndex - IGNITION_WINDOW_TICKS;
    while (this.ignitionMarks.length && this.ignitionMarks[0] < cutoff) this.ignitionMarks.shift();
    const span = Math.min(this.tickIndex, IGNITION_WINDOW_TICKS);
    const ignitions = this.ignitionMarks.length;

    return {
      C: Math.max(0, Math.min(1, coherence)),
      N,
      S,
      V,
      I: Math.max(0, I),
      Cphi,
      ignited,
      ignitions,
      ignitionRate: span > 0 ? ignitions / span : 0,
    };
  }

  /**
   * |⟨Ψ(t)|Ψ(t−φτ)⟩|² / (‖Ψ(t)‖²‖Ψ(t−φτ)‖²) against the real delayed state.
   * Returns 0 until the ring has filled — an unfilled ring must not fake
   * coherence, and a false ignition is worse than a missing one.
   */
  private goldenDelayOverlap(psi: Float64Array, normPsi: number): number {
    const M = psi.length;
    if (this.ringWidth !== M) {
      this.ringWidth = M;
      this.ring = Array.from({ length: GOLDEN_DELAY_TICKS }, () => new Float64Array(M));
      this.ringHead = 0;
      this.ringFill = 0;
    }
    // The slot about to be overwritten holds the state from exactly
    // GOLDEN_DELAY_TICKS ticks ago.
    const past = this.ring[this.ringHead];
    let overlap = 0;
    if (this.ringFill >= GOLDEN_DELAY_TICKS && normPsi > 0) {
      let d = 0, np = 0;
      for (let i = 0; i < M; i++) { d += psi[i] * past[i]; np += past[i] * past[i]; }
      if (np > 0) overlap = (d * d) / (normPsi * np);
    }
    past.set(psi);
    this.ringHead = (this.ringHead + 1) % GOLDEN_DELAY_TICKS;
    if (this.ringFill < GOLDEN_DELAY_TICKS) this.ringFill++;
    return Math.max(0, Math.min(1, overlap));
  }
}
