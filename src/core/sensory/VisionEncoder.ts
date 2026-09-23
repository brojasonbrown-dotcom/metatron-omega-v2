/**
 * VisionEncoder — client-side image embedder over @huggingface/transformers.
 *
 * Ontology
 * ========
 * Vision is the third continuous modality (after audio & IMU). We do NOT
 * feed the framework math directly; we produce a normalized embedding
 * vector per frame, publish it to (a) SensoryGateway as a 'vision-embed'
 * atom and (b) sensoryFieldBridge so future consumers can bind to it.
 * The engine's F5..F9 numerics are unchanged.
 *
 * Runtime posture
 * ---------------
 *   • WebGPU-first via `device: 'webgpu'` when navigator.gpu is present
 *     and the adapter accepts our request; automatic WASM fallback
 *     otherwise (transformers.js handles this transparently, but we make
 *     the decision explicit so we can log it and surface it in the UI).
 *   • Model + tokenizer weights are cached by transformers.js in the
 *     browser's Cache Storage (`transformers-cache/`) — first load
 *     downloads once (~86 MB for ViT-base), subsequent loads are
 *     offline. This is the "no web dependency after first bootstrap"
 *     property the user requested.
 *   • Loading is single-flight + idempotent. Multiple callers of
 *     `getVisionEncoder()` share one Promise, so we don't double-load
 *     or double-warm up.
 *   • encode() is single-in-flight per encoder — concurrent callers get
 *     the SAME embedding of the SAME frame they submitted (we serialize).
 *     This matches how the model actually processes: batching would
 *     require restructuring the frontend loop.
 *
 * Model choice (default, honest)
 * ------------------------------
 * Default: `Xenova/vit-base-patch16-224`. Rationale:
 *   • ImageNet-1K supervised ViT — proven, well-understood embeddings.
 *   • 768-D CLS token output → dense, useful for Hebbian binding.
 *   • Fully supported by transformers.js `image-feature-extraction` on
 *     WebGPU today (verified in HF WebGPU showcase).
 *   • ~86 MB fp32, ~22 MB int8 (transformers.js chooses per device).
 *
 * The env override `VITE_VISION_MODEL` lets us swap to MambaVision /
 * DINOv2 / MobileCLIP the moment their browser ONNX builds stabilize —
 * no code change required.
 *
 * Non-goals for this iteration:
 *   • Text-conditioned similarity (CLIP-style). Would need a text
 *     encoder + tokenizer; adds ~20 MB and doesn't help the engine
 *     bind visual patterns to field state.
 *   • Object detection / segmentation. Different task, different model.
 */

// Type-only imports are erased at build time — safe at module scope
// and don't pull the 1 MB runtime into non-vision chunks. The runtime
// itself is dynamic-imported inside load() so the ~23 MB ORT WASM +
// transformers.js bundle only downloads when the user turns VISION on.
import type { ImageFeatureExtractionPipeline, RawImage } from '@huggingface/transformers';

// Allow model override via Vite env at build time, e.g.
//   VITE_VISION_MODEL=Xenova/mobileclip-s0
// Keeps default sane and predictable for the deployed build.
const DEFAULT_MODEL =
  (import.meta.env.VITE_VISION_MODEL as string | undefined) ??
  'Xenova/vit-base-patch16-224';


export type VisionDevice = 'webgpu' | 'wasm' | 'unavailable';

export interface VisionEncoderState {
  readonly modelId: string;
  readonly device: VisionDevice;
  readonly ready: boolean;
  readonly loadError: string | null;
  readonly embeddingDim: number;
  readonly warmupMs: number;
  readonly lastInferMs: number;
  readonly framesEncoded: number;
}

class VisionEncoder {
  readonly modelId: string;
  private pipe: ImageFeatureExtractionPipeline | null = null;
  private loadPromise: Promise<void> | null = null;
  private inflight: Promise<Float32Array> | null = null;
  private _device: VisionDevice = 'unavailable';
  private _loadError: string | null = null;
  private _embeddingDim = 0;
  private _warmupMs = 0;
  private _lastInferMs = 0;
  private _framesEncoded = 0;

  constructor(modelId: string = DEFAULT_MODEL) {
    this.modelId = modelId;
  }

  state(): VisionEncoderState {
    return {
      modelId: this.modelId,
      device: this._device,
      ready: this.pipe !== null,
      loadError: this._loadError,
      embeddingDim: this._embeddingDim,
      warmupMs: this._warmupMs,
      lastInferMs: this._lastInferMs,
      framesEncoded: this._framesEncoded,
    };
  }

