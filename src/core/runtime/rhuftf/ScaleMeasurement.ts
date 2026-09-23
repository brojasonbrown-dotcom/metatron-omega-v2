/**
 * RHUFT-F per-scale measurement interface.  Phase 4 · Step 1 infrastructure.
 *
 * Each scale n ∈ [0..8] gets a `ScaleMeasurement` implementation that:
 *   1. Reads live amplitudes from ShadowStateTape (never mutates ψ).
 *   2. Compares against Phase-3 stability targets in
 *      `docs/v13_rebuild/scales/n<k>_stability.md`.
 *   3. Writes only to `m` (memory manifestation) and `gamma` (diagnostics)
 *      channels of the FieldStateN. `psi`, `psiHat`, `u`, `y` are read-only
 *      to this module.
 *
 * The registry lets the metric bank + panels iterate a stable enumeration.
 * Registration is opt-in per scale via `FLAG_RHUFTF_FRAMEWORK_<n>`; when
 * off, the scale simply doesn't appear in the registry.
 */

import type { FieldStateN } from '@metatron/field-kernel-core';

export interface ScaleMeasurementResult {
  readonly scale: number;
  /** Closure vector deviation ‖y − target‖². NaN when target not injected. */
  readonly closureResidual: number;
  /** Scalar closure score in [candidate 0..1] — spec-defined per scale. */
  readonly closureScore: number;
  /** Symmetry witness: 1 = candidate invariant holds, 0 = broken. */
  readonly invariantScore: number;
  /** Free-form per-scale diagnostics (written into γ). */
  readonly gamma: Float64Array;
}

export interface ScaleMeasurementContext {
  readonly tSeconds: number;
  readonly carrierHz: number;
  readonly tick: number;
}

export interface ScaleMeasurement {
  readonly scale: number;
  readonly name: string;
  readonly nodes: number;
  /**
   * Compute measurement result for the given state. MUST NOT mutate
   * `state.psi`, `state.psiHat`, `state.u`, or `state.y`. MAY write to
   * `state.m` and `state.gamma`. Returns the result for the metric bank.
   */
  measure(state: FieldStateN, ctx: ScaleMeasurementContext): ScaleMeasurementResult;
}

// ───────────────────────── scale ↔ sensor binding ─────────────────────────
//
// A rung is a SCALE of spacetime only if something actually reads that scale.
// Naming a rung "Galactic" does not sample a band; a microphone does. So every
// rung declares either a physical passband [fLo, fHi] in Hz or `null`, and the
// binding step marks it `measured` only when a real frontend covers that band
// AND satisfies Nyquist on it. Everything else is `inferred` and MUST NOT be
// scored as if it had been observed.

/** Physical passband of a rung, in Hz. */
export interface ScaleBand {
  readonly fLo: number;
  readonly fHi: number;
}

/**
 * A real sensory frontend's passband. `sampleRateHz` is omitted for
 * integrating (non-sampled) detectors such as the retina, where the Nyquist
 * criterion does not apply to the carrier frequency.
 */
export interface SensorPassband {
  readonly sensor: string;
  readonly fLo: number;
  readonly fHi: number;
  readonly sampleRateHz?: number;
}

export type ScaleProvenance = 'measured' | 'inferred';

export interface ScaleBinding {
  readonly scale: number;
  readonly nodes: number;
  readonly band: ScaleBand | null;
  readonly sensor: string | null;
  readonly provenance: ScaleProvenance;
  /** log₂(fHi/fLo) — band width in octaves. NaN when no band is declared. */
  readonly octaves: number;
  /** log_φ(fHi/fLo) — band width in φ-rungs. NaN when no band is declared. */
  readonly phiRungs: number;
  /** True when the bound sensor samples fast enough for the band's top edge. */
  readonly nyquistOk: boolean;
}

const LN_PHI_BAND = Math.log(1.6180339887498948482045868343656381);

/** Band width in octaves. NaN for a null/degenerate band. */
export function bandOctaves(band: ScaleBand | null): number {
  if (!band || !(band.fLo > 0) || !(band.fHi > 0)) return NaN;
  return Math.log2(band.fHi / band.fLo);
}

/** Band width in φ-rungs — the ladder's own unit. */
export function bandPhiRungs(band: ScaleBand | null): number {
  if (!band || !(band.fLo > 0) || !(band.fHi > 0)) return NaN;
  return Math.log(band.fHi / band.fLo) / LN_PHI_BAND;
}

/** Sensor covers the band edge-to-edge. */
export function sensorCovers(s: SensorPassband, band: ScaleBand): boolean {
  return s.fLo <= band.fLo && s.fHi >= band.fHi;
}

