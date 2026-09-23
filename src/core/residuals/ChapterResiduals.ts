/**
 * ChapterResiduals — additive invariants from the RHUFT chapters
 * ===============================================================
 *
 * Pure-function module. Consumes an already-computed `MetatronOutput` (and
 * optional input echoes for F2/F7/F9 extensions) and returns:
 *
 *   • F4  hex-packing residual            |η − π/(3√2)|
 *   • F8  ZPE mode-sum residual           |Σ½φ⁻ⁿ − ½/(1 − 1/φ)|
 *   • F2  mass-ladder residual            best-fit RMS to m₀·φⁿ
 *   • F7  Titius-Bode residual            best-fit RMS to a·φⁿ in log-space
 *   • F9  CMB acoustic-peak ratio         Σ|ℓ_k/ℓ_1 − k|
 *   • torusVector                         {scalar, poloidal, toroidal} with
 *                                          p²+t² = scalar², t/p = φ (ch.31)
 *   • per-rung closureSaturation         residual / theoretical-floor (φ⁻²ᵏ)
 *
 * Nothing in this module mutates engine state. V10 goldens cannot regress
 * because the chain itself is never touched.
 */

import type { MetatronOutput, ChainDiagnostic } from '../MetatronCore';
import { PHI, PHI_INV } from '../frameworks/constants';
import { NeumaierSum, Welford, phiPow, LN_PHI, finiteOr } from '../numerics/StableSum';
import { isChapter47Active, chapter47CoherenceFloor } from '../runtime/Chapter47';

// ──────────────────────────────────────────────────────────────────────────
// F4 — Hex packing residual
// ──────────────────────────────────────────────────────────────────────────

/** Closed-form 2-D hex packing efficiency η = π/(2√3) = π/(3·(√3/√3·…))
 *  Standard identity used in chapter 35 / phenomenon 35: η_hex = π/(2√3). */
export const HEX_PACKING_ETA = Math.PI / (2 * Math.sqrt(3));

export function f4PackingResidual(measuredEta: number): number {
  return Math.abs(measuredEta - HEX_PACKING_ETA);
}

// ──────────────────────────────────────────────────────────────────────────
// F8 — ZPE mode-sum (truncated φ-ladder vs closed-form geometric sum)
// ──────────────────────────────────────────────────────────────────────────

export function f8ZpeModeSum(maxN: number): number {
  // Inlined Neumaier compensation — no class dispatch per term. Bit-identical
  // to the NeumaierSum-based version on finite inputs; phiPow already
  // guards under/overflow so the per-term finiteness check is unnecessary.
  let s = 0, c = 0;
  for (let n = 0; n <= maxN; n++) {
    const x = 0.5 * phiPow(-n);
    const t = s + x;
    const as = s < 0 ? -s : s;
    const ax = x < 0 ? -x : x;
    c += as >= ax ? (s - t) + x : (x - t) + s;
    s = t;
  }
  return s + c;
}

/** Closed-form: ½ · Σ_{n=0..∞} φ⁻ⁿ = ½ / (1 − 1/φ) = ½ · φ. */
// Σ_{n=0..∞} φ⁻ⁿ = 1/(1−1/φ) = φ² ⇒ ½·Σ = ½·φ² = ½·(1+φ)
export const F8_ZPE_LIMIT = 0.5 * (1 + PHI);

export function f8ZpeResidual(maxN: number): number {
  return Math.abs(f8ZpeModeSum(maxN) - F8_ZPE_LIMIT);
}

// ──────────────────────────────────────────────────────────────────────────
// F2 — Mass-ladder RMS fit to m₀ · φⁿ
// ──────────────────────────────────────────────────────────────────────────

/**
 * Given a list of masses, find best (m₀, integer-n_i) such that masses ≈ m₀·φⁿⁱ.
 * Returns RMS log-residual in n-units (dimensionless; 0 = perfect φ-ladder).
 *
 * Anchored at smallest log-mass → n=0 (so the lightest particle is exact);
 * Welford gives cancellation-free RMS over the per-particle log-residuals.
 */
