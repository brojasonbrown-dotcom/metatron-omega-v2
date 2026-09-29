/**
 * eigenmodes — real spectral reference modes for the RHUFT-F ladder.
 *
 * Replaces the two documented surrogates:
 *
 *   • n = 1 (Quantum)        was `v_i = φ^(-i/N)` (φ-decay envelope)
 *                            now  Perron (leading) eigenvector of the
 *                                 55-node flower-of-life adjacency A,
 *                                 via power iteration with Rayleigh
 *                                 residual convergence.
 *
 *   • n = 8 (Hyper-Galactic) was `v_i = cos(π(i+½)/N)` (first DCT-II cosine,
 *                            i.e. the Fiedler vector of a *path* graph)
 *                            now  outermost (longest-wavelength) mode of the
 *                                 golden-angle spiral Laplacian L = D − W,
 *                                 i.e. its Fiedler vector, via Lanczos with
 *                                 full reorthogonalisation and null-space
 *                                 deflation of the constant vector.
 *
 * Both solvers are exact-arithmetic-free but fully deterministic: a fixed
 * LCG seed, Kahan-compensated inner products, and a residual-based stop.
 * Every returned mode carries a provenance tag containing the method, the
 * Krylov/iteration budget actually used, the converged eigenvalue and the
 * true residual ‖Av − λv‖ — that tag is what the SCALES deck renders, so a
 * reader can always tell a converged eigenmode from a bailed-out one.
 *
 * Resolution policy ("as high as the hardware can take"): the iteration and
 * Krylov budgets scale with measured hardware *relative to the operator
 * area* (n² multiply-adds per apply). See `deriveEigenBudget`.
 */

const NODES = 55;

// ─────────────────────────── linear algebra core ──────────────────────────

export type ApplyOp = (x: Float64Array, out: Float64Array) => void;

/** Kahan-compensated dot product. */
function dot(a: Float64Array, b: Float64Array): number {
  let s = 0,
    c = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] * b[i];
    const t = s + x;
    c += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s;
    s = t;
  }
  return s + c;
}

function norm2(a: Float64Array): number {
  return Math.sqrt(Math.max(0, dot(a, a)));
}

function scaleInPlace(a: Float64Array, k: number): void {
  for (let i = 0; i < a.length; i++) a[i] *= k;
}

/** Deterministic unit-norm start vector (LCG, no Math.random). */
function seedVector(n: number, seed: number): Float64Array {
  const v = new Float64Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    v[i] = (s / 0xffffffff) * 2 - 1;
  }
  const nrm = norm2(v) || 1;
  scaleInPlace(v, 1 / nrm);
  return v;
}

/** Sign-canonicalise: largest-|v| component made positive (stable tags). */
function canonicalSign(v: Float64Array): void {
  let bi = 0;
  for (let i = 1; i < v.length; i++) if (Math.abs(v[i]) > Math.abs(v[bi])) bi = i;
  if (v[bi] < 0) scaleInPlace(v, -1);
}

export interface EigenResult {
  vector: Float64Array;
  eigenvalue: number;
  /** True residual ‖Av − λv‖₂. */
  residual: number;
  iterations: number;
  /** Krylov dimension for Lanczos; 0 for power iteration. */
  krylov: number;
  converged: boolean;
  method: 'power-iteration' | 'lanczos';
  ms: number;
}

/**
 * Power iteration with Rayleigh-quotient shift-free convergence.
 * Suited to the flower-of-life adjacency, whose Perron root is simple and
 * well separated (non-negative irreducible graph → Perron–Frobenius).
 */
export function powerIteration(
  apply: ApplyOp,
  n: number,
  opts: { maxIters: number; tol: number; seed?: number },
): EigenResult {
  const t0 = nowMs();
  let v = seedVector(n, opts.seed ?? 0x5eed_1);
  const w = new Float64Array(n);
  const r = new Float64Array(n);
  let lambda = 0;
  let residual = Number.POSITIVE_INFINITY;
  let it = 0;
  for (; it < opts.maxIters; it++) {
    apply(v, w);
    const nw = norm2(w);
    if (!(nw > 0)) break;
    lambda = dot(v, w);
    for (let i = 0; i < n; i++) r[i] = w[i] - lambda * v[i];
    residual = norm2(r);
    const inv = 1 / nw;
    for (let i = 0; i < n; i++) v[i] = w[i] * inv;
    if (residual <= opts.tol) {
      it++;
      break;
    }
  }
  canonicalSign(v);
  return {
    vector: v,
    eigenvalue: lambda,
    residual,
    iterations: it,
    krylov: 0,
    converged: residual <= opts.tol,
    method: 'power-iteration',
    ms: nowMs() - t0,
  };
}

