/**
 * Ω-COG — the three cold edges of the atlas, owned by one driver.
 *
 * Three of the twelve atlas modules were structurally reachable but never
 * driven, because every path into them was pull-based and mounted on a deck:
 *
 *   engine.field ──▶ engine.spectral      only while the SPECTRAL deck was open
 *   knowledge.corpus ──▶ knowledge.latent only on a manual button
 *   knowledge.corpus ──▶ knowledge.field  only once, at hydrate, on an empty corpus
 *
 * This driver closes all three and adds nothing else:
 *
 *   C1  spectral scan of the warmest rung at a φ cadence ──▶ drift / residual /
 *       entropy channels for the analysis spine, and an L5 journal record when
 *       a scan is structurally salient (drift above the measured running band).
 *   C2  latent space trained at idle once the corpus is large enough, and
 *       retrained when it has grown materially since the last build.
 *   C3  field-signature eigenbasis warmed when it is missing, and the coverage
 *       sweep resumed whenever acquisition adds chunks the basis has not seen.
 *
 * Every number published here is measured. When a source has not produced a
 * new reading the driver publishes nothing rather than repeating itself — the
 * same rule the analysis sampler enforces, for the same reason.
 */

import { getOmegaRuntime, type OmegaState } from './omegaRuntime';
import { getMemoryRuntime } from './memoryRuntime';
import { getKnowledgeRuntime } from './knowledgeRuntime';
import type { SpectralView } from '@/core/omega/omegaProtocol';
import { PHI } from '@/core/constants/WolframVerified';
import { operator } from '@metatron/trnn-core';
import { modeLadder } from '@metatron/trnn-core';

/** Spectral pull cadence: 1000/φ² ms ≈ 382 ms (≈2.6 Hz). */
export const SPECTRAL_PERIOD_MS = 1000 / (PHI * PHI);
/** Knowledge maintenance cadence: φ⁷ s ≈ 29 s. Idle work, never per-frame. */
export const KNOWLEDGE_PERIOD_MS = 29_034;
/** Minimum chunks before a latent build is meaningful at all. */
export const LATENT_MIN_CHUNKS = 32;
/** Corpus growth factor that justifies a retrain. */
export const LATENT_REGROW = 1.25;
/** Samples of drift required before the salience band is a measurement. */
export const SALIENCE_WARMUP = 8;
/** Salience threshold in standard deviations above the running mean drift. */
export const SALIENCE_SIGMA = 2;

export interface SpectralMetrics {
  /** L2 distance between consecutive φ-weighted 13-slot signatures. */
  readonly drift: number;
  /** Worst plane roundtrip residual of this pass — the honesty of the basis. */
  readonly residual: number;
  /** Normalized Shannon entropy of the signature energy distribution, [0,1]. */
  readonly entropy: number;
  /**
   * Ω-OPERATOR N2′ — solenoidal fraction of the energy current on the φ mode
   * graph. Unlike drift (which any louder driver inflates) this is a ratio of
   * two parts of the same current, so it cannot be bought with amplitude.
   * NaN on the first pass, and NaN whenever the current is degenerate.
   */
  readonly circulation: number;
  /**
   * Ω-CONSISTENCY K2 — Sobolev roughness h1/l2 of the change between passes.
   * 1 means the change is pure amplitude; larger means the change lives in the
   * derivative, i.e. the *shape* of the spectrum moved. NaN when incomparable.
   */
  readonly roughness: number;
  /**
   * Spectral tail fraction of this pass's signature — energy above the low φ
   * band. High leakage means the window is being read across a discontinuity.
   */
  readonly leakage: number;
  /**
   * Measured gain of Fourier continuation on this window (rawTail −
   * continuedTail). Positive means a continued read would be cleaner; this is
   * a measurement of the seam, never an assumption about it.
   */
  readonly continuity: number;
  /**
   * Gated-recurrence persistence: relative distance between the cell's slow
   * state and this pass's magnitudes. 0 means the field is exactly what memory
   * predicted; 1 means it is entirely new. NaN before the cell has a frame.
   */
  readonly persistence: number;
}

