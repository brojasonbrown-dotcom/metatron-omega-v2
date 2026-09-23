/**
 * Structure-preserving checks for the web (BRAINMAP 3.5).
 *
 * Two properties make the web a morphism rather than an ad-hoc mixer:
 *
 *   M1 transport commutes with a global phase — rotating a field and then
 *      resampling equals resampling and then rotating (exact up to float);
 *   M2 transport is mean-preserving — the circular mean survives the octave.
 *
 * Both are *measured* here and reported as defects; nothing is asserted inside
 * the engine, the gate battery decides whether a defect is acceptable.
 */

import { createField, type CField } from '../core/complex';
import { octaveTransport } from './octave';
import { dcos, dsin } from '../core/dmath';

export interface MorphismReport {
  /** max |rotate(transport(z)) - transport(rotate(z))|. */
  readonly phaseCommutationDefect: number;
  /** |mean(transport(z)) - mean(z)|. */
  readonly meanDefect: number;
}

function mean(f: CField): { re: number; im: number } {
  let r = 0;
  let i = 0;
  for (let k = 0; k < f.n; k++) {
    r += f.re[k];
    i += f.im[k];
  }
  return f.n > 0 ? { re: r / f.n, im: i / f.n } : { re: 0, im: 0 };
}

function rotate(src: CField, dst: CField, theta: number): void {
  const c = dcos(theta);
  const s = dsin(theta);
  for (let i = 0; i < src.n; i++) {
    dst.re[i] = src.re[i] * c - src.im[i] * s;
    dst.im[i] = src.re[i] * s + src.im[i] * c;
  }
}

/** Probe the two morphism laws for one source/target pair. */
export function checkMorphism(z: CField, targetNodes: number, theta = 1.0471975511965976): MorphismReport {
  const t1 = createField(targetNodes);
  const t2 = createField(targetNodes);
  const rotSrc = createField(z.n);
  const rotT1 = createField(targetNodes);

  octaveTransport(z, t1);
  rotate(t1, rotT1, theta);

  rotate(z, rotSrc, theta);
  octaveTransport(rotSrc, t2);

  let d = 0;
  for (let i = 0; i < targetNodes; i++) {
    const dr = rotT1.re[i] - t2.re[i];
    const di = rotT1.im[i] - t2.im[i];
    const a = Math.sqrt(dr * dr + di * di);
    if (a > d) d = a;
  }

  const ms = mean(z);
  const mt = mean(t1);
  const mr = mt.re - ms.re;
  const mi = mt.im - ms.im;
  return {
    phaseCommutationDefect: d,
    meanDefect: Math.sqrt(mr * mr + mi * mi),
  };

}