  /**
   * Load the model + tokenizer + preprocessor. Idempotent + single-flight.
   * WebGPU-first; falls back to WASM automatically on device mismatch.
   */
  async load(): Promise<void> {
    if (this.pipe) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      const t0 = performance.now();
      // Dynamic import — the ~1 MB transformers.js + ~23 MB ORT WASM
      // only download when the user actually turns VISION on. This
      // keeps the initial page load lean for people who never use it.
      const tf = await import('@huggingface/transformers');
      // Configure the runtime posture once, on first use.
      tf.env.allowLocalModels = false;
      tf.env.useBrowserCache = true;

      // Try WebGPU first.
      const wantsWebGPU =
        typeof navigator !== 'undefined' &&
        typeof (navigator as { gpu?: unknown }).gpu !== 'undefined';
      try {
        if (wantsWebGPU) {
          this.pipe = await tf.pipeline('image-feature-extraction', this.modelId, {
            device: 'webgpu',
            // fp16 halves the WebGPU model size and roughly doubles
            // throughput on Ada/Ampere/M-series. Safe for embeddings.
            dtype: 'fp16',
          });
          this._device = 'webgpu';
        } else {
          throw new Error('no navigator.gpu');
        }
      } catch (e) {
        // Any WebGPU init failure (adapter absent, driver crash, model
        // op unsupported) → WASM fallback. Log but keep going.
        console.warn('[VisionEncoder] WebGPU init failed, falling back to WASM:', (e as Error).message);
        try {
          this.pipe = await tf.pipeline('image-feature-extraction', this.modelId, {
            device: 'wasm',
            dtype: 'q8', // int8 keeps WASM real-time
          });
          this._device = 'wasm';
        } catch (e2) {
          this._device = 'unavailable';
          this._loadError = (e2 as Error).message ?? 'unknown load error';
          throw e2;
        }
      }
      // Warmup — first inference is JIT-heavy on WebGPU; do a dummy
      // pass so real frames don't stall the render loop. `pool: true`
      // asks the pipeline for the pooled embedding (single vector per
      // image) rather than the raw hidden-state stack.
      try {
        const dummy = _makeDummyRawImage(224, 224);
        const warm = await this.pipe!(dummy, { pool: true });
        // Determine flat embedding length after any residual pooling.
        this._embeddingDim = _flattenEmbedding(warm.data as Float32Array, warm.dims as number[]).length;
      } catch (e) {
        console.warn('[VisionEncoder] warmup failed:', (e as Error).message);
      }


      this._warmupMs = performance.now() - t0;
    })();
    try {
      await this.loadPromise;
    } finally {
      // Keep loadPromise resolved so subsequent load() calls are cheap.
    }
  }

  /**
   * Encode one image frame → L2-normalized embedding. Serializes
   * concurrent callers (no batching). Returns a NEW Float32Array each
   * call so the caller can hold it without worrying about the model
   * reusing internal buffers.
   */
  async encode(image: RawImage): Promise<Float32Array> {
    if (!this.pipe) await this.load();
    if (!this.pipe) throw new Error('vision encoder not loaded');
    // Serialize.
    if (this.inflight) await this.inflight.catch(() => undefined);
    const p = (async () => {
      const t0 = performance.now();
      const out = await this.pipe!(image, { pool: true });
      this._lastInferMs = performance.now() - t0;
      this._framesEncoded++;
      // out.data may be [1, D] (pooled) or [1, N, D] (unpooled models
      // that ignore the pool flag). Flatten defensively, then
      // L2-normalize so cosine similarity == dot product downstream —
      // Hebbian binding assumes unit-norm vectors.
      const flat = _flattenEmbedding(out.data as Float32Array, out.dims as number[]);
      _l2NormalizeInPlace(flat);
      if (this._embeddingDim !== flat.length) this._embeddingDim = flat.length;
      return flat;
    })();

    this.inflight = p;
    try {
      return await p;
    } finally {
      if (this.inflight === p) this.inflight = null;
    }
  }
}

// Module-scoped singleton — one encoder per browser tab. Avoids double-
// loading a 86 MB model when multiple frontends want vision.
let singleton: VisionEncoder | null = null;

/**
 * Returns the shared VisionEncoder. Call `.load()` before `.encode()`.
 */
export function getVisionEncoder(): VisionEncoder {
  if (!singleton) singleton = new VisionEncoder();
  return singleton;
}

/**
 * Build a tiny gray RawImage for warmup. Uses the transformers.js
 * `RawImage` shape (uint8 planar RGB, 3 channels, no alpha).
 */
function _makeDummyRawImage(w: number, h: number): RawImage {
  const data = new Uint8ClampedArray(w * h * 3);
  data.fill(128);
  // The RawImage constructor is exposed on the library's export map;
  // we reconstruct one via the same shape without importing the class
  // directly (its export path has moved between versions).
  return {
    data,
    width: w,
    height: h,
    channels: 3,
  } as unknown as RawImage;
}

/**
 * Flatten a pipeline embedding tensor to a single vector.
 *
 * Pool-supporting models (ViT with `pool: true`, CLIP) return `[1, D]`
 * (or already-flat `[D]`) — clone as-is.
 * Models that ignore `pool` (some DINOv3 builds return `[1, N, D]`
 * hidden states) — mean-pool over N so the output shape is invariant
 * across model choices. This is what upstream consumers expect.
 */
function _flattenEmbedding(data: Float32Array, dims: readonly number[]): Float32Array {
  if (!dims || dims.length <= 2) {
    // [D] or [1, D] — just clone.
    const out = new Float32Array(data.length);
    out.set(data);
    return out;
  }
  // Higher-rank: fold every leading dim into a single "N" axis and
  // mean-pool over it. Handles [1, N, D], [N, D], [1, N, C, D] etc.
  const D = dims[dims.length - 1];
  const N = data.length / D;
  if (!Number.isFinite(N) || N < 1) {
    const out = new Float32Array(data.length);
    out.set(data);
    return out;
  }
  const out = new Float32Array(D);
  for (let i = 0; i < N; i++) {
    const off = i * D;
    for (let d = 0; d < D; d++) out[d] += data[off + d];
  }
  const inv = 1 / N;
  for (let d = 0; d < D; d++) out[d] *= inv;
  return out;
}

/** L2-normalize a vector in place so ‖x‖ = 1 (Hebbian binding assumes this). */
function _l2NormalizeInPlace(x: Float32Array): void {
  let sq = 0;
  for (let i = 0; i < x.length; i++) sq += x[i] * x[i];
  if (sq <= 1e-12) return; // zero vector — leave alone
  const inv = 1 / Math.sqrt(sq);
  for (let i = 0; i < x.length; i++) x[i] *= inv;
}

