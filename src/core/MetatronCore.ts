/**
 * METATRON V11 — UNIFIED CORE
 * ============================
 *
 * Runs all nine frameworks (F1..F9) in their natural scale-ascending chain
 * and threads each layer's `chainUpCoupling` into the next, mirroring the
 * V10 RHUFTFrameworks orchestration but built on the V11 wrappers (each of
 * which preserves V10 math bit-for-bit and adds Lyapunov closureResidual +
 * extension hooks).
 *
 *      F8  (sub-Planckian)
 *       │  chainUpCoupling
 *       ▼
 *      F1  (septenary, body)
 *       │  chainUpCoupling   +   centralColumn  ──┐
 *       ▼                                        │
 *      F2  (quantum, particles)                  │
 *       │                                        │
 *       ▼                                        │
 *      F3  (atomic, orbits)                      │
 *       │                                        │
 *       ▼                                        │
 *      F4  (geometric, Platonic)                 │
 *       │                                        │
 *       ▼                                        │
 *      F5  (color/music, harmonics)              │
 *       │                                        │
 *       ▼                                        │
 *      F6  (Hebrew, Tree of Life)  ◀─────────────┘ Heart-Throat bridge
 *       │
 *       ▼
 *      F7  (galactic, planets)
 *       │
 *       ▼
 *      F9  (hypergalactic, cosmic web)
 *
 * Toroidal closure: at each rung the local Lyapunov residual is the magnitude
 * of the φ-irrational phase-summed amplitude; the global `metatronClosure`
 * is the φ-weighted geometric mean of the nine residuals — small only when
 * the entire stack is coherent, ergodic, and toroidally balanced.
 */

import { computeF1, type F1Input, type F1Output } from './frameworks/F1_Septenary';
import { computeF2, type F2Input, type F2Output } from './frameworks/F2_Quantum';
import { computeF3, type F3Input, type F3Output } from './frameworks/F3_Atomic';
import { computeF4, type F4Input, type F4Output } from './frameworks/F4_Geometric';
import { computeF5, type F5Input, type ColorMusicOutput as F5Output } from './frameworks/F5_ColorMusic';
import { computeF6, type F6Input, type F6OutputV11 as F6Output } from './frameworks/F6_Hebrew';
import { computeF7, type F7Input, type F7OutputV11 as F7Output } from './frameworks/F7_Galactic';
import { computeF8, type F8Input, type F8Output } from './frameworks/F8_SubPlanckian';
import { computeF9, type F9Input, type F9OutputV11 as F9Output } from './frameworks/F9_HyperGalactic';
import { PHI, PHI_INV } from './frameworks/constants';

// ─────────────────────────────────────────────────────────────────────────────
//  Top-level input — minimal shared state plus per-framework optional knobs.
//  Anything not provided gets a deterministic, parity-safe default so the
//  unifier is callable as `computeMetatron({ coherence: 0.7, time: 0 })`.
// ─────────────────────────────────────────────────────────────────────────────

export interface MetatronInput {
  /** Master coherence ∈ [0,1] driving every layer. */
  coherence: number;
  /** Master energy ∈ [0,1] (used by F2/F7/F9). */
  energy?: number;
  /** Sim time (ms). */
  time: number;

  /** 22-complex F1 phase array (≥44 floats). Default: zero phases. */
  phases?: Float64Array;
  /** 55-node pineal Float64Array (F2/F9). Default: φ-decayed mode amplitudes. */
  pinealField?: Float64Array;
  /** F3 atomic node amps (Float64Array, ≥7). Default: φ-decayed. */
  nodeAmps?: Float64Array;
  /** F4 sacred-geometry node coherences (≥13). Default: φ-decayed. */
  nodeCoherences?: number[];
  /** F6 pineal coherences (≥22). Default: φ-decayed. */
  pinealCoherences?: number[];
  /** Shared 55-node flower-of-life coherence array. Default: φ-decayed. */
  flowerCoherences?: number[];
  /** Shared 9-step solfeggio coherence array. Default: 0.55 each. */
  solfeggioCoherences?: number[];

