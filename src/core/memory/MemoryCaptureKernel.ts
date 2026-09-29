/**
 * MemoryCaptureKernel — central per-tick capture orchestrator.
 *
 * Owns:
 *   - per-tick salience computation (ΔC, ΔE, Q, novelty, surprise)
 *   - FieldTape (L0) writes — every tick
 *   - PhiLockScheduler — routes L1..L6 jobs onto their Fibonacci phases
 *   - last-Ψ memory for re-measurement
 *
 * Pure consumer of MemoryStore + a PhiLockScheduler instance. The kernel
 * never blocks: a failing job is logged and the tick still completes.
 */

import { PhiLockScheduler } from '@/core/runtime/PhiLockScheduler';
import type { MemoryStore } from './MemoryStore';
import type { Episode, EpisodeReason } from './EpisodicStore';
import { memoryPolicy } from './MemoryPolicy';
import { readVisionEmbedding } from '@/core/sensory/sensoryFieldBridge';
import { quantizeInt8 } from '@/core/sensory/VisionProjection';
import { isFibonacciTick } from './FibonacciPatterns';

export interface CaptureInput {
  tick: number;
  psi: Float64Array;
  qualiaScalar: number;
  coherence: number;
  energy: number;
  text?: string;
  /** Trigger reasons forced by callers (events, grade shifts). */
  forceReason?: EpisodeReason;
}

export interface CaptureMetrics {
  tick: number;
  salience: number;
  novelty: number;
  surprise: number;
  deltaC: number;
  deltaE: number;
  episodicCaptured: boolean;
  firedJobs: string[];
}

// Threshold defaults — actual thresholds at capture-time are scaled by
// the user-tunable MemoryPolicy (see ./MemoryPolicy.ts).
const EPISODIC_SALIENCE_THRESHOLD = 0.45;
const TOPK_SIG = 24;
const WARMUP_TICKS = 8;

export class MemoryCaptureKernel {
  readonly scheduler = new PhiLockScheduler();
  private lastPsi: Float64Array | null = null;
  /** Double-buffer for lastPsi to avoid a per-tick Float64Array allocation. */
  private psiBufA: Float64Array | null = null;
  private psiBufB: Float64Array | null = null;
  private useBufA = true;
  private lastC = 0;
  private lastE = 0;
  private lastHash: string | null = null;
  private lastSalience = 0;
  private lastMetrics: CaptureMetrics | null = null;
  private salienceLog: number[] = [];
  /** Warm-up tick budget: the first frame has nothing to compare against,
   *  so novelty=1 and surprise spuriously cross the episodic threshold.
   *  We suppress episodic capture for the first WARMUP_TICKS frames. */
  private warmupRemaining = WARMUP_TICKS;

  /** Latest top-K of Ψ, cached during capture() so captureEpisode() and
   *  the vision index share the same computation. */
  private _lastTopKIdx: Int32Array | null = null;
  private _lastTopKAmp: Float64Array | null = null;
  /** Vision cosine and (quantised) embed captured this tick, if any. */
  private _lastVisionCosine = 0;
  private _lastVisionEmbedQ: Int8Array | null = null;
  private _lastVisionEmbedScale = 0;

  constructor(private readonly store: MemoryStore) {
    this.registerJobs();
  }

  private registerJobs(): void {
    // L1 Hebbian — every tick (period=1, low depth → moderate priority)
    this.scheduler.register({
      name: 'L1.hebbian',
      periodTicks: 1,
      depth: 1,
      run: () => {
        if (this.lastPsi) this.store.hebbian.update(this.lastPsi);
      },
    });
    // L3 semantic consolidation — F12 (144 ticks)
    this.scheduler.register({
      name: 'L3.semantic',
      periodTicks: 144,
      depth: 12,
      run: (t) => {
        this.consolidateSemantic(t);
      },
    });
    // L4 pathway transitions — every Fibonacci tick (period 13)
    this.scheduler.register({
      name: 'L4.pathway',
      periodTicks: 13,
      depth: 7,
      run: (t) => {
        this.tickPathway(t);
      },
    });
    // L6 reflective re-measurement — F11 (89 ticks ≈ 1.5 s at 60Hz)
    this.scheduler.register({
      name: 'L6.reflect',
      periodTicks: 89,
      depth: 11,
      run: (t) => {
        this.reflect(t);
      },
    });
  }

