/**
 * vsa — Ω-REAL P5: Fourier Holographic Reduced Representation over the phase
 * torus, plus an abstention-aware cleanup memory.
 *
 * WHY FHRR AND NOT BINARY VSA
 * ---------------------------
 * The machine's state is already a complex field: every mode carries a phase.
 * A binary/bipolar VSA would throw that phase away and force a quantisation
 * step on every bind. FHRR represents a hypervector as D UNIT PHASORS, so:
 *
 *   bind    = phase addition          (exactly invertible, no noise added)
 *   unbind  = phase subtraction       (bind with the conjugate)
 *   bundle  = complex sum, renormalised (superposition; magnitude = agreement)
 *   permute = cyclic index shift      (exactly invertible, protects sequence)
 *   sim     = mean cos(Δφ) ∈ [-1,1]
 *
 * bind distributes over bundle and is self-inverse under conjugation, which is
 * what makes role/filler algebra work: unbind(bind(r,f), r) = f exactly.
 *
 * ABSTENTION
 * ----------
 * For two independent random hypervectors, similarity has mean 0 and variance
 * 1/(2D). A cleanup query therefore only SPEAKS when the best match clears
 * `zFloor` sigmas of that chance distribution AND beats the runner-up by the
 * same margin. Otherwise it abstains (`null`) — a cleanup memory that always
 * returns its nearest prototype is a random-answer generator.
 *
 * FAN-IN CEILING
 * --------------
 * Bundling capacity is finite: superposing m random vectors leaves the
 * component at similarity ≈ 1/√m above a 1/√(2D) noise floor. Past a ceiling
 * the prototype is a blur, so `CLEANUP_FAN_IN = 100` caps how many exemplars
 * fold into one prototype; beyond it the oldest weight decays by φ⁻¹ rather
 * than the prototype silently dissolving.
 *
 * All transcendentals route through the deterministic bank.
 */

import { dacos, datan2, dcos, dsin } from '../core/dmath';
import { SeedStream } from '../core/determinism';
import { PHI_INV } from '../core/constants';

const TWO_PI = 6.283185307179586;
const PI = 3.141592653589793;

/** Measured bundling ceiling per prototype (report finding: fan-in 100). */
export const CLEANUP_FAN_IN = 100;

/** Default abstention strictness, in sigmas of the chance distribution. */
export const CLEANUP_Z_FLOOR = 5;

/** A hypervector: D phases, each in [-π, π). */
export type Hypervector = Float64Array;

/** Wrap a phase into [-π, π) — branch-exact, no fmod drift. */
export function wrapPhase(p: number): number {
  if (!Number.isFinite(p)) return NaN;
  let x = p;
  if (x >= PI || x < -PI) {
    const k = Math.floor((x + PI) / TWO_PI);
    x -= k * TWO_PI;
    // guard the boundary against a single-ulp overshoot
    if (x >= PI) x -= TWO_PI;
    if (x < -PI) x += TWO_PI;
  }
  return x;
}

/** Deterministic random hypervector: phases uniform on the circle. */
export function randomHv(dim: number, seed: string): Hypervector {
  const rng = new SeedStream(seed);
  const v = new Float64Array(dim);
  for (let i = 0; i < dim; i++) v[i] = wrapPhase(rng.signed() * PI);
  return v;
}

/** The identity element of bind: all-zero phase. */
export function identityHv(dim: number): Hypervector {
  return new Float64Array(dim);
}

/** Conjugate (bind inverse). */
export function conjugateHv(a: Hypervector): Hypervector {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = wrapPhase(-a[i]);
  return out;
}

/** bind(a,b) — phase addition. Commutative, associative, exactly invertible. */
export function bind(a: Hypervector, b: Hypervector): Hypervector {
  const n = Math.min(a.length, b.length);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = wrapPhase(a[i] + b[i]);
  return out;
}

/** unbind(c,a) = bind(c, conj(a)) — recovers b from bind(a,b). */
export function unbind(c: Hypervector, a: Hypervector): Hypervector {
  const n = Math.min(a.length, c.length);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = wrapPhase(c[i] - a[i]);
  return out;
}

/** Cyclic permutation by k (negative k rotates the other way). Invertible. */
export function permute(a: Hypervector, k = 1): Hypervector {
  const n = a.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  const s = ((k % n) + n) % n;
  for (let i = 0; i < n; i++) out[(i + s) % n] = a[i];
  return out;
}

