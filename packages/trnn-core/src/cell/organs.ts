/**
 * N0/N1/N2 — the per-node organ bank.
 *
 * Every node on a rung owns five organs. Before this module only the first of
 * them was real per node; the rest were rung-wide summaries computed on demand
 * for the telemetry decks. Here they become node-addressable state:
 *
 *   neuron        z[j]                            (owned by the engine)
 *   eigenmode     local modal reconstruction + residual per node
 *   radial        spherical-Bessel coefficients on the φ ladder, per node,
 *                 taken along that node's own golden-spiral ray
 *   superposition local participation ratio + local phase coherence per node
 *   sensory       per-node receptor: gain, modality tag, last injection
 *
 * Layout is struct-of-arrays: one typed array per organ field, indexed by node.
 * There is no per-node object anywhere — that is what keeps a 42k-node GRAND
 * build in tens of megabytes instead of gigabytes, and it is why `bytes()` can
 * report an exact figure to the governor instead of an estimate.
 *
 * Determinism: every value is a pure function of the field, the lattice and the
 * node index. No RNG, no wall clock, all transcendentals through the
 * deterministic math bank. The organs are *measurements*; they only touch the
 * dynamics when `radialGain > 0`, and at gain 0 the engine digest is
 * bit-identical to the certified S0 oracle.
 */

import { PHI, PHI_INV } from '../core/constants';
import { createField, type CField } from '../core/complex';
import { dmag, dpow } from '../core/dmath';
import {
  buildRadialBasis,
  radialAnalyze,
  radialGrid,
  radialGridSize,
  radialLadderWindow,
  type RadialBasis,
} from '../spectral/radial';
import type { ModeBasis } from '../torus/superposition';

/** Modality tags for the per-node receptor (mirrors sense/encode Modality). */
export const MODALITY_NONE = 0;

export interface OrganOptions {
  /** Radial orders per node (φ-ladder depth). Default 8. */
  readonly radialOrders?: number;
  /** Ladder index of the owning rung — offsets the radial φ ladder. */
  readonly rung?: number;
  /**
   * Strength of the radial reconstruction fed back into the resonance slot,
   * in [0, φ⁻¹]. 0 (default) makes the organ bank a pure observer and leaves
   * the engine bit-identical to the oracle.
   */
  readonly radialGain?: number;
  /** Recompute cadence in ticks (Fibonacci by convention). Default 1. */
  readonly stride?: number;
}

/** Upper bound on the radial feedback gain — keeps the R slot inside the
 *  certified drive envelope (δ·‖R‖ stays below the Jury slack). */
export const RADIAL_GAIN_MAX = PHI_INV;

export interface OrganReport {
  /** Ticks since the bank last recomputed (0 on a recompute tick). */
  readonly age: number;
  /** Mean per-node eigenmode residual — 0 means the modal basis spans z. */
  readonly meanEigenResidual: number;
  /** Max per-node eigenmode residual. */
  readonly maxEigenResidual: number;
  /** Mean per-node participation ratio in [1/K, 1] (1 = fully spread). */
  readonly meanParticipation: number;
  /** Mean per-node local phase coherence in [0, 1]. */
  readonly meanLocalCoherence: number;
  /** Max |radial reconstruction| across nodes. */
  readonly radialPeak: number;
  /** Gram defect of the radial basis (measured at build, not asserted). */
  readonly radialGramDefect: number;
  /** Radial basis functions that survived orthonormalisation (rank of the plane). */
  readonly radialBands: number;
  /** φ-ladder offset this rung's radial plane is anchored at. */
  readonly radialLadderOffset: number;
  /** Nodes whose radial reconstruction was saturated at the ray sup-norm. */
  readonly radialClipped: number;
  /** Nodes that carry a live receptor (gain > 0 and a modality tag). */
  readonly receptors: number;
}

export class NodeOrgans {
  readonly n: number;
  readonly orders: number;
  readonly modes: number;
  readonly stride: number;
  readonly radialGain: number;
  readonly radialBasis: RadialBasis;
  /** φ-ladder offset actually used (0 — the only fully representable anchor). */
  readonly radialLadderOffset: number;
  /** Grid index the radial reconstruction is read at (golden-section radius). */
  private readonly readIndex: number;

  // --- eigenmode organ -----------------------------------------------------
  /** |z_j − (basis reconstruction)_j| per node. */
  readonly eigenResidual: Float64Array;
  /** Index of the mode carrying the largest magnitude at node j. */
  readonly eigenLead: Int32Array;