/** Nyquist holds: a sampled channel needs fs ≥ 2·fHi. Unsampled → true. */
export function sensorNyquistOk(s: SensorPassband, band: ScaleBand): boolean {
  if (s.sampleRateHz === undefined) return true;
  return Number.isFinite(s.sampleRateHz) && s.sampleRateHz >= 2 * band.fHi;
}

/**
 * Bind rungs to frontends. Deterministic: the first sensor in `sensors` that
 * both covers the band and satisfies Nyquist wins, so the result is stable
 * under repeated calls with the same inputs.
 */
export function bindScaleSensors(
  shapes: readonly { scale: number; nodes: number }[],
  bands: readonly (ScaleBand | null)[],
  sensors: readonly SensorPassband[],
): readonly ScaleBinding[] {
  return shapes.map((sh) => {
    const band = bands[sh.scale] ?? null;
    const octaves = bandOctaves(band);
    const phiRungs = bandPhiRungs(band);
    if (!band) {
      return {
        scale: sh.scale, nodes: sh.nodes, band: null, sensor: null,
        provenance: 'inferred' as const, octaves, phiRungs, nyquistOk: false,
      };
    }
    const hit = sensors.find((s) => sensorCovers(s, band) && sensorNyquistOk(s, band));
    return {
      scale: sh.scale,
      nodes: sh.nodes,
      band,
      sensor: hit ? hit.sensor : null,
      provenance: hit ? ('measured' as const) : ('inferred' as const),
      octaves,
      phiRungs,
      nyquistOk: hit ? sensorNyquistOk(hit, band) : false,
    };
  });
}

// ──────────────── effective dimension of a rung's spacetime ────────────────
//
// A rung is not "a scale" because it is named one. A rung is a scale of
// spacetime when the discrete manifold it carries HAS a measurable dimension
// at that scale — and that dimension is computable exactly, with no fitting
// and no appeal to resemblance.
//
// The rung's manifold is the (R, r) torus the ladder already instantiates
// (major radius R = φ·r, principle ③). Discretise it as a p × q periodic grid
// and its graph Laplacian is circulant in both cycles, so the spectrum is
// CLOSED FORM — no iteration, no tolerance:
//
//     λ(a,b) = (4/h_u²)·sin²(πa/p) + (4/h_v²)·sin²(πb/q)
//     h_u = 2πR/p     h_v = 2πr/q      a ∈ [0,p)   b ∈ [0,q)
//
// The heat trace Z(t) = Σ e^{−tλ} then gives the SPECTRAL DIMENSION, the
// standard scale-dependent dimension of a diffusing probe:
//
//     d_s(t) = −2 · d ln Z(t) / d ln t
//
// This is the honest answer to "what is the dimension of spacetime at this
// scale": it is a function of the probe scale √t, not a constant.
//   • √t below the grid spacing  → d_s → 0   (the lattice is a point set;
//     nothing below h is represented, and the measurement says so)
//   • grid spacing ≪ √t ≪ 2πr    → d_s → 2   (both cycles are resolved)
//   • 2πr ≪ √t ≪ 2πR             → d_s → 1   (the minor cycle has closed;
//     dimensional reduction, not an assumption but a consequence of R = φr)
//   • √t above 2πR               → d_s → 0   (finite volume; the whole torus
//     is one point to the probe)
//
// Consequence for THIS ladder, and it is a negative result reported plainly:
// a rung with 7–55 nodes has fewer than two decades between h and 2πR, so its
// dimension plateau never reaches 2. Coarse rungs cannot represent a
// two-dimensional scale of spacetime, and `plateauDim` measures exactly how
// far short they fall.

const PHI_SM = 1.6180339887498948482045868343656381;
const LN_PHI_SM = Math.log(PHI_SM);

/** p × q periodic discretisation of the (R, r) torus. */
export interface TorusGrid {
  readonly p: number;
  readonly q: number;
  /** p·q — nodes actually used (≤ the rung's budget). */
  readonly used: number;
  /** Node budget the grid was chosen from. */
  readonly budget: number;
  /** p/q as realised — compare against the requested aspect. */
  readonly aspect: number;
}

/**
 * Largest p × q ≤ `budget` whose aspect p/q is closest to `aspect`.
 * Deterministic: maximise p·q first, then minimise |p/q − aspect|, then
 * prefer the smaller q. q = 1 is admitted — a single-cycle rung is a ring,
 * and its measured dimension should come out as 1, not be forbidden.
 */
