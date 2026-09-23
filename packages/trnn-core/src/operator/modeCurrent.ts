/**
 * Ω-OPERATOR N2′ — the driver-invariant coherence witness.
 *
 * Why not a spatial Hodge split. `torus/lattice.ts` is a one-dimensional golden
 * ring. On a circle every zero-mean field is exactly a gradient (verified
 * numerically: residual 1.3e-15), so a spatial solenoidal fraction is
 * identically zero — a dead channel, not a metric.
 *
 * What is genuinely two-dimensional here is the **mode lattice**: mode k sits at
 * `(p_k, q_k) = (k, round(kφ⁻¹))`. Energy moving between modes is a current on
 * that lattice, and on a graph with cycles the Helmholtz–Hodge decomposition is
 * non-degenerate:
 *
 *   J  =  B ψ        (gradient / throughput: source → sink)
 *      +  r          (cycle / circulation: closed loops, sustained structure)
 *
 * with `B` the edge–node incidence operator. ψ solves the normal equations
 * `Lψ = Bᵀ J` (L = graph Laplacian), and `r = J − Bψ` is orthogonal to every
 * gradient by construction. The reported witness is
 *
 *   modeCirculation = ‖r‖² / ‖J‖²  ∈ [0,1]
 *
 * Properties that Ω does not have:
 *  - amplitude-free: J is linear in the drive, the ratio is invariant;
 *  - driver-free: pumping the input harder grows the *gradient* part;
 *  - scale-free: normalised per rung.
 *
 * Read-only. Nothing here actuates the field.
 */

import type { ModeSpec } from '../torus/eigenmodes';

export interface ModeEdge {
  readonly a: number;
  readonly b: number;
  /** Lattice distance in (p,q) — the edge weight's reciprocal basis. */
  readonly d: number;
}

/**
 * φ-recurrence stencil: k ↔ k±1 and k ↔ k±2. Those are the Fibonacci
 * neighbour relations (F(k) = F(k−1) + F(k−2)), and the ±2 chords are what
 * create the triangles — without cycles the decomposition would be trivial.
 */
export function phiStencil(specs: readonly ModeSpec[]): ModeEdge[] {
  const k = specs.length;
  const edges: ModeEdge[] = [];
  for (let a = 0; a < k; a++) {
    for (const off of [1, 2]) {
      const b = a + off;
      if (b >= k) continue;
      const dp = specs[b].p - specs[a].p;
      const dq = specs[b].q - specs[a].q;
      edges.push({ a, b, d: Math.sqrt(dp * dp + dq * dq) || 1 });
    }
  }
  return edges;
}

/** Per-mode energy from split coefficient arrays. */
export function modeEnergies(re: ArrayLike<number>, im: ArrayLike<number>, k: number): Float64Array {
  const e = new Float64Array(k);
  for (let i = 0; i < k; i++) e[i] = re[i] * re[i] + im[i] * im[i];
  return e;
}

export interface ModeCurrentReading {
  /** Solenoidal (cycle) fraction of the mode-space energy current, in [0,1]. */
  readonly circulation: number;
  /** ‖J‖² — total current magnitude; 0 means the reading is undefined (reported as 0). */
  readonly current: number;
  /** ‖Bψ‖² — the driven-throughput part. */
  readonly throughput: number;
  /** True once a non-degenerate current was present this tick. */
  readonly valid: boolean;
}

/**
 * Edge currents from a pair of consecutive per-mode energy vectors.
 * Positive `J_ab` means energy moved from a to b.
 */
export function edgeCurrent(prev: ArrayLike<number>, curr: ArrayLike<number>, edges: readonly ModeEdge[]): Float64Array {
  const J = new Float64Array(edges.length);
  for (let e = 0; e < edges.length; e++) {
    const { a, b, d } = edges[e];
    const da = curr[a] - prev[a];
    const db = curr[b] - prev[b];
    J[e] = (db - da) / (2 * d);
  }
  return J;
}

/**
 * Discrete Hodge decomposition of an edge current on the mode graph.
 *
 * Dense elimination on the pinned Laplacian: the ladder is 13 modes, so this is
 * a 12×12 solve — deterministic, allocation-bounded and far cheaper than the
 * FFT that produced the coefficients.
 */
export function hodgeSplit(J: ArrayLike<number>, edges: readonly ModeEdge[], nodes: number): ModeCurrentReading {
  const m = edges.length;
  let total = 0;
  for (let e = 0; e < m; e++) total += J[e] * J[e];
  if (!(total > 0)) return { circulation: 0, current: 0, throughput: 0, valid: false };

  // Bᵀ J  and  L = Bᵀ B, with node 0 pinned to remove the constant null space.
  const rhs = new Float64Array(nodes);
  const L = new Float64Array(nodes * nodes);
  for (let e = 0; e < m; e++) {
    const { a, b } = edges[e];
    rhs[b] += J[e];
    rhs[a] -= J[e];
    L[b * nodes + b] += 1;
    L[a * nodes + a] += 1;
    L[a * nodes + b] -= 1;
    L[b * nodes + a] -= 1;
  }
  // Pin node 0: row/col 0 becomes the identity, ψ_0 = 0.
  for (let i = 0; i < nodes; i++) {
    L[i] = 0;
    L[i * nodes] = 0;
  }
  L[0] = 1;
  rhs[0] = 0;

  const psi = solveDense(L, rhs, nodes);

  let grad = 0;
  let res = 0;
  for (let e = 0; e < m; e++) {
    const { a, b } = edges[e];
    const g = psi[b] - psi[a];
    const r = J[e] - g;
    grad += g * g;
    res += r * r;
  }
  let c = res / total;
  if (c < 0) c = 0;
  if (c > 1) c = 1;
  return { circulation: c, current: total, throughput: grad, valid: true };
}

/** Gaussian elimination with partial pivoting. Deterministic; n is small. */
function solveDense(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const M = Float64Array.from(A);
  const x = Float64Array.from(b);
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(M[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r * n + col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-14) continue; // singular direction: leave that component at 0
    if (piv !== col) {
      for (let c = 0; c < n; c++) {
        const t = M[col * n + c];
        M[col * n + c] = M[piv * n + c];
        M[piv * n + c] = t;
      }
      const t = x[col];
      x[col] = x[piv];
      x[piv] = t;
    }
    const d = M[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r * n + col] / d;
      if (f === 0) continue;
      for (let c = col; c < n; c++) M[r * n + c] -= f * M[col * n + c];
      x[r] -= f * x[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    const d = M[r * n + r];
    if (Math.abs(d) < 1e-14) {
      x[r] = 0;
      continue;
    }
    let s = x[r];
    for (let c = r + 1; c < n; c++) s -= M[r * n + c] * x[c];
    x[r] = s / d;
  }
  return x;
}

/**
 * One-call witness: previous and current mode energies → circulation reading.
 */
export function modeCirculation(
  prevEnergies: ArrayLike<number>,
  currEnergies: ArrayLike<number>,
  specs: readonly ModeSpec[],
): ModeCurrentReading {
  const edges = phiStencil(specs);
  const J = edgeCurrent(prevEnergies, currEnergies, edges);
  return hodgeSplit(J, edges, specs.length);
}
