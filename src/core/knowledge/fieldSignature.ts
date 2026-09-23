/**
 * Ω-SHFN Section G — the memory ↔ field bridge.
 *
 * A chunk's hashed feature vector is a *semantic fingerprint*: it says which
 * tokens the text contains, nothing about how that text behaves as a field.
 * This module produces the missing half — a **field signature**: the encoded
 * text propagated through the measured Laplace–Beltrami spectrum of the rung
 * it lives on, read back as eigen-ordered complex coefficients.
 *
 * Pipeline (all deterministic, no RNG, no clock):
 *
 *   text ──encodeText──▶ Ψ ∈ C^N        (trigram φ-comb code, ‖Ψ‖_inf ≤ φ)
 *        ──analyze────▶ c_k = ⟨v_k|Ψ⟩   (v_k: measured eigenvectors of L)
 *        ──propagate──▶ a_k = c_k · e^{-λ_k τ} · e^{-i λ_k τ_ψ}
 *        ──normalise──▶ unit ℓ² signature, 2K floats (re/im interleaved)
 *
 * Why propagation is exact rather than stepped: on the eigenbasis of L the
 * heat semigroup and the free Schrödinger phase are *diagonal*, so evolving
 * for a fixed number of ticks is a closed-form multiply per mode. Stepping the
 * same operator would only add floating-point drift. τ is the ladder time of
 * F₇ = 13 ticks at dt = φ⁻⁵, chosen so the damping profile e^{-λτ} spans
 * roughly 1 → 0.3 over the resolved band: high modes are attenuated but never
 * annihilated, which is what keeps the tail of the signature informative.
 *
 * Similarity is the modulus of the complex inner product, so it is invariant
 * under a global phase (an irrelevant gauge) but *not* under per-mode phase
 * differences — which is exactly the structural information the hashed vector
 * throws away.
 *
 * Determinism guarantees:
 *   - every transcendental goes through the `dmath` bank (dexp/dcos/dsin),
 *   - the eigenbasis is Lanczos with full re-orthogonalisation and carries its
 *     own measured residual and digest,
 *   - signatures are never persisted: they are recomputed from text, so a
 *     reload can only reproduce them, never inherit a stale generation.
 */

import { buildRingLaplacian, lanczosEigenpairs, spectrumDigest } from '@metatron/trnn-core/spectral/laplacian';
import { encodeText, senseField } from '@metatron/trnn-core/sense/encode';
import type { CField } from '@metatron/trnn-core/core/complex';
import { dcos, dexp, dsin } from '@metatron/trnn-core/core/dmath';
import { PHI_INV } from '@/core/gematria/zphi';

/**
 * Bump when the encoder, the propagation law, the tier table, or the coefficient
 * layout changes. A bump invalidates cached signatures rather than mixing two
 * generations in one recall space.
 */
export const FIELD_SIGNATURE_VERSION = 'shfn-G-1' as const;

/** Ticks of ladder time the encoded field is propagated for (F₇). */
export const SIGNATURE_TICKS = 13;
/** Tick length on the φ ladder (φ⁻⁵). */
export const SIGNATURE_DT = PHI_INV * PHI_INV * PHI_INV * PHI_INV * PHI_INV;
/** Dissipative propagation time τ = ticks · dt. */
export const SIGNATURE_TAU = SIGNATURE_TICKS * SIGNATURE_DT;
/** Unitary (phase) propagation time — φ, one full ladder step. */
export const SIGNATURE_TAU_PHASE = 1 / PHI_INV;

export interface SignatureTier {
  readonly id: string;
  /** Ring nodes the text is encoded onto — Fibonacci (Law 2.2). */
  readonly nodes: number;
  /** Leading eigenmodes retained — the signature is 2·modes floats. */
  readonly modes: number;
  /** Measured build cost class, for the governor's UI copy only. */
  readonly note: string;
}

/**
 * Resolution ladder. Widths are Fibonacci and strictly increasing; the cost of
 * the one-time basis build grows super-linearly (measured: 610/233 ≈ 2.3 s,
 * 1597/610 ≈ minutes), so the upper tiers are opt-in, never auto-selected.
 */
export const SIGNATURE_TIERS: readonly SignatureTier[] = [
  { id: 'F13', nodes: 233, modes: 89, note: 'fast — sub-second basis' },
  { id: 'F15', nodes: 610, modes: 233, note: 'default — few seconds' },
  { id: 'F17', nodes: 1597, modes: 610, note: 'deep — minutes, opt-in' },
  { id: 'F19', nodes: 4181, modes: 987, note: 'offline — long build, opt-in' },
];

export function tierById(id: string): SignatureTier {
  return SIGNATURE_TIERS.find((t) => t.id === id) ?? SIGNATURE_TIERS[1];
}