export interface BundleResult {
  /** Superposed hypervector (unit phasors). */
  readonly hv: Hypervector;
  /**
   * Per-component resultant magnitude ∈ [0,1] — how much the inputs AGREED on
   * that component. Near 0 means the phase there is arbitrary; callers can use
   * it to abstain on individual components instead of trusting a blur.
   */
  readonly agreement: Float64Array;
  /** Mean agreement — one number for "how coherent is this superposition". */
  readonly meanAgreement: number;
}

/**
 * Bundle (superpose) with optional weights.
 *
 * Feature-level φ weighting is the intended use: pass `phiWeights(m)` so the
 * most recent / most salient exemplar carries weight 1, the next φ⁻¹, and so
 * on. Per-BIT φ weighting was measured to be a no-op (a monotone rescale of
 * every component alike) and is deliberately not offered.
 */
export function bundle(vs: readonly Hypervector[], weights?: readonly number[]): BundleResult {
  const m = vs.length;
  if (m === 0) return { hv: new Float64Array(0), agreement: new Float64Array(0), meanAgreement: NaN };
  const dim = vs[0].length;
  const re = new Float64Array(dim);
  const im = new Float64Array(dim);
  let wsum = 0;
  for (let j = 0; j < m; j++) {
    const w = weights ? weights[j] : 1;
    if (!Number.isFinite(w) || w <= 0) continue;
    wsum += w;
    const v = vs[j];
    for (let i = 0; i < dim; i++) {
      const p = v[i];
      if (!Number.isFinite(p)) continue;
      re[i] += w * dcos(p);
      im[i] += w * dsin(p);
    }
  }
  const hv = new Float64Array(dim);
  const agreement = new Float64Array(dim);
  let agSum = 0;
  for (let i = 0; i < dim; i++) {
    const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    hv[i] = mag <= 1e-300 ? 0 : wrapPhase(datan2(im[i], re[i]));
    const a = wsum > 0 ? Math.min(1, mag / wsum) : NaN;
    agreement[i] = a;
    agSum += Number.isFinite(a) ? a : 0;
  }
  return { hv, agreement, meanAgreement: dim > 0 ? agSum / dim : NaN };
}

/** φ-decaying weights: [1, φ⁻¹, φ⁻², …] — one φ-octave of salience per step. */
export function phiWeights(m: number): number[] {
  const w: number[] = [];
  let x = 1;
  for (let i = 0; i < m; i++) { w.push(x); x *= PHI_INV; }
  return w;
}

/** Similarity = mean cos(Δφ) ∈ [-1,1]. Length mismatch abstains. */
export function similarity(a: Hypervector, b: Hypervector): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return NaN;
  let s = 0, m = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    if (!Number.isFinite(d)) continue;
    s += dcos(d); m++;
  }
  return m === 0 ? NaN : s / m;
}

/** Chance sigma of the similarity statistic for dimension D: 1/√(2D). */
export function chanceSigma(dim: number): number {
  return dim > 0 ? 1 / Math.sqrt(2 * dim) : NaN;
}

/** Angular distance in radians between two hypervectors (0 = identical). */
export function angularDistance(a: Hypervector, b: Hypervector): number {
  const s = similarity(a, b);
  return Number.isFinite(s) ? dacos(Math.max(-1, Math.min(1, s))) : NaN;
}

/* ── cleanup memory ───────────────────────────────────────────────────────── */

export interface CleanupHit {
  readonly label: string;
  readonly similarity: number;
  /** Gap to the runner-up; Infinity when this is the only prototype. */
  readonly margin: number;
  /** similarity / chanceSigma — how many sigmas above chance. */
  readonly z: number;
  /** Exemplars folded into the winning prototype. */
  readonly fanIn: number;
}

export interface CleanupStats {
  readonly label: string;
  readonly fanIn: number;
  readonly meanAgreement: number;
  readonly saturated: boolean;
}

/**
 * Prototype store with abstention. Prototypes accumulate as a weighted phasor
 * sum, so `add` is O(D) and never re-scans exemplars.
 */
export class CleanupMemory {
  private readonly re = new Map<string, Float64Array>();
  private readonly im = new Map<string, Float64Array>();
  private readonly n = new Map<string, number>();

  constructor(
    readonly dim: number,
    readonly fanInCap: number = CLEANUP_FAN_IN,
    readonly zFloor: number = CLEANUP_Z_FLOOR,
  ) {}

  get size(): number { return this.n.size; }
  labels(): string[] { return [...this.n.keys()].sort(); }