  capture(input: CaptureInput): CaptureMetrics {
    const { tick, psi, qualiaScalar, coherence, energy, forceReason } = input;
    const deltaC = Math.abs(coherence - this.lastC);
    const deltaE = Math.abs(energy - this.lastE);

    // novelty = 1 - cosine(psi, lastPsi)
    let novelty = 1;
    if (this.lastPsi && this.lastPsi.length === psi.length) {
      let dot = 0,
        na = 0,
        nb = 0;
      for (let i = 0; i < psi.length; i++) {
        dot += psi[i] * this.lastPsi[i];
        na += psi[i] * psi[i];
        nb += this.lastPsi[i] * this.lastPsi[i];
      }
      const denom = Math.sqrt(na) * Math.sqrt(nb);
      novelty = denom > 0 ? Math.max(0, 1 - dot / denom) : 1;
    }
    const surprise = Math.max(deltaC * 4, deltaE * 2);
    // V10-parity sensoryWeight: live arousal from the most recent percept
    // biases salience so sensory-rich moments capture more strongly.
    const arousal = this.store.sensory.lastInjection?.cortex.arousal ?? 0;
    const salience = Math.min(
      8,
      Math.max(qualiaScalar, 0) * 1.0 +
        deltaC * 2.0 +
        deltaE * 1.0 +
        novelty * 1.5 +
        surprise * 0.5 +
        arousal * 0.6180339887,
    );

    // Vision co-occurrence — if a fresh vision slot exists, feed the
    // (embed, Ψ top-K) pair to the VisionFieldIndex now, BEFORE the tape
    // write, so the tape frame carries the same cosine that the index
    // stored. When vision is off, cosine and novelty default to 0 (bit-
    // identical tape contents to pre-vision runs).
    const vision = readVisionEmbedding();
    let visionCosine = 0;
    let visionNovelty = 0;
    if (vision) {
      visionNovelty = vision.novelty;
      const { indices: pIdx, amplitudes: pAmp } = topKDouble(psi, TOPK_SIG);
      visionCosine = this.store.visionField.append(tick, vision.embed, pIdx, pAmp);
      // Stash for episode capture below (avoids a second top-K scan).
      this._lastTopKIdx = pIdx;
      this._lastTopKAmp = pAmp;
      const qv = quantizeInt8(vision.embed);
      this._lastVisionCosine = visionCosine;
      this._lastVisionEmbedQ = qv.q;
      this._lastVisionEmbedScale = qv.scale;
    } else {
      this._lastTopKIdx = null;
      this._lastTopKAmp = null;
      this._lastVisionEmbedQ = null;
      this._lastVisionCosine = 0;
      this._lastVisionEmbedScale = 0;
    }

    // L0 FieldTape — every tick
    this.store.fieldTape.write({
      tick,
      psi,
      qualiaScalar,
      coherence,
      energy,
      salience,
      novelty,
      surprise,
      visionCosine,
      visionNovelty,
    });

    // Update scheduler salience for every job (priority weighting)
    this.scheduler.setSalience('L1.hebbian', 1 + salience * 0.3);
    this.scheduler.setSalience('L3.semantic', 1 + salience * 0.5);
    this.scheduler.setSalience('L4.pathway', 1 + salience * 0.4);
    this.scheduler.setSalience('L6.reflect', 1 + salience * 0.8);

    // L2 Episodic — capture if threshold or forced. Warm-up gate suppresses
    // the spurious first-tick capture (novelty=1 by definition before any
    // history exists). Forced captures still go through. Thresholds are
    // user-tunable via MemoryPolicy (slider in MEMORY SUBSTRATE panel).
    let episodicCaptured = false;
    const canEpisodic = forceReason !== undefined || this.warmupRemaining === 0;
    const allowFieldState = memoryPolicy.isFieldStateAllowed() || forceReason !== undefined;
    const salienceGate = memoryPolicy.episodicSalience();
    const noveltyGate = memoryPolicy.noveltyGate();
    const surpriseGate = memoryPolicy.surpriseGate();
    if (
      canEpisodic &&
      allowFieldState &&
      (forceReason || salience >= salienceGate || novelty > noveltyGate || surprise > surpriseGate)
    ) {
      this.captureEpisode(input, salience, novelty, surprise, forceReason);
      episodicCaptured = true;
    }
    // Reference baseline default so unused-import lint stays clean.
    void EPISODIC_SALIENCE_THRESHOLD;
    if (this.warmupRemaining > 0) this.warmupRemaining--;

    // Run PhiLock scheduler (drives L1/L3/L4/L6 on their Fibonacci phases)
    // Run PhiLock scheduler (drives L1/L3/L4/L6 on their Fibonacci phases).
    // Double-buffer lastPsi: copy into the inactive buffer, then swap. Avoids
    // per-tick `new Float64Array(psi)` allocation (was ~8 KB GC churn/frame at N=1024).
    const N = psi.length;
    if (!this.psiBufA || this.psiBufA.length !== N) {
      this.psiBufA = new Float64Array(N);
      this.psiBufB = new Float64Array(N);
      this.useBufA = true;
    }
    const target = this.useBufA ? this.psiBufA! : this.psiBufB!;
    target.set(psi);
    this.lastPsi = target;
    this.useBufA = !this.useBufA;
    this.lastC = coherence;
    this.lastE = energy;
    this.lastSalience = salience;
    const fired = this.scheduler.tick(tick);

    // L3 warm path — on every Fibonacci tick the semantic store ingests the
    // live Ψ directly (legacy facade contract). The PhiLock-scheduled
    // consolidateSemantic() still runs on its own phase and promotes the
    // durably reinforced episodes on top of this.
    if (isFibonacciTick(tick)) {
      this.store.patterns.ingest(tick, psi, qualiaScalar);
    }

    this.salienceLog.push(salience);
    if (this.salienceLog.length > 256) this.salienceLog.splice(0, this.salienceLog.length - 256);

    const metrics: CaptureMetrics = {
      tick,
      salience,
      novelty,
      surprise,
      deltaC,
      deltaE,
      episodicCaptured,
      firedJobs: fired.map((f) => f.name),
    };
    this.lastMetrics = metrics;
    return metrics;
  }