  // --- radial organ --------------------------------------------------------
  /** Row-major [node][order] spherical-Bessel coefficients. */
  readonly radialCoef: Float64Array;
  /** Reconstruction at r→0 of each node's ray, carried on the node's phase. */
  readonly radialField: CField;

  // --- superposition organ -------------------------------------------------
  /** Participation ratio of the modal decomposition at node j. */
  readonly participation: Float64Array;
  /** Local phase coherence against the golden-neighbour pair. */
  readonly localCoherence: Float64Array;

  // --- sensory organ -------------------------------------------------------
  readonly senseGain: Float64Array;
  readonly senseModality: Int8Array;
  readonly senseLast: Float64Array;

  private readonly ray: Float64Array;
  private readonly coefRow: Float64Array;
  private readonly amp: Float64Array;
  private tickCount = 0;
  private age = 0;
  private last: OrganReport;

  constructor(n: number, modes: number, opts: OrganOptions = {}) {
    if (!Number.isInteger(n) || n <= 0)
      throw new RangeError(`NodeOrgans: n must be a positive integer, got ${n}`);
    const orders = opts.radialOrders ?? 8;
    if (!Number.isInteger(orders) || orders < 1) {
      throw new RangeError(`NodeOrgans: radialOrders must be a positive integer, got ${orders}`);
    }
    const gain = opts.radialGain ?? 0;
    if (!Number.isFinite(gain) || gain < 0 || gain > RADIAL_GAIN_MAX) {
      throw new RangeError(
        `NodeOrgans: radialGain must be in [0, ${RADIAL_GAIN_MAX}], got ${gain}`,
      );
    }
    const stride = opts.stride ?? 1;
    if (!Number.isInteger(stride) || stride < 1) {
      throw new RangeError(`NodeOrgans: stride must be a positive integer, got ${stride}`);
    }

    this.n = n;
    this.orders = orders;
    this.modes = modes;
    this.stride = stride;
    this.radialGain = gain;

    // The ray is sampled on the same midpoint grid the radial plane quadrates
    // on, so analysis is the exact adjoint of synthesis for this organ too.
    // The rung's ladder index can run to 125 on the dense core; pi * phi^125 is
    // far past what any finite grid resolves, so an offset taken from the raw
    // index aliases (measured: the basis emptied out entirely for rungs 55-71).
    // Offsets above 0 are also unable to represent the near-constant part of a
    // ray, so the plane is anchored at 0 and spans phi^0..phi^(orders-1); the
    // rung's identity enters through its own spiral ray, not through the basis.
    const window = radialLadderWindow(orders);
    const offset = Math.min(0, window - 1);
    const grid = radialGrid(radialGridSize(orders, offset));
    this.radialLadderOffset = offset;
    this.radialBasis = buildRadialBasis(grid, 0, orders, offset);

    this.eigenResidual = new Float64Array(n);
    this.eigenLead = new Int32Array(n);
    this.radialCoef = new Float64Array(n * orders);
    this.radialField = createField(n);
    this.participation = new Float64Array(n);
    this.localCoherence = new Float64Array(n);
    this.senseGain = new Float64Array(n).fill(1);
    this.senseModality = new Int8Array(n);
    this.senseLast = new Float64Array(n);

    this.ray = new Float64Array(grid.n);
    this.readIndex = Math.min(grid.n - 1, Math.round(grid.n * PHI_INV));
    this.coefRow = new Float64Array(this.radialBasis.vectors.length);
    this.amp = new Float64Array(n);

    this.last = {
      age: 0,
      meanEigenResidual: 0,
      maxEigenResidual: 0,
      meanParticipation: 0,
      meanLocalCoherence: 0,
      radialPeak: 0,
      radialGramDefect: this.radialBasis.gramDefect,
      radialBands: this.radialBasis.vectors.length,
      radialLadderOffset: offset,
      radialClipped: 0,
      receptors: 0,
    };
  }

  /** Exact bytes this bank allocates — feeds the footprint check. */
  bytes(): number {
    const perNode =
      8 /*eigenResidual*/ +
      4 /*eigenLead*/ +
      8 * this.orders /*radialCoef*/ +
      16 /*radialField*/ +
      8 /*participation*/ +
      8 /*localCoherence*/ +
      8 /*senseGain*/ +
      1 /*senseModality*/ +
      8; /*senseLast*/
    const basis = this.radialBasis.vectors.length * this.orders * 8 + this.orders * 16;
    return (
      this.n * perNode + basis + this.ray.byteLength + this.coefRow.byteLength + this.amp.byteLength
    );
  }

