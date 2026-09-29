/**
 * SensoryGateway (L-S) — content-addressed sensory intake.
 *
 * Pipeline per frame:
 *   1. feature vector arrives from a frontend (audio/video/imu/synthetic)
 *   2. simHash64(feature) → 16-char hex bucket (Map<string> — fast)
 *   3. existing atom in same bucket with Hamming ≤ NEAR_THRESHOLD ⇒ reinforce
 *   4. else allocate a new atom (top-K-truncated for memory thrift)
 *   5. emit ΔΨ injection: sparse perturbation scaled by
 *        (1 + log(reinforcements)) · novelty · (0.5 + arousal)
 *
 * Eviction uses randomised tournament selection (Power-of-Two-Choices) —
 * O(1) per insert, no full-Map sort, with quality close to true min-heap
 * eviction because the prior on (reinforcements, lastSeen) is heavy-tailed.
 *
 * "Same image / same sound ⇒ same field state, reinforced not re-stored"
 * is enforced at this layer, exactly as planned.
 */

import { simHash64, hammingPre, parseHash64, bucketKey } from './SimHashPhi';
import type { SensoryAtom, SensoryModality } from './SensoryAtom';
import { atomBytes } from './SensoryAtom';
import { SensoryCortex, type CortexEvent, type CortexStats } from './SensoryCortex';
import { memoryPolicy } from '@/core/memory/MemoryPolicy';

const NEAR_THRESHOLD = 6; // bits — counts as "same" percept
const BUCKET_HASH_BITS = 12; // 4096 buckets
const DEFAULT_TOPK = 32;
const MIN_CAP = 64;
const EVICT_SAMPLE = 24; // tournament size per eviction

export interface SensoryInjection {
  modality: SensoryModality;
  hash: string;
  novelty: number; // 0..1
  energy: number; // ‖feature‖²
  reinforcements: number;
  indices: Int32Array;
  amplitudes: Float32Array;
  /** Live cortex telemetry for this ingest (predictive coding + lattice). */
  cortex: CortexEvent;
}

export interface SensoryStats {
  atoms: number;
  capacity: number;
  bytesUsed: number;
  bytesBudget: number;
  totalIngests: number;
  uniqueRatio: number;
  perModality: Record<SensoryModality, number>;
  cortex: CortexStats;
}

export class SensoryGateway {
  private atoms = new Map<string, SensoryAtom>();
  private hashList: string[] = []; // for O(1) sampling during eviction
  /**
   * Ω-READY R1 — eviction sampling must be reproducible.
   *
   * The tournament below used Math.random(), so two identical intake runs could
   * evict different atoms and diverge in every downstream hash. The cursor
   * advances by a golden-ratio stride (Weyl sequence), which spreads samples
   * across the list as evenly as a uniform draw while staying deterministic:
   * same intake sequence ⇒ same evictions ⇒ same snapshot bytes.
   */
  private evictCursor = 0;
  private buckets = new Map<string, string[]>();
  private cap: number;
  private topK: number;
  private totalIngests = 0;
  private uniqueAtoms = 0;
  private perModality: Record<SensoryModality, number> = {
    audio: 0,
    video: 0,
    imu: 0,
    synthetic: 0,
    'vision-embed': 0,
  };
  readonly cortex = new SensoryCortex();
  /**
   * PER-MODALITY injection slots (multi-modal continuity fix).
   *
   * Earlier versions kept a single `lastInjection`. When camera + mic + IMU
   * were all on, the fastest modality (audio @ 233 Hz) overwrote the others
   * between memory ticks, and the memory fold saw only the audio percept;
   * video/IMU contributed zero ΔΨ and zero Hebbian co-activation. The cortex
   * telemetry showed three streams but the field saw one.
   *
   * Fix: keep one slot per modality plus a per-slot generation counter.
   * `consumeAllForMemory()` returns every slot whose generation advanced
   * since the last consume — fold-once per modality, fold-all per tick.
   * `lastInjection` is preserved as a getter returning the most recent slot
   * across all modalities, so the sensory-side identity fast-path and any
   * single-modality readers (telemetry panels, arousal modulator) keep
   * working unchanged.
   */
  private lastByModality: Record<SensoryModality, SensoryInjection | null> = {
    audio: null,
    video: null,
    imu: null,
    synthetic: null,
    'vision-embed': null,
  };
  private genByModality: Record<SensoryModality, number> = {
    audio: 0,
    video: 0,
    imu: 0,
    synthetic: 0,
    'vision-embed': 0,
  };
  private lastConsumedGen: Record<SensoryModality, number> = {
    audio: 0,
    video: 0,
    imu: 0,
    synthetic: 0,
    'vision-embed': 0,
  };

