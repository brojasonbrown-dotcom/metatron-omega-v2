/**
 * N1 — the Sensory Node Array (SNA).
 *
 * Every line convergence on a toroid's lattice — every node of
 * `torus/lattice.ts` — carries a live receptor here. Where `cell/organs.ts`
 * gives each node a *structural* readout (modal residual, radial ladder,
 * participation), this module gives each node a *dynamical* one: what the
 * field at that convergence is actually doing over time.
 *
 * Per node j the array measures, every tick:
 *
 *   vibration spectrum   B exactly-orthogonal DFT bins over a Fibonacci window
 *   instantaneous freq   wrapped phase advance of z_j, in cycles/tick
 *   energy state         |z_j|² and its share of the rung's total
 *   superpositional flux signed current across the lattice lines incident on j
 *   band capture         Parseval fraction of the window energy the bins hold
 *
 * ## Why exact DFT bins rather than free φ-frequencies
 *
 * The bands are φ-spaced by construction: band k wants frequency
 * ½·φ^(−k) cycles/tick. A free frequency would make the bins non-orthogonal
 * over a finite window, and then the Parseval capture figure below would be a
 * fiction (it could exceed 1). So each φ-target is *snapped to the nearest
 * integer DFT bin of the window*, m_k = round(D·½·φ^(−k)), deduplicated
 * downward. The bins are then exactly orthogonal over the window, Parseval
 * holds to machine precision, and the reported capture is a real number rather
 * than a normalisation artefact. The measured φ-error of each snap is
 * reported (`bandDrift`) instead of being hidden.
 *
 * ## Why the accumulator, not a sliding Goertzel
 *
 * A block DFT accumulator X_k += z_j[t]·e^(−iω_k t) over a D-tick window costs
 * one complex MAC per node per band per tick and stores 2 doubles per node per
 * band — no per-node history buffer at all. The rotator e^(−iω_k t) depends
 * only on the tick, so it is computed once per band per tick and shared by
 * every node. At D ticks the window closes, amplitudes and phases latch, and
 * the accumulators reset. This is an *exact* windowed DFT, not an
 * approximation: the g-battery checks it against the Bluestein FFT.
 *
 * ## Flux
 *
 * The current along the lattice line joining nodes a and b is the discrete
 * probability current J(a→b) = Im(conj(z_a)·z_b). It is antisymmetric by
 * construction, so the divergence field div_j = Σ_incident J(j→·) sums to
 * exactly zero over the rung. That identity is the array's own closure law and
 * is measured (`divergenceSum`), never asserted.
 *
 * Each node has four incident lines: its two u-neighbours (j ± 1, the major
 * circle) and its two golden v-neighbours (j ± step, the minor spiral), which
 * are precisely the lines crossing at that convergence.
 *
 * ## Determinism and non-interference
 *
 * The array is a pure observer. It is never on the dynamics path, holds no
 * RNG and no wall clock, and routes every transcendental through `core/dmath`.
 * An engine built with sensors produces a bit-identical digest to one built
 * without — that is the parity law the battery checks.
 */

import { PHI, PHI_INV } from '../core/constants';
import type { CField } from '../core/complex';
import { dcos, dsin, datan2, dmag, dpow, dlog } from '../core/dmath';
import { isFibonacci } from '../core/fibonacci';
import { fft } from '../spectral/fft';
import type { Lattice } from '../torus/lattice';

const TWO_PI = 2 * Math.PI;

/** Default band count — 8 φ-spaced bins spans π down to ≈0.02 cycles/tick. */
export const DEFAULT_BANDS = 8;
/** Default window depth — Fibonacci (Law 2.2), long enough to resolve band 7. */
export const DEFAULT_DEPTH = 89;

export interface SensoryNodeOptions {
  /** Number of φ-spaced spectral bands per node. Default 8. */
  readonly bands?: number;
  /** Analysis window in ticks — must be Fibonacci (Law 2.2). Default 89. */
  readonly depth?: number;
}

