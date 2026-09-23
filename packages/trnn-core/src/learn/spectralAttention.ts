/**
 * Ω-SHFN Section E · Path C — cross-spectral phase attention.
 *
 * Dot-product attention is O(n²) and, worse, it is blind to phase: two fields
 * that differ only by a rotation of the torus look unrelated to it. The
 * frequency domain gives the right primitive for free:
 *
 *   A(c_q, c_m) = ℱ⁻¹{ ℱ(c_q) · conj(ℱ(c_m)) }
 *
 * — the circular cross-correlation along the *coefficient* axis, O(K log K)
 * through the Section-B transform. Its peak locates the modal offset between
 * the query and the memory, and its argument at each lag is the phase by which
 * the memory must be rotated to line up with the query.
 *
 * The output is deliberately reduced to a **pure phase rotation** e^{iθ_k}:
 * unit modulus, so the operator is an isometry. It contributes exactly 0 to the
 * ISS drive sum — the cheapest possible admission into the certified cell, and
 * the reason this path can run at full strength while Paths A and B are still
 * gated down.
 */

import { crossCorrelate } from '../spectral/fft';
import { datan2, dcos, dmag, dsin } from '../core/dmath';

export interface AttentionReport {
  /** Lag (in modes) of the correlation peak — the measured modal offset. */
  readonly lag: number;
  /** Peak magnitude, normalised by the geometric mean of the two energies. */
  readonly alignment: number;
  /** Mean |θ_k| applied, radians. */
  readonly meanRotation: number;
}

function deinterleave(coeffs: Float64Array, modes: number): { re: Float64Array; im: Float64Array } {
  const re = new Float64Array(modes);
  const im = new Float64Array(modes);
  for (let k = 0; k < modes; k++) {
    re[k] = coeffs[2 * k];
    im[k] = coeffs[2 * k + 1];
  }
  return { re, im };
}

/**
 * Rotate `coeffs` in place by the phase profile that best aligns it with
 * `memory`. `strength` ∈ [0,1] scales the rotation angle; 0 is the identity,
 * which is what keeps a default build bit-identical to the oracle.
 */
export function applySpectralAttention(
  coeffs: Float64Array,
  memory: Float64Array,
  modes: number,
  strength = 1,
): AttentionReport {
  if (coeffs.length < 2 * modes || memory.length < 2 * modes) {
    throw new RangeError('applySpectralAttention: buffers shorter than the declared mode count');
  }
  const s = Math.min(1, Math.max(0, strength));
  const q = deinterleave(coeffs, modes);
  const m = deinterleave(memory, modes);
  const c = crossCorrelate(q, m);

  let lag = 0;
  let peak = -1;
  let sumRot = 0;
  for (let k = 0; k < modes; k++) {
    const mag = dmag(c.re[k], c.im[k]);
    if (mag > peak) {
      peak = mag;
      lag = k;
    }
  }

  let eq = 0;
  let em = 0;
  for (let k = 0; k < modes; k++) {
    eq += q.re[k] ** 2 + q.im[k] ** 2;
    em += m.re[k] ** 2 + m.im[k] ** 2;
  }
  const denom = Math.sqrt(eq * em);

  if (s > 0) {
    for (let k = 0; k < modes; k++) {
      const theta = s * datan2(c.im[k], c.re[k]);
      sumRot += Math.abs(theta);
      const ct = dcos(theta);
      const st = dsin(theta);
      const cr = coeffs[2 * k];
      const ci = coeffs[2 * k + 1];
      coeffs[2 * k] = cr * ct - ci * st;
      coeffs[2 * k + 1] = cr * st + ci * ct;
    }
  }

  return {
    lag,
    alignment: denom > 0 ? peak / denom : 0,
    meanRotation: modes > 0 ? sumRot / modes : 0,
  };
}