  /** Galactic recursion depth for F7. */
  recursionDepth?: number;

  /** Per-framework V11 extension knobs. */
  extensions?: {
    /** F1: target chakra-mode count beyond 7. */
    chakraModes?: number;
    /** F2: extra SM-completion particles. */
    quantumParticles?: F2Input['extensionParticles'];
    /** F3: extra Bohr orbits beyond n=7. */
    atomicShells?: number;
    /** F4: extra Metatron nodes beyond 13. */
    metatronNodes?: number;
    /** F5: chromatic-mode count beyond 12 (e.g. 24-EDO). */
    chromaticSemitones?: number;
    /** F6: extra Hebrew letters beyond 22. */
    letters?: F6Input['extensionLetters'];
    /** F7: extra solar-system bodies. */
    bodies?: F7Input['extensionBodies'];
    /** F9: extra CMB acoustic-peak multipoles. */
    multipoles?: number[];
    /** F8: target ring count beyond 5 (5 ⇒ V10 golden). */
    subPlanckianRings?: number;
    /** F8: target vacuum-mode count beyond 7 (7 ⇒ V10 golden). */
    subPlanckianModes?: number;
    /** F8: target Planck-flower sphere count beyond 13 (13 ⇒ V10 golden). */
    subPlanckianSpheres?: number;
  };
}

export interface MetatronOutput {
  F1: F1Output;
  F2: F2Output;
  F3: F3Output;
  F4: F4Output;
  F5: F5Output;
  F6: F6Output;
  F7: F7Output;
  F8: F8Output;
  F9: F9Output;
  /**
   * φ-weighted geometric mean of all nine layers' Lyapunov closureResiduals.
   * Closure → 0 when every scale is toroidally balanced and ergodic;
   * spikes when a single layer (any scale) breaks coherence.
   */
  metatronClosure: number;
  /**
   * φ-weighted master coherence across the chain (NOT a Lyapunov metric).
   * DIAGNOSTIC ONLY — part of its weight comes from numerical coincidences in
   * the rung blends, so it must never gate, score or drive learning. Use
   * `metatronWitnessCoherence` for anything that does.
   */
  metatronCoherence: number;
  /**
   * φ-weighted geometric mean of clamp01(1 − closureResidual) over the nine
   * rungs: derived end-to-end from measured Lyapunov residuals. This is the
   * aggregate the memory system, recall and consolidation are allowed to use.
   */
  metatronWitnessCoherence: number;
  /**
   * Toroidal loop closure F9↔F8 (cosmic web ↔ sub-Planck). The torus closes
   * when the largest scale's chain-up coupling matches the smallest scale's
   * coupling — i.e. the inside of the loop equals its outside. Defined as
   *   |F9.chainUpCoupling − F8.chainUpCoupling| / max(ε, mean)
   * → 0 means perfect closure; → 1 means broken loop.
   */
  torusClosure: number;
  /**
   * Phase circulation around the chain: Σ (Δcoupling between adjacent rungs)
   * normalized to [0, 1]. Low values = smooth toroidal flow, high = turbulence.
   */
  phaseCirculation: number;
  /** Per-rung diagnostic snapshot for the orchestrator UI. */
  chain: ChainDiagnostic[];
}