/** One band's frequency plan, after the φ-target was snapped to a DFT bin. */
export interface BandPlan {
  readonly index: number;
  /**
   * Integer DFT bin over the window — guarantees exact orthogonality.
   * Bins above depth/2 are the negative-frequency half of the transform.
   */
  readonly bin: number;
  /**
   * Realised frequency, cycles per tick — **signed**. The field is complex,
   * so +f and −f are physically distinct: they are the two directions the
   * phase can circulate around the torus, and a node can carry one without
   * the other. Both signs are planned at every φ rung.
   */
  readonly frequency: number;
  /** Circulation sense: +1 prograde, −1 retrograde. */
  readonly sense: 1 | -1;
  /** The φ-ladder target, signed cycles per tick (= ±φ^(−2−rung)). */
  readonly target: number;
  /** |realised − target| / |target| — the measured cost of snapping. */
  readonly drift: number;
}

export interface SensoryNodeReport {
  readonly nodes: number;
  readonly bands: number;
  readonly depth: number;
  /** Ticks elapsed inside the current window, in [0, depth). */
  readonly windowPhase: number;
  /** Completed windows since construction. 0 means no spectrum has latched. */
  readonly windowsClosed: number;
  /** Total field energy Σ|z_j|² this tick. */
  readonly energy: number;
  /** Largest single-node energy share in [0, 1]. */
  readonly peakShare: number;
  /** Shannon entropy of the energy share distribution, normalised to [0, 1]. */
  readonly energyEntropy: number;
  /** Mean |instantaneous frequency| across nodes, cycles/tick. */
  readonly meanFrequency: number;
  /** Σ_j div_j — structurally 0; a non-zero value is a real defect. */
  readonly divergenceSum: number;
  /** Σ_j |div_j| — total circulation crossing the grid lines. */
  readonly circulation: number;
  /** Mean Parseval capture of the latched bands, in [0, 1]. */
  readonly meanCapture: number;
  /** Smallest per-node capture — the worst-resolved convergence. */
  readonly minCapture: number;
  /** Nodes whose latched spectrum is entirely zero (silent receptors). */
  readonly silent: number;
  /** Mean DC (standing-amplitude) share of the window energy, in [0, 1]. */
  readonly meanDcShare: number;
  /**
   * Full-spectrum probe of the busiest convergence. The φ ladder is sparse by
   * construction, so when capture is low the useful question is not "is the
   * array broken" but "where did the motion actually go". The probe answers
   * it exactly: one node's complete windowed DFT, reported as its strongest
   * AC lines. Null until the first window closes.
   */
  readonly probe: SpectralProbe | null;
}

/** One line of the full-spectrum probe. */
export interface ProbeLine {
  /** Signed frequency, cycles per tick. */
  readonly frequency: number;
  /** Integer DFT bin over the window. */
  readonly bin: number;
  /** Share of the node's AC window energy on this line, in [0, 1]. */
  readonly share: number;
  /** True when the φ ladder has a band on this exact bin. */
  readonly onLadder: boolean;
}

export interface SpectralProbe {
  /** Node the probe followed — the previous window's peak-energy convergence. */
  readonly node: number;
  /** Strongest AC lines, descending by share. */
  readonly lines: readonly ProbeLine[];
  /** Fraction of this node's AC energy the φ ladder holds, in [0, 1]. */
  readonly ladderShare: number;
}

export class SensoryNodeArray {
  readonly n: number;
  readonly bands: number;
  readonly depth: number;
  /** Frequency plan, shared by every node. */
  readonly plan: readonly BandPlan[];
  /** Golden stride used for the v-incident lines. */
  readonly goldenStep: number;

  /** Latched band magnitude, row-major [node][band]. */
  readonly bandAmp: Float64Array;
  /** Latched band phase in (−π, π], row-major [node][band]. */
  readonly bandPhase: Float64Array;
  /** |z_j|² this tick. */
  readonly energy: Float64Array;
  /** Energy share in [0, 1]. */
  readonly share: Float64Array;
  /** Instantaneous frequency, cycles/tick, in (−½, ½]. */
  readonly frequency: Float64Array;
  /** Signed current divergence across the four incident lattice lines. */
  readonly divergence: Float64Array;
  /**
   * Parseval capture of the latched spectrum, in [0, 1] — the fraction of the
   * node's *vibrational* (AC) window energy the φ bands hold. The DC bin is
   * excluded from both sides: a node's standing amplitude is not a vibration,
   * and counting it in the denominator would make a perfectly-tracked but
   * slowly-drifting convergence read as unresolved.
   */
  readonly capture: Float64Array;

