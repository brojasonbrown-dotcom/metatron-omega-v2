/**
 * Closure term Pi and its residual flux.
 *
 * [MATH] Closure obstruction: L(n) mod 13 is never 0, so a toroidal rung never
 * closes exactly. The mismatch between a field and its golden-angle rotated
 * self is real and must be *routed*, not discarded — kappa = 1/(phi*pi) damps
 * it into the Pi target, and whatever is left is reported as residual flux for
 * the ledger.
 */

import { KAPPA } from '../core/constants';
import type { CField } from '../core/complex';
import { dcos, dsin } from '../core/dmath';

export interface ClosureReport {
  /** ||Pi - z||_2 before damping — the raw obstruction (extensive). */
  readonly obstruction: number;
  /** Energy left unrouted after the kappa damping (goes to the flux sink). */
  readonly residualFlux: number;
  /** Turn index of the golden-angle walk. */
  readonly turn: number;
  /**
   * [MATH] Phase-aligned closure defect — the dimensionless one.
   *
   * The golden-angle rotation is a *global* phase: Pi = e^{i*theta} S z, so
   * ||Pi - z|| carries the whole walk angle theta and oscillates tick to tick
   * with the rung amplitude and node count folded in. It is a flux quantity,
   * not an error.
   *
   * The scale-free defect is what remains once that known global phase is
   * removed — the minimum over phi of ||e^{i*phi} S z - z|| / ||z||:
   *
   *   gamma  = |<S z, z>| / ||z||^2        in [0, 1]   (shift autocorrelation)
   *   defect = sqrt(2 - 2*gamma)           in [0, 2]
   *
   * defect = 0 is exact toroidal closure (z is a shift eigenvector, i.e. a
   * pure lattice mode); defect = sqrt(2) is decorrelated; 2 is phase reversal.
   * Invariant under amplitude, node count and the walk angle — this is what
   * the corridor gate must read.
   */
  readonly defect: number;
  /** Shift autocorrelation magnitude gamma in [0, 1]. */
  readonly closure: number;
}

/**
 * Build the closure target Pi from z: a kappa-damped, golden-angle phase
 * rotated copy of the field's own circular shift. Deterministic, allocation
 * free (writes into `pi`).
 */
export function closureTarget(z: CField, pi: CField, turn: number, shift: number): ClosureReport {
  const n = z.n;
  if (n === 0) return { obstruction: 0, residualFlux: 0, turn, defect: 0, closure: 1 };
  const theta = 2 * Math.PI * ((turn * (1 / 1.618033988749895)) % 1);
  const c = dcos(theta);
  const s = dsin(theta);

  let obs = 0;
  let flux = 0;
  // Shift autocorrelation <S z, z> and the field energy, accumulated in the
  // same pass — no second sweep over the rung.
  let ar = 0;
  let ai = 0;
  let e = 0;
  const sh = ((shift % n) + n) % n;
  for (let i = 0; i < n; i++) {
    const j = (i + sh) % n;
    const rr = z.re[j] * c - z.im[j] * s;
    const ri = z.re[j] * s + z.im[j] * c;
    const dr = rr - z.re[i];
    const di = ri - z.im[i];
    obs += dr * dr + di * di;
    pi.re[i] = z.re[i] + KAPPA * dr;
    pi.im[i] = z.im[i] + KAPPA * di;
    const ur = (1 - KAPPA) * dr;
    const ui = (1 - KAPPA) * di;
    flux += ur * ur + ui * ui;
    // conj(z_i) * z_{i+sh}
    ar += z.re[i] * z.re[j] + z.im[i] * z.im[j];
    ai += z.re[i] * z.im[j] - z.im[i] * z.re[j];
    e += z.re[i] * z.re[i] + z.im[i] * z.im[i];
  }

  // A dead rung has no closure to measure. Reporting defect 0 there would read
  // as perfect closure, so an empty field is reported as fully decorrelated.
  const gamma = e > 1e-300 ? Math.min(1, Math.sqrt(ar * ar + ai * ai) / e) : 0;
  const defect = Math.sqrt(Math.max(0, 2 - 2 * gamma));

  return { obstruction: Math.sqrt(obs), residualFlux: flux, turn, defect, closure: gamma };
}