  report(): OrganReport {
    return this.last;
  }

  /** Attach a receptor to one node. Gain 0 mutes it. */
  setReceptor(node: number, modality: number, gain = 1): void {
    if (!Number.isInteger(node) || node < 0 || node >= this.n) {
      throw new RangeError(`NodeOrgans.setReceptor: node ${node} out of range [0, ${this.n})`);
    }
    if (!Number.isFinite(gain) || gain < 0 || gain > PHI) {
      throw new RangeError(`NodeOrgans.setReceptor: gain must be in [0, ${PHI}], got ${gain}`);
    }
    this.senseGain[node] = gain;
    this.senseModality[node] = modality;
  }

  /** Record what the sensory plane actually delivered to each node this tick. */
  recordInjection(s: CField | null): void {
    if (!s) {
      this.senseLast.fill(0);
      return;
    }
    const k = Math.min(this.n, s.n);
    for (let j = 0; j < k; j++) this.senseLast[j] = dmag(s.re[j], s.im[j]);
    for (let j = k; j < this.n; j++) this.senseLast[j] = 0;
  }

  /**
   * Recompute every organ from the live field.
   *
   * `coeffs` is the rung's modal decomposition (interleaved re/im, already
   * computed by the engine — the organ bank never re-runs the analysis) and
   * `basis` its orthonormal mode vectors.
   */
  update(z: CField, basis: ModeBasis, coeffs: Float64Array): OrganReport {
    const t = this.tickCount++;
    if (t % this.stride !== 0) {
      this.age++;
      this.last = { ...this.last, age: this.age };
      return this.last;
    }
    this.age = 0;

    const n = this.n;
    const K = basis.vectors.length;

    // amplitudes once — every organ below reads them
    for (let j = 0; j < n; j++) this.amp[j] = dmag(z.re[j], z.im[j]);

    // --- eigenmode + superposition (one pass over nodes x modes) -----------
    let resSum = 0;
    let resMax = 0;
    let prSum = 0;
    for (let j = 0; j < n; j++) {
      let rr = 0;
      let ri = 0;
      let p2 = 0;
      let p4 = 0;
      let lead = 0;
      let leadMag = -1;
      for (let k = 0; k < K; k++) {
        const cr = coeffs[2 * k];
        const ci = coeffs[2 * k + 1];
        const br = basis.vectors[k].re[j];
        const bi = basis.vectors[k].im[j];
        // contribution of mode k at node j: c_k · b_k(j)
        const xr = cr * br - ci * bi;
        const xi = cr * bi + ci * br;
        rr += xr;
        ri += xi;
        const m2 = xr * xr + xi * xi;
        p2 += m2;
        p4 += m2 * m2;
        if (m2 > leadMag) {
          leadMag = m2;
          lead = k;
        }
      }
      const res = dmag(z.re[j] - rr, z.im[j] - ri);
      this.eigenResidual[j] = res;
      this.eigenLead[j] = lead;
      resSum += res;
      if (res > resMax) resMax = res;
      // participation ratio: (Σ m²)² / (K Σ m⁴) ∈ [1/K, 1]
      const pr = p4 > 0 ? (p2 * p2) / (K * p4) : 0;
      this.participation[j] = pr;
      prSum += pr;
    }

    // --- local phase coherence against the golden-neighbour pair -----------
    // The neighbour offset is the Fibonacci stride of the lattice itself, so
    // "local" means local on the spiral, not local in raw index order.
    const step = Math.max(1, Math.round(n * PHI_INV) % n || 1);
    let cohSum = 0;
    for (let j = 0; j < n; j++) {
      const a = (j + step) % n;
      const b = (j - step + n) % n;
      const ma = this.amp[j] * this.amp[a];
      const mb = this.amp[j] * this.amp[b];
      const da = ma > 0 ? (z.re[j] * z.re[a] + z.im[j] * z.im[a]) / ma : 0;
      const db = mb > 0 ? (z.re[j] * z.re[b] + z.im[j] * z.im[b]) / mb : 0;
      const c = 0.5 * (0.5 * (da + 1) + 0.5 * (db + 1));
      this.localCoherence[j] = c;
      cohSum += c;
    }

    // --- radial organ -------------------------------------------------------
    // Node j's ray walks outward along the golden spiral: sample i sits at
    // index j + round(r_i · n · φ⁻¹) (mod n). Every node therefore analyses a
    // different, deterministic slice of the rung — no shared surrogate ray.
    const grid = this.radialBasis.grid;
    const R = this.radialBasis.vectors.length;
    let radPeak = 0;
    let clipped = 0;
    for (let j = 0; j < n; j++) {
      let rayMax = 0;
      for (let i = 0; i < grid.n; i++) {
        const off = Math.round(grid.r[i] * n * PHI_INV);
        const a = this.amp[(j + off) % n];
        this.ray[i] = a;
        if (a > rayMax) rayMax = a;
      }
      radialAnalyze(this.radialBasis, this.ray, this.coefRow);
      const row = j * this.orders;
      // Reconstruction is read at the golden-section radius, not at r → 0: the
      // quadrature weight r² vanishes at the origin, so a truncated Bessel sum
      // is unconstrained there and overshoots by 3x (measured). At r = φ⁻¹ the
      // weight is real and the truncated sum tracks the ray.
      let v = 0;
      for (let k = 0; k < R; k++) {
        const c = this.coefRow[k];
        this.radialCoef[row + k] = c;
        v += c * this.radialBasis.vectors[k][this.readIndex];
      }
      for (let k = R; k < this.orders; k++) this.radialCoef[row + k] = 0;
      // A truncated Bessel expansion can overshoot at r → 0 (Gibbs). The raw
      // value is reported as-is, but what is handed back to the dynamics is
      // saturated at the ray's own sup-norm, which is what makes the convex
      // blend in applyRadial a genuine bound on ‖R‖∞ rather than a hope.
      const av = Math.abs(v);
      let vFed = v;
      if (av > rayMax) {
        vFed = v < 0 ? -rayMax : rayMax;
        clipped++;
      }
      // carry the scalar reconstruction on the node's own phase so the organ
      // returns a complex field the cell can actually consume
      const m = this.amp[j];
      if (m > 0) {
        this.radialField.re[j] = (vFed * z.re[j]) / m;
        this.radialField.im[j] = (vFed * z.im[j]) / m;
      } else {
        this.radialField.re[j] = 0;
        this.radialField.im[j] = 0;
      }
      if (av > radPeak) radPeak = av;
    }

    let receptors = 0;
    for (let j = 0; j < n; j++)
      if (this.senseGain[j] > 0 && this.senseModality[j] !== MODALITY_NONE) receptors++;

    this.last = {
      age: 0,
      meanEigenResidual: resSum / n,
      maxEigenResidual: resMax,
      meanParticipation: prSum / n,
      meanLocalCoherence: cohSum / n,
      radialPeak: radPeak,
      radialGramDefect: this.radialBasis.gramDefect,
      radialBands: this.radialBasis.vectors.length,
      radialLadderOffset: this.radialLadderOffset,
      radialClipped: clipped,
      receptors,
    };
    return this.last;
  }

