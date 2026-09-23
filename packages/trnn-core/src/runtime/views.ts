/**
 * Ω-P5 — read-only views over a live MultiTorusEngine.
 *
 * The snapshot bus carries scalars only; anything wide (a field frame, the
 * channel matrix, a spectral report) is pulled on demand at the rate the deck
 * that needs it can actually consume. Nothing here mutates the engine, and
 * nothing here invents a value: every field is either read from the engine or
 * computed from engine state by a documented transform.
 */

import type { MultiTorusEngine } from '../engine/MultiTorusEngine';
import { couplingWeight, emittedMass } from '../web/coupling';
import { FLUX_SINK, type FluxEntry } from '../web/fluxLedger';
import { SpectralSite, type PlaneReport } from '../spectral/site';
import { largestFibonacciAtMost } from '../core/fibonacci';
import { datan2 } from '../core/dmath';
import { scanRung, type RungScanReport } from '../sense/scan';

export interface LadderRungView {
  readonly rank: number;
  readonly n: number;
  readonly nodes: number;
  readonly lucasResidue: number;
  readonly logRadius: number;
  readonly logMinorRadius: number;
  readonly logTau: number;
  readonly qrf: number;
  readonly dense: boolean;
  /** Multi-rate clock stride: this rung steps once every `stride` web ticks. */
  readonly stride: number;
  /** Row sum of the channel matrix for this rung (mass it emits). */
  readonly emitted: number;
}

export interface WebDescription {
  readonly size: number;
  readonly band: number;
  readonly rowSumDefect: number;
  /** Row-major size×size channel weights, w[to][from]. */
  readonly weights: number[];
}

export interface EngineDescription {
  readonly rungs: readonly LadderRungView[];
  readonly web: WebDescription;
}

export interface FieldFrame {
  readonly rank: number;
  readonly n: number;
  readonly nodes: number;
  /** Every `stride`-th node is sampled; 1 means the full field. */
  readonly stride: number;
  /** Major angle of each sampled node, radians. */
  readonly u: number[];
  /** Minor angle, radians (fibonacci lattice keeps the unwrapped phase). */
  readonly v: number[];
  /** |z| per sampled node. */
  readonly amp: number[];
  /** arg z per sampled node, radians in (-π, π]. */
  readonly phase: number[];
  readonly peak: number;
  readonly mean: number;
  /** φ-weighted spectral signature carried by the rung's own tape. */
  readonly signature: number[];
  readonly digest: string;
  readonly tick: number;
}

export interface WebView {
  readonly tick: number;
  /** Net ledger position per rank (positive = net receiver). */
  readonly net: number[];
  /** Net mass parked in the closure sink. */
  readonly sink: number;
  readonly turnover: number;
  readonly imbalance: number;
  readonly netImbalance: number;
  readonly entries: FluxEntry[];
  readonly orderingViolations: number;
}

export interface SpectralView {
  readonly rank: number;
  readonly n: number;
  /**
   * How the torus field reached the spectral planes. The shell and radial
   * quadratures are separate grids, so the rung's |z| profile is resampled
   * onto them by index-proportional linear interpolation — stated here rather
   * than hidden, because the roundtrip error below is a property of the plane,
   * not of the resampling.
   */
  readonly source: string;
  readonly shellPoints: number;
  readonly shell: PlaneReport;
  readonly radial: PlaneReport;
  /** φ-weighted 13-slot signature of the shell coefficients. */
  readonly signature: number[];
}

export function describeEngine(engine: MultiTorusEngine): EngineDescription {
  const strides = engine.clockStrides();
  const size = engine.rungs.length;
  const weights: number[] = new Array(size * size);
  for (let to = 0; to < size; to++) {
    for (let from = 0; from < size; from++) {
      weights[to * size + from] = couplingWeight(engine.coupling, to, from);
    }
  }
  return {
    rungs: engine.rungs.map((r, rank) => ({
      rank,
      n: r.n,
      nodes: engine.engines[rank].nodes,
      lucasResidue: r.lucasResidue,
      logRadius: r.logRadius,
      logMinorRadius: r.logMinorRadius,
      logTau: r.logTau,
      qrf: r.qrf,
      dense: r.dense,
      stride: strides[rank] ?? 1,
      emitted: emittedMass(engine.coupling, rank),
    })),
    web: {
      size,
      band: engine.coupling.band,
      rowSumDefect: engine.coupling.rowSumDefect,
      weights,
    },
  };
}