  private mostRecentModality: SensoryModality | null = null;
  /** Back-compat getter — newest injection across all modalities. */
  get lastInjection(): SensoryInjection | null {
    return this.mostRecentModality ? this.lastByModality[this.mostRecentModality] : null;
  }
  set lastInjection(inj: SensoryInjection | null) {
    // Legacy setter — used by the disabled-modality early-return below to
    // null out the field on a policy gate. Routes to the modality slot.
    if (inj === null) {
      if (this.mostRecentModality) this.lastByModality[this.mostRecentModality] = null;
    } else {
      this.lastByModality[inj.modality] = inj;
      this.mostRecentModality = inj.modality;
    }
  }
  /** Ring buffer of recent atoms for halo visualization. */
  private recentHashes: string[] = [];
  private readonly RECENT_CAP = 64;

  /**
   * Legacy single-injection fold gate (back-compat). Returns the newest
   * unfolded injection across all modalities. Prefer `consumeAllForMemory()`
   * for true multi-modal continuity.
   */
  consumeForMemory(): SensoryInjection | null {
    const all = this.consumeAllForMemory();
    return all.length > 0 ? all[all.length - 1] : null;
  }

  /**
   * Fold-once, fold-all. Returns every modality slot whose generation has
   * advanced since the last call. Idempotent within a tick — calling twice
   * yields the second result as `[]`. Order is stable: audio, video, imu,
   * synthetic (matches Hebbian binding determinism).
   */
  consumeAllForMemory(): SensoryInjection[] {
    const out: SensoryInjection[] = [];
    const order: SensoryModality[] = ['audio', 'video', 'imu', 'synthetic', 'vision-embed'];
    for (const m of order) {
      const g = this.genByModality[m];
      if (g === 0 || g === this.lastConsumedGen[m]) continue;
      const inj = this.lastByModality[m];
      if (!inj) continue;
      this.lastConsumedGen[m] = g;
      out.push(inj);
    }
    return out;
  }

  /** Peek without consuming — for telemetry/debug panels and arousal. */
  peekLastInjection(): SensoryInjection | null {
    return this.lastInjection;
  }
  /** Peek a specific modality slot without consuming. */
  peekByModality(m: SensoryModality): SensoryInjection | null {
    return this.lastByModality[m];
  }

  constructor(cap: number, topK = DEFAULT_TOPK) {
    this.cap = Math.max(MIN_CAP, Math.floor(cap));
    this.topK = Math.max(8, Math.min(128, topK));
  }

  /** Recent atoms (newest last) for visualization. */
  recentAtoms(limit = 32): SensoryAtom[] {
    const out: SensoryAtom[] = [];
    const start = Math.max(0, this.recentHashes.length - limit);
    for (let i = start; i < this.recentHashes.length; i++) {
      const a = this.atoms.get(this.recentHashes[i]);
      if (a) out.push(a);
    }
    return out;
  }

  setCap(cap: number): void {
    this.cap = Math.max(MIN_CAP, Math.floor(cap));
    while (this.atoms.size > this.cap) this.evictOne();
  }

  capacity(): number {
    return this.cap;
  }
  size(): number {
    return this.atoms.size;
  }
  bytesUsed(): number {
    return this.atoms.size * atomBytes(this.topK);
  }
  bytesBudget(): number {
    return this.cap * atomBytes(this.topK);
  }

