/**
 * VisionEmbedFrontend — periodically samples the active camera and pipes
 * a semantic embedding into the sensory field.
 *
 * Design constraints (all deliberate)
 * ===================================
 *   • Never opens its own camera. Attaches to a running VideoFrontend
 *     and reads from its <video> element. One MediaStream per tab,
 *     shared by all consumers. This avoids the "black screen" bug
 *     browsers show when two getUserMedia calls contend for the same
 *     device, and halves battery/thermal load on mobile.
 *
 *   • Encode cadence is deliberately DECOUPLED from the 89 Hz motion
 *     tick. Semantic embeddings don't need per-motion-frame updates;
 *     8 Hz (default) is enough for scene-change binding + Hebbian
 *     co-activation with audio at the ~125 ms perceptual grain. The
 *     model itself averages 30-80 ms per inference on WebGPU, so 8 Hz
 *     keeps a comfortable 40% utilisation ceiling.
 *
 *   • Backpressure aware. When the engine reports high compute
 *     pressure (window.__metatronComputePressure > 0.85) we drop
 *     to the floor rate (3 Hz). Same knob AudioFrontend uses — the
 *     engine remains the priority citizen.
 *
 *   • Emit path is dual:
 *       1. SensoryGateway.ingest(embed, 'vision-embed', tick) — the
 *          embedding becomes a percept, hashed + bucketed + reinforced
 *          exactly like audio/video/imu atoms, and bound Hebbian-style
 *          to co-active modalities.
 *       2. publishVisionEmbedding(embed, novelty) — visible to any
 *          future framework consumer via the bridge, without forcing
 *          the framework layer to know about SensoryGateway atoms.
 *
 *   • Novelty is cosine-distance-to-prior. Since encoder returns
 *     L2-normalised vectors, novelty = 1 - x · x_prev (in [0..2],
 *     clamped to [0..1] since orthogonal is already "very novel").
 *     On first frame or dim change, novelty = 1.
 */

import type { SensoryGateway } from './SensoryGateway';
import type { VideoFrontend } from './VideoFrontend';
import { getVisionEncoder, type VisionEncoderState } from './VisionEncoder';
import { publishVisionEmbedding } from './sensoryFieldBridge';
import type { RawImage } from '@huggingface/transformers';

// Model canonical input side. ViT-base uses 224; if you swap to a
// different model, transformers.js's Processor will resize again
// internally — this is just a cheap pre-downsample to save bandwidth
// between canvas → preprocessor.
const CAPTURE_SIDE = 224;

// Default encode rate. Chosen so a WebGPU-backed ViT-base at ~60 ms
// per frame stays well under 50% utilisation; WASM ~250 ms per frame
// still runs comfortably (the CPU sees ~2 Hz effective under pressure).
const FAST_HZ = 8;
const FLOOR_HZ = 3;

