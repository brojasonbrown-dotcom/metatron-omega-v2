/**
 * lexeme — word/sentence → exact integer → toroidal field perturbation.
 *
 * This is the transcription layer: it puts language *into the field* the
 * engine already runs on, so a word is bound, rehearsed and recalled by the
 * same machinery as a sound or an image. It makes no claim about meaning.
 *
 * Two strictly separated jobs:
 *
 *   1. ADDRESS (exact, reversible).  A letter→digit map that is injective, so
 *      the integer image of a word is a *code*, not a sum. Positional base-27
 *      over [a-z] (0 = absent):
 *
 *          v(w) = Σ_{i<L} c(w_i) · 27^i,     c('a')=1 … c('z')=26
 *
 *      Injective for L ≤ 11 because 27^11 = 5559060566555523 < 2^53 =
 *      9007199254740992, so every such word has a distinct exact float64
 *      integer. Words longer than LEXEME_EXACT_LEN are truncated at 11 and
 *      carry a length tag, which is a documented, bounded collision channel —
 *      never silently exact. `lexemeAddress` renders v in Zeckendorf form, so
 *      the address is the canonical non-consecutive-Fibonacci slot key.
 *
 *   2. RESIDUE (bucketing only).  v mod 22 is a 22-symbol channel carrying
 *      log₂22 = 4.459431618637297 bits per word — enough to bucket candidates,
 *      never enough to assert a meaning. Nothing scores similarity from it.
 *
 * FIELD PLACEMENT.  A token is written onto the same (R=φ, r=1) torus that
 * `projectPsiToroidal` builds, using two independent coordinates:
 *
 *   • major circle (discrete, exact):   n = maxZeckIndex(v) mod rungs
 *   • minor circle (continuous):        ϕ = 2π · frac(v · φ⁻¹)
 *
 * The first is integer-structural and reversible; the second is an irrational
 * rotation, so by the three-distance theorem the phases of any token
 * inventory have gap ratio max/min = φ² = 2.618033988749895 — the minimum
 * achievable discrepancy for a one-parameter rotation. The two channels are
 * independent: one is a Zeckendorf class, the other an equidistributed phase.
 *
 * The four global tail slots (torusClosure, coherence, circulation,
 * phaseCirculation) are engine-owned invariants and are NEVER written here —
 * text may perturb the field, it may not fabricate its stability metrics.
 */

import { PHI, PHI_INV } from './zphi';
import { zeckendorf, zeckAddress } from './zeckendorf';

/** Letters of the positional code. */
export const LEXEME_RADIX = 27;
/** Longest word the base-27 code represents injectively inside 2^53. */
export const LEXEME_EXACT_LEN = 11;
/** Symbols in the residue channel. */
export const LEXEME_RESIDUE_SYMBOLS = 22;
/** Information carried by one residue symbol: log₂22, Wolfram-verified. */
export const LEXEME_RESIDUE_BITS = 4.459431618637297;
/** Injection gain φ⁻³ — matches the Hebbian learning rate, keeps ‖ΔΨ‖ in envelope. */
export const LEXEME_GAIN = PHI_INV * PHI_INV * PHI_INV;
/** Per-rung component count of the toroidal Ψ embedding. */
const RUNG_STRIDE = 4;
/** Global invariant slots at the tail of Ψ — never written by text. */
const TAIL = 4;

export interface Lexeme {
  /** Normalised token (lowercase, letters only). */
  readonly token: string;
  /** Exact base-27 integer code of the (possibly truncated) token. */
  readonly value: number;
  /** True when the token fit inside the injective length bound. */
  readonly exact: boolean;
  /** Zeckendorf address of `value`. */
  readonly address: string;
  /** Zeckendorf indices of `value`, descending, non-consecutive. */
  readonly zeck: readonly number[];
  /** 22-symbol bucket channel. */
  readonly residue: number;
}

/** Letter → digit. Non-letters yield 0 and are dropped by the tokeniser. */
function digit(ch: string): number {
  const c = ch.charCodeAt(0);
  if (c >= 97 && c <= 122) return c - 96; // a..z → 1..26
  if (c >= 65 && c <= 90) return c - 64; // A..Z → 1..26
  return 0;
}

/**
 * Exact integer code of a single token. Positional, so an anagram does NOT
 * collide with its source word — the failure mode of every additive gematria.
 */
export function lexemeValue(token: string): number {
  let v = 0;
  let p = 1;
  const n = Math.min(token.length, LEXEME_EXACT_LEN);
  for (let i = 0; i < n; i++) {
    v += digit(token[i]) * p;
    p *= LEXEME_RADIX;
  }
  if (token.length > LEXEME_EXACT_LEN) {
    // Bounded, declared collision channel: fold the excess length only, so
    // the value stays < 2^53 and the truncation is visible via `exact`.
    v += (token.length % LEXEME_RADIX) * p;
  }
  return v;
}

