/**
 * Phase 5 · Step 2 — canonical local-update kernels.
 *
 * Shared numeric core for every F<k>LocalUpdate module. Two shapes:
 *
 *   • relaxTowardsTemplate(state, ctx, out, uPhi)
 *       out.psi ← state.psi − α·(state.psi − target),
 *       target[i] = uPhi[i] · ‖state.psi‖₂,     α = clamp(ctx.dt, 0, 1).
 *
 *     `uPhi` MUST be unit ℓ² norm. At equilibrium (state.psi aligned with
 *     `uPhi`) the update is a fixed point ≤ 1 ULP: target ≡ state.psi ⇒
 *     out.psi ≡ state.psi, ΔE = 0. Off-equilibrium, since α ∈ [0, 1] the
 *     projected residual contracts by (1 − α), so ‖out.psi − target‖² ≤
 *     ‖state.psi − target‖² — monotone-non-increasing Lyapunov energy,
 *     dissipative by construction.
 *
 *   • nullUpdate(state, ctx, out, nodes)
 *       out.psi ← state.psi.  Fixed point everywhere (n=7 Sub-Planckian
 *       ground state).
 *
 * Write contract (enforced by CanonicalUpdateBank truth suite in Step 5):
 *
 *   ✓ writes out.psi, out.m, out.gamma
 *   ✗ never touches out.psiHat, out.u, out.y (measurement-owned)
 *   ✗ never mutates `state` in place (pure w.r.t. input)
 *
 * All accumulators are Neumaier-compensated. No allocations on the hot
 * path — callers pre-build `uPhi` at module scope.
 */

import type {
  FieldStateN,
  LocalUpdateContext,
  LocalUpdateReport,
} from '@metatron/field-kernel-core';

/**
 * Build a unit-ℓ² template of length `nodes` where entry i is `gen(i)`.
 * Called once per module at import time.
 */
export function buildUnitTemplate(nodes: number, gen: (i: number) => number): Float64Array {
  const v = new Float64Array(nodes);
  let sq = 0;
  for (let i = 0; i < nodes; i++) {
    v[i] = gen(i);
    sq += v[i] * v[i];
  }
  const inv = sq > 0 ? 1 / Math.sqrt(sq) : 0;
  for (let i = 0; i < nodes; i++) v[i] *= inv;
  return v;
}

/** Neumaier-compensated ℓ² norm of the first `n` entries of `v`. */
function normL2(v: Float64Array, n: number): number {
  let s = 0,
    c = 0;
  for (let i = 0; i < n; i++) {
    const x = v[i] * v[i];
    const t = s + x;
    c += Math.abs(s) >= x ? s - t + x : x - t + s;
    s = t;
  }
  const total = s + c;
  return total > 0 ? Math.sqrt(total) : 0;
}

/** Clamp α = dt into [0, 1] deterministically (NaN → 0). */
function stepAlpha(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return dt >= 1 ? 1 : dt;
}

/** Compensated add of `x` into (`sum`, `carry`). Returns new `sum`. */
function kAdd(sum: number, carry: { c: number }, x: number): number {
  const t = sum + x;
  carry.c += Math.abs(sum) >= Math.abs(x) ? sum - t + x : x - t + sum;
  return t;
}

/**
 * Relaxation update against a unit-ℓ² template.
 *
 * When any `state.psi[i]` is non-finite the update is not admitted and
 * `out` mirrors `state` (psi/m/gamma). Callers see `admitted:false`.
 */
export function relaxTowardsTemplate(
  state: FieldStateN,
  ctx: LocalUpdateContext,
  out: FieldStateN,
  uPhi: Float64Array,
): LocalUpdateReport {
  const n = uPhi.length;
  if (state.psi.length < n || out.psi.length < n) {
    return { psiDelta: NaN, energyContribution: NaN, admitted: false, gamma: 0 };
  }

  // Finiteness gate — reject rather than propagate NaN.
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(state.psi[i])) {
      for (let j = 0; j < n; j++) {
        out.psi[j] = state.psi[j];
        out.m[j] = state.m[j];
        out.gamma[j] = 0;
      }
      return { psiDelta: 0, energyContribution: 0, admitted: false, gamma: 0 };
    }
  }

  const alpha = stepAlpha(ctx.dt);
  const norm = normL2(state.psi, n);

  let dSum = 0;
  const dCarry = { c: 0 };
  let eBefore = 0;
  const bCarry = { c: 0 };
  let eAfter = 0;
  const aCarry = { c: 0 };

  for (let i = 0; i < n; i++) {
    const tgt = uPhi[i] * norm;
    const p = state.psi[i];
    const np = p - alpha * (p - tgt);

    out.psi[i] = np;
    out.m[i] = state.m[i]; // memory channel carried through
    out.gamma[i] = p - tgt; // signed residual to equilibrium

    const dp = np - p;
    dSum = kAdd(dSum, dCarry, dp * dp);

    const rb = p - tgt;
    eBefore = kAdd(eBefore, bCarry, rb * rb);

    const ra = np - tgt;
    eAfter = kAdd(eAfter, aCarry, ra * ra);
  }

  const psiDelta = Math.sqrt(Math.max(0, dSum + dCarry.c));
  const energyContribution = 0.5 * (eAfter + aCarry.c - (eBefore + bCarry.c));

  return {
    psiDelta,
    energyContribution,
    admitted: true,
    gamma: alpha,
  };
}

/** Null update — out.psi ← state.psi. Every state is a fixed point. */
export function nullUpdate(
  state: FieldStateN,
  _ctx: LocalUpdateContext,
  out: FieldStateN,
  nodes: number,
): LocalUpdateReport {
  const n = nodes;
  if (state.psi.length < n || out.psi.length < n) {
    return { psiDelta: NaN, energyContribution: NaN, admitted: false, gamma: 0 };
  }
  for (let i = 0; i < n; i++) {
    out.psi[i] = state.psi[i];
    out.m[i] = state.m[i];
    out.gamma[i] = 0;
  }
  return { psiDelta: 0, energyContribution: 0, admitted: true, gamma: 0 };
}
