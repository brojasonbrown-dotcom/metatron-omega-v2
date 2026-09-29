/**
 * SensoryCortex — fuses every modality through a governor-sized PhiLattice
 * with predictive coding, habituation, and cross-modal binding.
 *
 *   • Each modality owns its own PhiLattice; N is chosen by the governor
 *     (no hardcoded ceilings).
 *   • Predictive coding: AR(1) over lattice amps with α=φ⁻¹. Surprise =
 *     ‖actual − predicted‖ / √N drives salience. A 32-bin histogram of
 *     recent surprises is kept per modality (the panel sparkline).
 *   • Habituation: per-modality novelty decays on low-surprise streams,
 *     recovers on quiet periods — so repeated identical input is silently
 *     reinforced, never re-amplified. Recent habituation timeline kept.
 *   • Cross-modal binding via a SHARED 89-dim φ-projection bind space,
 *     so different lattice Ns can be compared properly (previous version
 *     gated on length equality → binding never fired).
 *   • Per-modality amplitude snapshots use double-buffered Float32Arrays
 *     so cross-modal comparisons are allocation-free.
 */

import {
  PhiLattice,
  governorLatticeN,
  LATTICE_CONSTANTS,
  type PhiLatticeReading,
} from './PhiLattice';
import type { SensoryModality } from './SensoryAtom';

// Vision-embed included so ViT semantic vectors participate in the shared
// 89-D bind space alongside audio/video/imu — otherwise the modality's
// per-lattice state is maintained but never cross-modally bound (dead loop).
const MODALITIES: SensoryModality[] = ['audio', 'video', 'imu', 'synthetic', 'vision-embed'];
const PHI = 1.6180339887498949;
const PHI_INV = 1 / PHI;
const HABIT_DECAY = 0.999;
const HABIT_GROWTH = 0.02;
const BIND_WINDOW_TICKS = 3;
const BIND_THRESHOLD = 0.45;
const BIND_DIM = 89; // F₁₁ — shared cross-modal embedding size
const SURPRISE_BINS = 32;
const HABIT_TIMELINE = 89;

export interface CortexEvent {
  modality: SensoryModality;
  tick: number;
  lattice: PhiLatticeReading;
  surprise: number;
  novelty: number;
  arousal: number;
  bound: SensoryModality[];
}

export interface CortexModalityStats {
  samples: number;
  latticeN: number;
  featureDim: number;
  avgCoherence: number;
  avgSurprise: number;
  closureFlux: number;
  closureBaseline: number;
  stableFraction: number;
  habit: number;
  surpriseHistogram: number[]; // length SURPRISE_BINS, normalised
  habitTimeline: number[]; // length HABIT_TIMELINE, ring
}

export interface CortexStats {
  lambda: number;
  totalNodes: number;
  perModality: Record<SensoryModality, CortexModalityStats>;
  bindings: number;
  bindScores: { pair: string; score: number }[];
}

interface ModalityState {
  lattice: PhiLattice | null;
  predicted: Float32Array | null;
  alpha: number;
  samples: number;
  coherenceEMA: number;
  surpriseEMA: number;
  closureEMA: number;
  stableEMA: number;
  habit: number;
  ping: Float32Array | null; // double-buffered amp snapshots
  pong: Float32Array | null;
  bindPing: Float32Array | null; // double-buffered bind-space snapshots
  bindPong: Float32Array | null;
  useping: boolean;
  bindProj: Float32Array | null; // BIND_DIM × N projection matrix (row-major)
  lastTick: number;
  featureDim: number;
  surpriseHist: Float32Array;
  habitRing: Float32Array;
  habitIdx: number;
}

export class SensoryCortex {
  private state: Record<SensoryModality, ModalityState>;
  private bindings = 0;
  private lastBindVec: Partial<Record<SensoryModality, { tick: number; v: Float32Array }>> = {};
  /** Aggregated bind score per modality-pair (key = sorted "a|b"). */
  readonly bindScore = new Map<string, number>();