/**
 * Pick a tier from *measured* hardware only. `deviceMemory` and
 * `hardwareConcurrency` are read where available; when neither is reported the
 * conservative tier is used rather than a guess.
 */
export function recommendTier(): SignatureTier {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as
    | (Navigator & { deviceMemory?: number })
    | undefined;
  const gb = typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : 0;
  const cores = typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 0;
  // F15 costs ~40 ms per chunk to encode; only a machine that reports both a
  // large heap and real parallelism gets it by default. Everything else runs
  // F13, which still resolves 89 measured modes.
  if (gb >= 8 && cores >= 8) return SIGNATURE_TIERS[1];
  return SIGNATURE_TIERS[0];
}

export interface BasisReport {
  readonly tier: string;
  readonly nodes: number;
  readonly modes: number;
  /** max ‖L v_k − λ_k v_k‖ over the retained pairs — measured, not assumed. */
  readonly maxResidual: number;
  /** FNV-1a over the λ table; two engines that agree print the same digest. */
  readonly digest: string;
  readonly lambdaMin: number;
  readonly lambdaMax: number;
  /** Wall-clock build cost in ms — a real timing, never an estimate. */
  readonly buildMs: number;
  readonly version: string;
}

interface Basis {
  readonly tier: SignatureTier;
  readonly vectors: readonly Float64Array[];
  readonly lambda: Float64Array;
  /** Precomputed per-mode propagator e^{-λτ}·e^{-iλτ_ψ}. */
  readonly propRe: Float64Array;
  readonly propIm: Float64Array;
  readonly report: BasisReport;
}

const BASES = new Map<string, Basis>();

function buildBasis(tier: SignatureTier): Basis {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const L = buildRingLaplacian(tier.nodes);
  const pairs = lanczosEigenpairs(L, tier.modes);
  const k = pairs.lambda.length;
  const propRe = new Float64Array(k);
  const propIm = new Float64Array(k);
  let maxResidual = 0;
  for (let i = 0; i < k; i++) {
    const lam = pairs.lambda[i];
    const damp = dexp(-lam * SIGNATURE_TAU);
    const ang = -lam * SIGNATURE_TAU_PHASE;
    propRe[i] = damp * dcos(ang);
    propIm[i] = damp * dsin(ang);
    if (pairs.residual[i] > maxResidual) maxResidual = pairs.residual[i];
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  return {
    tier,
    vectors: pairs.vectors,
    lambda: pairs.lambda,
    propRe,
    propIm,
    report: {
      tier: tier.id,
      nodes: tier.nodes,
      modes: k,
      maxResidual,
      digest: spectrumDigest(pairs.lambda),
      lambdaMin: pairs.lambda[0] ?? 0,
      lambdaMax: pairs.lambda[k - 1] ?? 0,
      buildMs: t1 - t0,
      version: FIELD_SIGNATURE_VERSION,
    },
  };
}

/**
 * Field-signature encoder for one tier. The basis build is the only expensive
 * step and happens once per tier per session; encoding is O(N·K) after that.
 */
export class FieldSignatureEncoder {
  readonly tier: SignatureTier;
  private basis: Basis | null = null;
  private psi: CField | null = null;

  constructor(tier: SignatureTier = SIGNATURE_TIERS[1]) {
    this.tier = tier;
    this.basis = BASES.get(tier.id) ?? null;
  }

  ready(): boolean { return this.basis !== null; }
  report(): BasisReport | null { return this.basis?.report ?? null; }
  /** Signature width in floats (2 per retained mode). */
  width(): number { return this.basis ? this.basis.vectors.length * 2 : 0; }

  /** Build (or reuse) the eigenbasis. Synchronous and deterministic. */
  prepare(): BasisReport {
    if (!this.basis) {
      const cached = BASES.get(this.tier.id);
      const b = cached ?? buildBasis(this.tier);
      BASES.set(this.tier.id, b);
      this.basis = b;
    }
    return this.basis.report;
  }

  /**
   * Encode text into a unit-norm field signature. Returns null for empty text
   * or a field with no energy — an abstention, never a zero vector that would
   * silently score as "unrelated to everything".
   */
  encode(text: string): Float64Array | null {
    const basis = this.basis;
    if (!basis) throw new Error('FieldSignatureEncoder: prepare() must run before encode()');
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (!this.psi || this.psi.n !== basis.tier.nodes) this.psi = senseField(basis.tier.nodes);
    const psi = this.psi;
    const rep = encodeText(trimmed, psi);
    if (!(rep.energy > 0)) return null;

    const k = basis.vectors.length;
    const out = new Float64Array(2 * k);
    let sq = 0;
    for (let m = 0; m < k; m++) {
      const v = basis.vectors[m];
      // ⟨v|Ψ⟩ with a real eigenvector; Neumaier-compensated so the projection
      // is reproducible independent of summation order effects.
      let sr = 0, cr = 0, si = 0, ci = 0;
      for (let i = 0; i < v.length; i++) {
        const tr = v[i] * psi.re[i];
        let t = sr + tr;
        cr += Math.abs(sr) >= Math.abs(tr) ? sr - t + tr : tr - t + sr;
        sr = t;
        const ti = v[i] * psi.im[i];
        t = si + ti;
        ci += Math.abs(si) >= Math.abs(ti) ? si - t + ti : ti - t + si;
        si = t;
      }
      const are = sr + cr;
      const aim = si + ci;
      const pr = basis.propRe[m];
      const pi = basis.propIm[m];
      const re = are * pr - aim * pi;
      const im = are * pi + aim * pr;
      out[2 * m] = re;
      out[2 * m + 1] = im;
      sq += re * re + im * im;
    }
    const n = Math.sqrt(sq);
    if (!(n > 0)) return null;
    for (let i = 0; i < out.length; i++) out[i] /= n;
    return out;
  }
}

/**
 * Phase-aligned cosine between two signatures: |Σ a_k conj(b_k)| / (‖a‖‖b‖).
 *
 * Taking the modulus removes the global gauge phase (two encodings of the same
 * content that differ only by an overall rotation must match exactly) while
 * keeping *relative* inter-mode phase, which is where the structure lives.
 * Returns NaN when either side abstains or the widths disagree — an abstention
 * the caller must renormalise around, never a silent 0.
 */
export function signatureSimilarity(a: Float64Array | null, b: Float64Array | null): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return NaN;
  let dr = 0, di = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 2) {
    const ar = a[i], ai = a[i + 1], br = b[i], bi = b[i + 1];
    dr += ar * br + ai * bi;
    di += ai * br - ar * bi;
    na += ar * ar + ai * ai;
    nb += br * br + bi * bi;
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  if (!(den > 0)) return NaN;
  const v = Math.sqrt(dr * dr + di * di) / den;
  return v > 1 ? 1 : v;
}

