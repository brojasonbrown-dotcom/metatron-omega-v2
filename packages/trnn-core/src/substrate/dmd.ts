/**
 * dmd — Ω-REAL P5: Dynamic Mode Decomposition over L0 field trajectories.
 *
 * WHAT IT BUYS
 * ------------
 * The tape holds snapshots x₀…x_m of the field. DMD fits the best-fit LINEAR
 * operator A with x_{k+1} ≈ A·x_k, then reads its eigenvalues λⱼ. Each mode is
 * a coherent structure with a growth rate and a frequency:
 *
 *   growth   = ln|λ| / Δt     (>0 growing, <0 decaying, ≈0 sustained)
 *   freq     = arg(λ) / (2π·Δt)
 *
 * That converts "the field did something" into "the field contains a mode at
 * f Hz decaying with time constant τ" — a physical statement, and a genuine
 * one-step-ahead PREDICTOR the machine can be scored against.
 *
 * METHOD
 * ------
 * Exact DMD on the rank-r POD subspace:
 *   1. X = [x₀…x_{m-1}], Y = [x₁…x_m]
 *   2. thin SVD of X via eigendecomposition of the small Gram matrix XᵀX
 *      (m ≪ D here, so the m×m route is both cheaper and better conditioned
 *      than a D×D one), by cyclic one-sided Jacobi — deterministic, no LAPACK
 *   3. rank truncation at singular values below `rankTol`·σ₀
 *   4. Ã = Uᵀ Y V Σ⁻¹, eigenvalues of Ã by unshifted Hessenberg-free QR on the
 *      small r×r matrix (real Schur → 1×1 and 2×2 blocks give the complex pair)
 *
 * ABSTENTION
 * ----------
 * Fewer than `MIN_SNAPSHOTS` columns, a rank-0 subspace, or a non-finite
 * snapshot means the fit does not exist — the API returns `null` rather than a
 * confident set of made-up modes.
 */

import { datan2, dlog } from '../core/dmath';

/** A linear fit needs more columns than the modes it claims; F7 = 13. */
export const MIN_SNAPSHOTS = 13;

export interface DmdMode {
  /** Eigenvalue of the reduced operator. */
  readonly lambdaRe: number;
  readonly lambdaIm: number;
  /** |λ| — per-step amplification. */
  readonly magnitude: number;
  /** Continuous-time growth rate ln|λ|/Δt (1/s). */
  readonly growth: number;
  /** Frequency arg(λ)/(2π·Δt) in Hz. */
  readonly frequency: number;
  /** Energy share of this mode in the fitted subspace ∈ [0,1]. */
  readonly energy: number;
}

export interface DmdFit {
  readonly rank: number;
  readonly modes: readonly DmdMode[];
  /** Singular values of the snapshot matrix, descending. */
  readonly singularValues: readonly number[];
  /** One-step reconstruction error ‖Y − A·X‖_F / ‖Y‖_F ∈ [0,∞). */
  readonly relError: number;
  /** Spectral radius max|λ| — >1 means the fitted dynamics grow. */
  readonly spectralRadius: number;
  /** Predict the next snapshot from the last one. */
  predict(x: ArrayLike<number>): Float64Array;
}

/* ── small dense linear algebra (deterministic, no libm on state paths) ────── */

/** Symmetric eigendecomposition by cyclic Jacobi. A is n×n row-major, destroyed. */
export function jacobiEigen(
  A: Float64Array,
  n: number,
  sweeps = 60,
): { values: Float64Array; vectors: Float64Array } {
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let s = 0; s < sweeps; s++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] * A[p * n + q];
    if (off <= 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = A[p * n + p],
          aqq = A[q * n + q];
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const sn = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p],
            akq = A[k * n + q];
          A[k * n + p] = c * akp - sn * akq;
          A[k * n + q] = sn * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k],
            aqk = A[q * n + k];
          A[p * n + k] = c * apk - sn * aqk;
          A[q * n + k] = sn * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p],
            vkq = V[k * n + q];
          V[k * n + p] = c * vkp - sn * vkq;
          V[k * n + q] = sn * vkp + c * vkq;
        }
      }
    }
  }
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) values[i] = A[i * n + i];
  return { values, vectors: V };
}

/**
 * Reduce a general real matrix to upper Hessenberg form by Gaussian
 * elimination with pivoting (elmhes). In place, row-major n×n.
 */