/** Signature energy entropy, normalized by log(width) so it lands in [0,1]. */
export function signatureEntropy(sig: readonly number[]): number {
  let total = 0;
  for (const v of sig) {
    const a = Math.abs(v);
    if (Number.isFinite(a)) total += a;
  }
  if (!(total > 0)) return 0;
  let h = 0;
  for (const v of sig) {
    const p = Math.abs(v) / total;
    if (p > 0) h -= p * Math.log(p);
  }
  const width = sig.length;
  return width > 1 ? h / Math.log(width) : 0;
}

/** Real signature as a complex field, so the Sobolev norms can grade it. */
function asField(sig: readonly number[]): { re: Float64Array; im: Float64Array; n: number } {
  const n = sig.length;
  const re = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Number.isFinite(sig[i]) ? sig[i] : 0;
  return { re, im: new Float64Array(n), n };
}

/** Low band kept before the tail is counted: the φ² split of the width. */
function keepBand(width: number): number {
  return Math.max(1, Math.floor(width / (PHI * PHI)));
}

/**
 * Measure one spectral pass against the previous one. With no previous pass the
 * drift is NaN — an unmeasurable quantity, not zero.
 *
 * `cell` is an optional gated-recurrence memory over the same width; when given
 * it is advanced by this pass and yields the persistence witness. It observes
 * only — nothing downstream of it steers the engine.
 */
export function spectralMetrics(
  prev: SpectralView | null,
  next: SpectralView,
  cell?: {
    modes: number;
    state: Float64Array;
    frames: number;
    step(x: ArrayLike<number>): Float64Array;
  } | null,
): SpectralMetrics {
  const residual = Math.max(next.shell.roundtrip, next.radial.roundtrip);
  const entropy = signatureEntropy(next.signature);
  const width = next.signature.length;
  let drift = NaN;
  let circulation = NaN;
  let roughness = NaN;
  // Both comparisons need the same premise: two passes of equal width on the
  // same rung. Different rungs are different instruments, not a change.
  const comparable = prev !== null && prev.signature.length === width && prev.rank === next.rank;
  if (comparable && prev) {
    let sum = 0;
    for (let i = 0; i < width; i++) {
      const d = next.signature[i] - prev.signature[i];
      sum += d * d;
    }
    drift = Math.sqrt(sum);
    const r = operator.modeCirculation(prev.signature, next.signature, ladderFor(width));
    if (r.valid) circulation = r.circulation;
    // Ω-CONSISTENCY K2 — graded error. Exact spectral derivatives, so this
    // separates "the same shape, louder" from "a different shape".
    const g = operator.gradedError(asField(next.signature), asField(prev.signature));
    if (Number.isFinite(g.roughness)) roughness = g.roughness;
  }

  // Seam honesty of this window, measured both ways on the same data.
  let leakage = NaN;
  let continuity = NaN;
  if (width >= 4) {
    const verdict = operator.assessContinuation(next.signature, undefined, keepBand(width));
    leakage = verdict.rawTail;
    continuity = verdict.improvement;
  }

  // Gated recurrence over the magnitudes — a slow predictor of the spectrum.
  let persistence = NaN;
  if (cell && cell.modes === width) {
    const mag = new Float64Array(width);
    for (let i = 0; i < width; i++) mag[i] = Math.abs(next.signature[i]);
    const had = cell.frames > 0;
    const prior = had ? Float64Array.from(cell.state) : null;
    cell.step(mag);
    if (prior) {
      let num = 0;
      let den = 0;
      for (let i = 0; i < width; i++) {
        const d = mag[i] - prior[i];
        num += d * d;
        den += mag[i] * mag[i];
      }
      persistence = den > 0 ? Math.min(1, Math.sqrt(num / den)) : 0;
    }
  }

  return { drift, residual, entropy, circulation, roughness, leakage, continuity, persistence };
}

/** The mode ladder is a pure function of width; recomputing it per pass is waste. */
const LADDER_CACHE = new Map<number, ReturnType<typeof modeLadder>>();
function ladderFor(width: number): ReturnType<typeof modeLadder> {
  let l = LADDER_CACHE.get(width);
  if (!l) {
    l = modeLadder(width);
    LADDER_CACHE.set(width, l);
  }
  return l;
}

