/**
 * Measurement plane — read-only. Nothing here ever actuates the field.
 *
 * Golden-delay coherence (BRAINMAP 2.6):
 *   C(t) = |<Psi(t)|Psi(t-233)>|^2 / (|Psi(t)|^2 |Psi(t-233)|^2)
 * Ignition is an up-crossing of phi^-2.
 *
 * The delay ring is the only large buffer here; it is explicitly retained at
 * exactly DELAY+1 frames (Law L6).
 */

import { COHERENCE_DELAY, IGNITION_THRESHOLD } from '../core/constants';
import type { CField } from '../core/complex';

export interface CoherenceReading {
  /** C(t) in [0,1]; NaN-free (0 until the ring is warm). */
  readonly c: number;
  /** True on the tick where C crosses phi^-2 upward. */
  readonly ignition: boolean;
  /** True once the ring holds a full delay window. */
  readonly warm: boolean;
}

export class CoherenceMeter {
  private readonly ringRe: Float64Array;
  private readonly ringIm: Float64Array;
  private readonly width: number;
  private readonly frames: number;
  private cursor = 0;
  private written = 0;
  private last = 0;

  constructor(width: number, delay = COHERENCE_DELAY) {
    this.width = width;
    this.frames = delay + 1;
    this.ringRe = new Float64Array(this.frames * width);
    this.ringIm = new Float64Array(this.frames * width);
  }

  reset(): void {
    this.ringRe.fill(0);
    this.ringIm.fill(0);
    this.cursor = 0;
    this.written = 0;
    this.last = 0;
  }

  /** Push the current field and read C(t). */
  push(psi: CField): CoherenceReading {
    const w = this.width;
    const base = this.cursor * w;
    for (let i = 0; i < w; i++) {
      this.ringRe[base + i] = psi.re[i];
      this.ringIm[base + i] = psi.im[i];
    }
    const warm = this.written >= this.frames - 1;
    let c = 0;
    if (warm) {
      const old = ((this.cursor + 1) % this.frames) * w;
      let ir = 0;
      let ii = 0;
      let na = 0;
      let nb = 0;
      for (let i = 0; i < w; i++) {
        const ar = this.ringRe[base + i];
        const ai = this.ringIm[base + i];
        const br = this.ringRe[old + i];
        const bi = this.ringIm[old + i];
        ir += ar * br + ai * bi;
        ii += ar * bi - ai * br;
        na += ar * ar + ai * ai;
        nb += br * br + bi * bi;
      }
      const den = na * nb;
      c = den > 0 ? (ir * ir + ii * ii) / den : 0;
      if (c > 1) c = 1;
    }
    this.cursor = (this.cursor + 1) % this.frames;
    this.written++;
    const ignition = warm && this.last <= IGNITION_THRESHOLD && c > IGNITION_THRESHOLD;
    this.last = c;
    return { c, ignition, warm };
  }
}