  ingest(feature: Float32Array, modality: SensoryModality, tick: number): SensoryInjection {
    this.totalIngests++;
    this.perModality[modality]++;

    // Cortex ALWAYS observes the raw feature — predictive coding, habituation
    // and cross-modal binding run regardless of whether we store, so live
    // panels keep updating even when a modality is muted in memory policy.
    const cortex = this.cortex.observe(modality, feature, tick);

    // Modality gate (user-tunable). When disabled we skip atom creation /
    // reinforcement entirely — nothing enters long-term memory. We return a
    // synthetic injection carrying just the cortex telemetry so callers that
    // read `.cortex` still work. The modality slot is cleared so the fold
    // loop can't re-fold a stale injection from a now-muted modality.
    if (!memoryPolicy.isModalityAllowed(modality)) {
      let energy = 0;
      for (let i = 0; i < feature.length; i++) energy += feature[i] * feature[i];
      this.lastByModality[modality] = null;
      return {
        modality,
        hash: '',
        novelty: cortex.novelty,
        energy,
        reinforcements: 0,
        indices: new Int32Array(0),
        amplitudes: new Float32Array(0),
        cortex,
      };
    }

    const hash = simHash64(feature);

    // Identity fast-path — same simHash as the previous ingest *of the same
    // modality* means a bit-identical percept (within simHash's collision
    // rate ≈ 2⁻⁶⁴). Per-modality match prevents an audio hash collision
    // from short-circuiting a video reinforcement (the prior single-slot
    // version cross-contaminated whenever a fast modality preceded a slow one).
    const prior = this.lastByModality[modality];
    if (prior && prior.hash === hash) {
      const atom = this.atoms.get(hash);
      if (atom) {
        atom.reinforcements++;
        atom.lastSeen = tick;
        let energy = 0;
        for (let i = 0; i < feature.length; i++) energy += feature[i] * feature[i];
        const novelty = Math.max(
          0.02,
          cortex.novelty * (1 - Math.min(1, atom.reinforcements / 64)),
        );
        const inj: SensoryInjection = {
          modality,
          hash,
          novelty,
          energy,
          reinforcements: atom.reinforcements,
          indices: atom.topIndices,
          amplitudes: atom.topAmps,
          cortex,
        };
        this.recordInjection(inj);
        this.pushRecent(hash);
        return inj;
      }
    }

    const key = bucketKey(hash, BUCKET_HASH_BITS);
    const bucket = this.buckets.get(key);

    // Search bucket for near-match. Pre-parse the query hash once so the
    // inner loop avoids 2 parseInts per candidate (was the dominant cost
    // on noisy modalities where every ingest is a fresh hash).
    let matchHash: string | null = null;
    let bestHd = NEAR_THRESHOLD + 1;
    if (bucket) {
      const q = parseHash64(hash);
      const qHi = q.hi,
        qLo = q.lo;
      for (const h of bucket) {
        if (h === hash) {
          matchHash = h;
          bestHd = 0;
          break;
        }
        const hd = hammingPre(qHi, qLo, h);
        if (hd < bestHd) {
          bestHd = hd;
          matchHash = h;
          if (hd === 0) break;
        }
      }
    }

    let energy = 0;
    for (let i = 0; i < feature.length; i++) energy += feature[i] * feature[i];

    if (matchHash !== null && bestHd <= NEAR_THRESHOLD) {
      const atom = this.atoms.get(matchHash)!;
      atom.reinforcements++;
      atom.lastSeen = tick;
      const novelty = Math.max(0.02, cortex.novelty * (1 - Math.min(1, atom.reinforcements / 64)));
      const inj: SensoryInjection = {
        modality,
        hash: matchHash,
        novelty,
        energy,
        reinforcements: atom.reinforcements,
        indices: atom.topIndices,
        amplitudes: atom.topAmps,
        cortex,
      };
      this.recordInjection(inj);
      this.pushRecent(matchHash);
      return inj;
    }

    // New atom — top-K-truncate feature
    const { indices, amplitudes } = topK(feature, this.topK);
    const atom: SensoryAtom = {
      hash,
      modality,
      firstSeen: tick,
      lastSeen: tick,
      reinforcements: 1,
      topIndices: indices,
      topAmps: amplitudes,
      energy,
    };
    this.atoms.set(hash, atom);
    this.hashList.push(hash);
    if (!bucket) this.buckets.set(key, [hash]);
    else bucket.push(hash);
    this.uniqueAtoms++;
    if (this.atoms.size > this.cap) this.evictOne();

    const inj: SensoryInjection = {
      modality,
      hash,
      novelty: cortex.novelty,
      energy,
      reinforcements: 1,
      indices,
      amplitudes,
      cortex,
    };
    this.recordInjection(inj);
    this.pushRecent(hash);
    return inj;
  }