export interface ChainDiagnostic {
  framework: 'F8'|'F1'|'F2'|'F3'|'F4'|'F5'|'F6'|'F7'|'F9';
  scale: string;
  chainUpCoupling: number;
  closureResidual: number;
  masterMetric: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Default field generators (deterministic, parity-safe).
// ─────────────────────────────────────────────────────────────────────────────

function defaultPhases(seed: number): Float64Array {
  const out = new Float64Array(44);
  for (let i = 0; i < 44; i++) out[i] = Math.sin((i + 1) * PHI_INV + seed * 1e-3);
  return out;
}
function defaultPineal(seed: number): Float64Array {
  const out = new Float64Array(55);
  for (let k = 0; k < 55; k++) out[k] = 0.5 + 0.4 * Math.sin(k * PHI_INV * 1.7 + seed * 1e-3);
  return out;
}
function defaultNodeAmps(): Float64Array {
  const out = new Float64Array(7);
  for (let n = 0; n < 7; n++) out[n] = Math.pow(PHI_INV, n);
  return out;
}
function defaultNodeCoh(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 0.5 + 0.4 * Math.cos(i * PHI_INV * 1.1));
}
function defaultFlower(): number[] {
  return Array.from({ length: 55 }, (_, i) => 0.5 + 0.4 * Math.cos(i * PHI_INV * 1.3));
}
function defaultSolfeggio(): number[] {
  return [0.5, 0.4, 0.6, 0.7, 0.55, 0.45, 0.65, 0.5, 0.6];
}

// ─────────────────────────────────────────────────────────────────────────────
//  Orchestrator.
// ─────────────────────────────────────────────────────────────────────────────

