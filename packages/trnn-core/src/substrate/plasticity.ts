/**
 * plasticity — Ω-REAL P5: memristive and Oja learning for the L1 associative
 * matrix.
 *
 * WHY NOT PLAIN HEBB
 * ------------------
 * Δw = η·x·y is unbounded: correlated input drives every weight to saturation
 * and the matrix stops discriminating. Two bounded rules replace it.
 *
 * OJA
 *   Δwᵢ = η·y·(xᵢ − y·wᵢ),  y = w·x
 * The −y²wᵢ term is an implicit normaliser: the weight vector converges to the
 * principal eigenvector of the input covariance with ‖w‖ → 1, WITHOUT any
 * explicit renormalisation step. This is real unsupervised feature extraction,
 * not a decaying counter.
 *
 * MEMRISTIVE (the missing component)
 *   A physical memristor's conductance moves on a bounded, state-dependent,
 *   RATE-ASYMMETRIC window:
 *     dw/dt = η·f(w)·s,   f(w) = 1 − (2w/wmax − 1)^(2p)   (Joglekar window)
 *   with separate set (potentiation) and reset (depression) rates. Properties
 *   that matter here and that Hebb lacks:
 *     • hard bounds  — w can never leave [wmin, wmax], no clipping artefacts
 *     • sticking     — f(w) → 0 at the rails, so a fully learned synapse
 *                      resists erasure by a single contrary event
 *     • asymmetry    — forgetting is φ⁻¹ slower than learning, so evidence
 *                      accumulates faster than it evaporates
 *     • pinched loop — the state is path-dependent (hysteresis): the same net
 *                      input in a different order gives a different weight,
 *                      which is exactly what makes it a MEMORY element
 *
 * All rules are pure functions over a caller-owned Float64Array so they can be
 * applied in-place inside the engine loop without allocation.
 */

import { dpow } from '../core/dmath';
import { PHI_INV } from '../core/constants';

/* ── Oja ──────────────────────────────────────────────────────────────────── */

export interface OjaResult {
  /** Projection y = w·x for this step. */
  readonly y: number;
  /** ‖w‖ after the update — should converge to 1. */
  readonly norm: number;
  /** Σ|Δw| — how much the step actually moved anything. */
  readonly drift: number;
}

/**
 * One in-place Oja step. `w` is modified; nothing is allocated.
 * η must be small relative to the input scale (η·‖x‖² ≪ 1) or the rule
 * diverges — the caller owns that, and `norm` reports it immediately.
 */
export function ojaStep(w: Float64Array, x: ArrayLike<number>, eta: number): OjaResult {
  const n = Math.min(w.length, x.length);
  let y = 0;
  for (let i = 0; i < n; i++) y += w[i] * x[i];
  let drift = 0, sq = 0;
  for (let i = 0; i < n; i++) {
    const d = eta * y * (x[i] - y * w[i]);
    w[i] += d;
    drift += Math.abs(d);
    sq += w[i] * w[i];
  }
  return { y, norm: Math.sqrt(sq), drift };
}

/**
 * Sanger / Generalised Hebbian rule: Oja extended to K components, extracting
 * the top-K principal subspace in ONE pass, ordered by eigenvalue. Rows of `W`
 * are the components (row-major, K×D).
 */
export function sangerStep(W: Float64Array, k: number, d: number, x: ArrayLike<number>, eta: number): Float64Array {
  const y = new Float64Array(k);
  for (let a = 0; a < k; a++) {
    let s = 0;
    const off = a * d;
    for (let i = 0; i < d; i++) s += W[off + i] * x[i];
    y[a] = s;
  }
  for (let a = 0; a < k; a++) {
    const off = a * d;
    for (let i = 0; i < d; i++) {
      let back = 0;
      for (let b = 0; b <= a; b++) back += y[b] * W[b * d + i];
      W[off + i] += eta * y[a] * (x[i] - back);
    }
  }
  return y;
}

/* ── memristive ───────────────────────────────────────────────────────────── */

export interface MemristiveParams {
  /** Potentiation rate. */
  readonly etaSet: number;
  /** Depression rate; defaults to φ⁻¹·etaSet (forgetting is slower). */
  readonly etaReset?: number;
  readonly wMin?: number;
  readonly wMax?: number;
  /** Joglekar window exponent p ≥ 1; higher p = harder rails. */
  readonly p?: number;
}

/**
 * Joglekar window f(w) = 1 − (2·ŵ − 1)^(2p) on the normalised state ŵ.
 * f(wMin) = f(wMax) = 0 exactly, f(midpoint) = 1.
 */
export function joglekarWindow(w: number, wMin = 0, wMax = 1, p = 1): number {
  if (!(wMax > wMin)) return NaN;
  const wh = (w - wMin) / (wMax - wMin);
  if (wh <= 0 || wh >= 1) return 0;
  const u = 2 * wh - 1;
  const f = 1 - dpow(u * u, p);
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/**
 * One memristive update. `s` is the signed drive (e.g. pre·post correlation):
 * s > 0 potentiates at etaSet, s < 0 depresses at etaReset. The state can
 * never leave [wMin, wMax] because the window vanishes at both rails.
 */
export function memristiveStep(w: number, s: number, params: MemristiveParams): number {
  const wMin = params.wMin ?? 0;
  const wMax = params.wMax ?? 1;
  const p = params.p ?? 1;
  if (!Number.isFinite(w) || !Number.isFinite(s)) return w;
  const eta = s >= 0 ? params.etaSet : (params.etaReset ?? params.etaSet * PHI_INV);
  const f = joglekarWindow(w, wMin, wMax, p);
  const next = w + eta * f * s;
  return next < wMin ? wMin : next > wMax ? wMax : next;
}

/** Apply a memristive update to a whole weight vector in place. */
export function memristiveVector(
  w: Float64Array,
  drive: ArrayLike<number>,
  params: MemristiveParams,
): number {
  const n = Math.min(w.length, drive.length);
  let drift = 0;
  for (let i = 0; i < n; i++) {
    const before = w[i];
    w[i] = memristiveStep(before, drive[i], params);
    drift += Math.abs(w[i] - before);
  }
  return drift;
}

/**
 * BCM sliding threshold: potentiate only above a running average of squared
 * post-synaptic activity, depress below it. This is what stops a memristive
 * array from potentiating everything when the whole field is loud.
 *   Δw = η·x·y·(y − θ),  θ ← θ + (y² − θ)/τ
 */
export class BcmThreshold {
  private theta: number;
  constructor(readonly tau: number, initial = 0) { this.theta = initial; }
  get value(): number { return this.theta; }
  /** Update θ with a new post-synaptic activity and return the drive factor. */
  observe(y: number): number {
    if (!Number.isFinite(y)) return 0;
    this.theta += (y * y - this.theta) / Math.max(1, this.tau);
    return y - this.theta;
  }
}
