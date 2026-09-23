/**
 * FieldTape (L0) — continuous Ψ ring buffer.
 *
 * Every engine tick writes a compressed Ψ frame here. The tape is the
 * substrate of "true continuity": replay, recall, and any layer above L0
 * can rebuild context from these frames without ever asking the engine
 * to re-derive prior state.
 *
 * Storage strategy
 * ----------------
 * Chunked Float32Array allocation (lazy, on-demand). Each chunk holds
 * `framesPerChunk` frames of fixed width. The total capacity comes from
 * the sovereign ResourceGovernor's RAM budget — we do NOT pre-allocate
 * the whole budget (browsers cap single ArrayBuffer at ~2 GB). Chunks
 * grow as the ring fills, capped at `cap` frames. When wrap occurs the
 * oldest frame is overwritten in place — no allocation cost on the
 * steady-state hot path.
 *
 * Frame layout (Float32):
 *   [0]            tick
 *   [1]            qualiaScalar
 *   [2]            coherenceΩ
 *   [3]            energyE
 *   [4]            salience
 *   [5]            novelty
 *   [6]            surprise
 *   [7]            reserved (flags)
 *   [8]            visionCosine   (cosine(vision-embed, densified Ψ) — 0 if no live vision)
 *   [9]            visionNovelty  (scene-cut burst score — 0 if no live vision)
 *   [10 .. 10+K-1]   top-K mode indices (cast to f32)
 *   [10+K .. 10+2K-1] top-K mode amplitudes
 *
 * Determinism: identical Ψ stream ⇒ identical tape. Vision fields are
 * additive; when the camera is off both are 0 and the tape carries the
 * same numerical content as pre-vision runs (goldens preserved).
 */

const FRAME_HEADER = 10;
const DEFAULT_TOPK = 16;
const FRAMES_PER_CHUNK = 1 << 14; // 16K frames per chunk

export interface FieldTapeFrameInput {
  tick: number;
  psi: Float64Array;
  qualiaScalar: number;
  coherence: number;
  energy: number;
  salience: number;
  novelty: number;
  surprise: number;
  /** Cosine between the projected vision embedding and the densified Ψ
   *  in the shared projection space. Optional — 0 when vision inactive. */
  visionCosine?: number;
  /** Scene-cut burst from the vision frontend. Optional — 0 when off. */
  visionNovelty?: number;
}

export interface FieldTapeFrame {
  tick: number;
  qualiaScalar: number;
  coherence: number;
  energy: number;
  salience: number;
  novelty: number;
  surprise: number;
  visionCosine: number;
  visionNovelty: number;
  indices: Int32Array;
  amplitudes: Float32Array;
}

export class FieldTape {
  private cap: number;
  private readonly topK: number;
  private readonly frameWidth: number;
  private readonly chunkBytes: number;
  private chunks: Float32Array[] = [];
  private chunksAllocated = 0;
  private writeIndex = 0;        // next frame slot (mod cap)
  private count = 0;             // total frames written
  private totalTicks = 0;
  // measured write-rate (Hz) — EMA over real wall-clock deltas between
  // consecutive write() calls. Used by the HUD; never feeds back into
  // PhiLock scheduling, so it is observation-only and cannot regress
  // the carrier or any Fibonacci period.
  private lastWriteMs = 0;
  private measuredHzEma = 0;
  private static readonly HZ_ALPHA = 0.06180339887; // 1/φ⁴ ≈ smooth response

  constructor(cap: number, topK: number = DEFAULT_TOPK) {
    this.topK = Math.max(4, Math.min(64, Math.floor(topK)));
    this.frameWidth = FRAME_HEADER + 2 * this.topK;
    this.chunkBytes = FRAMES_PER_CHUNK * this.frameWidth * 4;
    this.cap = Math.max(FRAMES_PER_CHUNK, Math.floor(cap));
  }

