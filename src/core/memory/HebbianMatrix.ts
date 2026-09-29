/**
 * HebbianMatrix — sparse symmetric co-activation store.
 *
 *   W_ij ← W_ij + η · a_i · a_j        (i < j only, symmetric on read)
 *   W_ij ← W_ij · (1 − decay)          (every update)
 *
 * Constants:
 *   η     = φ⁻³ ≈ 0.236068
 *   decay = φ⁻⁵ ≈ 0.090170
 *
 * STABILITY — stated exactly, because the previous note was wrong.
 *
 *   • The *unclamped* rule has fixed point w* = η/decay = φ² =
 *     2.618033988749894848, so the saturating clamp at ±1 in update() is what
 *     actually binds, not the activation range: |W_ij| ≤ 1 always holds.
 *     (The old comment claimed the caller clamped activations to [−1,1]; it
 *     does not, and nothing depended on it doing so.)
 *   • Consequently ‖W‖_F ≤ √(size) and recall() obeys
 *     ‖y‖_∞ ≤ 2·‖cue‖₁ (each entry contributes to two output rows). recall()
 *     is therefore bounded but NOT unit-scaled: callers comparing y against a
 *     fixed threshold must normalise by ‖cue‖₁ themselves. It is left raw here
 *     so the engine's frozen numerics stay bit-identical.
 *
 * Determinism: identical activation stream ⇒ identical W.
 * Eviction: when cap reached, smallest |w| pruned.
 */

import { PHI_INV } from '@/core/frameworks/constants';
import { memristiveStep } from '@metatron/trnn-core/substrate/plasticity';
import { PORT_FLAGS } from '@/core/runtime/portFlags';
import { computeMemoryCaps } from './MemoryGovernor';
import { memoryPolicy } from './MemoryPolicy';

export const ETA = PHI_INV * PHI_INV * PHI_INV; // φ⁻³
export const DECAY = ETA * PHI_INV * PHI_INV; // φ⁻⁵
const ACTIVATION_THRESHOLD = 1e-4;

export interface HebbianSnapshot {
  entries: Array<[number, number, number]>; // [i, j, w] with i<j
  dim: number;
}

export class HebbianMatrix {
  // Stored weights are *raw*; effective(W_ij) = raw * globalScale.
  // Per-tick decay is folded into globalScale (O(1)) instead of scanning
  // every entry. A renormalisation pass materialises raw ← raw*globalScale
  // and prunes sub-threshold entries either when globalScale has decayed
  // below RENORM_FLOOR or every RENORM_PERIOD ticks — whichever comes first.
  private W = new Map<number, number>(); // key = i*dim + j, i<j; effective = value * globalScale
  private dim = 0;
  private cap: number;
  private globalScale = 1;
  private ticksSinceRenorm = 0;
  private static readonly RENORM_PERIOD = 1024; // ~34 s @ 30 Hz
  private static readonly RENORM_FLOOR = 1e-6; // raw float64 headroom
  // Eviction slack: trigger only when size > cap*(1+SLACK), bulk-drop to cap.
  // Amortises O(N) quickselect cost across SLACK*cap ticks.
  private static readonly EVICT_SLACK = 0.0625; // 6.25 % headroom

  /**
   * Ω-REAL P5 — memristive plasticity port.
   *
   * OFF (default): the historical saturating-linear rule, bit-identical.
   * ON: the update rides a Joglekar window on [-1,1], so a weight can never
   * be clipped (it asymptotes instead), a fully learned synapse resists a
   * single contrary event, and depression is φ⁻¹ slower than potentiation.
   */
  private readonly memristive: boolean;

  constructor(cap?: number, opts?: { memristive?: boolean }) {
    this.cap = cap ?? computeMemoryCaps().maxHebbianEntries;
    this.memristive = opts?.memristive ?? PORT_FLAGS.FLAG_MEMRISTIVE_L1;
  }

  /** Live-resize the cap (called when the governor's RAM budget changes). */
  setCap(cap: number): void {
    this.cap = Math.max(64, Math.floor(cap));
    if (this.W.size > this.cap) this.evict();
  }

  /** Current cap (entries). */
  capacity(): number {
    return this.cap;
  }

  private key(i: number, j: number): number {
    return i < j ? i * this.dim + j : j * this.dim + i;
  }

  /** Materialise globalScale into raw weights and prune sub-threshold entries. */
  private renormalize(): void {
    const s = this.globalScale;
    if (s === 1 && this.W.size === 0) {
      this.ticksSinceRenorm = 0;
      return;
    }
    const cutoff = ACTIVATION_THRESHOLD; // compare effective magnitudes
    for (const [k, w] of this.W) {
      const eff = w * s;
      if (Math.abs(eff) < cutoff) this.W.delete(k);
      else this.W.set(k, eff);
    }
    this.globalScale = 1;
    this.ticksSinceRenorm = 0;
  }