/** Symmetric tridiagonal QL with implicit shifts (EISPACK `tql2`). */
function tql2(d: Float64Array, e: Float64Array, z: Float64Array[], n: number): void {
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  for (let l = 0; l < n; l++) {
    let iter = 0;
    let m = l;
    do {
      for (m = l; m < n - 1; m++) {
        const dd = Math.abs(d[m]) + Math.abs(d[m + 1]);
        if (Math.abs(e[m]) <= Number.EPSILON * dd) break;
      }
      if (m !== l) {
        if (iter++ === 60) break;
        let g = (d[l + 1] - d[l]) / (2 * e[l]);
        let rr = Math.hypot(g, 1);
        g = d[m] - d[l] + e[l] / (g + (g >= 0 ? Math.abs(rr) : -Math.abs(rr)));
        let s = 1,
          c = 1,
          p = 0;
        for (let i = m - 1; i >= l; i--) {
          let f = s * e[i];
          const b = c * e[i];
          rr = Math.hypot(f, g);
          e[i + 1] = rr;
          if (rr === 0) {
            d[i + 1] -= p;
            e[m] = 0;
            break;
          }
          s = f / rr;
          c = g / rr;
          g = d[i + 1] - p;
          rr = (d[i] - g) * s + 2 * c * b;
          p = s * rr;
          d[i + 1] = g + p;
          g = c * rr - b;
          for (let k = 0; k < n; k++) {
            f = z[k][i + 1];
            z[k][i + 1] = s * z[k][i] + c * f;
            z[k][i] = c * z[k][i] - s * f;
          }
        }
        d[l] -= p;
        e[l] = g;
        e[m] = 0;
      }
    } while (m !== l);
  }
}

/**
 * Lanczos with full reorthogonalisation. Returns the Ritz pair selected by
 * `pick` ('smallest' | 'largest') from the tridiagonal spectrum, with the
 * residual measured against the *original* operator (not the projection).
 */
export function lanczos(
  apply: ApplyOp,
  n: number,
  opts: {
    krylov: number;
    restarts: number;
    tol: number;
    seed?: number;
    pick: 'smallest' | 'largest';
  },
): EigenResult {
  const t0 = nowMs();
  const m = Math.max(2, Math.min(opts.krylov, n));
  let start = seedVector(n, opts.seed ?? 0x5eed_8);
  let best: { vec: Float64Array; lam: number; res: number } | null = null;
  let totalIters = 0;

  for (let restart = 0; restart < Math.max(1, opts.restarts); restart++) {
    const V: Float64Array[] = [];
    const alpha = new Float64Array(m);
    const beta = new Float64Array(m);
    let v = Float64Array.from(start);
    scaleInPlace(v, 1 / (norm2(v) || 1));
    let vPrev = new Float64Array(n);
    let b = 0;
    const w = new Float64Array(n);
    let used = m;

    for (let j = 0; j < m; j++) {
      V.push(Float64Array.from(v));
      apply(v, w);
      const a = dot(v, w);
      alpha[j] = a;
      for (let i = 0; i < n; i++) w[i] = w[i] - a * v[i] - b * vPrev[i];
      // Full reorthogonalisation (twice — Kahan/Parlett rule).
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k <= j; k++) {
          const c = dot(V[k], w);
          for (let i = 0; i < n; i++) w[i] -= c * V[k][i];
        }
      }
      b = norm2(w);
      beta[j] = b;
      totalIters++;
      if (b <= 1e-14) {
        used = j + 1;
        break;
      }
      vPrev = v;
      v = new Float64Array(n);
      for (let i = 0; i < n; i++) v[i] = w[i] / b;
    }

    // Tridiagonal eigenproblem on the used block.
    const d = alpha.slice(0, used);
    const e = new Float64Array(used);
    for (let i = 1; i < used; i++) e[i] = beta[i - 1];
    const z: Float64Array[] = [];
    for (let i = 0; i < used; i++) {
      const row = new Float64Array(used);
      row[i] = 1;
      z.push(row);
    }
    tql2(d, e, z, used);

    let idx = 0;
    for (let i = 1; i < used; i++) {
      if (opts.pick === 'smallest' ? d[i] < d[idx] : d[i] > d[idx]) idx = i;
    }
    const ritz = new Float64Array(n);
    for (let k = 0; k < used; k++) {
      const c = z[k][idx];
      if (c === 0) continue;
      for (let i = 0; i < n; i++) ritz[i] += c * V[k][i];
    }
    scaleInPlace(ritz, 1 / (norm2(ritz) || 1));

    apply(ritz, w);
    const lam = dot(ritz, w);
    let resSq = 0;
    for (let i = 0; i < n; i++) {
      const r = w[i] - lam * ritz[i];
      resSq += r * r;
    }
    const res = Math.sqrt(resSq);
    if (!best || res < best.res) best = { vec: ritz, lam, res };
    if (res <= opts.tol) break;
    start = ritz; // thick restart from the best Ritz vector
  }

  const out = best!.vec;
  canonicalSign(out);
  return {
    vector: out,
    eigenvalue: best!.lam,
    residual: best!.res,
    iterations: totalIters,
    krylov: m,
    converged: best!.res <= opts.tol,
    method: 'lanczos',
    ms: nowMs() - t0,
  };
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// ───────────────────────────── the operators ──────────────────────────────

