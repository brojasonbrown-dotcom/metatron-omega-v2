/**
 * RHUFT-F contraction certificates — principle ① "contract first, compose second".
 *
 * A rung may only participate in a composed chain when its operator is an
 * empirical contraction (λ < 1). We estimate λ from the live error sequence
 *
 *     e_t = ψ_t − ψ̂_t          λ_t = ‖e_t‖ / ‖e_{t−1}‖
 *
 * and hold a windowed GEOMETRIC mean of λ_t (log domain, Neumaier
 * accumulated) so a single spike cannot dominate the certificate.
 *
 * Each rung additionally carries a spec floor (φ⁻², φ⁻³, φ⁻¹·⁵ …). The floor
 * is the rate the scale is *supposed* to achieve; `slack = floor − empirical`
 * is positive when the rung meets spec and negative when it is off-spec.
 *
 * Pure, allocation-flat after construction, no RNG, no module-scope compute.
 */

import { PHI } from '@metatron/field-kernel-core';

/** φ^(−k) without pow-domain error accumulation for small k. */
export function phiPow(k: number): number {
  return Math.exp(-k * Math.log(PHI));
}

/**
 * Certified contraction floors per rung, expressed as φ-exponents.
 * Derived from the per-scale stability specs: tighter (larger exponent)
 * where the operator is a strict projection, looser where the rung carries
 * an open boundary (n=7 sub-Planckian ceiling, n=8 hyper-galactic spiral).
 */
export const CONTRACTION_FLOOR_EXPONENT: readonly number[] = Object.freeze([
  2,    // n=0 Septenary
  3,    // n=1 Quantum (Perron mode — strongest contraction)
  2,    // n=2 Atomic
  2,    // n=3 Geometric
  1.5,  // n=4 Color/Music
  1.5,  // n=5 Hebrew
  1.5,  // n=6 Galactic
  1,    // n=7 Sub-Planckian (open ceiling)
  1.5,  // n=8 Hyper-Galactic (Fiedler mode)
]);

export function contractionFloor(scale: number): number {
  const k = CONTRACTION_FLOOR_EXPONENT[scale] ?? 1;
  return phiPow(k);
}

export interface ContractionCertificate {
  readonly scale: number;
  /**
   * Windowed geometric mean of the OPERATOR's local Lipschitz ratio
   *   λ = ‖T(ψ + εu) − T(ψ)‖ / (ε‖u‖)
   * This is the contraction rate principle ① actually talks about. NaN before
   * the first successful probe.
   */
  readonly lambdaEmpirical: number;
  /** Instantaneous Lipschitz ratio for the most recent probe. */
  readonly lambdaInstant: number;
  /**
   * Windowed geomean of the DRIVEN error ratio ‖e_t‖/‖e_{t−1}‖. Diagnostic
   * only: a continuously re-excited field holds this near 1 no matter how
   * contractive the operator is, so it must never gate the chain.
   */
  readonly lambdaDrive: number;
  /** Spec floor φ^(−k) for this rung. */
  readonly lambdaFloor: number;
  /** floor − empirical. Positive = meets spec. */
  readonly slack: number;
  /** True when the operator is a measured contraction (λ < 1). */
  readonly certified: boolean;
  /** Number of Lipschitz samples currently in the window. */
  readonly samples: number;
}

/**
 * Deterministic unit probe direction — golden-angle phases, no RNG, so the
 * certificate is reproducible tick to tick and across hosts.
 */
export function probeDirection(out: Float64Array): void {
  const n = out.length;
  if (n === 0) return;
  const step = 2 * Math.PI * (1 - 1 / PHI); // golden angle in radians
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.cos(step * (i + 1));
    out[i] = v;
    acc += v * v;
  }
  const norm = Math.sqrt(acc);
  if (norm > 0) for (let i = 0; i < n; i++) out[i] /= norm;
}


const EPS = 1e-300;

/** Neumaier accumulator (matches the kernel's numerics). */
interface NAcc { s: number; c: number; }
function nAcc(): NAcc { return { s: 0, c: 0 }; }
function nAdd(a: NAcc, x: number): void {
  if (!Number.isFinite(x)) return;
  const s = a.s;
  const t = s + x;
  a.c += Math.abs(s) >= Math.abs(x) ? (s - t) + x : (x - t) + s;
  a.s = t;
}
function nVal(a: NAcc): number { return a.s + a.c; }

