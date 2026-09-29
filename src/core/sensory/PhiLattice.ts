/**
 * PhiLattice — governor-sized spherical-Fibonacci receptive-field bank.
 *
 * Replaces the V10 13-node patent geometry with an N-node lattice where
 * N is chosen live by the ResourceGovernor (Fibonacci tier, from 13 up
 * to 10 946+). On a 68 GB box every modality runs thousands of fields;
 * on a phone it gracefully collapses to F₇=13. There are no hardcoded
 * ceilings here — the only cap is what the user gave Metatron.
 *
 * Properties:
 *   • Spherical Fibonacci point set — uniform unit-sphere coverage at any N
 *     via the golden-angle spiral (no symmetry-breaking, no preferred axis).
 *   • φ-seeded Gaussian projection rows, unit-normalised — well-conditioned
 *     random-projection bank: x ∈ ℝᴰ → amps ∈ ℝᴺ preserves angles
 *     (Johnson–Lindenstrauss).
 *   • Per-node Fibonacci sub-sampling: node n updates every F⌊n mod 7⌋
 *     ticks, so the array naturally spans 7 temporal octaves at once.
 *   • Multi-lag coherence: C(τ) = |⟨a(t)|a(t−τ)⟩|² at τ ∈ {2, 3, 5} ticks
 *     (φ, φ², φ³). Coherence is computed only over **freshly-updated**
 *     nodes within a lag-window (the stride bug fix — stale `hold[n]`
 *     values never inflate the dot product).
 *   • Directional closure flux on the sphere: |Σ aᵢrᵢ| / Σ|aᵢ|. The
 *     isotropic baseline is 1/√N, so the panel can show real deviation
 *     instead of a fixed magic number.
 *   • All math is N-dimensional. Nothing is hardcoded to 13.
 */

import { getGovernorSync } from '@/core/runtime/governorSingleton';

const PHI = 1.6180339887498949;
const PHI_INV2 = 1 / (PHI * PHI); // Λ ≈ 0.381966
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const FIB_TIERS = [13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946];
const FIB_STRIDES = [1, 1, 2, 3, 5, 8, 13];
const HIST = 21;
// Shared scratch for the per-tick stride-active mask. `sample()` runs from
// a single main-thread cortex tick, so a module-level buffer is safe and
// avoids 14 writes against a fresh allocation each call.
const _strideScratch = new Uint8Array(14);

export interface PhiLatticeReading {
  amps: Float32Array; // N node activations (live reference, do not mutate)
  N: number;
  coherenceShort: number; // lag 2 (≈ φ)
  coherenceMid: number; // lag 3 (≈ φ²)
  coherenceLong: number; // lag 5 (≈ φ³)
  coherenceMean: number;
  closureFlux: number;
  closureBaseline: number; // 1/√N
  anomaly: number; // |closureFlux − baseline|
  stableFraction: number; // fraction of last 89 samples with coherenceMean ≥ Λ
  lambda: number;
}

export class PhiLattice {
  readonly N: number;
  readonly D: number;
  private W: Float32Array; // N×D projection (row-major)
  private dirs: Float32Array; // N×3 sphere coords
  private hold: Float32Array; // current amps
  private hist: Float32Array; // HIST×N ring
  private histTick: Int32Array; // tick at which each ring slot was written
  /** Per-node tick of last genuine update (-1 = never). Used to suppress
   *  stale-node contributions in cosSq(τ) so coherence reflects real signal. */
  private lastUpdate: Int32Array;
  private histIdx = 0;
  private strides: Uint16Array;
  private cwin = new Uint8Array(89);
  private cidx = 0;