export function f2MassLadderResidual(masses: readonly number[]): number {
  const pos: number[] = [];
  for (const m of masses) if (Number.isFinite(m) && m > 0) pos.push(m);
  if (pos.length < 2) return 0;
  let minLog = Infinity;
  const logs = new Array<number>(pos.length);
  for (let i = 0; i < pos.length; i++) {
    const lm = Math.log(pos[i]);
    logs[i] = lm;
    if (lm < minLog) minLog = lm;
  }
  const w = new Welford();
  for (const lm of logs) {
    const nReal = (lm - minLog) / LN_PHI;
    const nInt = Math.round(nReal);
    w.add(lm - (minLog + nInt * LN_PHI));
  }
  return finiteOr(w.rms / LN_PHI);
}

// ──────────────────────────────────────────────────────────────────────────
// F2 bridge — closed-form anomalous-slope + QED log correction
// ──────────────────────────────────────────────────────────────────────────
//
// The raw ladder m_n = m₀·φⁿ has a CODATA gap of ≈0.056 n-units for
// (eˉ, μˉ, τˉ): log_φ(206.77) − 11 = +0.07951 and log_φ(3477.23) − 17 = −0.05528
// (RHUFT §5.5). That gap is the well-known QED loop correction; it is NOT a
// numerical bug in `f2MassLadderResidual` and the raw residual must remain
// available for parity with the V10/V11 goldens.
//
// Two physically-motivated bridges are computed alongside the raw value:
//
//   1. δ-slope bridge:  m_n = m₀ · φ^(n·(1+δ)).
//      Closed-form least-squares solution:
//          δ_n = Σ(n_i · Δ_i) / Σ(n_i²)   over i with n_i > 0,
//      where Δ_i = (log m_i − log m₀)/ln φ − n_i  (n-units).
//      Bridged residual_i = Δ_i − n_i · δ_n.
//      Reported as `f2MassLadderBridgedSlope` together with the slope δ_n.
//
//   2. QED log bridge:  ε_n = (α/π) · ln(n+1) / ln φ
//      (one-loop anomalous magnetic moment in φ-mode units, α = 1/137.035999).
//      Subtracted sign-preserving:  Δ_i − sign(Δ_i)·ε_{n_i}.
//      Reported as `f2MassLadderBridgedQed`.
//
// Both bridges are *diagnostic*: they explain the residual without mutating
// the φ-ladder itself, so V10/V11 golden parity for `f2MassLadder` is
// preserved bit-for-bit while the new fields expose the residual's structure.

/** Fine-structure constant (CODATA 2018). */
const ALPHA_FS = 7.2973525693e-3; // ≈ 1/137.035999084

export interface F2MassLadderBridge {
  /** Raw residual (matches `f2MassLadderResidual`). */
  raw: number;
  /** Least-squares slope δ (dimensionless). 0 when fewer than 2 non-anchor masses. */
  bridgedSlope: number;
  /** RMS residual in n-units after subtracting n·δ. */
  bridgedSlopeResidual: number;
  /** RMS residual in n-units after subtracting the 1-loop QED correction. */
  bridgedQedResidual: number;
}