/** One rung's field, decimated to at most `maxSamples` nodes. */
export function fieldFrame(engine: MultiTorusEngine, rank: number, maxSamples = 610): FieldFrame {
  const eng = engine.engines[rank];
  if (!eng) throw new RangeError(`fieldFrame: rank ${rank} out of range`);
  const snap = eng.snapshot();
  const nodes = eng.nodes;
  const stride = Math.max(1, Math.ceil(nodes / Math.max(1, maxSamples)));
  const u: number[] = [];
  const v: number[] = [];
  const amp: number[] = [];
  const phase: number[] = [];
  let peak = 0;
  let sum = 0;
  for (let j = 0; j < nodes; j += stride) {
    const re = snap.z.re[j];
    const im = snap.z.im[j];
    const a = Math.sqrt(re * re + im * im);
    if (a > peak) peak = a;
    sum += a;
    u.push(eng.lattice.u[j]);
    v.push(eng.lattice.v[j]);
    amp.push(a);
    phase.push(datan2(im, re));
  }
  return {
    rank,
    n: engine.rungs[rank].n,
    nodes,
    stride,
    u,
    v,
    amp,
    phase,
    peak,
    mean: amp.length > 0 ? sum / amp.length : 0,
    signature: Array.from(snap.signature),
    digest: snap.digest,
    tick: snap.tick,
  };
}

export function webView(engine: MultiTorusEngine, tail = 24): WebView {
  const size = engine.rungs.length;
  const net: number[] = new Array(size);
  for (let i = 0; i < size; i++) net[i] = engine.ledger.net(i);
  return {
    tick: engine.currentTick(),
    net,
    sink: engine.ledger.net(FLUX_SINK),
    turnover: engine.ledger.turnover(),
    imbalance: engine.ledger.imbalance(),
    netImbalance: engine.ledger.netImbalance(),
    entries: engine.ledger.tail(tail),
    orderingViolations: engine.ordering.count(),
  };
}

/** Lazily built per shell width — the bases are expensive and reusable. */
const siteCache = new Map<number, SpectralSite>();

function siteFor(points: number): SpectralSite {
  let s = siteCache.get(points);
  if (!s) {
    s = new SpectralSite({ shellPoints: points });
    siteCache.set(points, s);
  }
  return s;
}

/** Resample by index-proportional linear interpolation (deterministic). */
function resample(src: number[] | Float64Array, m: number): Float64Array {
  const out = new Float64Array(m);
  const nsrc = src.length;
  if (nsrc === 0) return out;
  if (nsrc === 1) {
    out.fill(src[0]);
    return out;
  }
  for (let i = 0; i < m; i++) {
    const x = (i * (nsrc - 1)) / Math.max(1, m - 1);
    const j = Math.min(nsrc - 2, Math.floor(x));
    const f = x - j;
    out[i] = src[j] * (1 - f) + src[j + 1] * f;
  }
  return out;
}

export function spectralView(engine: MultiTorusEngine, rank: number): SpectralView {
  const eng = engine.engines[rank];
  if (!eng) throw new RangeError(`spectralView: rank ${rank} out of range`);
  const snap = eng.snapshot();
  const amp = new Float64Array(eng.nodes);
  for (let j = 0; j < eng.nodes; j++) amp[j] = Math.sqrt(snap.z.re[j] * snap.z.re[j] + snap.z.im[j] * snap.z.im[j]);

  // Shell width must be Fibonacci (Law 2.2) and no wider than the rung itself,
  // otherwise the "roundtrip" would be measuring interpolation, not the plane.
  const points = Math.max(13, Math.min(233, largestFibonacciAtMost(eng.nodes)));
  const site = siteFor(points);
  const onShell = resample(amp, site.sphere.shell.n);
  const onRadial = resample(amp, site.radial.grid.n);
  return {
    rank,
    n: engine.rungs[rank].n,
    source: `|z| of rung n=${engine.rungs[rank].n} (${eng.nodes} nodes) resampled linearly onto the ${site.sphere.shell.n}-point Fibonacci shell and the ${site.radial.grid.n}-node radial quadrature`,
    shellPoints: site.sphere.shell.n,
    shell: site.shellReport(onShell),
    radial: site.radialReport(onRadial),
    signature: Array.from(site.signature(onShell)),
  };
}

/**
 * N1 — the six-section scan of one toroid. Read-only; the engine is neither
 * advanced nor mutated. Returns null when the rank is off the ladder.
 */
export function rungScan(engine: MultiTorusEngine, rank: number): RungScanReport | null {
  const e = engine.engines[rank];
  if (!e) return null;
  return scanRung(e, rank);
}

export type { RungScanReport } from '../sense/scan';