/**
 * Flower-of-life adjacency on 55 nodes.
 *
 * Construction: the triangular (hex) lattice generated by the FoL circle
 * centres — axial coordinates (q, r) mapped to the plane by
 * (x, y) = (q + r/2, r·√3/2). Take the 55 centres nearest the origin
 * (ties broken by angle for determinism) and connect every pair at unit
 * lattice distance. That is exactly the vesica-neighbour graph of the
 * pattern, and it is non-negative + irreducible, so Perron–Frobenius
 * guarantees a simple positive leading eigenvector.
 */
export function buildFlowerOfLifeAdjacency(n = NODES): Float64Array {
  type P = { q: number; r: number; x: number; y: number; d: number; a: number };
  const pts: P[] = [];
  const R = 8;
  for (let q = -R; q <= R; q++) {
    for (let r = -R; r <= R; r++) {
      const x = q + r / 2;
      const y = (r * Math.sqrt(3)) / 2;
      pts.push({ q, r, x, y, d: Math.hypot(x, y), a: Math.atan2(y, x) });
    }
  }
  pts.sort((p1, p2) => p1.d - p2.d || p1.a - p2.a || p1.q - p2.q);
  const sel = pts.slice(0, n);
  const A = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dd = Math.hypot(sel[i].x - sel[j].x, sel[i].y - sel[j].y);
      if (Math.abs(dd - 1) < 1e-9) {
        A[i * n + j] = 1;
        A[j * n + i] = 1;
      }
    }
  }
  return A;
}

const PHI_C = (1 + Math.sqrt(5)) / 2;

/**
 * Golden-angle spiral Laplacian on 55 nodes.
 *
 * Node i sits on the Vogel spiral: θ_i = i·2π/φ², ρ_i = √i. Affinity is the
 * Gaussian of the true planar distance with bandwidth σ = mean nearest-
 * neighbour distance — a real geometric operator, not an index kernel.
 * L = D − W is PSD with the constant vector in its null space; its
 * *outermost* (longest-wavelength) mode is the Fiedler vector, which we
 * obtain by Lanczos on the constant-deflated L picking the smallest Ritz
 * value.
 */
export function buildSpiralLaplacian(n = NODES): Float64Array {
  const theta = 2 * Math.PI * Math.pow(1 / PHI_C, 2);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const rho = Math.sqrt(i + 0.5);
    x[i] = rho * Math.cos(i * theta);
    y[i] = rho * Math.sin(i * theta);
  }
  // σ from the mean nearest-neighbour distance (scale-free bandwidth).
  let sAcc = 0;
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = Math.hypot(x[i] - x[j], y[i] - y[j]);
      if (d < best) best = d;
    }
    sAcc += best;
  }
  const sigma = sAcc / n;
  const inv2s2 = 1 / (2 * sigma * sigma);
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    let deg = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d2 = (x[i] - x[j]) ** 2 + (y[i] - y[j]) ** 2;
      const w = Math.exp(-d2 * inv2s2);
      L[i * n + j] = -w;
      deg += w;
    }
    L[i * n + i] = deg;
  }
  return L;
}

/** Dense symmetric mat-vec with Kahan compensation per row. */
export function denseApply(M: Float64Array, n: number): ApplyOp {
  return (v, out) => {
    for (let i = 0; i < n; i++) {
      let s = 0,
        c = 0;
      const base = i * n;
      for (let j = 0; j < n; j++) {
        const t = M[base + j] * v[j];
        const y = s + t;
        c += Math.abs(s) >= Math.abs(t) ? s - y + t : t - y + s;
        s = y;
      }
      out[i] = s + c;
    }
  };
}

/** Wrap an operator so the constant vector is projected out before & after. */
function deflateConstant(apply: ApplyOp, n: number): ApplyOp {
  const inv = 1 / n;
  const tmp = new Float64Array(n);
  return (v, out) => {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += v[i];
    mean *= inv;
    for (let i = 0; i < n; i++) tmp[i] = v[i] - mean;
    apply(tmp, out);
    let mo = 0;
    for (let i = 0; i < n; i++) mo += out[i];
    mo *= inv;
    // Push the deflated direction far above the picked (smallest) end.
    for (let i = 0; i < n; i++) out[i] = out[i] - mo + 1e3 * mean;
  };
}

// ───────────────────────── hardware-relative budget ───────────────────────