/** Welford accumulator over drift, so the salience band is measured not guessed. */
export class DriftBand {
  private n = 0;
  private mean = 0;
  private m2 = 0;

  push(x: number): void {
    if (!Number.isFinite(x)) return;
    this.n++;
    const d = x - this.mean;
    this.mean += d / this.n;
    this.m2 += d * (x - this.mean);
  }

  get count(): number {
    return this.n;
  }
  get average(): number {
    return this.n > 0 ? this.mean : NaN;
  }
  get sigma(): number {
    return this.n > 1 ? Math.sqrt(this.m2 / (this.n - 1)) : NaN;
  }

  /** True when x exceeds mean + k·σ, and the band has enough samples to say so. */
  salient(x: number, k = SALIENCE_SIGMA): boolean {
    if (!Number.isFinite(x) || this.n < SALIENCE_WARMUP) return false;
    const s = this.sigma;
    if (!Number.isFinite(s) || s === 0) return false;
    return x > this.mean + k * s;
  }
}

/** Pick the rung to scan: the warmest stepped rung, else the lowest stepped. */
export function warmestRank(
  rungs: readonly { warm: boolean; coherence: number }[],
  stepped: readonly number[],
): number | null {
  if (stepped.length === 0) return null;
  let best: number | null = null;
  let bestC = -Infinity;
  for (const rank of stepped) {
    const r = rungs[rank];
    if (!r || !r.warm || !Number.isFinite(r.coherence)) continue;
    if (r.coherence > bestC) {
      bestC = r.coherence;
      best = rank;
    }
  }
  return best ?? stepped[0];
}

export interface CognitiveSnapshot {
  /** Completed spectral passes measured this session (the sampler cursor). */
  readonly passes: number;
  readonly drift: number;
  readonly residual: number;
  readonly entropy: number;
  /** Driver-invariant mode-space circulation witness, [0,1] or NaN. */
  readonly circulation: number;
  /** Sobolev h1/l2 of the change — shape movement vs pure amplitude. */
  readonly roughness: number;
  /** Spectral tail fraction of the current signature window. */
  readonly leakage: number;
  /** Measured gain of Fourier continuation on that window. */
  readonly continuity: number;
  /** Gated-recurrence novelty against the slow mode memory, [0,1] or NaN. */
  readonly persistence: number;
  /** Contraction factor of the recurrence cell — < 1 is the stability proof. */
  readonly contraction: number;
  readonly meanDrift: number;
  readonly sigmaDrift: number;
  /** Journal records written for structurally salient spectral states. */
  readonly salient: number;
  readonly rank: number | null;
  readonly latentBuilds: number;
  readonly signatureSweeps: number;
}

const EMPTY: CognitiveSnapshot = {
  passes: 0,
  drift: NaN,
  residual: NaN,
  entropy: NaN,
  circulation: NaN,
  roughness: NaN,
  leakage: NaN,
  continuity: NaN,
  persistence: NaN,
  contraction: NaN,
  meanDrift: NaN,
  sigmaDrift: NaN,
  salient: 0,
  rank: null,
  latentBuilds: 0,
  signatureSweeps: 0,
};

class CognitiveDriver {
  private unsub: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSpectralPullAt = 0;
  private lastSpectral: SpectralView | null = null;
  private readonly band = new DriftBand();
  /** Ω-CONSISTENCY K2 — slow gated memory over the signature, rebuilt on width change. */
  private cell: InstanceType<typeof operator.RecurrentModeCell> | null = null;
  private passes = 0;
  private salient = 0;
  private latentBuilds = 0;
  private signatureSweeps = 0;
  private lastLatentChunks = 0;
  private snap: CognitiveSnapshot = EMPTY;

  start(): void {
    if (this.unsub) return;
    const omega = getOmegaRuntime();
    this.unsub = omega.subscribe((s) => this.onState(s));
    this.onState(omega.get());
    if (typeof window !== 'undefined') {
      this.timer = setInterval(() => this.maintainKnowledge(), KNOWLEDGE_PERIOD_MS);
    }
  }

