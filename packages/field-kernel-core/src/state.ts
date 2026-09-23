/**
 * @metatron/field-kernel-core/state
 *
 * Phase 2 · Step 1 — RHUFT-F Layer 1 structured state tuple.
 *
 * Blueprint §5: every scale n carries a six-channel tuple
 *   (ψ, ψ̂, m, u, y, γ)
 * rather than a single Float64Array. Landing this as pure types + factories
 * with NO consumers wired yet — the ShadowStateTape (Step 2) is the first
 * writer, and even then only under FLAG_RHUFTF_STATE_TUPLE.
 *
 * Contract:
 *   - All six channels are Float64Array of identical length (`nodes`).
 *   - Channels never alias each other. `createFieldStateN` allocates
 *     fresh buffers; `cloneFieldStateN` copies via `.set()` (fastest
 *     typed-array clone on both V8 and Node).
 *   - Zero-initialised. Consumers must write before read.
 *   - `scale` is a signed int in the RHUFT-F ladder [-1 … 8]; not validated
 *     here to keep the factory branch-free.
 */

export interface FieldStateN {
  /** RHUFT-F scale index (n = -1 … 8 in the current ladder). */
  readonly scale: number;
  /** Live field amplitudes ψ (owned copy — never aliases the kernel's `prev`). */
  readonly psi: Float64Array;
  /** Frozen canonical predictor output ψ̂ (blueprint §8). */
  readonly psiHat: Float64Array;
  /** Memory channel m — writeable by manifestation modules, never by physics. */
  readonly m: Float64Array;
  /** Control/input channel u — reserved for Phase 5 canonical local update. */
  readonly u: Float64Array;
  /** Measurement channel y = O_n(ψ, m, γ). Written by Step 3 operators. */
  readonly y: Float64Array;
  /** Diagnostics/gauge channel γ — writeable by measurement, never by physics. */
  readonly gamma: Float64Array;
}

export function createFieldStateN(scale: number, nodes: number): FieldStateN {
  const n = Math.max(0, nodes | 0);
  return {
    scale: scale | 0,
    psi: new Float64Array(n),
    psiHat: new Float64Array(n),
    m: new Float64Array(n),
    u: new Float64Array(n),
    y: new Float64Array(n),
    gamma: new Float64Array(n),
  };
}

export function cloneFieldStateN(src: FieldStateN): FieldStateN {
  const out = createFieldStateN(src.scale, src.psi.length);
  out.psi.set(src.psi);
  out.psiHat.set(src.psiHat);
  out.m.set(src.m);
  out.u.set(src.u);
  out.y.set(src.y);
  out.gamma.set(src.gamma);
  return out;
}

/**
 * Copy every channel from `src` into `dst` in-place. Both tuples must have
 * matching node counts. Used by ShadowStateTape's ring buffer to avoid
 * per-tick allocations.
 */
export function copyFieldStateN(dst: FieldStateN, src: FieldStateN): void {
  if (dst.psi.length !== src.psi.length) {
    throw new Error(
      `copyFieldStateN: length mismatch dst=${dst.psi.length} src=${src.psi.length}`,
    );
  }
  dst.psi.set(src.psi);
  dst.psiHat.set(src.psiHat);
  dst.m.set(src.m);
  dst.u.set(src.u);
  dst.y.set(src.y);
  dst.gamma.set(src.gamma);
}