export interface EigenBudget {
  /** Power-iteration cap. */
  maxIters: number;
  /** Lanczos Krylov dimension (≤ n). */
  krylov: number;
  /** Thick restarts. */
  restarts: number;
  /** Residual target ‖Av − λv‖. */
  tol: number;
  /** Provenance of the sizing decision. */
  note: string;
}

/**
 * Size the solve to the machine, relative to operator area (n² flops/apply).
 *
 * `cores` and `deviceMemory` are read when the platform exposes them; the
 * throughput term is measured, never assumed — we time a real mat-vec and
 * spend a fixed wall-clock budget (`budgetMs`) on iterations, which is the
 * only hardware-honest way to say "highest resolution this machine can do".
 */
export function deriveEigenBudget(n: number, budgetMs = 60): EigenBudget {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const cores = typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 4;
  const memGB = (nav as unknown as { deviceMemory?: number } | undefined)?.deviceMemory ?? 4;

  // Measure one apply on a throwaway dense operator of the same area.
  const probe = new Float64Array(n * n).fill(1 / n);
  const ap = denseApply(probe, n);
  const v = seedVector(n, 1);
  const out = new Float64Array(n);
  // Warm the JIT first — an unwarmed sample would understate the machine and
  // starve the solve of iterations.
  for (let i = 0; i < 200; i++) ap(v, out);
  const t0 = nowMs();
  let reps = 0;
  while (nowMs() - t0 < 3.0 && reps < 200_000) {
    ap(v, out);
    reps++;
  }
  const applyMs = Math.max(1e-6, (nowMs() - t0) / Math.max(1, reps));

  // Wall-clock budget scaled by parallel/memory headroom (relative area).
  const headroom = Math.min(4, Math.max(0.5, cores / 4)) * Math.min(2, Math.max(0.5, memGB / 4));
  const applies = Math.floor((budgetMs * headroom) / applyMs);

  const maxIters = Math.max(200, Math.min(200_000, applies));
  // Lanczos costs ~krylov applies + O(krylov²·n) reorthogonalisation.
  const krylov = Math.max(16, Math.min(n, Math.floor(Math.sqrt(applies))));
  const restarts = Math.max(2, Math.min(64, Math.floor(applies / Math.max(1, krylov * 4))));
  const tol = 1e-13;
  return {
    maxIters,
    krylov,
    restarts,
    tol,
    note: `apply=${applyMs.toFixed(5)}ms · area=${n}² · cores=${cores} · mem=${memGB}GB · budget=${budgetMs}ms×${headroom.toFixed(2)}`,
  };
}

// ─────────────────────────── computed references ──────────────────────────

export interface ComputedMode {
  scale: number;
  operator: string;
  vector: Float64Array;
  eigen: EigenResult;
  tag: string;
  budget: EigenBudget;
}

function tagFor(op: string, r: EigenResult, b: EigenBudget): string {
  return `${op}:${r.method}(k=${r.krylov || '-'},it=${r.iterations},λ=${r.eigenvalue.toPrecision(10)},res=${r.residual.toExponential(2)},${r.converged ? 'converged' : 'BAILED'},tol=${b.tol.toExponential(0)},${r.ms.toFixed(2)}ms)`;
}

/** n = 1 — Perron eigenvector of the flower-of-life adjacency. */
export function computeQuantumEigenmode(budget = deriveEigenBudget(NODES)): ComputedMode {
  const A = buildFlowerOfLifeAdjacency(NODES);
  const res = powerIteration(denseApply(A, NODES), NODES, {
    maxIters: budget.maxIters,
    tol: budget.tol,
    seed: 0x51,
  });
  // Perron vector is strictly positive; enforce the sign convention.
  let neg = 0;
  for (let i = 0; i < NODES; i++) if (res.vector[i] < 0) neg++;
  if (neg > NODES / 2) scaleInPlace(res.vector, -1);
  return {
    scale: 1,
    operator: 'fol-adjacency-perron',
    vector: res.vector,
    eigen: res,
    tag: tagFor('fol-adjacency-perron', res, budget),
    budget,
  };
}

/** n = 8 — outermost (Fiedler) mode of the golden-angle spiral Laplacian. */
export function computeHyperGalacticEigenmode(budget = deriveEigenBudget(NODES)): ComputedMode {
  const L = buildSpiralLaplacian(NODES);
  const op = deflateConstant(denseApply(L, NODES), NODES);
  const res = lanczos(op, NODES, {
    krylov: budget.krylov,
    restarts: budget.restarts,
    tol: budget.tol,
    seed: 0x88,
    pick: 'smallest',
  });
  return {
    scale: 8,
    operator: 'spiral-laplacian-outermost',
    vector: res.vector,
    eigen: res,
    tag: tagFor('spiral-laplacian-outermost', res, budget),
    budget,
  };
}