export function hessenberg(A: Float64Array, n: number): void {
  for (let m = 1; m < n - 1; m++) {
    let x = 0,
      i = m;
    for (let j = m; j < n; j++) {
      if (Math.abs(A[j * n + (m - 1)]) > Math.abs(x)) {
        x = A[j * n + (m - 1)];
        i = j;
      }
    }
    if (i !== m) {
      for (let j = m - 1; j < n; j++) {
        const t = A[i * n + j];
        A[i * n + j] = A[m * n + j];
        A[m * n + j] = t;
      }
      for (let j = 0; j < n; j++) {
        const t = A[j * n + i];
        A[j * n + i] = A[j * n + m];
        A[j * n + m] = t;
      }
    }
    if (x !== 0) {
      for (let k = m + 1; k < n; k++) {
        let y = A[k * n + (m - 1)];
        if (y === 0) continue;
        y /= x;
        A[k * n + (m - 1)] = y;
        for (let j = m; j < n; j++) A[k * n + j] -= y * A[m * n + j];
        for (let j = 0; j < n; j++) A[j * n + m] += y * A[j * n + k];
      }
    }
  }
  for (let i = 2; i < n; i++) for (let j = 0; j < i - 1; j++) A[i * n + j] = 0;
}

/**
 * Eigenvalues of a general real matrix: Hessenberg reduction followed by the
 * Francis DOUBLE-shift QR iteration (hqr).
 *
 * The double shift is not an optimisation — a single real shift cannot deflate
 * a complex-conjugate pair, so a single-shift implementation simply spins on
 * any oscillatory system and returns nothing. Oscillation is exactly what this
 * machine's trajectories are made of, so the double shift is mandatory.
 *
 * Returns real and imaginary parts; conjugate pairs come out adjacent.
 */