  /**
   * Fraction of each node's window energy sitting on DC — its standing
   * amplitude as opposed to its motion. High dcShare with high capture means
   * a quiet, well-resolved node, not a blind one.
   */
  readonly dcShare: Float64Array;

  /** Live DFT accumulators, row-major [node][band] × (re, im). */
  private readonly accRe: Float64Array;
  private readonly accIm: Float64Array;
  /** DC (bin 0) accumulators — the window mean, needed to split AC from DC. */
  private readonly accDcRe: Float64Array;
  private readonly accDcIm: Float64Array;
  /** Raw window trace of the probe node, for its full-spectrum transform. */
  private readonly probeRe: Float64Array;
  private readonly probeIm: Float64Array;
  private probeNode = 0;
  private probeResult: SpectralProbe | null = null;
  /** Running Σ|z_j|² inside the open window. */
  private readonly winEnergy: Float64Array;
  /** arg z_j on the previous tick. */
  private readonly prevPhase: Float64Array;
  private primed = false;

  /** Per-band rotator for the current tick, recomputed once per tick. */
  private readonly rotRe: Float64Array;
  private readonly rotIm: Float64Array;

  private windowPhase = 0;
  private windowsClosed = 0;
  private last: SensoryNodeReport;

  constructor(n: number, opts: SensoryNodeOptions = {}) {
    if (!Number.isInteger(n) || n <= 0) {
      throw new RangeError(`SensoryNodeArray: n must be a positive integer, got ${n}`);
    }
    const bands = opts.bands ?? DEFAULT_BANDS;
    if (!Number.isInteger(bands) || bands < 1) {
      throw new RangeError(`SensoryNodeArray: bands must be a positive integer, got ${bands}`);
    }
    const depth = opts.depth ?? DEFAULT_DEPTH;
    if (!Number.isInteger(depth) || depth < 2) {
      throw new RangeError(`SensoryNodeArray: depth must be an integer >= 2, got ${depth}`);
    }
    if (!isFibonacci(depth)) {
      throw new RangeError(`SensoryNodeArray: depth ${depth} is not Fibonacci (Law 2.2)`);
    }
    // Bands come in ± pairs, so the binding limit is one φ rung per positive
    // bin below Nyquist.
    if (bands / 2 > Math.floor(depth / 2)) {
      throw new RangeError(
        `SensoryNodeArray: ${bands} bands cannot fit in a ${depth}-tick window (max ${2 * Math.floor(depth / 2)})`,
      );
    }

    this.n = n;
    this.bands = bands;
    this.depth = depth;
    this.plan = planBands(bands, depth);
    this.goldenStep = goldenStride(n);

    this.bandAmp = new Float64Array(n * bands);
    this.bandPhase = new Float64Array(n * bands);
    this.energy = new Float64Array(n);
    this.share = new Float64Array(n);
    this.frequency = new Float64Array(n);
    this.divergence = new Float64Array(n);
    this.capture = new Float64Array(n);

    this.accRe = new Float64Array(n * bands);
    this.accIm = new Float64Array(n * bands);
    this.accDcRe = new Float64Array(n);
    this.accDcIm = new Float64Array(n);
    this.probeRe = new Float64Array(depth);
    this.probeIm = new Float64Array(depth);
    this.dcShare = new Float64Array(n);
    this.winEnergy = new Float64Array(n);
    this.prevPhase = new Float64Array(n);

    this.rotRe = new Float64Array(bands);
    this.rotIm = new Float64Array(bands);

    this.last = {
      nodes: n,
      bands,
      depth,
      windowPhase: 0,
      windowsClosed: 0,
      energy: 0,
      peakShare: 0,
      energyEntropy: 0,
      meanFrequency: 0,
      divergenceSum: 0,
      circulation: 0,
      meanCapture: 0,
      minCapture: 0,
      silent: n,
      meanDcShare: 0,
      probe: null,
    };
  }

  /** Exact bytes this array allocates — feeds the governor footprint check. */
  bytes(): number {
    const perNode = 8 * (6 + 4 * this.bands);
    return this.n * perNode + this.bands * 16 + this.plan.length * 32;
  }

  report(): SensoryNodeReport {
    return this.last;
  }