  /**
   * Fold an exemplar into a prototype.
   *
   * At the fan-in ceiling the existing sum is scaled by φ⁻¹ before the new
   * exemplar lands: the prototype keeps tracking rather than freezing, and the
   * effective window stays bounded instead of the mean going to mush.
   */
  add(label: string, v: Hypervector, weight = 1): void {
    if (!Number.isFinite(weight) || weight <= 0) return;
    let re = this.re.get(label);
    let im = this.im.get(label);
    if (!re || !im) {
      re = new Float64Array(this.dim);
      im = new Float64Array(this.dim);
      this.re.set(label, re); this.im.set(label, im); this.n.set(label, 0);
    }
    let count = this.n.get(label) ?? 0;
    if (count >= this.fanInCap) {
      for (let i = 0; i < this.dim; i++) { re[i] *= PHI_INV; im[i] *= PHI_INV; }
      count = this.fanInCap - 1;
    }
    const lim = Math.min(this.dim, v.length);
    for (let i = 0; i < lim; i++) {
      const p = v[i];
      if (!Number.isFinite(p)) continue;
      re[i] += weight * dcos(p);
      im[i] += weight * dsin(p);
    }
    this.n.set(label, count + 1);
  }

  /** Current prototype hypervector, or null when the label is unknown. */
  prototype(label: string): Hypervector | null {
    const re = this.re.get(label); const im = this.im.get(label);
    if (!re || !im) return null;
    const out = new Float64Array(this.dim);
    for (let i = 0; i < this.dim; i++) {
      out[i] = (re[i] * re[i] + im[i] * im[i]) <= 1e-300 ? 0 : wrapPhase(datan2(im[i], re[i]));
    }
    return out;
  }

  stats(label: string): CleanupStats | null {
    const re = this.re.get(label); const im = this.im.get(label);
    const n = this.n.get(label);
    if (!re || !im || n === undefined) return null;
    let agree = 0;
    for (let i = 0; i < this.dim; i++) agree += Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    const mean = this.dim > 0 && n > 0 ? Math.min(1, agree / (this.dim * n)) : NaN;
    return { label, fanIn: n, meanAgreement: mean, saturated: n >= this.fanInCap };
  }

  /**
   * Nearest prototype, or null when the evidence does not clear chance.
   *
   * Two independent gates, both required:
   *   z      = sim / (1/√(2D))  ≥ zFloor   — the match is not a coincidence
   *   margin = sim − runnerUp   ≥ zFloor·σ — the match is not a coin flip
   */
  query(v: Hypervector, zFloor = this.zFloor): CleanupHit | null {
    if (this.n.size === 0) return null;
    const sigma = chanceSigma(this.dim);
    let bestLabel = ''; let best = Number.NEGATIVE_INFINITY; let second = Number.NEGATIVE_INFINITY;
    for (const label of this.labels()) {
      const proto = this.prototype(label);
      if (!proto) continue;
      const s = similarity(v, proto);
      if (!Number.isFinite(s)) continue;
      if (s > best) { second = best; best = s; bestLabel = label; }
      else if (s > second) { second = s; }
    }
    if (!Number.isFinite(best) || bestLabel === '') return null;
    const margin = Number.isFinite(second) ? best - second : Number.POSITIVE_INFINITY;
    const z = best / sigma;
    if (z < zFloor) return null;
    if (margin < zFloor * sigma) return null;
    return { label: bestLabel, similarity: best, margin, z, fanIn: this.n.get(bestLabel) ?? 0 };
  }
}

/* ── structured records ───────────────────────────────────────────────────── */

/**
 * Encode a role→filler record: bundle over bind(role, filler).
 * Decoding a role is unbind followed by cleanup — the cleanup memory is what
 * turns the noisy unbind result back into a symbol, or abstains.
 */
export function encodeRecord(pairs: readonly (readonly [Hypervector, Hypervector])[]): BundleResult {
  return bundle(pairs.map(([r, f]) => bind(r, f)));
}

/** Extract the (noisy) filler bound to a role from a record. */
export function decodeRole(record: Hypervector, role: Hypervector): Hypervector {
  return unbind(record, role);
}

/**
 * Encode an ordered sequence with permutation protection:
 * bundle( π⁰(v₀), π¹(v₁), … ) — position is recoverable, order is not lost to
 * the commutativity of bundling.
 */
export function encodeSequence(vs: readonly Hypervector[], weights?: readonly number[]): BundleResult {
  return bundle(vs.map((v, i) => permute(v, i)), weights);
}

/** Recover the item at position i from a permutation-protected sequence. */
export function decodePosition(seq: Hypervector, i: number): Hypervector {
  return permute(seq, -i);
}