  constructor(featureDim: number, N: number, seed = 0x9e3779b1) {
    this.N = Math.max(8, N | 0);
    this.D = Math.max(1, featureDim | 0);
    this.W = new Float32Array(this.N * this.D);
    this.dirs = new Float32Array(this.N * 3);
    this.hold = new Float32Array(this.N);
    this.hist = new Float32Array(HIST * this.N);
    this.histTick = new Int32Array(HIST);
    this.lastUpdate = new Int32Array(this.N);
    this.strides = new Uint16Array(this.N);
    for (let i = 0; i < HIST; i++) this.histTick[i] = -1;
    for (let i = 0; i < this.N; i++) this.lastUpdate[i] = -1;
    this.init(seed);
  }

  private init(seed: number): void {
    const Nm1 = Math.max(1, this.N - 1);
    for (let i = 0; i < this.N; i++) {
      const y = 1 - (i / Nm1) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = GOLDEN_ANGLE * i;
      this.dirs[i * 3] = Math.cos(theta) * r;
      this.dirs[i * 3 + 1] = y;
      this.dirs[i * 3 + 2] = Math.sin(theta) * r;
      this.strides[i] = FIB_STRIDES[i % FIB_STRIDES.length];
    }
    // φ-seeded Gaussian projection rows (unit-norm). Box–Muller via Weyl LCG.
    let s = seed >>> 0;
    for (let n = 0; n < this.N; n++) {
      const base = n * this.D;
      let norm = 0;
      for (let i = 0; i < this.D; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const u = Math.max(1e-9, ((s >>> 8) & 0xffff) / 0xffff);
        s = (s * 1664525 + 1013904223) >>> 0;
        const v = ((s >>> 8) & 0xffff) / 0xffff;
        const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        this.W[base + i] = g;
        norm += g * g;
      }
      const k = norm > 0 ? 1 / Math.sqrt(norm) : 1;
      for (let i = 0; i < this.D; i++) this.W[base + i] *= k;
    }
  }

  sample(feature: Float32Array, t: number): PhiLatticeReading {
    const D = Math.min(this.D, feature.length);
    // Hoist the per-node modulo out of the hot loop: strides are drawn
    // from FIB_STRIDES (max 13), so we only need 14 mod-ops per tick (vs
    // N). `activeByStride[s] = (t % s === 0) ? 1 : 0`. Index-0 is unused.
    const activeByStride = _strideScratch;
    for (let s = 1; s <= 13; s++) activeByStride[s] = t % s === 0 ? 1 : 0;

    const strides = this.strides;
    const W = this.W;
    const hold = this.hold;
    const lastUpdate = this.lastUpdate;
    const Dn = this.D;
    for (let n = 0; n < this.N; n++) {
      if (!activeByStride[strides[n]]) continue;
      const base = n * Dn;
      let acc = 0;
      for (let i = 0; i < D; i++) acc += feature[i] * W[base + i];
      hold[n] = acc;
      lastUpdate[n] = t;
    }
    // copy current hold into history ring (note: stale nodes keep prev value
    // but cosSq() ignores them via lastUpdate window check below).
    const hbase = this.histIdx * this.N;
    this.hist.set(hold, hbase);
    this.histTick[this.histIdx] = t;
    this.histIdx = (this.histIdx + 1) % HIST;

    const cShort = this.cosSqLag(2, t);
    const cMid = this.cosSqLag(3, t);
    const cLong = this.cosSqLag(5, t);
    const cMean = (cShort + cMid + cLong) / 3;

    // directional closure flux on the sphere — single contiguous walk over
    // `dirs` via a running base pointer (no per-axis index math).
    const dirs = this.dirs;
    let sx = 0,
      sy = 0,
      sz = 0,
      sa = 0,
      db = 0;
    for (let i = 0; i < this.N; i++) {
      const v = hold[i];
      sa += v < 0 ? -v : v;
      sx += v * dirs[db];
      sy += v * dirs[db + 1];
      sz += v * dirs[db + 2];
      db += 3;
    }
    const closureFlux = sa > 1e-9 ? Math.sqrt(sx * sx + sy * sy + sz * sz) / sa : 0;
    const closureBaseline = 1 / Math.sqrt(this.N);
    const anomaly = Math.abs(closureFlux - closureBaseline);

    this.cwin[this.cidx] = cMean >= PHI_INV2 ? 1 : 0;
    this.cidx = (this.cidx + 1) % this.cwin.length;
    let cn = 0;
    for (let i = 0; i < this.cwin.length; i++) cn += this.cwin[i];
    const stableFraction = cn / this.cwin.length;

    return {
      amps: this.hold,
      N: this.N,
      coherenceShort: cShort,
      coherenceMid: cMid,
      coherenceLong: cLong,
      coherenceMean: cMean,
      closureFlux,
      closureBaseline,
      anomaly,
      stableFraction,
      lambda: PHI_INV2,
    };
  }