  setCap(cap: number): void {
    const next = Math.max(FRAMES_PER_CHUNK, Math.floor(cap));
    if (next === this.cap) return;
    if (next < this.cap) {
      // Shrink: drop chunks past the new cap. Move writeIndex to a safe slot.
      const neededChunks = Math.ceil(next / FRAMES_PER_CHUNK);
      if (this.chunks.length > neededChunks) this.chunks.length = neededChunks;
      this.chunksAllocated = this.chunks.length;
      this.writeIndex = this.writeIndex % next;
      this.count = Math.min(this.count, next);
    }
    this.cap = next;
  }

  capacity(): number { return this.cap; }
  size(): number { return this.count; }
  totalWrites(): number { return this.totalTicks; }
  bytesUsed(): number { return this.chunksAllocated * this.chunkBytes; }
  bytesBudget(): number { return Math.ceil(this.cap / FRAMES_PER_CHUNK) * this.chunkBytes; }
  /** EMA-smoothed write rate in Hz (observation-only, never drives scheduling). */
  measuredHz(): number { return this.measuredHzEma; }


  /** Append one compressed Ψ frame. O(N) over psi length (top-K selection). */
  write(input: FieldTapeFrameInput): void {
    const slot = this.writeIndex;
    const chunkIdx = Math.floor(slot / FRAMES_PER_CHUNK);
    const offset = (slot - chunkIdx * FRAMES_PER_CHUNK) * this.frameWidth;
    this.ensureChunk(chunkIdx);
    const buf = this.chunks[chunkIdx];

    buf[offset] = input.tick;
    buf[offset + 1] = input.qualiaScalar;
    buf[offset + 2] = input.coherence;
    buf[offset + 3] = input.energy;
    buf[offset + 4] = input.salience;
    buf[offset + 5] = input.novelty;
    buf[offset + 6] = input.surprise;
    buf[offset + 7] = 0;
    buf[offset + 8] = input.visionCosine ?? 0;
    buf[offset + 9] = input.visionNovelty ?? 0;

    // top-K by |amp| — persistent min-slot tracking (was O(N·K), now amortised O(N)).
    const K = this.topK;
    const idxOut = offset + FRAME_HEADER;
    const ampOut = offset + FRAME_HEADER + K;
    for (let i = 0; i < K; i++) { buf[idxOut + i] = -1; buf[ampOut + i] = 0; }
    const psi = input.psi;
    // Initial min slot 0, |amp|=0; first K real samples will displace.
    let minSlot = 0;
    let minAbs = 0;
    for (let i = 0; i < psi.length; i++) {
      const a = psi[i];
      const abs = a < 0 ? -a : a;
      if (abs > minAbs) {
        buf[idxOut + minSlot] = i;
        buf[ampOut + minSlot] = a;
        // Re-scan K slots to find new smallest.
        let ms = 0;
        let mv = buf[ampOut]; mv = mv < 0 ? -mv : mv;
        for (let k = 1; k < K; k++) {
          let x = buf[ampOut + k]; x = x < 0 ? -x : x;
          if (x < mv) { mv = x; ms = k; }
        }
        minSlot = ms;
        minAbs = mv;
      }
    }

    this.writeIndex = (slot + 1) % this.cap;
    if (this.count < this.cap) this.count++;
    this.totalTicks++;

    // Measured Hz EMA — only updated when we have a previous timestamp.
    // Uses performance.now() when available, else Date.now() — both fine
    // here because this metric is HUD-only, never fed back into scheduling.
    const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (this.lastWriteMs > 0) {
      const dt = now - this.lastWriteMs;
      if (dt > 0 && dt < 60000) {
        const instHz = 1000 / dt;
        this.measuredHzEma = this.measuredHzEma === 0
          ? instHz
          : this.measuredHzEma + FieldTape.HZ_ALPHA * (instHz - this.measuredHzEma);
      }
    }
    this.lastWriteMs = now;
  }


  /** Read the most recent n frames (newest first). */
  tail(n: number): FieldTapeFrame[] {
    const out: FieldTapeFrame[] = [];
    const take = Math.min(n, this.count);
    for (let i = 0; i < take; i++) {
      const slot = (this.writeIndex - 1 - i + this.cap) % this.cap;
      const frame = this.readSlot(slot);
      if (frame) out.push(frame);
    }
    return out;
  }