  private captureEpisode(
    input: CaptureInput,
    salience: number,
    novelty: number,
    surprise: number,
    forced?: EpisodeReason,
  ): void {
    const { tick, psi, qualiaScalar, coherence, energy, text } = input;
    const { indices, amplitudes } = topKDouble(psi, TOPK_SIG);
    const norm = Math.sqrt(amplitudes.reduce((a, b) => a + b * b, 0));
    const hash = signatureHash(indices, amplitudes);

    // Reinforce if hash already known
    if (this.store.episodic.reinforce(hash, tick, salience * 0.25)) {
      this.lastHash = hash;
      return;
    }

    const reason: EpisodeReason =
      forced ??
      (surprise > 0.5
        ? 'surprise'
        : novelty > 0.6
          ? 'novelty'
          : tick % 89 === 0
            ? 'fibonacci'
            : 'salience');

    const ep: Episode = {
      tick,
      reason,
      hash,
      norm,
      poloidal: 0,
      toroidal: 0,
      qualiaScalar,
      coherence,
      energy,
      salience,
      novelty,
      surprise,
      indices,
      amplitudes,
      tapeIndex: 0,
      reinforcements: 0,
      lastReinforced: tick,
      text,
    };
    // Attach the visual co-occurrence captured earlier this tick, if any.
    // This is the concrete "image this moment felt like" binding — later
    // recalls via episodic.recallByVision(embed) surface these episodes.
    if (this._lastVisionEmbedQ) {
      ep.visionEmbedQ = this._lastVisionEmbedQ;
      ep.visionEmbedScale = this._lastVisionEmbedScale;
      ep.visionFieldCosine = this._lastVisionCosine;
    }
    this.store.episodic.append(ep);

    // L5 journal mirror
    this.store.journal.append({
      tick,
      qualiaScalar,
      signatureHash: hash,
      text: text ?? `${reason} · sal=${salience.toFixed(2)}`,
    });

    // L4 pathway link from prior hash
    if (this.lastHash && this.lastHash !== hash) {
      this.store.pathway.observe(this.lastHash, hash, tick);
    }
    this.lastHash = hash;
  }

