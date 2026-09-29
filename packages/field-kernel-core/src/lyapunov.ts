/**
 * @metatron/field-kernel-core/lyapunov
 *
 * Phase 2 · Step 4 — RHUFT-F Layer 7 Lyapunov candidate.
 *
 *   E_t = Σ_n ( a_n·‖ψ‖²  +  b_n·‖ψ−ψ̂‖²  +  c_n·Φ_graph  +  d_n·Φ_scale )
 *
 * where Φ_graph is a Laplacian-like norm of the pathway graph adjacency
 * (supplied by the caller as a read-only snapshot) and Φ_scale is a
 * cross-scale drift term Σ_i (ψ_n[i] − ψ_{n+1}[i])² on shared modes.
 *
 * Deterministic Neumaier accumulation → same-runtime bit-identical.
 *
 * Weights default to `{a: 1, b: PHI, c: KAPPA, d: PHI_INV}`, versioned via
 * `LYAPUNOV_WEIGHTS_VERSION` so future tuning is traceable in the ring
 * buffer without breaking replay determinism.
 */

import type { FieldStateN } from './state';
import { PHI, PHI_INV, KAPPA } from './kernel';

export const LYAPUNOV_WEIGHTS_VERSION = 'v13.phase2.step4' as const;

export interface LyapunovWeights {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
}

export const DEFAULT_LYAPUNOV_WEIGHTS: LyapunovWeights = Object.freeze({
  a: 1,
  b: PHI,
  c: KAPPA,
  d: PHI_INV,
});

interface NAcc {
  s: number;
  c: number;
}
function nAcc(): NAcc {
  return { s: 0, c: 0 };
}
function nAdd(a: NAcc, x: number): void {
  if (!Number.isFinite(x)) return;
  const s = a.s;
  const t = s + x;
  a.c += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s;
  a.s = t;
}
function nVal(a: NAcc): number {
  return a.s + a.c;
}

/** ‖ψ‖² */
function psiNorm2(s: FieldStateN): number {
  const acc = nAcc();
  const p = s.psi;
  for (let i = 0; i < p.length; i++) nAdd(acc, p[i] * p[i]);
  return nVal(acc);
}

/** ‖ψ − ψ̂‖² (mirrors measureDrift; duplicated to avoid cross-module coupling). */
function driftNorm2(s: FieldStateN): number {
  const acc = nAcc();
  const p = s.psi,
    h = s.psiHat;
  const n = Math.min(p.length, h.length);
  for (let i = 0; i < n; i++) {
    const d = p[i] - h[i];
    nAdd(acc, d * d);
  }
  return nVal(acc);
}

/**
 * Φ_graph = Σ_(i,j) w_ij · (ψ_i − ψ_j)²  (graph Dirichlet energy).
 *
 * The adjacency is passed as a flat CSR-ish view: two parallel arrays
 * `edgeI[k]`, `edgeJ[k]` of node indices, and `edgeW[k]` of weights. The
 * caller is responsible for supplying a read-only snapshot — this function
 * never mutates. If any edge index is out of range, that edge is skipped
 * (never crashes, never fabricates).
 */
export interface GraphSnapshot {
  readonly edgeI: Int32Array | Uint32Array;
  readonly edgeJ: Int32Array | Uint32Array;
  readonly edgeW: Float64Array;
}

function phiGraph(state: FieldStateN, graph: GraphSnapshot | null): number {
  if (!graph) return 0;
  const { edgeI, edgeJ, edgeW } = graph;
  const psi = state.psi;
  const n = psi.length;
  const acc = nAcc();
  const m = Math.min(edgeI.length, edgeJ.length, edgeW.length);
  for (let k = 0; k < m; k++) {
    const i = edgeI[k],
      j = edgeJ[k];
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const d = psi[i] - psi[j];
    nAdd(acc, edgeW[k] * d * d);
  }
  return nVal(acc);
}

/** Σ_i (ψ_n[i] − ψ_{n+1}[i])² over min-length shared modes. */
function phiScale(a: FieldStateN, b: FieldStateN | undefined): number {
  if (!b) return 0;
  const pa = a.psi,
    pb = b.psi;
  const n = Math.min(pa.length, pb.length);
  const acc = nAcc();
  for (let i = 0; i < n; i++) {
    const d = pa[i] - pb[i];
    nAdd(acc, d * d);
  }
  return nVal(acc);
}

/**
 * Compute E_t across an ordered array of per-scale states.
 *
 * `graphs[i]` is optional — pass `null` for scales without a pathway graph.
 * `weights[i]` overrides the default per-scale; pass `undefined` for a
 * uniform default.
 */
export function lyapunovEnergy(
  states: readonly FieldStateN[],
  graphs?: readonly (GraphSnapshot | null)[],
  weights?: readonly LyapunovWeights[] | LyapunovWeights,
): number {
  const acc = nAcc();
  for (let n = 0; n < states.length; n++) {
    const s = states[n];
    const w: LyapunovWeights = Array.isArray(weights)
      ? (weights[n] ?? DEFAULT_LYAPUNOV_WEIGHTS)
      : ((weights as LyapunovWeights | undefined) ?? DEFAULT_LYAPUNOV_WEIGHTS);
    const g = graphs ? (graphs[n] ?? null) : null;
    const next = states[n + 1];
    nAdd(acc, w.a * psiNorm2(s));
    nAdd(acc, w.b * driftNorm2(s));
    nAdd(acc, w.c * phiGraph(s, g));
    nAdd(acc, w.d * phiScale(s, next));
  }
  return nVal(acc);
}