export function generalEigenvalues(
  M: Float64Array,
  n: number,
  iters = 60,
): { re: Float64Array; im: Float64Array } {
  const a = Float64Array.from(M);
  hessenberg(a, n);
  const wr = new Float64Array(n);
  const wi = new Float64Array(n);
  const A = (i: number, j: number) => a[i * n + j];
  const set = (i: number, j: number, v: number) => {
    a[i * n + j] = v;
  };

  let anorm = 0;
  for (let i = 0; i < n; i++)
    for (let j = Math.max(i - 1, 0); j < n; j++) anorm += Math.abs(A(i, j));

  let nn = n - 1;
  let t = 0;
  while (nn >= 0) {
    let its = 0;
    let l: number;
    do {
      for (l = nn; l >= 1; l--) {
        const s = Math.abs(A(l - 1, l - 1)) + Math.abs(A(l, l));
        const sc = s === 0 ? anorm : s;
        if (Math.abs(A(l, l - 1)) + sc === sc) {
          set(l, l - 1, 0);
          break;
        }
      }
      let x = A(nn, nn);
      if (l === nn) {
        wr[nn] = x + t;
        wi[nn] = 0;
        nn--;
        break;
      }
      let y = A(nn - 1, nn - 1);
      let w = A(nn, nn - 1) * A(nn - 1, nn);
      if (l === nn - 1) {
        const p = 0.5 * (y - x);
        const q = p * p + w;
        let z = Math.sqrt(Math.abs(q));
        x += t;
        if (q >= 0) {
          z = p + (p >= 0 ? Math.abs(z) : -Math.abs(z));
          wr[nn - 1] = wr[nn] = x + z;
          if (z !== 0) wr[nn] = x - w / z;
          wi[nn - 1] = wi[nn] = 0;
        } else {
          wr[nn - 1] = wr[nn] = x + p;
          wi[nn - 1] = -(wi[nn] = z);
        }
        nn -= 2;
        break;
      }
      if (its === iters) {
        wr[nn] = x + t;
        wi[nn] = 0;
        nn--;
        break;
      }
      let p = 0,
        q = 0,
        r = 0,
        z = 0,
        s = 0;
      if (its === 10 || its === 20) {
        // exceptional shift — breaks the rare cycling case
        t += x;
        for (let i = 0; i <= nn; i++) set(i, i, A(i, i) - x);
        s = Math.abs(A(nn, nn - 1)) + Math.abs(A(nn - 1, nn - 2));
        y = x = 0.75 * s;
        w = -0.4375 * s * s;
      }
      its++;
      let m: number;
      for (m = nn - 2; m >= l; m--) {
        z = A(m, m);
        r = x - z;
        s = y - z;
        p = (r * s - w) / A(m + 1, m) + A(m, m + 1);
        q = A(m + 1, m + 1) - z - r - s;
        r = A(m + 2, m + 1);
        s = Math.abs(p) + Math.abs(q) + Math.abs(r);
        p /= s;
        q /= s;
        r /= s;
        if (m === l) break;
        const u = Math.abs(A(m, m - 1)) * (Math.abs(q) + Math.abs(r));
        const v =
          Math.abs(p) * (Math.abs(A(m - 1, m - 1)) + Math.abs(z) + Math.abs(A(m + 1, m + 1)));
        if (u + v === v) break;
      }
      for (let i = m + 2; i <= nn; i++) {
        set(i, i - 2, 0);
        if (i !== m + 2) set(i, i - 3, 0);
      }
      for (let k = m; k <= nn - 1; k++) {
        if (k !== m) {
          p = A(k, k - 1);
          q = A(k + 1, k - 1);
          r = k !== nn - 1 ? A(k + 2, k - 1) : 0;
          x = Math.abs(p) + Math.abs(q) + Math.abs(r);
          if (x !== 0) {
            p /= x;
            q /= x;
            r /= x;
          }
        }
        const sg = Math.sqrt(p * p + q * q + r * r);
        s = p >= 0 ? Math.abs(sg) : -Math.abs(sg);
        if (s === 0) continue;
        if (k === m) {
          if (l !== m) set(k, k - 1, -A(k, k - 1));
        } else {
          set(k, k - 1, -s * x);
        }
        p += s;
        const px = p / s,
          py = q / s,
          pz = r / s;
        q /= p;
        r /= p;
        for (let j = k; j <= nn; j++) {
          let pp = A(k, j) + q * A(k + 1, j);
          if (k !== nn - 1) {
            pp += r * A(k + 2, j);
            set(k + 2, j, A(k + 2, j) - pp * pz);
          }
          set(k + 1, j, A(k + 1, j) - pp * py);
          set(k, j, A(k, j) - pp * px);
        }
        const mmin = nn < k + 3 ? nn : k + 3;
        for (let i = l; i <= mmin; i++) {
          let pp = px * A(i, k) + py * A(i, k + 1);
          if (k !== nn - 1) {
            pp += pz * A(i, k + 2);
            set(i, k + 2, A(i, k + 2) - pp * r);
          }
          set(i, k + 1, A(i, k + 1) - pp * q);
          set(i, k, A(i, k) - pp);
        }
      }
    } while (true); // eslint-disable-line no-constant-condition -- QR sweep exits via deflation breaks
  }
  return { re: wr, im: wi };
}

export interface DmdOptions {
  /** Sample interval in seconds; drives growth/frequency units. */
  readonly dt?: number;
  /** Relative singular-value cutoff for rank truncation (default √eps = 1e-8). */
  readonly rankTol?: number;
  /** Hard cap on retained modes. */
  readonly maxRank?: number;
}

/**
 * Fit exact DMD to a snapshot sequence. `snapshots[k]` is the state at step k;
 * every snapshot must have the same length and be finite. Returns null when
 * the fit does not exist.
 */
