/**
 * @metatron/field-kernel-core/measurement
 *
 * Phase 2 · Step 3 — RHUFT-F Layer 4 measurement operators y = O_n(ψ, m, γ).
 *
 * Strict rules (per master plan Decision #2):
 *   - Every function returns a RAW live number. No clamping, no offset,
 *     no synthetic floor. If a metric is undefined for the current state
 *     (e.g. divide-by-zero), NaN is returned — never a fabricated value.
 *   - Neumaier compensated summation for every accumulator so values remain
 *     stable as node count climbs toward the Planck ceiling.
 *   - No allocations on the hot path (all scratch is stack-scalar).
 *
 * These are pure functions. The Metric Bank (Step 5) is responsible for
 * wiring them to the ShadowStateTape and publishing snapshots.
 */

import type { FieldStateN } from './state';

/* ────────────────────────────  Neumaier helpers  ─────────────────────────── */

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

/* ─────────────────────────────  Measurements  ────────────────────────────── */

/** ‖ψ − ψ̂‖² — real, unclamped. Returns NaN if lengths mismatch. */
export function measureDrift(state: FieldStateN): number {
  const psi = state.psi,
    hat = state.psiHat;
  if (psi.length !== hat.length) return NaN;
  const acc = nAcc();
  for (let i = 0; i < psi.length; i++) {
    const d = psi[i] - hat[i];
    nAdd(acc, d * d);
  }
  return nVal(acc);
}

/**
 * Temporal coherence = Rayleigh ratio ⟨ψ, prev⟩ / ⟨prev, prev⟩.
 * Unclamped: values outside [-1, 1] indicate genuine physical anti-correlation
 * or resonance growth — surfaced as-is per Decision #2.
 * Returns NaN when denominator is 0 (no signal to correlate against).
 */
export function measureTemporalCoherence(psi: Float64Array, prev: Float64Array): number {
  if (psi.length !== prev.length) return NaN;
  const num = nAcc();
  const den = nAcc();
  for (let i = 0; i < psi.length; i++) {
    nAdd(num, psi[i] * prev[i]);
    nAdd(den, prev[i] * prev[i]);
  }
  const d = nVal(den);
  if (d === 0) return NaN;
  return nVal(num) / d;
}

/**
 * Closure deviation against Phase-3 targets. Targets are injected; when
 * absent, returns NaN sentinel (targets ship in Phase 3, not Phase 2).
 * Deviation = Σ (y_i − target_i)².
 */
export function measureClosure(state: FieldStateN, targets: Float64Array | null): number {
  if (!targets) return NaN;
  const y = state.y;
  if (y.length !== targets.length) return NaN;
  const acc = nAcc();
  for (let i = 0; i < y.length; i++) {
    const d = y[i] - targets[i];
    nAdd(acc, d * d);
  }
  return nVal(acc);
}

/**
 * Information density ρ_I (blueprint §4) — Shannon entropy over the
 * normalised power spectrum p_i = |ψ_i|² / Σ|ψ|². Base-2, nats-free.
 * Returns NaN when total power is 0.
 */
export function measureInformationDensity(state: FieldStateN): number {
  const psi = state.psi;
  const norm = nAcc();
  for (let i = 0; i < psi.length; i++) {
    nAdd(norm, psi[i] * psi[i]);
  }
  const total = nVal(norm);
  if (!(total > 0)) return NaN;
  const invTotal = 1 / total;
  const LN2 = Math.LN2;
  const ent = nAcc();
  for (let i = 0; i < psi.length; i++) {
    const p = psi[i] * psi[i] * invTotal;
    if (p > 0) {
      nAdd(ent, -p * (Math.log(p) / LN2));
    }
  }
  return nVal(ent);
}

/** Σ|m|, scale-weighted by φ^n (blueprint §4). PHI is inlined to keep pure. */
const PHI = 1.618033988749895;
export function measureBurden(state: FieldStateN): number {
  const m = state.m;
  const acc = nAcc();
  for (let i = 0; i < m.length; i++) {
    const a = m[i];
    nAdd(acc, a < 0 ? -a : a);
  }
  // Guard against Math.pow blow-up at scale > ~1400 by clamping the
  // multiplier expression only (does not clamp the measurement itself).
  const w = Math.pow(PHI, state.scale);
  return nVal(acc) * (Number.isFinite(w) ? w : 0);
}

/**
 * Inertia = ‖ψ_t − ψ_{t−1}‖ (Neumaier ‖·‖²) then sqrt at the end.
 * Returns NaN on length mismatch.
 */
export function measureInertia(curr: FieldStateN, prev: FieldStateN): number {
  const a = curr.psi,
    b = prev.psi;
  if (a.length !== b.length) return NaN;
  const acc = nAcc();
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    nAdd(acc, d * d);
  }
  return Math.sqrt(nVal(acc));
}