  /** Read frame at logical age (0 = most recent). Returns null if missing. */
  ago(age: number): FieldTapeFrame | null {
    if (age < 0 || age >= this.count) return null;
    const slot = (this.writeIndex - 1 - age + this.cap) % this.cap;
    return this.readSlot(slot);
  }

  // ── Ω-ACTIVATE B1 — readback ────────────────────────────────────────────
  //
  // The tape was write-only in practice: frames went in every tick and no
  // caller ever read one back, so L0 was a size counter rather than a memory.
  // These readers give the layers above it a real trajectory to work with.

  /** Iterate every retained frame, oldest → newest. Allocation-light. */
  *frames(): IterableIterator<FieldTapeFrame> {
    for (let age = this.count - 1; age >= 0; age--) {
      const f = this.ago(age);
      if (f) yield f;
    }
  }

  /** Every retained frame whose tick lies in [fromTick, toTick], oldest first. */
  readRange(fromTick: number, toTick: number): FieldTapeFrame[] {
    const lo = Math.min(fromTick, toTick);
    const hi = Math.max(fromTick, toTick);
    const out: FieldTapeFrame[] = [];
    for (const f of this.frames()) {
      if (f.tick >= lo && f.tick <= hi) out.push(f);
    }
    return out;
  }

  /**
   * The retained frame closest in tick to `tick`, or null when the tape is
   * empty. Ties resolve to the earlier frame, which keeps replay deterministic.
   */
  nearest(tick: number): FieldTapeFrame | null {
    let best: FieldTapeFrame | null = null;
    let bestD = Infinity;
    for (const f of this.frames()) {
      const d = Math.abs(f.tick - tick);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  /**
   * A replay window centred on `tick`: up to `before` frames preceding it and
   * `after` following it, oldest first. This is what an episode uses to answer
   * "what was the field doing when I formed".
   */
  window(tick: number, before = 21, after = 21): FieldTapeFrame[] {
    const anchor = this.nearest(tick);
    if (!anchor) return [];
    const all = [...this.frames()];
    const i = all.findIndex((f) => f.tick === anchor.tick);
    if (i < 0) return [];
    return all.slice(Math.max(0, i - before), Math.min(all.length, i + after + 1));
  }

  private readSlot(slot: number): FieldTapeFrame | null {
    const chunkIdx = Math.floor(slot / FRAMES_PER_CHUNK);
    if (chunkIdx >= this.chunksAllocated) return null;
    const buf = this.chunks[chunkIdx];
    if (!buf) return null;
    const offset = (slot - chunkIdx * FRAMES_PER_CHUNK) * this.frameWidth;
    const K = this.topK;
    const indices = new Int32Array(K);
    const amplitudes = new Float32Array(K);
    for (let k = 0; k < K; k++) {
      indices[k] = buf[offset + FRAME_HEADER + k] | 0;
      amplitudes[k] = buf[offset + FRAME_HEADER + K + k];
    }
    return {
      tick: buf[offset],
      qualiaScalar: buf[offset + 1],
      coherence: buf[offset + 2],
      energy: buf[offset + 3],
      salience: buf[offset + 4],
      novelty: buf[offset + 5],
      surprise: buf[offset + 6],
      visionCosine: buf[offset + 8],
      visionNovelty: buf[offset + 9],
      indices,
      amplitudes,
    };
  }

  private ensureChunk(idx: number): void {
    while (this.chunks.length <= idx) {
      try {
        this.chunks.push(new Float32Array(FRAMES_PER_CHUNK * this.frameWidth));
        this.chunksAllocated++;
      } catch (e) {
        // OOM — clamp cap to what we've got and overwrite from the start.
        const safeCap = this.chunks.length * FRAMES_PER_CHUNK;
        this.cap = Math.max(FRAMES_PER_CHUNK, safeCap);
        this.writeIndex = this.writeIndex % this.cap;
        this.count = Math.min(this.count, this.cap);
        return;
      }
    }
  }
}