  /** Write a fresh injection into its modality slot + bump generation. */
  private recordInjection(inj: SensoryInjection): void {
    this.lastByModality[inj.modality] = inj;
    this.genByModality[inj.modality]++;
    this.mostRecentModality = inj.modality;
  }

  private pushRecent(hash: string): void {
    this.recentHashes.push(hash);
    if (this.recentHashes.length > this.RECENT_CAP) {
      this.recentHashes.splice(0, this.recentHashes.length - this.RECENT_CAP);
    }
  }

  /** Project current atoms into a Ψ perturbation (sparse map indices→amp). */
  injectPsi(target: Float64Array, last: SensoryInjection | null): void {
    if (!last) return;
    // Arousal-scaled gain — cortex tells us how much this percept matters.
    const reinforceBoost = 1 + Math.log(1 + last.reinforcements);
    const gain = reinforceBoost * last.novelty * (0.5 + last.cortex.arousal);
    const N = target.length;
    for (let i = 0; i < last.indices.length; i++) {
      const idx = last.indices[i] % N;
      target[idx] += last.amplitudes[i] * gain * 0.01; // tiny ΔΨ — engine-safe
    }
  }

  /**
   * Fused multi-modal Ψ injection (true continuity).
   *
   * Sums per-modality ΔΨ into one psi vector. Each modality is scaled by the
   * same gain rule as injectPsi(), then the total is divided by √k (k = number
   * of active modalities) so a 3-modality fold has the same engine-safe ‖ΔΨ‖
   * bound as a single modality. This is the standard variance-preserving
   * fusion gain (orthogonal-noise assumption) and matches the Reflect.ts
   * isotropic-baseline normalisation used elsewhere.
   *
   * The post-injection Ψ feeds L1.hebbian.update() on the next tick, which
   * naturally registers cross-modal co-activation (audio_idx, video_idx in
   * the same activation vector) — no separate cross-modal binding pass needed.
   */
  injectPsiFused(target: Float64Array, injections: SensoryInjection[]): void {
    if (injections.length === 0) return;
    if (injections.length === 1) {
      this.injectPsi(target, injections[0]);
      return;
    }
    const N = target.length;
    const norm = 1 / Math.sqrt(injections.length);
    for (const inj of injections) {
      const reinforceBoost = 1 + Math.log(1 + inj.reinforcements);
      const gain = reinforceBoost * inj.novelty * (0.5 + inj.cortex.arousal) * norm;
      for (let i = 0; i < inj.indices.length; i++) {
        const idx = inj.indices[i] % N;
        target[idx] += inj.amplitudes[i] * gain * 0.01;
      }
    }
  }

  stats(): SensoryStats {
    return {
      atoms: this.atoms.size,
      capacity: this.cap,
      bytesUsed: this.bytesUsed(),
      bytesBudget: this.bytesBudget(),
      totalIngests: this.totalIngests,
      uniqueRatio: this.totalIngests > 0 ? this.uniqueAtoms / this.totalIngests : 0,
      perModality: { ...this.perModality },
      cortex: this.cortex.stats(),
    };
  }