export function f2MassLadderBridge(masses: readonly number[]): F2MassLadderBridge {
  const pos: number[] = [];
  for (const m of masses) if (Number.isFinite(m) && m > 0) pos.push(m);
  if (pos.length < 2) return { raw: 0, bridgedSlope: 0, bridgedSlopeResidual: 0, bridgedQedResidual: 0 };
  let minLog = Infinity;
  for (let i = 0; i < pos.length; i++) {
    const lm = Math.log(pos[i]);
    if (lm < minLog) minLog = lm;
  }
  // Per-particle Δ_i = (log m_i − minLog)/ln φ − round(...). Anchor (Δ=0) is skipped.
  const ns: number[] = [];
  const deltas: number[] = [];
  const rawSquares = new NeumaierSum();
  for (const m of pos) {
    const nReal = (Math.log(m) - minLog) / LN_PHI;
    const nInt = Math.round(nReal);
    const d = nReal - nInt;            // n-units
    rawSquares.add(d * d);
    if (nInt > 0) { ns.push(nInt); deltas.push(d); }
  }
  const rawRms = finiteOr(Math.sqrt(rawSquares.value() / pos.length));
  if (ns.length === 0) {
    return { raw: rawRms, bridgedSlope: 0, bridgedSlopeResidual: rawRms, bridgedQedResidual: rawRms };
  }
  // δ-slope: closed-form least squares  δ = Σ(n·Δ) / Σ(n²)
  const sumN2 = new NeumaierSum();
  const sumNd = new NeumaierSum();
  for (let i = 0; i < ns.length; i++) {
    sumN2.add(ns[i] * ns[i]);
    sumNd.add(ns[i] * deltas[i]);
  }
  const slope = sumN2.value() > 0 ? sumNd.value() / sumN2.value() : 0;
  // QED 1-loop bridge:  ε_n = (α/π) · ln(n+1) / ln φ
  const qedCoeff = (ALPHA_FS / Math.PI) / LN_PHI;
  const slopeSq = new NeumaierSum();
  const qedSq = new NeumaierSum();
  // Include the anchor's zero residual so RMS divides by `pos.length` (consistent with raw).
  const anchorZeroCount = pos.length - ns.length;
  for (let i = 0; i < anchorZeroCount; i++) { slopeSq.add(0); qedSq.add(0); }
  for (let i = 0; i < ns.length; i++) {
    const rs = deltas[i] - ns[i] * slope;
    slopeSq.add(rs * rs);
    const eps = qedCoeff * Math.log(ns[i] + 1);
    const rq = deltas[i] - Math.sign(deltas[i]) * eps;
    qedSq.add(rq * rq);
  }
  return {
    raw: rawRms,
    bridgedSlope: finiteOr(slope),
    bridgedSlopeResidual: finiteOr(Math.sqrt(slopeSq.value() / pos.length)),
    bridgedQedResidual: finiteOr(Math.sqrt(qedSq.value() / pos.length)),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// F7 — Titius-Bode φ-fit RMS (log-space)
// ──────────────────────────────────────────────────────────────────────────

export function f7TitiusBodeResidual(radiiAu: readonly number[]): number {
  // Same shape as f2: best-fit a·φⁿ in log-space.
  return f2MassLadderResidual(radiiAu);
}

// ──────────────────────────────────────────────────────────────────────────
// Ch.5 — φ-integer lepton residual (RHUFT §5.5)
// ──────────────────────────────────────────────────────────────────────────
//
// Claim: m_μ/m_e ≈ φ^11, m_τ/m_e ≈ φ^17.
// Residual = |log_φ(ratio) − round(log_φ(ratio))|. Lower = the doc's
// coincidence holds. Pure numerical check, no fitting parameters.
//
// CODATA reference ratios:
//   m_μ/m_e = 206.7682830  →  log_φ ≈ 11.0795  (Δ ≈ 0.0795)
//   m_τ/m_e = 3477.23      →  log_φ ≈ 16.9447  (Δ ≈ 0.0553)
export const LEPTON_RATIO_MU_E = 206.7682830;
export const LEPTON_RATIO_TAU_E = 3477.23;

export interface PhiIntegerFit {
  ratio: number;
  logPhi: number;
  nearestInt: number;
  residual: number;
}

export function phiIntegerFit(ratio: number): PhiIntegerFit {
  const lp = Math.log(ratio) / Math.log(PHI);
  const n = Math.round(lp);
  return { ratio, logPhi: lp, nearestInt: n, residual: Math.abs(lp - n) };
}

export interface LeptonPhiResiduals {
  muon: PhiIntegerFit;
  tau: PhiIntegerFit;
  combined: number;
}

export function leptonPhiResiduals(
  muRatio: number = LEPTON_RATIO_MU_E,
  tauRatio: number = LEPTON_RATIO_TAU_E,
): LeptonPhiResiduals {
  const muon = phiIntegerFit(muRatio);
  const tau = phiIntegerFit(tauRatio);
  const combined = Math.sqrt((muon.residual ** 2 + tau.residual ** 2) / 2);
  return { muon, tau, combined };
}

// ──────────────────────────────────────────────────────────────────────────
// Ch.3.7 — Bond-angle lattice residual
// ──────────────────────────────────────────────────────────────────────────
//
// Doc claim: sphere-save-point lattice yields canonical bond angles.
//   linear         180°
//   trigonal       120°       (graphene, sp²)
//   tetrahedral    109.4712°  = arccos(−1/3), sp³
//   octahedral      90°       sp³d²
export const TETRAHEDRAL_DEG = (Math.acos(-1 / 3) * 180) / Math.PI;
export const BOND_ANGLE_CANONICAL_DEG: readonly number[] = [
  90, TETRAHEDRAL_DEG, 120, 180,
] as const;

export function bondAngleResidualDeg(measuredDeg: number): number {
  let best = Infinity;
  for (const a of BOND_ANGLE_CANONICAL_DEG) {
    const d = Math.abs(measuredDeg - a);
    if (d < best) best = d;
  }
  return best;
}

export function bondAngleSetResidualDeg(angles: readonly number[]): number {
  if (angles.length === 0) return 0;
  const w = new Welford();
  for (const a of angles) w.add(bondAngleResidualDeg(a));
  // Welford gives stable Σ(r²)/n via variance + mean² identity.
  return finiteOr(w.rms);
}

// ──────────────────────────────────────────────────────────────────────────
// Ch.4.7 — Compton toroidal-radius identity
// ──────────────────────────────────────────────────────────────────────────
//
// Doc claim: R_torus(e⁻) = ℏ/(m_e c) = reduced Compton wavelength.
// Identity holds by definition; residual is meaningful only when a caller
// supplies an independently measured charge-distribution radius.
//
//   λ̄_C(e⁻) = 3.8615926796e-13 m  (CODATA 2018)
export const REDUCED_COMPTON_E_M = 3.8615926796e-13;

export function comptonToroidalResidual(measuredRadiusM: number): number {
  return Math.abs(measuredRadiusM - REDUCED_COMPTON_E_M) / REDUCED_COMPTON_E_M;
}

// ──────────────────────────────────────────────────────────────────────────
// F9 — CMB acoustic-peak ratio residual
// ──────────────────────────────────────────────────────────────────────────

/** Σ_k |ℓ_k/ℓ_1 − k| over k=2..N. Zero when peaks are perfect integer multiples. */
export function f9CmbPeakResidual(multipoles: readonly number[]): number {
  if (multipoles.length < 2) return 0;
  const l1 = multipoles[0];
  if (!Number.isFinite(l1) || l1 <= 0) return 0;
  const acc = new NeumaierSum();
  for (let k = 1; k < multipoles.length; k++) {
    acc.add(Math.abs(multipoles[k] / l1 - (k + 1)));
  }
  return finiteOr(acc.value() / (multipoles.length - 1));
}

// ──────────────────────────────────────────────────────────────────────────
// Torus closure vector — chapter 31 poloidal/toroidal split
// ──────────────────────────────────────────────────────────────────────────
//
// Chapter 31 gives the winding ratio toroidal / poloidal = φ.
// Decompose the scalar so p² + t² = scalar²  AND  t/p = φ.
//   p = scalar / √(1+φ²),   t = scalar·φ / √(1+φ²)

const NORM_PT = Math.sqrt(1 + PHI * PHI);

export interface TorusVector {
  scalar: number;
  poloidal: number;
  toroidal: number;
}

export function torusVector(scalar: number): TorusVector {
  const p = scalar / NORM_PT;
  const t = scalar * PHI / NORM_PT;
  return { scalar, poloidal: p, toroidal: t };
}

// ──────────────────────────────────────────────────────────────────────────
// Closure saturation labels — per-rung physical floor (V13)
// ──────────────────────────────────────────────────────────────────────────
//
// V11/V12 used floor = φ^(-2k) where k = canonical rung index. That treats
// every rung as if it had the same physical contraction, and the index alias
// (`indexOf` defaulting to 0) silently mis-floored F8. V13 swaps this for
// the per-rung Lyapunov bank — each rung carries its own physically-derived
// λ (see `src/core/v12/audit/LyapunovBank.ts` and provenance script
// `scripts/v13FreezeLyapunov.ts`).
//
// Acceptance band is the golden envelope [λ/φ, λ·φ] (width φ² ≈ 2.618×).
//
// Cross-source check: the floor is reconstructed via an independent
// arithmetic path (log-space, exp(ln λ)) and the two must agree within
// 1/φ⁸ ≈ 0.021 — anything wider is labelled `divergent`.

import { LYAPUNOV_BANK, SATURATION_BAND_LO, SATURATION_BAND_HI, type RungName } from '../v12/audit/LyapunovBank';

export type SaturationLabel = 'saturated-OK' | 'under' | 'over' | 'absent' | 'divergent';

export interface RungSaturation {
  framework: ChainDiagnostic['framework'];
  measured: number;
  /** Lyapunov floor λ for this rung (from LyapunovBank). */
  floor: number;
  /** measured / floor. */
  saturation: number;
  label: SaturationLabel;
  /** Symbolic form of λ, e.g. "φ⁻²". */
  lambdaSymbol: string;
  /** Independent (log-space) reconstruction of `saturation`. */
  saturationCrossCheck: number;
  /** |saturation − saturationCrossCheck|. < 1/φ⁸ for non-divergent. */
  crossCheckResidual: number;
}

const CROSS_CHECK_TOL = Math.pow(PHI_INV, 8); // ≈ 0.02132

export function classifyRung(rung: ChainDiagnostic): RungSaturation {
  const entry = LYAPUNOV_BANK[rung.framework as RungName];
  const floor = entry?.lambda ?? PHI_INV * PHI_INV;
  const lambdaSymbol = entry?.symbolic ?? 'φ⁻²';
  const measured = rung.closureResidual;
  if (!(measured > 0)) {
    return {
      framework: rung.framework,
      measured, floor, saturation: 0,
      label: 'absent', lambdaSymbol,
      saturationCrossCheck: 0, crossCheckResidual: 0,
    };
  }
  // Direct path:  sat = measured / floor
  const sat = measured / floor;
  // Cross-source: sat' = exp(log(measured) − log(floor)). Different code
  // path → catches order-of-magnitude inconsistencies and underflow drift.
  const satCross = Math.exp(Math.log(measured) - Math.log(floor));
  const residual = Math.abs(sat - satCross);
  if (residual > CROSS_CHECK_TOL * Math.max(1, sat)) {
    return {
      framework: rung.framework,
      measured, floor, saturation: sat,
      label: 'divergent', lambdaSymbol,
      saturationCrossCheck: satCross, crossCheckResidual: residual,
    };
  }
  const label: SaturationLabel =
    sat >= SATURATION_BAND_LO && sat <= SATURATION_BAND_HI ? 'saturated-OK'
    : sat < SATURATION_BAND_LO ? 'under'
    : 'over';
  return {
    framework: rung.framework,
    measured, floor, saturation: sat, label, lambdaSymbol,
    saturationCrossCheck: satCross, crossCheckResidual: residual,
  };
}

export function classifyChain(chain: readonly ChainDiagnostic[]): RungSaturation[] {
  return chain.map(classifyRung);
}

// ──────────────────────────────────────────────────────────────────────────
// Aggregate
// ──────────────────────────────────────────────────────────────────────────

export interface ChapterResidualsInput {
  /** F2 extension particle masses (optional). */
  f2Masses?: readonly number[];
  /** F7 body semi-major axes in AU (optional). */
  f7RadiiAu?: readonly number[];
  /** F9 acoustic-peak multipoles (optional). */
  f9Multipoles?: readonly number[];
  /** F4 measured packing efficiency. Defaults to chapter-ideal (residual=0). */
  f4Eta?: number;
  /** F8 mode-sum truncation N. */
  f8MaxN?: number;
}

export interface ChapterResiduals {
  f4Packing: number;
  f8ZpeModeSum: number;
  f8ZpeLimit: number;
  f8ZpeResidual: number;
  f2MassLadder: number;
  /**
   * F2 bridge diagnostics — explain the raw residual without mutating the
   * canonical φ-ladder (V10/V11 golden parity preserved). Both bridged
   * residuals are in n-units (same scale as `f2MassLadder`).
   */
  f2MassLadderBridge: F2MassLadderBridge;
  f7TitiusBode: number;
  f9CmbPeakRatio: number;
  torus: TorusVector;
  saturation: RungSaturation[];
  /** Ch.5 — distance of m_μ/m_e and m_τ/m_e from nearest integer power of φ. */
  leptonPhi: LeptonPhiResiduals;
  /** Ch.3.7 — RMS deviation (deg) of supplied bond angles from canonical set. */
  bondAngle: number;
  /** Ch.4.7 — relative deviation of supplied electron toroidal radius from λ̄_C. */
  comptonToroidal: number;
  /** Ch.47 engagement flag (true when crystalline floor is clamping coherence). */
  chapter47Active: boolean;
  /** Live Ch.47 coherence floor (0 when disengaged, φ⁻² when engaged). */
  chapter47Floor: number;
}

// Canonical lepton mass ladder (CODATA, MeV/c²) — drives F2 ladder by default.
const DEFAULT_LEPTON_MASSES_MEV: readonly number[] = [
  0.51099895, 105.6583755, 1776.86,
];
// Solar-system semi-major axes (AU) — drives F7 Titius-Bode by default.
const DEFAULT_PLANETARY_AU: readonly number[] = [
  0.387, 0.723, 1.000, 1.524, 5.203, 9.537, 19.191, 30.069,
];

export function computeChapterResiduals(
  output: MetatronOutput,
  extras: ChapterResidualsInput & {
    bondAnglesDeg?: readonly number[];
    measuredElectronRadiusM?: number;
  } = {},
): ChapterResiduals {
  const maxN = Math.max(0, Math.floor(extras.f8MaxN ?? 40));
  // Compute the mode-sum once; the residual is just |sum − limit|.
  const f8Sum = f8ZpeModeSum(maxN);
  const f2Masses = extras.f2Masses ?? DEFAULT_LEPTON_MASSES_MEV;
  const f2Bridge = f2MassLadderBridge(f2Masses);
  return {
    f4Packing: f4PackingResidual(extras.f4Eta ?? HEX_PACKING_ETA),
    f8ZpeModeSum: f8Sum,
    f8ZpeLimit: F8_ZPE_LIMIT,
    f8ZpeResidual: Math.abs(f8Sum - F8_ZPE_LIMIT),
    f2MassLadder: f2Bridge.raw,
    f2MassLadderBridge: f2Bridge,
    f7TitiusBode: f7TitiusBodeResidual(extras.f7RadiiAu ?? DEFAULT_PLANETARY_AU),
    f9CmbPeakRatio: f9CmbPeakResidual(extras.f9Multipoles ?? []),
    torus: torusVector(output.torusClosure),
    saturation: classifyChain(output.chain),
    leptonPhi: leptonPhiResiduals(),
    bondAngle: bondAngleSetResidualDeg(extras.bondAnglesDeg ?? []),
    comptonToroidal:
      extras.measuredElectronRadiusM !== undefined
        ? comptonToroidalResidual(extras.measuredElectronRadiusM)
        : 0,
    chapter47Active: isChapter47Active(),
    chapter47Floor: chapter47CoherenceFloor(),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Memoisation — Section 4
//
// `computeChapterResiduals` is referentially transparent w.r.t. (output, extras):
// identical inputs → bit-identical residuals. It's called every 30 Hz from
// Workstation + 60 Hz from /torus and re-runs Welford fits, NeumaierSum, and
// f8ZpeModeSum(40) every call. We cache on (output reference identity, extras
// fingerprint, Ch.47 floor state) — the engine output is itself memoised by
// computeMetatronMemo so identity is a perfect cache key.
// ──────────────────────────────────────────────────────────────────────────

function arrFp(a: readonly number[] | undefined): string {
  if (!a) return '_';
  const n = a.length;
  if (n === 0) return '0';
  return `${n}:${a[0]}:${a[n >> 1]}:${a[n - 1]}`;
}
function extrasFp(e: Parameters<typeof computeChapterResiduals>[1] | undefined): string {
  if (!e) return '_';
  return [
    e.f4Eta ?? '_',
    e.f8MaxN ?? '_',
    arrFp(e.f2Masses as readonly number[] | undefined),
    arrFp(e.f7RadiiAu as readonly number[] | undefined),
    arrFp(e.f9Multipoles as readonly number[] | undefined),
    arrFp(e.bondAnglesDeg as readonly number[] | undefined),
    e.measuredElectronRadiusM ?? '_',
  ].join('|');
}

const CR_LRU_MAX = 4;
const crLru = new Map<string, ChapterResiduals>();
let lastOutputRef: MetatronOutput | null = null;
let lastOutputTag = 0;
function outputTag(o: MetatronOutput): string {
  // Reference identity gives an O(1) tag; allocate a fresh number per new ref.
  if (o !== lastOutputRef) { lastOutputRef = o; lastOutputTag++; }
  return String(lastOutputTag);
}

export function computeChapterResidualsMemo(
  output: MetatronOutput,
  extras: Parameters<typeof computeChapterResiduals>[1] = {},
): ChapterResiduals {
  const key = `${outputTag(output)}|${extrasFp(extras)}|${isChapter47Active() ? '1' : '0'}:${chapter47CoherenceFloor()}`;
  const hit = crLru.get(key);
  if (hit !== undefined) {
    crLru.delete(key); crLru.set(key, hit);
    return hit;
  }
  const out = computeChapterResiduals(output, extras);
  crLru.set(key, out);
  if (crLru.size > CR_LRU_MAX) {
    const oldest = crLru.keys().next().value;
    if (oldest !== undefined) crLru.delete(oldest);
  }
  return out;
}

export function resetChapterResidualsMemo() {
  crLru.clear(); lastOutputRef = null; lastOutputTag = 0;
}
export function chapterResidualsMemoStats() {
  return { size: crLru.size, max: CR_LRU_MAX };
}

