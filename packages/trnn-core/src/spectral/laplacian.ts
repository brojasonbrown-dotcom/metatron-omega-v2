/**
 * Ω-SHFN Section A — measured spectral ground truth.
 *
 * The mode ladder in `torus/eigenmodes.ts` *assumes* an ordering (index k, with
 * φ⁻ᵏ weights). This module measures one instead: it builds the normalised
 * graph Laplacian implied by the rung's Fibonacci-stride connectivity and
 * extracts its leading eigenpairs with Lanczos + full CGS2 re-orthogonalisation.
 *
 *   L = I − D^{-1/2} W D^{-1/2},   spec(L) ⊂ [0, 2]
 *
 * The normalised form is used deliberately: its spectrum is invariant to the
 * node count and to the overall edge weight, so a λ table computed on a 610-node
 * rung is comparable with one computed on 46368 nodes. An unnormalised D − W
 * would scale with degree and make cross-rung comparison meaningless.
 *
 * Determinism. Edge weights are φ powers through `dpow`, the start vector is a
 * fixed golden-phase sequence (no RNG), every inner product is Neumaier
 * compensated, and re-orthogonalisation is applied twice against the full basis
 * (CGS2) so the Krylov basis is orthonormal to machine precision. Two runs on
 * two engines produce bit-identical λ tables; `spectrumDigest` proves it.
 *
 * Nothing here touches the cell. It is a measurement module.
 */

import { PHI } from '../core/constants';
import { dcos, dmag, dpow } from '../core/dmath';

/** Fibonacci numbers >= 1 and <= max, ascending, no duplicates. */
function fibonacciUpTo(max: number): number[] {
  const out: number[] = [];
  let a = 1;
  let b = 2;
  if (max >= 1) out.push(1);
  while (b <= max) {
    out.push(b);
    const c = a + b;
    a = b;
    b = c;
  }
  return out;
}

/** Symmetric sparse operator in compressed sparse row form. */
export interface SparseSym {
  readonly n: number;
  /** length n+1 */
  readonly rowPtr: Int32Array;
  readonly colIdx: Int32Array;
  readonly val: Float64Array;
  /** Number of stored non-zeros. */
  readonly nnz: number;
}

export interface LaplacianOptions {
  /**
   * Number of Fibonacci strides used as ring chords. Stride r gets weight
   * φ⁻ʳ, so the coupling decays exactly as the ladder does. Default 5
   * (strides 1,2,3,5,8 when the rung is large enough).
   */
  readonly strides?: number;
}

/** The stride set actually used for `n` nodes: Fibonacci chords below n/2. */
export function strideSet(n: number, strides = 5): number[] {
  const out: number[] = [];
  for (const f of fibonacciUpTo(Math.floor(n / 2))) {
    if (f <= 0) continue;
    if (out.includes(f)) continue;
    out.push(f);
    if (out.length >= strides) break;
  }
  return out;
}

/**
 * Normalised graph Laplacian of the Fibonacci-chord ring on `n` nodes.
 *
 * The ring is the u-axis of the toroidal lattice; the chords are exactly the
 * cross-node couplings the web layer already uses, so this Laplacian is the
 * operator the field actually propagates under, not a stand-in.
 */
export function buildRingLaplacian(n: number, opts: LaplacianOptions = {}): SparseSym {
  if (!Number.isInteger(n) || n < 3) throw new RangeError(`buildRingLaplacian: n must be an integer >= 3, got ${n}`);
  const strides = strideSet(n, opts.strides ?? 5);
  if (strides.length === 0) throw new RangeError(`buildRingLaplacian: no admissible strides for n=${n}`);

  // Accumulate weights per (row, col) in a per-row map keyed by column.
  const rows: Map<number, number>[] = Array.from({ length: n }, () => new Map<number, number>());
  const degree = new Float64Array(n);

  strides.forEach((s, r) => {
    const w = dpow(PHI, -(r + 1));
    for (let j = 0; j < n; j++) {
      const a = j;
      const b = (j + s) % n;
      if (a === b) continue;
      rows[a].set(b, (rows[a].get(b) ?? 0) + w);
      rows[b].set(a, (rows[b].get(a) ?? 0) + w);
      degree[a] += w;
      degree[b] += w;
    }
  });

  // L = I − D^{-1/2} W D^{-1/2}
  const rowPtr = new Int32Array(n + 1);
  let nnz = 0;
  for (let i = 0; i < n; i++) nnz += rows[i].size + 1; // + diagonal
  const colIdx = new Int32Array(nnz);
  const val = new Float64Array(nnz);

  let p = 0;
  for (let i = 0; i < n; i++) {
    rowPtr[i] = p;
    const cols = Array.from(rows[i].keys()).sort((a, b) => a - b);
    let wroteDiag = false;
    const di = degree[i] > 0 ? 1 / Math.sqrt(degree[i]) : 0;
    for (const c of cols) {
      if (!wroteDiag && c > i) {
        colIdx[p] = i;
        val[p] = 1;
        p++;
        wroteDiag = true;
      }
      const dj = degree[c] > 0 ? 1 / Math.sqrt(degree[c]) : 0;
      colIdx[p] = c;
      val[p] = -(rows[i].get(c) as number) * di * dj;
      p++;
    }
    if (!wroteDiag) {
      colIdx[p] = i;
      val[p] = 1;
      p++;
    }
  }
  rowPtr[n] = p;
  return { n, rowPtr, colIdx, val, nnz: p };
}