/**
 * Ω-DEPTH Section 3 — multi-scale reading of the *same* signature.
 *
 * The coefficients are eigen-ordered by increasing λ, so the head of the vector
 * is the coarse band (global eigendeformations) and the tail is the fine band
 * (local texture). Splitting the head at φ⁻¹ of the retained modes gives a
 * cheap coarse score for ranking, and the full vector for refinement among the
 * survivors. No stored layout changes, so signatures stay bit-identical and the
 * version does not move.
 */
export const COARSE_SPLIT = PHI_INV;
/** Survivors refined at full resolution — Fibonacci. */
export const REFINE_KEEP = 34;

/** Number of *floats* in the coarse head of a signature of `len` floats. */
export function coarseWidth(len: number): number {
  const modes = len >> 1;
  const head = Math.max(1, Math.round(modes * COARSE_SPLIT));
  return Math.min(len, head * 2);
}

/** Phase-aligned cosine over the coarse head only. */
export function signatureSimilarityCoarse(a: Float64Array | null, b: Float64Array | null): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return NaN;
  const w = coarseWidth(a.length);
  let dr = 0, di = 0, na = 0, nb = 0;
  for (let i = 0; i < w; i += 2) {
    const ar = a[i], ai = a[i + 1], br = b[i], bi = b[i + 1];
    dr += ar * br + ai * bi;
    di += ai * br - ar * bi;
    na += ar * ar + ai * ai;
    nb += br * br + bi * bi;
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  if (!(den > 0)) return NaN;
  const v = Math.sqrt(dr * dr + di * di) / den;
  return v > 1 ? 1 : v;
}

/**
 * Coarse-first ranking: score every candidate on the coarse band, then rescore
 * only the top `keep` at full resolution. Deterministic — ties break on id.
 * Candidates that abstain (NaN) stay NaN; nothing is silently zeroed.
 */
export function multiScaleScores(
  query: Float64Array | null,
  candidates: ReadonlyMap<string, Float64Array | null>,
  keep = REFINE_KEEP,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!query) return out;
  const coarse: { id: string; v: number }[] = [];
  for (const [id, sig] of candidates) {
    const c = signatureSimilarityCoarse(query, sig);
    out.set(id, c);
    if (Number.isFinite(c)) coarse.push({ id, v: c });
  }
  coarse.sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < Math.min(keep, coarse.length); i++) {
    const id = coarse[i].id;
    const full = signatureSimilarity(query, candidates.get(id) ?? null);
    if (Number.isFinite(full)) out.set(id, full);
  }
  return out;
}

/** Byte-level equality — the determinism gate compares with this, not a tolerance. */
export function signatureEquals(a: Float64Array | null, b: Float64Array | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