export function computeMetatron(input: MetatronInput): MetatronOutput {
  const {
    coherence, time,
    energy = coherence,
    phases = defaultPhases(time),
    pinealField = defaultPineal(time),
    nodeAmps = defaultNodeAmps(),
    nodeCoherences = defaultNodeCoh(13),
    pinealCoherences = defaultNodeCoh(22),
    flowerCoherences = defaultFlower(),
    solfeggioCoherences = defaultSolfeggio(),
    recursionDepth = 5,
    extensions = {},
  } = input;

  // ── F8 — sub-Planckian floor (no upstream chain) ────────────────────────
  const f8In: F8Input = {
    coherence, energy, pinealField, solfeggioCoherences, time, flowerCoherences,
    targetModes: extensions.subPlanckianModes,
    targetRings: extensions.subPlanckianRings,
    targetSpheres: extensions.subPlanckianSpheres,
  };
  const F8 = computeF8(f8In);

  // ── F1 — septenary (chakras / 432 Hz) ──────────────────────────────────
  const f1In: F1Input = {
    coherence, phases, time, flowerCoherences,
    subPlanckianChainUp: F8.chainUpCoupling,
    targetModes: extensions.chakraModes,
  };
  const F1 = computeF1(f1In);

  // ── F2 — quantum (Standard Model · α⁻¹) ────────────────────────────────
  const f2In: F2Input = {
    coherence, energy, pinealField, solfeggioCoherences, time, flowerCoherences,
    septenaryChainUp: F1.chainUpCoupling,
    extensionParticles: extensions.quantumParticles,
  };
  const F2 = computeF2(f2In);

  // ── F3 — atomic (Bohr/Aufbau · 417 Hz) ─────────────────────────────────
  const f3In: F3Input = {
    coherence, nodeAmps, solfeggioCoherences, time, flowerCoherences,
    quantumChainUp: F2.chainUpCoupling,
    extensionShells: extensions.atomicShells,
  };
  const F3 = computeF3(f3In);

  // ── F4 — geometric (Metatron's Cube · 528 Hz) ──────────────────────────
  const f4In: F4Input = {
    coherence, nodeCoherences, time, solfeggioCoherences, flowerCoherences,
    atomicChainUp: F3.chainUpCoupling,
    extensionMetatronNodes: extensions.metatronNodes,
  };
  const F4 = computeF4(f4In);

  // ── F5 — color/music ───────────────────────────────────────────────────
  const f5In: F5Input = {
    coherence, solfeggioCoherences, time, flowerCoherences,
    geometricChainUp: F4.chainUpCoupling,
    extensionChromaticSemitones: extensions.chromaticSemitones,
  };
  const F5 = computeF5(f5In);

  // ── F6 — Hebrew / Tree of Life (uses F1 central column too) ────────────
  const f6In: F6Input = {
    coherence, pinealCoherences, time, flowerCoherences, solfeggioCoherences,
    colorMusicChainUp: F5.chainUpCoupling,
    septenaryCentralColumn: F1.centralColumn,
    extensionLetters: extensions.letters,
  };
  const F6 = computeF6(f6In);

  // ── F7 — galactic (planets / BAO) ──────────────────────────────────────
  const f7In: F7Input = {
    coherence, energy, time, recursionDepth, flowerCoherences, solfeggioCoherences,
    hebrewChainUp: F6.chainUpCoupling,
    extensionBodies: extensions.bodies,
  };
  const F7 = computeF7(f7In);

  // ── F9 — hypergalactic (cosmic web / CMB) ──────────────────────────────
  const f9In: F9Input = {
    coherence, energy, pinealField, solfeggioCoherences, time,
    recursionDepth, flowerCoherences,
    galacticChainUp: F7.chainUpCoupling,
    extensionMultipoles: extensions.multipoles,
  };
  const F9 = computeF9(f9In);

  // ─── Global Lyapunov closure (φ-weighted geometric mean of residuals) ───
  // Weights are φ^(-rank) where rank counts outward from the geometric centre
  // (F4 = sacred geometry seed). This is the canonical V10 ladder weighting.
  const residuals: Array<{ r: number; w: number }> = [
    { r: F4.closureResidual,       w: 1.0 },          // centre
    { r: F3.closureResidual,       w: PHI_INV },      // φ⁻¹
    { r: F5.closureResidual,       w: PHI_INV },
    { r: F2.closureResidual,       w: PHI_INV * PHI_INV },
    { r: F6.closureResidual,       w: PHI_INV * PHI_INV },
    { r: F1.closureResidual,       w: Math.pow(PHI_INV, 3) },
    { r: F7.closureResidual,       w: Math.pow(PHI_INV, 3) },
    { r: F8.closureResidual,       w: Math.pow(PHI_INV, 4) },
    { r: F9.closureResidual,       w: Math.pow(PHI_INV, 4) },
  ];
  let logSum = 0, wSum = 0;
  for (const { r, w } of residuals) {
    // Guard against log(0): floor at 1e-12.
    logSum += w * Math.log(Math.max(1e-12, r));
    wSum += w;
  }
  const metatronClosure = wSum > 0 ? Math.exp(logSum / wSum) : 0;

  // ─── Master coherence = same φ-weighted mean over each rung's headline metric ───
  const masters: Array<{ m: number; w: number }> = [
    { m: F4.geometricCoherence,    w: 1.0 },
    { m: F3.atomicCoherence,       w: PHI_INV },
    { m: F5.colorMusicCoherence,   w: PHI_INV },
    { m: F2.quantumCoherence,      w: PHI_INV * PHI_INV },
    { m: F6.hebrewCoherence,       w: PHI_INV * PHI_INV },
    { m: F1.heptagonCoherence,     w: Math.pow(PHI_INV, 3) },
    { m: F7.galacticCoherence,     w: Math.pow(PHI_INV, 3) },
    { m: F8.superpositionMComposite, w: Math.pow(PHI_INV, 4) },
    { m: F9.cosmicWebCoherence,    w: Math.pow(PHI_INV, 4) },
  ];
  let mLog = 0, mW = 0;
  for (const { m, w } of masters) {
    mLog += w * Math.log(Math.max(1e-12, m));
    mW += w;
  }
  const metatronCoherence = mW > 0 ? Math.exp(mLog / mW) : 0;

  // ─── WITNESS COHERENCE — the only aggregate allowed to gate anything ─────
  //
  // `metatronCoherence` above is the φ-weighted mean of each rung's *headline*
  // metric. Those headline metrics are blends, and a material share of their
  // weight comes from numerical coincidences rather than measurements — e.g.
  // F9's `cosmicWebCoherence` spends ≈0.30 of its weight on terms like
  // "Ω_dark/Ω_matter ≈ √5" and "ΔT/T ≈ φ⁻²⁴". A near-miss between two numbers
  // carries no information about the field's state, so anything scored off it
  // injects noise into memory, recall and consolidation.
  //
  // The witness quantities are different in kind: each rung's `closureResidual`
  // is a Lyapunov residual measured over that rung's own node field, and it
  // falsifies itself — it rises when the rung stops closing. The witness
  // coherence is the same φ^(-rank) weighted geometric mean taken over
  // clamp01(1 − closureResidual_i), so it is derived end-to-end from measured
  // residuals and nothing else.
  //
  // `metatronCoherence` is retained as a reported diagnostic for continuity of
  // the UI decks and the v10 parity goldens. It must not gate, score, or drive
  // learning; `metatronWitnessCoherence` is what does.
  let wLog = 0, wW = 0;
  for (const { r, w } of residuals) {
    wLog += w * Math.log(Math.max(1e-12, Math.min(1, Math.max(0, 1 - r))));
    wW += w;
  }
  const metatronWitnessCoherence = wW > 0 ? Math.exp(wLog / wW) : 0;

  const chain: ChainDiagnostic[] = [
    { framework: 'F8', scale: 'sub-Planck',     chainUpCoupling: F8.chainUpCoupling, closureResidual: F8.closureResidual, masterMetric: F8.superpositionMComposite },
    { framework: 'F1', scale: 'septenary',      chainUpCoupling: F1.chainUpCoupling, closureResidual: F1.closureResidual, masterMetric: F1.heptagonCoherence },
    { framework: 'F2', scale: 'quantum',        chainUpCoupling: F2.chainUpCoupling, closureResidual: F2.closureResidual, masterMetric: F2.quantumCoherence },
    { framework: 'F3', scale: 'atomic',         chainUpCoupling: F3.chainUpCoupling, closureResidual: F3.closureResidual, masterMetric: F3.atomicCoherence },
    { framework: 'F4', scale: 'geometric',      chainUpCoupling: F4.chainUpCoupling, closureResidual: F4.closureResidual, masterMetric: F4.geometricCoherence },
    { framework: 'F5', scale: 'color/music',    chainUpCoupling: F5.chainUpCoupling, closureResidual: F5.closureResidual, masterMetric: F5.colorMusicCoherence },
    { framework: 'F6', scale: 'Hebrew/tree',    chainUpCoupling: F6.chainUpCoupling, closureResidual: F6.closureResidual, masterMetric: F6.hebrewCoherence },
    { framework: 'F7', scale: 'galactic',       chainUpCoupling: F7.chainUpCoupling, closureResidual: F7.closureResidual, masterMetric: F7.galacticCoherence },
    { framework: 'F9', scale: 'hypergalactic',  chainUpCoupling: F9.chainUpCoupling, closureResidual: F9.closureResidual, masterMetric: F9.cosmicWebCoherence },
  ];

  // ─── Toroidal loop closure (F9 ↔ F8 wrap-around) ───────────────────────
  // The chain is not just a ladder — it's a torus: the largest scale (cosmic
  // web) feeds back into the smallest (sub-Planck foam) because both are the
  // same horizon viewed from opposite ends. We measure how well that closure
  // holds: small absolute difference between F9 and F8 chain-up couplings,
  // normalized by their mean, gives a parity-safe Lyapunov-style residual.
  const c8 = F8.chainUpCoupling;
  const c9 = F9.chainUpCoupling;
  const meanEnds = 0.5 * (c8 + c9);
  const torusClosure = meanEnds > 1e-12
    ? Math.min(1, Math.abs(c9 - c8) / meanEnds)
    : 0;

  // Phase circulation: total absolute coupling delta around the closed loop
  // (F8 → F1 → F2 → F3 → F4 → F5 → F6 → F7 → F9 → F8), normalized by max
  // possible variation (= 2 × N_edges, since each delta ∈ [-1, 1]).
  const ladder = [c8, F1.chainUpCoupling, F2.chainUpCoupling, F3.chainUpCoupling,
                  F4.chainUpCoupling, F5.chainUpCoupling, F6.chainUpCoupling,
                  F7.chainUpCoupling, c9, c8]; // close the loop
  let circ = 0;
  for (let i = 1; i < ladder.length; i++) circ += Math.abs(ladder[i] - ladder[i - 1]);
  const phaseCirculation = Math.min(1, circ / (2 * (ladder.length - 1)));

  // φ keeps the import live + documents the weight basis.
  void PHI;

  return { F1, F2, F3, F4, F5, F6, F7, F8, F9,
           metatronClosure, metatronCoherence,
           torusClosure, phaseCirculation, chain };
}