  /**
   * Blend the radial reconstruction into the resonance slot:
   *
   *   R_j ← (1 − g) · R_j + g · radial_j,   g = radialGain ∈ [0, φ⁻¹]
   *
   * A convex blend, so ‖R‖∞ never exceeds max(‖m‖∞, ‖radial‖∞) and the δ·R
   * drive term stays inside the envelope the ISS certificate already bounds.
   * At g = 0 this is a no-op and the digest is untouched.
   */
  applyRadial(R: CField): void {
    const g = this.radialGain;
    if (g <= 0) return;
    const h = 1 - g;
    for (let j = 0; j < this.n; j++) {
      R.re[j] = h * R.re[j] + g * this.radialField.re[j];
      R.im[j] = h * R.im[j] + g * this.radialField.im[j];
    }
  }

  /** Per-node receptor scaling applied to a staged sensory field, in place. */
  applyReceptors(s: CField): void {
    const k = Math.min(this.n, s.n);
    for (let j = 0; j < k; j++) {
      const g = this.senseGain[j];
      if (g === 1) continue;
      s.re[j] *= g;
      s.im[j] *= g;
    }
  }
}

/** Bytes a bank of `n` nodes at `orders` radial orders will allocate. */
export function organBytes(n: number, orders = 8): number {
  const perNode = 8 + 4 + 8 * orders + 16 + 8 + 8 + 8 + 1 + 8;
  return n * perNode + orders * orders * 8 + orders * 16;
}

/** φ-ladder wavenumber of radial order `i` on rung `n` — telemetry helper. */
export function radialWavenumber(order: number, rung = 0): number {
  return Math.PI * dpow(PHI, rung + order);
}