export function fitDmd(
  snapshots: readonly ArrayLike<number>[],
  opts: DmdOptions = {},
): DmdFit | null {
  const dt = opts.dt ?? 1;
  // The Gram (XᵀX) route squares the condition number, so a singular value is
  // only trustworthy to ~√eps·σ₀ ≈ 1.5e-8·σ₀. Anything at or near that band is
  // numerical dust, and keeping it INVENTS modes with |λ|≈0 and meaningless
  // frequencies. The default cutoff sits two decades above the dust band.
  const rankTol = opts.rankTol ?? 1e-6;
  const cols = snapshots.length - 1;
  if (snapshots.length < MIN_SNAPSHOTS || cols < 2) return null;
  const D = snapshots[0].length;
  if (D === 0) return null;
  for (const s of snapshots) {
    if (s.length !== D) return null;
    for (let i = 0; i < D; i++) if (!Number.isFinite(s[i])) return null;
  }

  // Gram matrix G = XᵀX (cols×cols)
  const G = new Float64Array(cols * cols);
  for (let a = 0; a < cols; a++) {
    for (let b = a; b < cols; b++) {
      let s = 0;
      const xa = snapshots[a],
        xb = snapshots[b];
      for (let i = 0; i < D; i++) s += xa[i] * xb[i];
      G[a * cols + b] = s;
      G[b * cols + a] = s;
    }
  }
  const { values, vectors } = jacobiEigen(Float64Array.from(G), cols);
  // sort descending by eigenvalue
  const order = [...values.keys()].sort((p, q) => values[q] - values[p]);
  const sv: number[] = order.map((i) => (values[i] > 0 ? Math.sqrt(values[i]) : 0));
  const s0 = sv[0] ?? 0;
  if (s0 <= 0) return null;
  let r = 0;
  const maxRank = Math.min(opts.maxRank ?? cols, cols);
  while (r < maxRank && sv[r] > rankTol * s0) r++;
  if (r === 0) return null;

  // U (D×r) = X · V · Σ⁻¹
  const U = new Float64Array(D * r);
  for (let j = 0; j < r; j++) {
    const col = order[j];
    const inv = 1 / sv[j];
    for (let k = 0; k < cols; k++) {
      const vk = vectors[k * cols + col] * inv;
      if (vk === 0) continue;
      const xk = snapshots[k];
      for (let i = 0; i < D; i++) U[i * r + j] += vk * xk[i];
    }
  }

  // Ã = Uᵀ Y V Σ⁻¹  (r×r)
  const At = new Float64Array(r * r);
  for (let a = 0; a < r; a++) {
    for (let b = 0; b < r; b++) {
      const colB = order[b];
      const invB = 1 / sv[b];
      let acc = 0;
      for (let k = 0; k < cols; k++) {
        const vk = vectors[k * cols + colB] * invB;
        if (vk === 0) continue;
        const yk = snapshots[k + 1];
        let dot = 0;
        for (let i = 0; i < D; i++) dot += U[i * r + a] * yk[i];
        acc += dot * vk;
      }
      At[a * r + b] = acc;
    }
  }

  const { re, im } = generalEigenvalues(At, r);
  const energyTotal = sv.slice(0, r).reduce((s, v) => s + v * v, 0);
  const modes: DmdMode[] = [];
  let radius = 0;
  for (let j = 0; j < r; j++) {
    const mag = Math.sqrt(re[j] * re[j] + im[j] * im[j]);
    radius = Math.max(radius, mag);
    modes.push({
      lambdaRe: re[j],
      lambdaIm: im[j],
      magnitude: mag,
      growth: mag > 0 ? dlog(mag) / dt : Number.NEGATIVE_INFINITY,
      frequency: datan2(im[j], re[j]) / (2 * Math.PI * dt),
      energy: energyTotal > 0 ? (sv[j] * sv[j]) / energyTotal : NaN,
    });
  }

  // Reconstruction error of the projected operator, measured not assumed.
  let num = 0,
    den = 0;
  const predictFrom = (x: ArrayLike<number>): Float64Array => {
    const z = new Float64Array(r);
    for (let a = 0; a < r; a++) {
      let s = 0;
      for (let i = 0; i < D; i++) s += U[i * r + a] * x[i];
      z[a] = s;
    }
    const w = new Float64Array(r);
    for (let a = 0; a < r; a++) {
      let s = 0;
      for (let b = 0; b < r; b++) s += At[a * r + b] * z[b];
      w[a] = s;
    }
    const out = new Float64Array(D);
    for (let i = 0; i < D; i++) {
      let s = 0;
      for (let a = 0; a < r; a++) s += U[i * r + a] * w[a];
      out[i] = s;
    }
    return out;
  };
  for (let k = 0; k < cols; k++) {
    const pred = predictFrom(snapshots[k]);
    const y = snapshots[k + 1];
    for (let i = 0; i < D; i++) {
      const e = y[i] - pred[i];
      num += e * e;
      den += y[i] * y[i];
    }
  }

  return {
    rank: r,
    modes,
    singularValues: sv.slice(0, r),
    relError: den > 0 ? Math.sqrt(num / den) : NaN,
    spectralRadius: radius,
    predict: predictFrom,
  };
}