class RungWindow {
  private readonly buf: Float64Array;   // stores ln(λ_t)
  private len = 0;
  private head = 0;
  prevNorm = NaN;
  lastRatio = NaN;

  constructor(window: number) { this.buf = new Float64Array(window); }

  push(lnRatio: number): void {
    if (!Number.isFinite(lnRatio)) return;
    this.buf[this.head] = lnRatio;
    this.head = (this.head + 1) % this.buf.length;
    if (this.len < this.buf.length) this.len++;
  }

  geomean(): number {
    if (this.len === 0) return NaN;
    const acc = nAcc();
    for (let i = 0; i < this.len; i++) nAdd(acc, this.buf[i]);
    return Math.exp(nVal(acc) / this.len);
  }

  get samples(): number { return this.len; }
}

export class ContractionTracker {
  /** Lipschitz window — this is what certifies the rung. */
  private readonly lip = new Map<number, RungWindow>();
  /** Driven-error window — diagnostic only. */
  private readonly drive = new Map<number, RungWindow>();

  constructor(private readonly window = 34) {}

  /**
   * Feed the driven error norm ‖ψ − ψ̂‖ (NOT squared) for a rung. Recorded for
   * display; it does NOT decide certification, because a field that is
   * re-excited every tick pins this ratio near 1 regardless of the operator.
   */
  observeDrive(scale: number, errNorm: number): void {
    let w = this.drive.get(scale);
    if (!w) { w = new RungWindow(this.window); this.drive.set(scale, w); }

    if (Number.isFinite(errNorm) && Number.isFinite(w.prevNorm) && w.prevNorm > EPS) {
      const ratio = errNorm / w.prevNorm;
      if (ratio > EPS && Number.isFinite(ratio)) {
        w.lastRatio = ratio;
        w.push(Math.log(ratio));
      }
    }
    if (Number.isFinite(errNorm)) w.prevNorm = errNorm;
  }

  /**
   * Feed one Lipschitz probe ratio ‖T(ψ+εu) − T(ψ)‖ / (ε‖u‖) for a rung.
   * Pass NaN when the probe could not run this tick.
   */
  observeLipschitz(scale: number, ratio: number): void {
    let w = this.lip.get(scale);
    if (!w) { w = new RungWindow(this.window); this.lip.set(scale, w); }
    if (Number.isFinite(ratio) && ratio > EPS) {
      w.lastRatio = ratio;
      w.push(Math.log(ratio));
    }
  }

  /** Certificate for a rung from whatever has been observed so far. */
  certificate(scale: number): ContractionCertificate {
    const lw = this.lip.get(scale);
    const dw = this.drive.get(scale);
    const empirical = lw ? lw.geomean() : NaN;
    const floor = contractionFloor(scale);
    return {
      scale,
      lambdaEmpirical: empirical,
      lambdaInstant: lw ? lw.lastRatio : NaN,
      lambdaDrive: dw ? dw.geomean() : NaN,
      lambdaFloor: floor,
      slack: Number.isFinite(empirical) ? floor - empirical : NaN,
      certified: Number.isFinite(empirical) && empirical < 1,
      samples: lw ? lw.samples : 0,
    };
  }

  reset(): void { this.lip.clear(); this.drive.clear(); }
}

export interface ChainReport {
  /** Π λ_i over the maximal run of consecutive certified rungs. */
  readonly chainRate: number;
  /** Scale ids in that run, in order. */
  readonly members: readonly number[];
  /** Rungs excluded because they are not certified (still measured/shown). */
  readonly excluded: readonly number[];
}

/**
 * Composition gate: only consecutive certified rungs may be chained, and the
 * composed error rate is the product of their individual rates.
 */
export function composeChain(certs: readonly ContractionCertificate[]): ChainReport {
  const sorted = [...certs].sort((a, b) => a.scale - b.scale);
  const excluded: number[] = [];
  let best: number[] = [];
  let bestRate = NaN;
  let run: number[] = [];
  let runRate = 1;

  const flush = () => {
    if (run.length > best.length) { best = run; bestRate = runRate; }
    run = []; runRate = 1;
  };

  for (const c of sorted) {
    if (c.certified) {
      run.push(c.scale);
      runRate *= c.lambdaEmpirical;
    } else {
      excluded.push(c.scale);
      flush();
    }
  }
  flush();

  return {
    chainRate: best.length > 0 ? bestRate : NaN,
    members: best,
    excluded,
  };
}