  /** Latched spectrum of one node, as a fresh array of `bands` magnitudes. */
  spectrumOf(node: number): Float64Array {
    if (!Number.isInteger(node) || node < 0 || node >= this.n) {
      throw new RangeError(`SensoryNodeArray.spectrumOf: node ${node} out of range [0, ${this.n})`);
    }
    return this.bandAmp.slice(node * this.bands, (node + 1) * this.bands);
  }

  /**
   * Read the post-update field. Pure observation — nothing here is fed back
   * into the dynamics, so an engine with sensors digests identically to one
   * without.
   */
  update(z: CField, lattice: Lattice): SensoryNodeReport {
    const n = this.n;
    const B = this.bands;
    const D = this.depth;
    const t = this.windowPhase;

    // Rotators e^(−2πi·m_k·t/D), once per band per tick.
    for (let k = 0; k < B; k++) {
      const th = (-TWO_PI * this.plan[k].bin * t) / D;
      this.rotRe[k] = dcos(th);
      this.rotIm[k] = dsin(th);
    }

    // --- energy, instantaneous frequency, DFT accumulation ------------------
    let total = 0;
    let freqSum = 0;
    for (let j = 0; j < n; j++) {
      const zr = z.re[j];
      const zi = z.im[j];
      const e = zr * zr + zi * zi;
      this.energy[j] = e;
      total += e;
      this.winEnergy[j] += e;
      this.accDcRe[j] += zr;
      this.accDcIm[j] += zi;
      if (j === this.probeNode) {
        this.probeRe[t] = zr;
        this.probeIm[t] = zi;
      }

      // instantaneous frequency: wrapped phase advance, cycles per tick
      const ph = datan2(zi, zr);
      if (this.primed) {
        let d = ph - this.prevPhase[j];
        while (d > Math.PI) d -= TWO_PI;
        while (d <= -Math.PI) d += TWO_PI;
        const f = d / TWO_PI;
        this.frequency[j] = f;
        freqSum += f < 0 ? -f : f;
      } else {
        this.frequency[j] = 0;
      }
      this.prevPhase[j] = ph;

      const row = j * B;
      for (let k = 0; k < B; k++) {
        const rr = this.rotRe[k];
        const ri = this.rotIm[k];
        this.accRe[row + k] += zr * rr - zi * ri;
        this.accIm[row + k] += zr * ri + zi * rr;
      }
    }
    this.primed = true;

    // --- energy shares + entropy -------------------------------------------
    let peakShare = 0;
    let entropy = 0;
    if (total > 0) {
      for (let j = 0; j < n; j++) {
        const s = this.energy[j] / total;
        this.share[j] = s;
        if (s > peakShare) peakShare = s;
        if (s > 0) entropy -= s * dlog(s);
      }
      entropy /= dlog(n > 1 ? n : 2);
    } else {
      this.share.fill(0);
    }

    // --- superpositional flux across the incident lattice lines -------------
    // Four lines cross at node j: the major circle (j ± 1) and the golden
    // minor spiral (j ± step). J(j→a) = Im(conj(z_j)·z_a) is antisymmetric,
    // so Σ_j div_j is structurally zero and any drift is a real defect.
    const step = this.goldenStep;
    let divSum = 0;
    let circulation = 0;
    for (let j = 0; j < n; j++) {
      const zr = z.re[j];
      const zi = z.im[j];
      let d = 0;
      d += current(zr, zi, z.re[(j + 1) % n], z.im[(j + 1) % n]);
      d += current(zr, zi, z.re[(j - 1 + n) % n], z.im[(j - 1 + n) % n]);
      d += current(zr, zi, z.re[(j + step) % n], z.im[(j + step) % n]);
      d += current(zr, zi, z.re[(j - step + n) % n], z.im[(j - step + n) % n]);
      this.divergence[j] = d;
      divSum += d;
      circulation += d < 0 ? -d : d;
    }

    // --- window close: latch the spectrum, measure capture, reset -----------
    this.windowPhase = t + 1;
    let meanCapture = this.last.meanCapture;
    let minCapture = this.last.minCapture;
    let silent = this.last.silent;
    let meanDcShare = this.last.meanDcShare;
    if (this.windowPhase >= D) {
      this.windowPhase = 0;
      this.windowsClosed++;
      let capSum = 0;
      let dcSum = 0;
      minCapture = 1;
      silent = 0;
      for (let j = 0; j < n; j++) {
        const row = j * B;
        let held = 0;
        let peak = 0;
        for (let k = 0; k < B; k++) {
          const ar = this.accRe[row + k];
          const ai = this.accIm[row + k];
          const mag = dmag(ar, ai) / D;
          this.bandAmp[row + k] = mag;
          this.bandPhase[row + k] = datan2(ai, ar);
          // Parseval over exactly-orthogonal bins: |X_k|²/D is the energy the
          // bin holds. Every planned bin is distinct and the two circulation
          // senses are planned separately, so each contributes exactly once —
          // no conjugate-pair doubling (the field is complex, not real).
          held += (ar * ar + ai * ai) / D;
          if (mag > peak) peak = mag;
          this.accRe[row + k] = 0;
          this.accIm[row + k] = 0;
        }
        // Split the window energy: DC (standing amplitude) vs AC (motion).
        const dr = this.accDcRe[j];
        const di = this.accDcIm[j];
        const dcEnergy = (dr * dr + di * di) / D;
        this.accDcRe[j] = 0;
        this.accDcIm[j] = 0;
        const we = this.winEnergy[j];
        this.dcShare[j] = we > 0 ? Math.min(1, dcEnergy / we) : 0;
        const ac = we - dcEnergy;
        const cap = ac > 1e-300 ? Math.min(1, held / ac) : 0;
        this.capture[j] = cap;
        capSum += cap;
        dcSum += this.dcShare[j];
        if (cap < minCapture) minCapture = cap;
        if (peak === 0) silent++;
        this.winEnergy[j] = 0;
      }
      meanCapture = capSum / n;
      meanDcShare = dcSum / n;
      this.probeResult = this.runProbe();
      // Follow the busiest convergence into the next window.
      let hot = 0;
      for (let j = 1; j < n; j++) if (this.energy[j] > this.energy[hot]) hot = j;
      this.probeNode = hot;
    }

    this.last = {
      nodes: n,
      bands: B,
      depth: D,
      windowPhase: this.windowPhase,
      windowsClosed: this.windowsClosed,
      energy: total,
      peakShare,
      energyEntropy: entropy,
      meanFrequency: n > 0 ? freqSum / n : 0,
      divergenceSum: divSum,
      circulation,
      meanCapture,
      minCapture: this.windowsClosed > 0 ? minCapture : 0,
      silent: this.windowsClosed > 0 ? silent : n,
      meanDcShare,
      probe: this.probeResult,
    };
    // `lattice` is accepted so the array is bound to the grid it measures and
    // can be extended to true (u, v) adjacency without changing the call site.
    void lattice;
    return this.last;
  }