export function torusGrid(budget: number, aspect: number = PHI_SM): TorusGrid {
  const b = Math.floor(budget);
  if (!(b >= 1)) throw new RangeError(`torusGrid: budget must be >= 1, got ${budget}`);
  let best = { p: b, q: 1, used: b, aspect: b };
  let bestUsed = -1;
  let bestErr = Infinity;
  for (let q = 1; q <= b; q++) {
    const p = Math.floor(b / q);
    if (p < 1) break;
    const used = p * q;
    const err = Math.abs(p / q - aspect);
    if (used > bestUsed || (used === bestUsed && err < bestErr)) {
      bestUsed = used;
      bestErr = err;
      best = { p, q, used, aspect: p / q };
    }
  }
  return Object.freeze({ ...best, budget: b });
}

/**
 * Closed-form Laplacian spectrum of the grid on the (R, r) torus, ascending.
 * Units are those of R and r; only the ratio R/r and the grid shape affect
 * the dimension profile, so the ladder's unrepresentable absolute radii
 * (φ^293 ℓ_P) never enter.
 */
export function torusSpectrum(g: TorusGrid, R: number = PHI_SM, r: number = 1): Float64Array {
  if (!(R > 0) || !(r > 0)) throw new RangeError('torusSpectrum: R and r must be > 0');
  const hu = (2 * Math.PI * R) / g.p;
  const hv = (2 * Math.PI * r) / g.q;
  const cu = 4 / (hu * hu);
  const cv = 4 / (hv * hv);
  const out = new Float64Array(g.p * g.q);
  let i = 0;
  for (let a = 0; a < g.p; a++) {
    const su = Math.sin((Math.PI * a) / g.p);
    const lu = cu * su * su;
    for (let b = 0; b < g.q; b++) {
      const sv = Math.sin((Math.PI * b) / g.q);
      out[i++] = lu + cv * sv * sv;
    }
  }
  return out.sort();
}

/** Heat trace Z(t) = Σ_k e^{−t λ_k}. Z(0) = number of modes, exactly. */
export function heatTrace(spectrum: Readonly<Float64Array>, t: number): number {
  if (!(t >= 0) || !Number.isFinite(t)) return NaN;
  let z = 0;
  for (let k = 0; k < spectrum.length; k++) z += Math.exp(-t * spectrum[k]);
  return z;
}

/**
 * Spectral dimension d_s(t) = −2 d ln Z / d ln t, by a centred difference in
 * ln t with step `h` (default ln φ — the ladder's own logarithmic unit).
 * NaN when either shifted trace underflows to zero, rather than a fabricated
 * finite dimension.
 */
export function spectralDimension(
  spectrum: Readonly<Float64Array>,
  t: number,
  h: number = LN_PHI_SM,
): number {
  if (!(t > 0) || !(h > 0)) return NaN;
  const zp = heatTrace(spectrum, t * Math.exp(h));
  const zm = heatTrace(spectrum, t * Math.exp(-h));
  if (!(zp > 0) || !(zm > 0)) return NaN;
  return (-2 * (Math.log(zp) - Math.log(zm))) / (2 * h);
}

export interface DimensionSample {
  /** Diffusion time. */
  readonly t: number;
  /** Probe length √t, in the same units as R and r. */
  readonly probe: number;
  readonly heatTrace: number;
  readonly dim: number;
}

export interface DimensionProfile {
  readonly grid: TorusGrid;
  /** Grid spacings (major, minor) — the lower resolution limit. */
  readonly hu: number;
  readonly hv: number;
  /** Diffusion-time window actually swept, φ-spaced. */
  readonly tLo: number;
  readonly tHi: number;
  readonly samples: readonly DimensionSample[];
  /** Flattest run of `plateauRun` samples: mean dimension there. */
  readonly plateauDim: number;
  /** Probe length at the centre of that run. */
  readonly plateauProbe: number;
  /** Probe length where d_s falls through 1.5 — the 2→1 reduction. NaN if never. */
  readonly reduction2to1: number;
  /** Probe length where d_s falls through 0.5 — finite-volume cutoff. NaN if never. */
  readonly cutoff1to0: number;
  /** Largest dimension the rung ever resolves. */
  readonly maxDim: number;
}

const PLATEAU_RUN = 5;

/**
 * Sweep t over φ-spaced steps spanning the grid spacing to the torus
 * circumference (with a φ⁵ margin each side) and report the dimension profile.
 */
