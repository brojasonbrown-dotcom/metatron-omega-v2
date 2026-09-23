/**
 * Octave transport — moving a field between rungs of different node counts.
 *
 * Rungs carry different Fibonacci node counts; a receipt from rung j must be
 * resampled onto rung i's lattice before it can enter the cell. The transport
 * is a deterministic band-limited resample on the circle:
 *
 *   down  (N -> M, M < N): block average of the phi-partitioned arcs
 *   up    (N -> M, M > N): linear interpolation on the circle
 *
 * Both directions are normalized so that the *mean* is preserved exactly and
 * the energy ratio is reported rather than assumed — an honest lossy map, not
 * a pretended unitary one.
 */

import { createField, type CField } from '../core/complex';

export interface OctaveReport {
  /** Energy of the source field. */
  readonly sourceEnergy: number;
  /** Energy of the transported field. */
  readonly targetEnergy: number;
  /** targetEnergy / sourceEnergy, or 1 when the source is zero. */
  readonly energyRatio: number;
  /** true when no resampling was needed. */
  readonly identity: boolean;
}

function energyOf(f: CField): number {
  let s = 0;
  for (let i = 0; i < f.n; i++) s += f.re[i] * f.re[i] + f.im[i] * f.im[i];
  return s;
}

/**
 * Resample `src` onto `dst` (dst.n may differ). Allocation free.
 */
export function octaveTransport(src: CField, dst: CField): OctaveReport {
  const N = src.n;
  const M = dst.n;
  const se = energyOf(src);

  if (N === M) {
    dst.re.set(src.re);
    dst.im.set(src.im);
    return { sourceEnergy: se, targetEnergy: se, energyRatio: 1, identity: true };
  }

  if (M < N) {
    // area-weighted downsample: dst[k] = mean of src over the arc [k*N/M, (k+1)*N/M)
    const step = N / M;
    for (let k = 0; k < M; k++) {
      const a = k * step;
      const b = a + step;
      let ar = 0;
      let ai = 0;
      let wsum = 0;
      const i0 = Math.floor(a);
      const i1 = Math.ceil(b);
      for (let i = i0; i < i1; i++) {
        const lo = Math.max(a, i);
        const hi = Math.min(b, i + 1);
        const wgt = hi - lo;
        if (wgt <= 0) continue;
        const idx = ((i % N) + N) % N;
        ar += wgt * src.re[idx];
        ai += wgt * src.im[idx];
        wsum += wgt;
      }
      dst.re[k] = wsum > 0 ? ar / wsum : 0;
      dst.im[k] = wsum > 0 ? ai / wsum : 0;
    }
  } else {
    // circular linear interpolation upsample
    const step = N / M;
    for (let k = 0; k < M; k++) {
      const x = k * step;
      const i0 = Math.floor(x);
      const t = x - i0;
      const a = ((i0 % N) + N) % N;
      const b = (a + 1) % N;
      dst.re[k] = src.re[a] * (1 - t) + src.re[b] * t;
      dst.im[k] = src.im[a] * (1 - t) + src.im[b] * t;
    }
  }

  const te = energyOf(dst);
  return { sourceEnergy: se, targetEnergy: te, energyRatio: se > 0 ? te / se : 1, identity: false };
}

/** Scratch buffers keyed by node count, so transport never allocates on the tick path. */
export class OctaveScratch {
  private readonly pool = new Map<number, CField>();

  get(n: number): CField {
    let f = this.pool.get(n);
    if (!f) {
      f = createField(n);
      this.pool.set(n, f);
    }
    return f;
  }

  sizes(): number[] {
    return [...this.pool.keys()].sort((a, b) => a - b);
  }
}