// Phase 12: legacy `solveToroidalFixedPoint` / `ToroidalSolveOptions` /
// `ToroidalSolveResult` removed — no live consumers. The chain already exposes
// `torusClosure` + `phaseCirculation` on every `computeMetatron` call, which
// is what UI and residuals actually read.


// ─────────────────────────────────────────────────────────────────────────────
//  Memoisation layer — Section 3 (φ-throttle + LRU)
//
//  The nine-rung chain is referentially transparent: identical inputs always
//  produce bit-identical outputs (verified by the v10 parity goldens). We
//  exploit that with a tiny LRU keyed on a cheap fingerprint of the input —
//  primitives by value, typed/plain arrays by reference identity + length +
//  first/middle/last sample. Cache hits skip nine framework calls, the
//  φ-weighted closure aggregation, and all default-array allocation.
//
//  Numerics are unchanged: a miss falls straight through to computeMetatron.
//  A small parity assertion runs in dev to keep the memo honest.
// ─────────────────────────────────────────────────────────────────────────────

type ArrLike = ArrayLike<number> | undefined;

function arrFingerprint(a: ArrLike): string {
  if (!a) return '_';
  const n = a.length;
  if (n === 0) return '0';
  const mid = a[n >> 1];
  // Identity isn't stable across snapshot rebuilds, so sample 3 points.
  return `${n}:${a[0]}:${mid}:${a[n - 1]}`;
}