  private consolidateSemantic(_tick: number): void {
    // Promote top-priority episodes into FibonacciPatterns (L3) — keeps the
    // legacy semantic store warm with the durably reinforced material.
    //
    // Attention-biased consolidation (Gap #3): bias the L3 top-K compression
    // toward psi-space indices recently touched by sensory ΔΨ. This mirrors
    // hippocampal-cortical sleep replay, where consolidation is weighted by
    // present-moment salience — peek the current sensory state (do NOT
    // consume; tickMemory already consumed for the fold) and build a mask
    // from the cortex injection's indices, projected into the L3 dense
    // dimension (36 = 9 rungs × 4 axes; the 4-element global toroidal tail
    // at psi[36..39] is dropped by denseFromTopK and excluded from L3).
    const inj = this.store.sensory.peekLastInjection();
    let mask: Set<number> | undefined;
    let arousal = 0;
    if (inj && inj.indices.length > 0) {
      arousal = inj.cortex.arousal;
      mask = new Set<number>();
      // psi-space index = feature index mod 40 (matches injectPsi). Then keep
      // only indices < 36 — the L3 dense dim. Tail-mapped sensory hits are
      // intentionally excluded (the global toroidal tail isn't part of L3).
      for (let i = 0; i < inj.indices.length; i++) {
        const psiIdx = ((inj.indices[i] % 40) + 40) % 40;
        if (psiIdx < 36) mask.add(psiIdx);
      }
      if (mask.size === 0) mask = undefined;
    }
    const top = this.store.episodic.prioritised(_tick, 8);
    for (const ep of top) {
      this.store.patterns.ingest(
        ep.tick,
        denseFromTopK(ep.indices, ep.amplitudes, 36),
        ep.qualiaScalar,
        mask,
        arousal,
      );
    }
  }

  private tickPathway(_tick: number): void {
    // Pathway already updated on each episodic capture; this hook lets us
    // prune stale edges in the future without changing the public API.
  }

  private reflect(tick: number): void {
    if (!this.lastPsi) return;
    const { indices, amplitudes } = topKDouble(this.lastPsi, TOPK_SIG);
    this.store.reflective.reflect(tick, 16, { indices, amplitudes, norm: 0 });
  }

  recentSalience(n = 64): number[] {
    return this.salienceLog.slice(-n);
  }
  metrics(): CaptureMetrics | null {
    return this.lastMetrics;
  }
  schedulerStats() {
    return this.scheduler.stats();
  }
}

/* ─── helpers ─── */

function topKDouble(
  psi: Float64Array,
  K: number,
): { indices: Int32Array; amplitudes: Float64Array } {
  const idx = new Int32Array(K);
  const amp = new Float64Array(K);
  for (let i = 0; i < K; i++) {
    idx[i] = -1;
    amp[i] = 0;
  }
  // Persistent min-slot tracking — re-scan K only after a replacement
  // (matches FieldTape Sec12 pattern). Branch-on-sign avoids Math.abs calls.
  let minSlot = 0;
  let minAbs = 0;
  for (let i = 0; i < psi.length; i++) {
    const a = psi[i];
    const abs = a < 0 ? -a : a;
    if (abs > minAbs) {
      idx[minSlot] = i;
      amp[minSlot] = a;
      let ms = 0;
      let mv = amp[0];
      mv = mv < 0 ? -mv : mv;
      for (let k = 1; k < K; k++) {
        let x = amp[k];
        x = x < 0 ? -x : x;
        if (x < mv) {
          mv = x;
          ms = k;
        }
      }
      minSlot = ms;
      minAbs = mv;
    }
  }
  return { indices: idx, amplitudes: amp };
}

function signatureHash(indices: Int32Array, amplitudes: Float64Array): string {
  // FNV-1a over quantised (idx, sign·magnitudeBin) pairs.
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < indices.length; i++) {
    const q = Math.round(amplitudes[i] * 1024) | 0;
    const v = (indices[i] * 0x9e3779b1) ^ q;
    h ^= v >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function denseFromTopK(indices: Int32Array, amplitudes: Float64Array, dim: number): Float64Array {
  const out = new Float64Array(dim);
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (idx >= 0 && idx < dim) out[idx] = amplitudes[i];
  }
  return out;
}