  /**
   * Multi-lag coherence between the most recent ring slot and the slot
   * recorded `lag` ticks earlier. Nodes that have NOT been updated within
   * the window [t-lag, t] are excluded — this kills the stale-stride bug
   * that previously inflated coherence toward 1.
   */
  private cosSqLag(lag: number, t: number): number {
    const aIdx = (this.histIdx - 1 + HIST) % HIST;
    const bIdx = (this.histIdx - 1 - lag + HIST * 2) % HIST;
    const tA = this.histTick[aIdx],
      tB = this.histTick[bIdx];
    if (tA < 0 || tB < 0) return 0;
    const aBase = aIdx * this.N;
    const bBase = bIdx * this.N;
    const fresh = t - lag - 1; // node must have updated at or after this tick
    let dot = 0,
      na = 0,
      nb = 0,
      contributing = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.lastUpdate[i] < fresh) continue;
      const a = this.hist[aBase + i],
        b = this.hist[bBase + i];
      dot += a * b;
      na += a * a;
      nb += b * b;
      contributing++;
    }
    if (contributing < this.N * 0.1) return 0;
    const d = na * nb;
    return d > 1e-12 ? Math.min(1, (dot * dot) / d) : 0;
  }

  static similarity(a: Float32Array, b: Float32Array): number {
    const n = Math.min(a.length, b.length);
    let dot = 0,
      na = 0,
      nb = 0;
    for (let i = 0; i < n; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const d = Math.sqrt(na) * Math.sqrt(nb);
    return d > 1e-9 ? dot / d : 0;
  }

  bytes(): number {
    return (
      this.W.byteLength +
      this.dirs.byteLength +
      this.hold.byteLength +
      this.hist.byteLength +
      this.lastUpdate.byteLength +
      this.histTick.byteLength
    );
  }
}

/**
 * Pick lattice N from the governor:
 *   • Anchored to the engine's live φ-mode ceiling (the same tier the
 *     field is running at). 68 GB → F₁₈ class (≈2584); phone → F₇ (13).
 *   • Further bounded by a per-modality RAM share so 4 modalities never
 *     exceed ~16 % of the RAM allocation.
 */
export function governorLatticeN(featureDim: number, fallback = 144): number {
  const snap = getGovernorSync();
  const m = snap?.gov.computeMaxM?.() ?? fallback;
  let pick = FIB_TIERS[0];
  for (const f of FIB_TIERS) {
    if (f <= m) pick = f;
    else break;
  }
  const ramBytes = snap?.gov.settings.ramBytes ?? 256 * 1024 * 1024;
  const perModalityBudget = ramBytes * 0.04; // 4% per modality, 4 modalities = 16% cap
  const bytesFor = (N: number) => N * featureDim * 4 + HIST * N * 4 + N * 3 * 4;
  if (bytesFor(pick) > perModalityBudget) {
    for (let i = FIB_TIERS.length - 1; i >= 0; i--) {
      if (FIB_TIERS[i] <= pick && bytesFor(FIB_TIERS[i]) <= perModalityBudget) {
        pick = FIB_TIERS[i];
        break;
      }
    }
  }
  return pick;
}

export const LATTICE_CONSTANTS = { LAMBDA: PHI_INV2, FIB_TIERS, HIST };