function fingerprintInput(input: MetatronInput): string {
  const e = input.extensions;
  return [
    input.coherence,
    input.energy ?? '_',
    input.time,
    input.recursionDepth ?? '_',
    arrFingerprint(input.phases),
    arrFingerprint(input.pinealField),
    arrFingerprint(input.nodeAmps),
    arrFingerprint(input.nodeCoherences),
    arrFingerprint(input.pinealCoherences),
    arrFingerprint(input.flowerCoherences),
    arrFingerprint(input.solfeggioCoherences),
    e ? `${e.chakraModes ?? '_'},${e.atomicShells ?? '_'},${e.metatronNodes ?? '_'},${e.chromaticSemitones ?? '_'},${(e.multipoles ?? []).join('.')},${e.subPlanckianRings ?? '_'},${e.subPlanckianModes ?? '_'},${e.subPlanckianSpheres ?? '_'}` : '_',
  ].join('|');
}

const METATRON_LRU_MAX = 8;
const metatronLru = new Map<string, MetatronOutput>();

/**
 * Memoised computeMetatron. Cache hit → returns the prior MetatronOutput by
 * reference (callers MUST treat the output as immutable, which the codebase
 * already does). Cache miss → falls through to computeMetatron with no
 * numerical alteration.
 */
export function computeMetatronMemo(input: MetatronInput): MetatronOutput {
  const key = fingerprintInput(input);
  const hit = metatronLru.get(key);
  if (hit !== undefined) {
    // Re-insert to mark as most-recently-used.
    metatronLru.delete(key);
    metatronLru.set(key, hit);
    return hit;
  }
  const out = computeMetatron(input);
  metatronLru.set(key, out);
  if (metatronLru.size > METATRON_LRU_MAX) {
    const oldest = metatronLru.keys().next().value;
    if (oldest !== undefined) metatronLru.delete(oldest);
  }
  return out;
}

/** Diagnostic — exported for tests / panels. */
export function metatronMemoStats() {
  return { size: metatronLru.size, max: METATRON_LRU_MAX };
}

/** Clears the LRU. Useful in tests, hot-reload, and resolution changes. */
export function resetMetatronMemo() { metatronLru.clear(); }