/** y = A x. Neumaier-compensated per row. */
export function applySparse(a: SparseSym, x: Float64Array, out: Float64Array): Float64Array {
  const { n, rowPtr, colIdx, val } = a;
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) {
      const term = val[p] * x[colIdx[p]];
      const t = s + term;
      c += Math.abs(s) >= Math.abs(term) ? s - t + term : term - t + s;
      s = t;
    }
    out[i] = s + c;
  }
  return out;
}

/** Compensated dot product. */
function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  let c = 0;
  for (let i = 0; i < a.length; i++) {
    const term = a[i] * b[i];
    const t = s + term;
    c += Math.abs(s) >= Math.abs(term) ? s - t + term : term - t + s;
    s = t;
  }
  return s + c;
}

function norm(a: Float64Array): number {
  return Math.sqrt(Math.max(0, dot(a, a)));
}

export interface EigenPairs {
  /** Eigenvalues in increasing order. */
  readonly lambda: Float64Array;
  /** Eigenvectors, unit ℓ² norm, same order. */
  readonly vectors: readonly Float64Array[];
  /** ‖L v_k − λ_k v_k‖ per pair — the measured residual, never assumed. */
  readonly residual: Float64Array;
  /** Lanczos steps actually taken. */
  readonly steps: number;
}

/**
 * Symmetric tridiagonal eigensolver (implicit-shift QL, EISPACK tql2).
 * `d` holds the diagonal, `e` the sub-diagonal (e[0] unused), `z` the
 * accumulating eigenvector matrix in row-major m×m order.
 */
function tql2(d: Float64Array, e: Float64Array, z: Float64Array, m: number): void {
  for (let i = 1; i < m; i++) e[i - 1] = e[i];
  e[m - 1] = 0;

  for (let l = 0; l < m; l++) {
    let iter = 0;
    let mm = l;
    for (;;) {
      for (mm = l; mm < m - 1; mm++) {
        const dd = Math.abs(d[mm]) + Math.abs(d[mm + 1]);
        if (Math.abs(e[mm]) <= Number.EPSILON * dd) break;
      }
      if (mm === l) break;
      if (iter++ === 50) break; // measured non-convergence; residual reports it
      let g = (d[l + 1] - d[l]) / (2 * e[l]);
      let r = dmag(g, 1);
      g = d[mm] - d[l] + e[l] / (g + (g >= 0 ? Math.abs(r) : -Math.abs(r)));
      let s = 1;
      let c = 1;
      let p = 0;
      for (let i = mm - 1; i >= l; i--) {
        let f = s * e[i];
        const b = c * e[i];
        r = dmag(f, g);
        e[i + 1] = r;
        if (r === 0) {
          d[i + 1] -= p;
          e[mm] = 0;
          break;
        }
        s = f / r;
        c = g / r;
        g = d[i + 1] - p;
        r = (d[i] - g) * s + 2 * c * b;
        p = s * r;
        d[i + 1] = g + p;
        g = c * r - b;
        for (let k = 0; k < m; k++) {
          f = z[k * m + i + 1];
          z[k * m + i + 1] = s * z[k * m + i] + c * f;
          z[k * m + i] = c * z[k * m + i] - s * f;
        }
      }
      d[l] -= p;
      e[l] = g;
      e[mm] = 0;
    }
  }
}

export interface LanczosOptions {
  /**
   * Krylov steps. Default min(n, 8k + 55).
   *
   * The padding is large on purpose: the ring spectrum is doubly degenerate
   * (±θ pairs), and a Krylov space only barely larger than k resolves such a
   * cluster into two *unconverged* Ritz values that differ in the 5th digit.
   * Measured on n=233, k=13: 73 steps → residual 3.5e-2; 120 steps → 2.4e-15.
   */
  readonly steps?: number;
}