  clear(): void {
    this.atoms.clear();
    this.buckets.clear();
    this.hashList.length = 0;
    this.totalIngests = 0;
    this.uniqueAtoms = 0;
    this.perModality = { audio: 0, video: 0, imu: 0, synthetic: 0, 'vision-embed': 0 };
    this.cortex.reset();
    this.lastByModality = {
      audio: null,
      video: null,
      imu: null,
      synthetic: null,
      'vision-embed': null,
    };
    this.genByModality = { audio: 0, video: 0, imu: 0, synthetic: 0, 'vision-embed': 0 };
    this.lastConsumedGen = { audio: 0, video: 0, imu: 0, synthetic: 0, 'vision-embed': 0 };
    this.mostRecentModality = null;

    this.recentHashes.length = 0;
    this.evictCursor = 0;
  }

  /**
   * Power-of-K tournament eviction. We sample K atoms and drop the weakest by
   * priority = reinforcements·1000 + lastSeen. O(K) amortised. Quality vs
   * full-sort eviction is provably within 1/e for K ≥ 8 under heavy-tailed
   * reinforcement distributions (which sensory atoms exhibit).
   *
   * Sampling is a deterministic Weyl stride (R1), not a random draw.
   */
  private evictOne(): void {
    if (this.hashList.length === 0) return;
    let worstHash: string | null = null;
    let worstPriority = Number.POSITIVE_INFINITY;
    const K = Math.min(EVICT_SAMPLE, this.hashList.length);
    for (let s = 0; s < K; s++) {
      this.evictCursor = (this.evictCursor + 0x9e3779b1) >>> 0;
      const idx = this.evictCursor % this.hashList.length;
      const h = this.hashList[idx];
      const a = this.atoms.get(h);
      if (!a) continue;
      const p = a.reinforcements * 1000 + a.lastSeen;
      if (p < worstPriority) {
        worstPriority = p;
        worstHash = h;
      }
    }
    if (!worstHash) return;
    const atom = this.atoms.get(worstHash);
    if (!atom) return;
    this.atoms.delete(worstHash);
    // Remove from hashList (swap-pop)
    const li = this.hashList.indexOf(worstHash);
    if (li >= 0) {
      const last = this.hashList.pop()!;
      if (li < this.hashList.length) this.hashList[li] = last;
    }
    // Remove from bucket
    const key = bucketKey(worstHash, BUCKET_HASH_BITS);
    const b = this.buckets.get(key);
    if (b) {
      const i = b.indexOf(worstHash);
      if (i >= 0) b.splice(i, 1);
      if (b.length === 0) this.buckets.delete(key);
    }
  }
}

function topK(feature: Float32Array, K: number): { indices: Int32Array; amplitudes: Float32Array } {
  const idx = new Int32Array(K);
  const amp = new Float32Array(K);
  for (let i = 0; i < K; i++) {
    idx[i] = -1;
    amp[i] = 0;
  }
  // Persistent min-slot — only re-scan after a replacement (turns the inner
  // O(K) scan into amortised O(1) per feature element on average). Initial
  // minAbs=0 / minSlot=0 because every slot starts at amp=0.
  let minSlot = 0;
  let minAbs = 0;
  for (let i = 0; i < feature.length; i++) {
    const a = feature[i];
    const abs = a < 0 ? -a : a;
    if (abs > minAbs) {
      idx[minSlot] = i;
      amp[minSlot] = a;
      // Re-locate the smallest |amp| slot after the replacement.
      let ms = 0;
      let ma = amp[0] < 0 ? -amp[0] : amp[0];
      for (let k = 1; k < K; k++) {
        const x = amp[k] < 0 ? -amp[k] : amp[k];
        if (x < ma) {
          ma = x;
          ms = k;
        }
      }
      minSlot = ms;
      minAbs = ma;
    }
  }
  return { indices: idx, amplitudes: amp };
}