  /** Apply one Hebbian update from an activation vector. */
  update(activation: Float64Array): void {
    const n = activation.length;
    if (n === 0) return;
    if (n > this.dim) this.dim = n;

    // O(1) decay — fold (1-DECAY/boost) into the global scale.
    // boost ≥ 1 (MemoryPolicy.hebbianDecayBoost), so effective decay shrinks
    // as the user dials aggression up → longer retention τ. boost=1 reproduces
    // historical behaviour exactly.
    const boost = memoryPolicy.hebbianDecayBoost();
    const effDecay = boost > 0 ? DECAY / boost : DECAY;
    this.globalScale *= 1 - effDecay;
    this.ticksSinceRenorm++;
    if (
      this.globalScale < HebbianMatrix.RENORM_FLOOR ||
      this.ticksSinceRenorm >= HebbianMatrix.RENORM_PERIOD
    ) {
      this.renormalize();
    }

    // Find above-threshold indices for sparse outer product.
    const active: number[] = [];
    for (let i = 0; i < n; i++) {
      if (Math.abs(activation[i]) >= ACTIVATION_THRESHOLD) active.push(i);
    }
    if (active.length < 2) {
      if (this.W.size > this.cap) this.evict();
      return;
    }

    // Convert effective updates into raw-space: raw_new = raw_old + ΔEff / s
    const invScale = 1 / this.globalScale;
    for (let a = 0; a < active.length; a++) {
      const i = active[a];
      const ai = activation[i];
      for (let b = a + 1; b < active.length; b++) {
        const j = active[b];
        const k = this.key(i, j);
        const rawOld = this.W.get(k) ?? 0;
        const effOld = rawOld * this.globalScale;
        const effNew = this.memristive
          ? memristiveStep(effOld, ai * activation[j], { etaSet: ETA, wMin: -1, wMax: 1 })
          : effOld + ETA * ai * activation[j];
        // Clamp effective to [-1, 1] (saturating Hebbian). Under the
        // memristive rule the window already guarantees this; the clamp then
        // costs nothing and never fires.
        const effClamped = effNew > 1 ? 1 : effNew < -1 ? -1 : effNew;
        this.W.set(k, effClamped * invScale);
      }
    }

    if (this.W.size > this.cap) this.evict();
  }

  /** Recall: y = W · cue (symmetric multiply). */
  recall(cue: Float64Array): Float64Array {
    const out = new Float64Array(Math.max(cue.length, this.dim));
    if (this.dim === 0) return out;
    const s = this.globalScale;
    for (const [k, w] of this.W) {
      const i = Math.floor(k / this.dim);
      const j = k - i * this.dim;
      const eff = w * s;
      const ci = i < cue.length ? cue[i] : 0;
      const cj = j < cue.length ? cue[j] : 0;
      out[j] += eff * ci;
      out[i] += eff * cj;
    }
    return out;
  }

  private evict(): void {
    // Slack gate: avoid running on every overflowing tick.
    const trigger = this.cap + Math.ceil(this.cap * HebbianMatrix.EVICT_SLACK);
    if (this.W.size <= trigger) return;

    // |raw| ordering = |effective| ordering (globalScale > 0 monotone),
    // so we can prune by raw magnitude without materialising.
    // Quickselect (Hoare partition) on |w| to find the (drop)th smallest
    // in O(N) expected time, vs O(N log N) for a full sort.
    const n = this.W.size;
    const drop = n - this.cap;

    // Single allocation: parallel arrays of key + |w|.
    const keys = new Float64Array(n); // store as number (safe; keys < 2^53)
    const absW = new Float64Array(n);
    let idx = 0;
    for (const [k, w] of this.W) {
      keys[idx] = k;
      absW[idx] = w < 0 ? -w : w;
      idx++;
    }

    // Quickselect: partition so absW[0..drop) ≤ pivot ≤ absW[drop..n).
    // Iterative Hoare partition, median-of-three pivot.
    let lo = 0,
      hi = n - 1;
    const target = drop - 1; // index of largest element to drop
    while (lo < hi) {
      // Median-of-three pivot.
      const mid = (lo + hi) >>> 1;
      const a = absW[lo],
        b = absW[mid],
        c = absW[hi];
      // Pivot = median(a,b,c).
      const pivot = a < b ? (b < c ? b : a < c ? c : a) : a < c ? a : b < c ? c : b;
      let i = lo,
        j = hi;
      while (i <= j) {
        while (absW[i] < pivot) i++;
        while (absW[j] > pivot) j--;
        if (i <= j) {
          if (i !== j) {
            const tw = absW[i];
            absW[i] = absW[j];
            absW[j] = tw;
            const tk = keys[i];
            keys[i] = keys[j];
            keys[j] = tk;
          }
          i++;
          j--;
        }
      }
      if (target <= j) hi = j;
      else if (target >= i) lo = i;
      else break;
    }

    // keys[0..drop) are now the `drop` smallest-|w| entries (unordered).
    for (let i = 0; i < drop; i++) this.W.delete(keys[i]);
  }

  /** Frobenius norm — used by stability tests. */
  frobenius(): number {
    let s = 0;
    for (const w of this.W.values()) s += w * w;
    return Math.sqrt(s) * Math.abs(this.globalScale);
  }

  size(): number {
    return this.W.size;
  }
  dimension(): number {
    return this.dim;
  }

  snapshot(): HebbianSnapshot {
    // Materialise so the snapshot is portable / scale-independent.
    this.renormalize();
    const entries: Array<[number, number, number]> = [];
    for (const [k, w] of this.W) {
      const i = Math.floor(k / this.dim);
      const j = k - i * this.dim;
      entries.push([i, j, w]);
    }
    entries.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return { entries, dim: this.dim };
  }

  restore(snap: HebbianSnapshot): void {
    this.dim = snap.dim;
    this.W.clear();
    this.globalScale = 1;
    this.ticksSinceRenorm = 0;
    for (const [i, j, w] of snap.entries) this.W.set(this.key(i, j), w);
  }
}