  constructor() {
    this.state = {
      audio: this.make(),
      video: this.make(),
      imu: this.make(),
      synthetic: this.make(),
      'vision-embed': this.make(),
    };
  }

  private make(): ModalityState {
    return {
      lattice: null,
      predicted: null,
      alpha: PHI_INV,
      samples: 0,
      coherenceEMA: 0,
      surpriseEMA: 0,
      closureEMA: 0,
      stableEMA: 0,
      habit: 0,
      ping: null,
      pong: null,
      bindPing: null,
      bindPong: null,
      useping: true,
      bindProj: null,
      lastTick: 0,
      featureDim: 0,
      surpriseHist: new Float32Array(SURPRISE_BINS),
      habitRing: new Float32Array(HABIT_TIMELINE),
      habitIdx: 0,
    };
  }

  observe(modality: SensoryModality, feature: Float32Array, tick: number): CortexEvent {
    const st = this.state[modality];
    if (!st.lattice || st.featureDim !== feature.length) {
      const seed = ((modality.charCodeAt(0) * 0x9e3779b1) ^ feature.length) >>> 0;
      const N = governorLatticeN(feature.length);
      st.lattice = new PhiLattice(feature.length, N, seed);
      st.featureDim = feature.length;
      st.predicted = new Float32Array(N);
      st.ping = new Float32Array(N);
      st.pong = new Float32Array(N);
      st.bindPing = new Float32Array(BIND_DIM);
      st.bindPong = new Float32Array(BIND_DIM);
      st.bindProj = makeBindProjection(N, BIND_DIM, seed ^ 0xb01dface);
    }
    const reading = st.lattice.sample(feature, tick);
    const amps = reading.amps;
    const N = reading.N;

    // Fused predictive-coding pass — one walk over `amps`/`predicted`
    // instead of two. We use the identity
    //   α·a + (1−α)·p  ≡  p + α·(a − p)  ≡  p + α·d
    // so the surprise residual `d` we already compute for err² is reused
    // as the AR(1) increment. Saves N adds/muls per modality per tick and,
    // more importantly, halves the memory traffic over `predicted`.
    let err2 = 0;
    const pred = st.predicted;
    if (pred && pred.length === N) {
      const a = st.alpha;
      for (let i = 0; i < N; i++) {
        const d = amps[i] - pred[i];
        err2 += d * d;
        pred[i] = pred[i] + a * d;
      }
    }
    const surprise = Math.min(1, Math.sqrt(err2 / N));

    // habituation
    st.habit =
      surprise > 0.1
        ? Math.max(0, st.habit - HABIT_GROWTH * 0.5)
        : Math.min(1, st.habit * HABIT_DECAY + HABIT_GROWTH * (1 - surprise));
    const novelty = Math.max(0.05, 1 - st.habit * 0.85);

    st.coherenceEMA = 0.9 * st.coherenceEMA + 0.1 * reading.coherenceMean;
    st.surpriseEMA = 0.9 * st.surpriseEMA + 0.1 * surprise;
    st.closureEMA = 0.9 * st.closureEMA + 0.1 * reading.closureFlux;
    st.stableEMA = 0.95 * st.stableEMA + 0.05 * reading.stableFraction;
    st.samples++;
    st.lastTick = tick;

    // surprise histogram + habit ring
    {
      const bin = Math.min(SURPRISE_BINS - 1, Math.floor(surprise * SURPRISE_BINS));
      for (let i = 0; i < SURPRISE_BINS; i++) st.surpriseHist[i] *= 0.97;
      st.surpriseHist[bin] += 1;
      st.habitRing[st.habitIdx] = st.habit;
      st.habitIdx = (st.habitIdx + 1) % HABIT_TIMELINE;
    }

    // double-buffered amp snapshot (no alloc per frame)
    const snap = st.useping ? st.ping! : st.pong!;
    snap.set(amps);
    st.useping = !st.useping;

    // bind-space projection (BIND_DIM × N) — produces a fixed-size vector
    const bindSnap = st.useping ? st.bindPing! : st.bindPong!;
    projectInto(amps, st.bindProj!, BIND_DIM, bindSnap);

    const arousal = Math.min(
      1,
      reading.coherenceMean * 0.4 +
        surprise * 0.3 +
        novelty * 0.15 +
        Math.min(1, reading.anomaly / Math.max(1e-9, reading.closureBaseline)) * 0.15,
    );

    // cross-modal binding via shared bind space
    const bound: SensoryModality[] = [];
    for (const other of MODALITIES) {
      if (other === modality) continue;
      const ev = this.lastBindVec[other];
      if (!ev) continue;
      if (Math.abs(tick - ev.tick) > BIND_WINDOW_TICKS) continue;
      const sim = cosineSim(bindSnap, ev.v);
      if (sim < BIND_THRESHOLD) continue;
      const key = [modality, other].sort().join('|');
      this.bindScore.set(key, (this.bindScore.get(key) ?? 0) * 0.999 + sim * 0.05);
      bound.push(other);
      this.bindings++;
    }
    this.lastBindVec[modality] = { tick, v: bindSnap };

    return { modality, tick, lattice: reading, surprise, novelty, arousal, bound };
  }