/** Full lexeme record for one token. */
export function lexeme(token: string): Lexeme {
  const t = token.toLowerCase().replace(/[^a-z]/g, '');
  const value = lexemeValue(t);
  const zeck = value > 0 ? zeckendorf(value) : [];
  return {
    token: t,
    value,
    exact: t.length > 0 && t.length <= LEXEME_EXACT_LEN,
    address: zeckAddress(value),
    zeck,
    residue: value % LEXEME_RESIDUE_SYMBOLS,
  };
}

/** Deterministic tokeniser: lowercase letter runs, order preserved. */
export function lexemeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 0);
}

/** Zeckendorf address of a whole utterance (order-sensitive, reversible per token). */
export function lexemeAddress(text: string): string {
  const parts = lexemeTokens(text).map((t) => lexeme(t).address.slice(2));
  return parts.length === 0 ? 'z:0' : 'z:' + parts.join('|');
}

/** Where a lexeme lands on the (R=φ, r=1) torus with `rungs` major positions. */
export interface LexemeTorus {
  /** Largest Zeckendorf index of the code (the discrete class). */
  readonly top: number;
  /** Major-circle rung = top mod rungs. */
  readonly rung: number;
  /** Major angle θ = 2π·rung/rungs, radians. */
  readonly theta: number;
  /** Minor angle ϕ = 2π·frac(v·φ⁻¹), radians. */
  readonly minor: number;
}

export function lexemeTorus(lx: Lexeme, rungs: number): LexemeTorus {
  const top = lx.zeck.length > 0 ? lx.zeck[0] : 2;
  const r = Math.max(1, Math.floor(rungs));
  const rung = top % r;
  return {
    top,
    rung,
    theta: (2 * Math.PI * rung) / r,
    minor: 2 * Math.PI * ((lx.value * PHI_INV) % 1),
  };
}

export interface TextInjection {
  /** Tokens actually written into Ψ. */
  tokens: number;
  /** Tokens that exceeded the injective length bound. */
  inexact: number;
  /** ‖ΔΨ‖₂ actually added. */
  norm: number;
  /** Zeckendorf address of the utterance — the recall key. */
  address: string;
}

/**
 * Write an utterance into a toroidal Ψ in place, additively.
 *
 * Amplitude decays as φ⁻ʳ with token rank r (leading words carry the frame),
 * the sum is normalised by 1/√k so utterance length cannot inflate injected
 * energy, and the whole perturbation is scaled by LEXEME_GAIN = φ⁻³. Returns
 * provenance; mutates only the per-rung slots of `psi`.
 */
export function injectTextPsi(psi: Float64Array, text: string): TextInjection {
  const empty: TextInjection = { tokens: 0, inexact: 0, norm: 0, address: 'z:0' };
  const rungs = Math.floor((psi.length - TAIL) / RUNG_STRIDE);
  if (rungs <= 0) return empty;
  const tokens = lexemeTokens(text);
  if (tokens.length === 0) return empty;

  const delta = new Float64Array(rungs * RUNG_STRIDE);
  let inexact = 0;
  for (let r = 0; r < tokens.length; r++) {
    const lx = lexeme(tokens[r]);
    if (lx.value <= 0) continue;
    if (!lx.exact) inexact++;
    // Major circle: Zeckendorf class (discrete, reversible); minor circle:
    // golden-angle phase (equidistributed). One definition, shared with UI.
    const { rung: n, theta, minor } = lexemeTorus(lx, rungs);
    const ringR = PHI + Math.cos(minor);
    const amp = PHI_INV ** Math.min(r, 12);
    const base = RUNG_STRIDE * n;
    delta[base + 0] += ringR * Math.cos(theta) * amp;
    delta[base + 1] += ringR * Math.sin(theta) * amp;
    delta[base + 2] += Math.sin(minor) * amp;
    // Slot 3 is the rung's master metric — a text token contributes its
    // residue channel as a mean-centred value in [-1,1], nothing more.
    delta[base + 3] += (lx.residue / (LEXEME_RESIDUE_SYMBOLS - 1) - 0.5) * 2 * amp;
  }

  const scale = LEXEME_GAIN / Math.sqrt(tokens.length);
  let norm = 0;
  for (let i = 0; i < delta.length; i++) {
    const d = delta[i] * scale;
    psi[i] += d;
    norm += d * d;
  }
  return {
    tokens: tokens.length,
    inexact,
    norm: Math.sqrt(norm),
    address: lexemeAddress(text),
  };
}