  /**
   * Full windowed DFT of the probe node. Exact for any depth (Bluestein), so
   * the reported lines are the true spectrum of that convergence, not an
   * interpolation between φ bands.
   */
  private runProbe(): SpectralProbe {
    const D = this.depth;
    const spec = fft(this.probeRe, this.probeIm);
    const ladder = new Set(this.plan.map((p) => p.bin));
    let ac = 0;
    const power = new Float64Array(D);
    for (let b = 1; b < D; b++) {
      const e = (spec.re[b] * spec.re[b] + spec.im[b] * spec.im[b]) / D;
      power[b] = e;
      ac += e;
    }
    let onLadder = 0;
    for (const b of ladder) onLadder += power[b] ?? 0;
    const order: number[] = [];
    for (let b = 1; b < D; b++) order.push(b);
    order.sort((a, b) => power[b] - power[a]);
    const lines: ProbeLine[] = order.slice(0, 5).map((b) => ({
      bin: b,
      frequency: (b <= D / 2 ? b : b - D) / D,
      share: ac > 0 ? power[b] / ac : 0,
      onLadder: ladder.has(b),
    }));
    return { node: this.probeNode, lines, ladderShare: ac > 0 ? onLadder / ac : 0 };
  }

  /** Reset all accumulators and latched state (used by checkpoint restore). */
  reset(): void {
    this.accRe.fill(0);
    this.accIm.fill(0);
    this.winEnergy.fill(0);
    this.prevPhase.fill(0);
    this.bandAmp.fill(0);
    this.bandPhase.fill(0);
    this.energy.fill(0);
    this.share.fill(0);
    this.frequency.fill(0);
    this.divergence.fill(0);
    this.capture.fill(0);
    this.dcShare.fill(0);
    this.accDcRe.fill(0);
    this.accDcIm.fill(0);
    this.probeRe.fill(0);
    this.probeIm.fill(0);
    this.probeNode = 0;
    this.probeResult = null;
    this.windowPhase = 0;
    this.windowsClosed = 0;
    this.primed = false;
  }
}