  stats(): CortexStats {
    const perModality = {} as Record<SensoryModality, CortexModalityStats>;
    let total = 0;
    for (const m of MODALITIES) {
      const s = this.state[m];
      const N = s.lattice?.N ?? 0;
      total += N;
      // normalise surprise histogram (sum→1) for display
      let sum = 0;
      for (let i = 0; i < SURPRISE_BINS; i++) sum += s.surpriseHist[i];
      const hist: number[] = new Array(SURPRISE_BINS);
      for (let i = 0; i < SURPRISE_BINS; i++) hist[i] = sum > 0 ? s.surpriseHist[i] / sum : 0;
      // habit timeline in chronological order
      const tl: number[] = new Array(HABIT_TIMELINE);
      for (let i = 0; i < HABIT_TIMELINE; i++)
        tl[i] = s.habitRing[(s.habitIdx + i) % HABIT_TIMELINE];
      perModality[m] = {
        samples: s.samples,
        latticeN: N,
        featureDim: s.featureDim,
        avgCoherence: s.coherenceEMA,
        avgSurprise: s.surpriseEMA,
        closureFlux: s.closureEMA,
        closureBaseline: N > 0 ? 1 / Math.sqrt(N) : 0,
        stableFraction: s.stableEMA,
        habit: s.habit,
        surpriseHistogram: hist,
        habitTimeline: tl,
      };
    }
    const bindScores = Array.from(this.bindScore.entries())
      .map(([pair, score]) => ({ pair, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    return {
      lambda: LATTICE_CONSTANTS.LAMBDA,
      totalNodes: total,
      perModality,
      bindings: this.bindings,
      bindScores,
    };
  }

  lastAmps(m: SensoryModality): Float32Array | null {
    const st = this.state[m];
    return st.useping ? st.pong : st.ping;
  }

  reset(): void {
    for (const m of MODALITIES) this.state[m] = this.make();
    this.bindScore.clear();
    this.bindings = 0;
    this.lastBindVec = {};
  }
}

/* ─── helpers ─── */

function makeBindProjection(N: number, K: number, seed: number): Float32Array {
  // Random φ-seeded ±1 projection, row-scaled by 1/√N (Achlioptas).
  const out = new Float32Array(K * N);
  let s = seed >>> 0;
  const inv = 1 / Math.sqrt(N);
  for (let r = 0; r < K; r++) {
    for (let c = 0; c < N; c++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      out[r * N + c] = (s & 1 ? 1 : -1) * inv;
    }
  }
  return out;
}

function projectInto(amps: Float32Array, proj: Float32Array, K: number, out: Float32Array): void {
  const N = amps.length;
  for (let r = 0; r < K; r++) {
    let acc = 0;
    const base = r * N;
    for (let i = 0; i < N; i++) acc += proj[base + i] * amps[i];
    out[r] = acc;
  }
}

function cosineSim(a: Float32Array, b: Float32Array): number {
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