  stop(): void {
    this.unsub?.();
    this.unsub = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getSnapshot = (): CognitiveSnapshot => this.snap;

  private now(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  // ── C1 · spectral scan ──────────────────────────────────────────────────
  private onState(s: OmegaState): void {
    const snapshot = s.snapshot;
    // The learning battery pauses the tick loop; asking for a spectral pass
    // then would queue work behind it for no new information.
    if (!snapshot || !s.running || s.learning) return;

    const now = this.now();
    if (now - this.lastSpectralPullAt >= SPECTRAL_PERIOD_MS) {
      const rank = warmestRank(snapshot.rungs, snapshot.stepped);
      if (rank !== null) {
        this.lastSpectralPullAt = now;
        getOmegaRuntime().requestSpectral(rank);
      }
    }

    const view = s.spectral;
    if (!view || view === this.lastSpectral) return;
    const width = view.signature.length;
    if (!this.cell || this.cell.modes !== width) {
      this.cell = width >= 1 ? new operator.RecurrentModeCell({ modes: width }) : null;
    }
    const m = spectralMetrics(this.lastSpectral, view, this.cell);
    this.lastSpectral = view;
    this.passes++;

    if (Number.isFinite(m.drift)) {
      const isSalient = this.band.salient(m.drift);
      this.band.push(m.drift);
      if (isSalient) {
        this.salient++;
        // The trace of a structurally novel field state. Salience is the drift
        // in units of the measured band, so the journal can rank on it.
        try {
          getMemoryRuntime().store.journal.append({
            tick: snapshot.tick,
            qualiaScalar: Math.min(1, m.drift / (this.band.average + 3 * this.band.sigma)),
            signatureHash: `spec:${view.rank}:${snapshot.digest}`,
            text: `spectral drift ${m.drift.toExponential(3)} on rung ${view.rank} · entropy ${m.entropy.toFixed(4)} · residual ${m.residual.toExponential(2)}`,
          });
        } catch {
          /* memory disabled: the measurement still stands */
        }
      }
    }

    this.snap = {
      passes: this.passes,
      drift: m.drift,
      residual: m.residual,
      entropy: m.entropy,
      circulation: m.circulation,
      roughness: m.roughness,
      leakage: m.leakage,
      continuity: m.continuity,
      persistence: m.persistence,
      contraction: this.cell ? this.cell.certify().contraction : NaN,
      meanDrift: this.band.average,
      sigmaDrift: this.band.sigma,
      salient: this.salient,
      rank: view.rank,
      latentBuilds: this.latentBuilds,
      signatureSweeps: this.signatureSweeps,
    };
  }

  // ── C2 + C3 · knowledge maintenance ─────────────────────────────────────
  /** Exposed so a deck (or a test) can force one maintenance pass. */
  maintainKnowledge(): void {
    const know = getKnowledgeRuntime();
    const ks = know.getStats();
    const chunks = ks.stats.chunks;
    if (chunks === 0) return;

    // C3 — eigenbasis first: the signature sweep is what the FLD recall
    // channel and the knowledge.field self-test depend on.
    const sig = know.signatureState();
    if (!ks.signing) {
      if (!sig.ready) {
        know.warmSignatures();
        this.signatureSweeps++;
      } else if (sig.covered < sig.total) {
        void know.buildSignatures();
        this.signatureSweeps++;
      }
    }

    // C2 — latent space: build once the corpus can support it, rebuild after
    // material growth. Never while a signature sweep is holding the slice.
    if (ks.signing || chunks < LATENT_MIN_CHUNKS) return;
    const needs = !ks.latent || chunks >= Math.ceil(this.lastLatentChunks * LATENT_REGROW);
    if (!needs) return;
    const run = () => {
      try {
        know.trainLatent();
        this.lastLatentChunks = chunks;
        this.latentBuilds++;
        this.snap = { ...this.snap, latentBuilds: this.latentBuilds };
      } catch {
        /* an unbuildable corpus stays unbuilt; recall abstains */
      }
    };
    const ric = (
      globalThis as unknown as {
        requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (typeof ric === 'function') ric(run, { timeout: 8000 });
    else setTimeout(run, 0);
  }
}

let singleton: CognitiveDriver | null = null;

export function getCognitiveDriver(): CognitiveDriver {
  if (!singleton) singleton = new CognitiveDriver();
  return singleton;
}

export type { CognitiveDriver };