export function dimensionProfile(
  grid: TorusGrid,
  R: number = PHI_SM,
  r: number = 1,
  h: number = LN_PHI_SM,
): DimensionProfile {
  const spectrum = torusSpectrum(grid, R, r);
  const hu = (2 * Math.PI * R) / grid.p;
  const hv = (2 * Math.PI * r) / grid.q;
  const hMin = Math.min(hu, hv);
  const tLo = (hMin * hMin) / Math.pow(PHI_SM, 5);
  const tHi = Math.pow(2 * Math.PI * R, 2) * Math.pow(PHI_SM, 5);
  const samples: DimensionSample[] = [];
  for (let t = tLo; t <= tHi; t *= Math.exp(h)) {
    samples.push(Object.freeze({
      t,
      probe: Math.sqrt(t),
      heatTrace: heatTrace(spectrum, t),
      dim: spectralDimension(spectrum, t, h),
    }));
  }

  // Flattest window: minimal total |Δdim| over a run of PLATEAU_RUN samples.
  let plateauDim = NaN;
  let plateauProbe = NaN;
  let bestVar = Infinity;
  for (let i = 0; i + PLATEAU_RUN <= samples.length; i++) {
    let flat = 0;
    let sum = 0;
    let ok = true;
    for (let k = 0; k < PLATEAU_RUN; k++) {
      const d = samples[i + k].dim;
      if (!Number.isFinite(d)) { ok = false; break; }
      sum += d;
      if (k > 0) flat += Math.abs(d - samples[i + k - 1].dim);
    }
    if (!ok) continue;
    const mean = sum / PLATEAU_RUN;
    // Prefer flat AND high: a flat run at d≈0 is the trivial tail, not a plateau.
    const score = flat - mean * 1e-6;
    if (mean > 0.25 && score < bestVar) {
      bestVar = score;
      plateauDim = mean;
      plateauProbe = samples[i + ((PLATEAU_RUN - 1) >> 1)].probe;
    }
  }

  const maxDim = samples.reduce((m, s) => (Number.isFinite(s.dim) && s.dim > m ? s.dim : m), 0);
  return Object.freeze({
    grid, hu, hv, tLo, tHi,
    samples: Object.freeze(samples),
    plateauDim, plateauProbe,
    reduction2to1: crossDown(samples, 1.5),
    cutoff1to0: crossDown(samples, 0.5),
    maxDim,
  });
}

/** Probe length where the profile last falls through `level`, log-interpolated. */
function crossDown(samples: readonly DimensionSample[], level: number): number {
  let hit = NaN;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1].dim;
    const b = samples[i].dim;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a > level && b <= level) {
      const f = (a - level) / (a - b);
      const lp = Math.log(samples[i - 1].probe) * (1 - f) + Math.log(samples[i].probe) * f;
      hit = Math.exp(lp);
    }
  }
  return hit;
}

/** Per-rung dimension record, joined to the sensor binding. */
export interface ScaleDimension {
  readonly scale: number;
  readonly nodes: number;
  readonly provenance: ScaleProvenance;
  readonly grid: TorusGrid;
  /** Nodes the grid could not use (budget − p·q) — wasted allocation. */
  readonly unusedNodes: number;
  readonly plateauDim: number;
  readonly plateauProbe: number;
  readonly maxDim: number;
  readonly reduction2to1: number;
  readonly cutoff1to0: number;
  /** 2 − plateauDim, clamped at 0: dimension the rung fails to represent. */
  readonly dimensionDeficit: number;
}

/**
 * Measure every rung's effective dimension. `bindings` supplies node counts
 * and provenance so the deck can show, per rung, both what reads the scale
 * and what dimension the rung can actually carry.
 */
export function measureScaleDimensions(
  bindings: readonly ScaleBinding[],
  aspect: number = PHI_SM,
): readonly ScaleDimension[] {
  return bindings.map((b) => {
    const grid = torusGrid(b.nodes, aspect);
    const prof = dimensionProfile(grid, aspect, 1);
    return Object.freeze({
      scale: b.scale,
      nodes: b.nodes,
      provenance: b.provenance,
      grid,
      unusedNodes: b.nodes - grid.used,
      plateauDim: prof.plateauDim,
      plateauProbe: prof.plateauProbe,
      maxDim: prof.maxDim,
      reduction2to1: prof.reduction2to1,
      cutoff1to0: prof.cutoff1to0,
      dimensionDeficit: Number.isFinite(prof.plateauDim) ? Math.max(0, 2 - prof.plateauDim) : NaN,
    });
  });
}

class ScaleMeasurementRegistry {
  private readonly byScale = new Map<number, ScaleMeasurement>();

  register(m: ScaleMeasurement): void {
    if (this.byScale.has(m.scale)) {
      throw new Error(`ScaleMeasurement already registered for scale ${m.scale}`);
    }
    this.byScale.set(m.scale, m);
  }

  get(scale: number): ScaleMeasurement | undefined {
    return this.byScale.get(scale);
  }

  list(): readonly ScaleMeasurement[] {
    return Array.from(this.byScale.values()).sort((a, b) => a.scale - b.scale);
  }

  clear(): void { this.byScale.clear(); }
}

export const scaleMeasurementRegistry = new ScaleMeasurementRegistry();