function readEnginePressure(): number {
  if (typeof window === 'undefined') return 0;
  const v = (window as unknown as { __metatronComputePressure?: number }).__metatronComputePressure;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export interface VisionEmbedStatus {
  running: boolean;
  encoder: VisionEncoderState;
  lastCaptureMs: number;
  publishedCount: number;
  lastNovelty: number;
  effectiveHz: number;
}

export class VisionEmbedFrontend {
  private videoSource: VideoFrontend | null = null;
  private gateway: SensoryGateway | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private timer: number | null = null;
  private running = false;
  private tickRef = { v: 0 };
  private prevEmbed: Float32Array | null = null;
  // Temporal EMA of the semantic embedding. α = 1/φ² ≈ 0.381966 matches
  // the F5 EMA constant used elsewhere in the engine, so the scene-level
  // vector responds on the same φ-graded timescale as the audio bands.
  // Published to downstream consumers (frameworks, memory). Raw per-frame
  // embed is used ONLY for novelty computation (fast scene-cut detection).
  private emaEmbed: Float32Array | null = null;
  private static readonly EMA_ALPHA = 0.3819660112501051; // 1/φ²
  private lastNovelty = 1;
  private publishedCount = 0;
  private lastCaptureMs = 0;
  private lastPeriodMs = 1000 / FAST_HZ;
  private inflight = false;

  isRunning(): boolean { return this.running; }
  setTickRef(ref: { v: number }): void { this.tickRef = ref; }

  status(): VisionEmbedStatus {
    return {
      running: this.running,
      encoder: getVisionEncoder().state(),
      lastCaptureMs: this.lastCaptureMs,
      publishedCount: this.publishedCount,
      lastNovelty: this.lastNovelty,
      effectiveHz: this.lastPeriodMs > 0 ? 1000 / this.lastPeriodMs : 0,
    };
  }

  /**
   * Attach to a running VideoFrontend + SensoryGateway. Idempotent.
   * The encoder is loaded lazily on the first encode() so the UI can
   * enable this frontend without a long await.
   */
  async enable(videoSource: VideoFrontend, gateway: SensoryGateway): Promise<void> {
    if (this.running) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      throw new Error('vision-embed: browser only');
    }
    if (!videoSource.isRunning()) {
      throw new Error('vision-embed: attached VideoFrontend must be running first');
    }
    this.videoSource = videoSource;
    this.gateway = gateway;
    this.canvas = document.createElement('canvas');
    this.canvas.width = CAPTURE_SIDE;
    this.canvas.height = CAPTURE_SIDE;
    // willReadFrequently=true keeps the canvas in CPU-side memory so
    // getImageData is fast; we're going to read every capture.
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!this.ctx) throw new Error('vision-embed: 2D context unavailable');
    this.running = true;

    // Kick off model load — non-blocking. The loop will wait for it
    // on first encode().
    void getVisionEncoder().load().catch((e) => {
      console.error('[VisionEmbedFrontend] encoder load failed:', e);
    });

    const loop = () => {
      if (!this.running) return;
      const pressure = readEnginePressure();
      const hz = pressure > 0.85 ? FLOOR_HZ : FAST_HZ;
      this.lastPeriodMs = 1000 / hz;
      // Fire-and-forget: capture+encode is async; the timer keeps
      // advancing so we can drop frames rather than back up a queue.
      if (!this.inflight) void this.tickOnce();
      this.timer = window.setTimeout(loop, this.lastPeriodMs);
    };
    this.timer = window.setTimeout(loop, this.lastPeriodMs);
  }

  private async tickOnce(): Promise<void> {
    if (!this.videoSource || !this.canvas || !this.ctx || !this.gateway) return;
    const videoEl = this.videoSource.videoElement();
    if (!videoEl || videoEl.readyState < 2) return;
    this.inflight = true;
    try {
      // Aspect-correct centre-crop → 224×224. Previous behaviour squashed
      // 640×480 into a square and warped features; ViT was trained on
      // centre-cropped square inputs so we mirror that pipeline exactly.
      const vw = videoEl.videoWidth || CAPTURE_SIDE;
      const vh = videoEl.videoHeight || CAPTURE_SIDE;
      const side = Math.min(vw, vh);
      const sx = (vw - side) / 2;
      const sy = (vh - side) / 2;
      this.ctx.drawImage(videoEl, sx, sy, side, side, 0, 0, CAPTURE_SIDE, CAPTURE_SIDE);
      const img = this.ctx.getImageData(0, 0, CAPTURE_SIDE, CAPTURE_SIDE);
      // Convert RGBA → RGB planar Uint8ClampedArray. transformers.js
      // Processor accepts channels=3 or 4 but 3 is smaller.
      const rgb = new Uint8ClampedArray(CAPTURE_SIDE * CAPTURE_SIDE * 3);
      const src = img.data;
      for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
        rgb[j] = src[i];
        rgb[j + 1] = src[i + 1];
        rgb[j + 2] = src[i + 2];
      }
      const raw = {
        data: rgb,
        width: CAPTURE_SIDE,
        height: CAPTURE_SIDE,
        channels: 3,
      } as unknown as RawImage;

      const t0 = performance.now();
      const embed = await getVisionEncoder().encode(raw);
      this.lastCaptureMs = performance.now() - t0;

      // Novelty: 1 − cos(x, x_prev) computed on the RAW per-frame embed so
      // true scene cuts spike novelty even when the EMA is still catching up.
      let novelty = 1;
      if (this.prevEmbed && this.prevEmbed.length === embed.length) {
        let dot = 0;
        for (let i = 0; i < embed.length; i++) dot += embed[i] * this.prevEmbed[i];
        novelty = Math.max(0, Math.min(1, 1 - dot));
      }
      this.lastNovelty = novelty;
      this.prevEmbed = embed;

      // Temporal EMA of the embedding. Publishes the *scene-level*
      // semantic vector (α = 1/φ² blends ≈2.6-frame half-life at 8Hz),
      // then L2-renormalises so downstream cosine math stays honest.
      if (!this.emaEmbed || this.emaEmbed.length !== embed.length) {
        this.emaEmbed = new Float32Array(embed.length);
        this.emaEmbed.set(embed);
      } else {
        const a = VisionEmbedFrontend.EMA_ALPHA;
        const inv = 1 - a;
        const ema = this.emaEmbed;
        for (let i = 0; i < embed.length; i++) ema[i] = inv * ema[i] + a * embed[i];
        // Renormalise so ‖ema‖ = 1 (embed is already unit-norm; the blend
        // pulls it off the unit sphere slightly).
        let n = 0;
        for (let i = 0; i < ema.length; i++) n += ema[i] * ema[i];
        n = Math.sqrt(n);
        if (n > 1e-12) {
          const s = 1 / n;
          for (let i = 0; i < ema.length; i++) ema[i] *= s;
        }
      }

      // Dual publish: gateway atom (Hebbian binding, uses raw so per-frame
      // percept discrimination is preserved) + bridge slot (EMA — stable
      // scene-level vector for frameworks and memory).
      this.gateway.ingest(embed, 'vision-embed', this.tickRef.v);
      publishVisionEmbedding(this.emaEmbed, novelty);
      this.publishedCount++;
    } catch (e) {
      // Encoder not loaded yet is expected on the first few ticks;
      // silently retry. Real errors: log but keep the loop alive.
      const msg = (e as Error)?.message ?? String(e);
      if (!msg.includes('not loaded')) {
        console.warn('[VisionEmbedFrontend] tick failed:', msg);
      }
    } finally {
      this.inflight = false;
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    this.videoSource = null;
    this.gateway = null;
    this.canvas = null;
    this.ctx = null;
    this.prevEmbed = null;
    this.emaEmbed = null;
  }
}