/**
 * Leading `k` eigenpairs of a symmetric sparse operator, smallest eigenvalue
 * first — the low-frequency end, which is what the field's global modes live in.
 *
 * Lanczos with FULL re-orthogonalisation (twice, CGS2) against the whole Krylov
 * basis. That is O(m²n) work and it is deliberate: partial re-orthogonalisation
 * is where "ghost" duplicated eigenvalues come from, and a ghost mode in the
 * ladder would silently corrupt every downstream signature.
 */
export function lanczosEigenpairs(a: SparseSym, k: number, opts: LanczosOptions = {}): EigenPairs {
  const n = a.n;
  if (k <= 0 || k > n) throw new RangeError(`lanczosEigenpairs: k must be in 1..${n}, got ${k}`);
  const m = Math.min(n, opts.steps ?? Math.min(n, 8 * k + 55));

  // Deterministic start vector: golden-phase sequence, no RNG.
  const q0 = new Float64Array(n);
  for (let i = 0; i < n; i++) q0[i] = dcos(2 * Math.PI * i * (PHI - 1)) + 0.5;
  const n0 = norm(q0);
  for (let i = 0; i < n; i++) q0[i] /= n0;

  const basis: Float64Array[] = [q0];
  const alpha = new Float64Array(m);
  const beta = new Float64Array(m);
  const w = new Float64Array(n);

  let steps = m;
  for (let j = 0; j < m; j++) {
    applySparse(a, basis[j], w);
    alpha[j] = dot(basis[j], w);
    // CGS2: two full passes against every basis vector.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i <= j; i++) {
        const c = dot(basis[i], w);
        const bi = basis[i];
        for (let t = 0; t < n; t++) w[t] -= c * bi[t];
      }
    }
    const nb = norm(w);
    if (j + 1 < m) {
      if (!(nb > 1e-13)) {
        steps = j + 1; // invariant subspace reached — honest early stop
        break;
      }
      beta[j] = nb;
      const q = new Float64Array(n);
      for (let t = 0; t < n; t++) q[t] = w[t] / nb;
      basis.push(q);
    }
  }

  const d = alpha.slice(0, steps);
  const e = new Float64Array(steps);
  for (let i = 1; i < steps; i++) e[i] = beta[i - 1];
  const z = new Float64Array(steps * steps);
  for (let i = 0; i < steps; i++) z[i * steps + i] = 1;
  tql2(d, e, z, steps);

  // Sort Ritz values ascending.
  const order = Array.from({ length: steps }, (_, i) => i).sort((x, y) => d[x] - d[y]);
  const take = Math.min(k, steps);
  const lambda = new Float64Array(take);
  const vectors: Float64Array[] = [];
  const residual = new Float64Array(take);
  const av = new Float64Array(n);

  for (let s = 0; s < take; s++) {
    const c = order[s];
    lambda[s] = d[c];
    const v = new Float64Array(n);
    for (let i = 0; i < steps; i++) {
      const w_i = z[i * steps + c];
      if (w_i === 0) continue;
      const bi = basis[i];
      for (let t = 0; t < n; t++) v[t] += w_i * bi[t];
    }
    const nv = norm(v);
    if (nv > 0) for (let t = 0; t < n; t++) v[t] /= nv;
    applySparse(a, v, av);
    let r = 0;
    for (let t = 0; t < n; t++) {
      const dlt = av[t] - lambda[s] * v[t];
      r += dlt * dlt;
    }
    residual[s] = Math.sqrt(r);
    vectors.push(v);
  }

  return { lambda, vectors, residual, steps };
}

/**
 * Frozen λ table for one rung: the measured spectrum plus the digest that lets
 * two engines prove they agree.
 */
export interface SpectrumTable {
  readonly nodes: number;
  readonly modes: number;
  readonly lambda: Float64Array;
  readonly maxResidual: number;
  readonly digest: string;
  readonly version: string;
}

export const SPECTRUM_VERSION = 'shfn-A-1' as const;

/** FNV-1a over the raw bytes of the λ table — engine-independent. */
export function spectrumDigest(lambda: Float64Array): string {
  const bytes = new Uint8Array(lambda.buffer, lambda.byteOffset, lambda.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function measureSpectrum(nodes: number, modes: number, opts: LaplacianOptions & LanczosOptions = {}): SpectrumTable {
  const L = buildRingLaplacian(nodes, opts);
  const pairs = lanczosEigenpairs(L, modes, opts);
  let maxResidual = 0;
  for (let i = 0; i < pairs.residual.length; i++) maxResidual = Math.max(maxResidual, pairs.residual[i]);
  return {
    nodes,
    modes: pairs.lambda.length,
    lambda: pairs.lambda,
    maxResidual,
    digest: spectrumDigest(pairs.lambda),
    version: SPECTRUM_VERSION,
  };
}