/** Discrete probability current along the line a→b: Im(conj(z_a)·z_b). */
function current(ar: number, ai: number, br: number, bi: number): number {
  return ar * bi - ai * br;
}

/**
 * φ-spaced band plan snapped to exact DFT bins of a `depth`-tick window,
 * covering **both circulation senses**.
 *
 * The node field is complex, so its spectrum is not conjugate-symmetric:
 * a convergence whose phase winds prograde at f has energy at +f and none at
 * −f. A positive-frequency-only ladder is therefore blind to half the motion
 * on the toroid — measured on a driven 233-node rung, 79 % of the window
 * energy sat on a retrograde bin the one-sided plan never sampled.
 *
 * The ladder is walked in pairs: rung r has target ±φ^(−2−r) cycles/tick,
 * with the negative member stored as DFT bin depth−m. `bands` must therefore
 * be even. Targets are rounded to the nearest bin (clamped at Nyquist);
 * collisions are resolved
 * toward DC, and a band that would land on bin 0 is rejected rather than
 * silently aliasing onto the standing amplitude.
 */
/**
 * Top of the φ ladder, cycles per tick: φ⁻² = 0.381966…
 *
 * Anchoring at ½ (Nyquist) was arbitrary and measurably wrong. The engine's
 * own dynamics are φ-recursive, so their spectral lines land on powers of φ⁻¹,
 * not on halves of them: the full-spectrum probe on a driven 89-node rung put
 * 100 % of the busiest convergence's AC energy at exactly −φ⁻² cycles/tick,
 * which a ½·φ⁻ᵏ ladder (0.5, 0.309, 0.191, …) straddles and never samples.
 * φ⁻² is the largest φ power strictly below Nyquist, so the whole ladder
 * descends from it inside the representable band.
 */
export const LADDER_ANCHOR = PHI_INV * PHI_INV;

export function planBands(bands: number, depth: number): BandPlan[] {
  if (bands % 2 !== 0) {
    throw new RangeError(`planBands: bands must be even (± pairs), got ${bands}`);
  }
  const nyquist = Math.floor(depth / 2);
  const used = new Set<number>();
  const out: BandPlan[] = [];
  for (let k = 0; k < bands; k++) {
    const rung = k >> 1;
    const sense: 1 | -1 = k % 2 === 0 ? 1 : -1;
    const magnitude = LADDER_ANCHOR * dpow(PHI_INV, rung);
    const target = sense * magnitude;
    let m = Math.min(nyquist, Math.round(magnitude * depth));
    while (m > 0 && used.has(sense > 0 ? m : depth - m)) m--;
    if (m <= 0) {
      throw new RangeError(
        `planBands: band ${k} (target ${target} cycles/tick) has no free DFT bin in a ${depth}-tick window`,
      );
    }
    const bin = sense > 0 ? m : depth - m;
    used.add(bin);
    const frequency = (sense * m) / depth;
    out.push({
      index: k,
      bin,
      frequency,
      sense,
      target,
      drift: Math.abs(frequency - target) / Math.abs(target),
    });
  }
  return out;
}

/** The lattice's own golden stride — the minor-spiral neighbour offset. */
export function goldenStride(n: number): number {
  const s = Math.round(n * PHI_INV) % n;
  return s < 1 ? 1 : s;
}

/** Bytes an array of `n` nodes at `bands` bands will allocate. */
export function sensoryNodeBytes(n: number, bands = DEFAULT_BANDS): number {
  return n * 8 * (6 + 4 * bands) + bands * 16;
}

/** φ-ladder target frequency of band k, cycles per tick (pre-snap). */
export function bandTarget(k: number): number {
  return 0.5 * dpow(PHI, -k);
}
