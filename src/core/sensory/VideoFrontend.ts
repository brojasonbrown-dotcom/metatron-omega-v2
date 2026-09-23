/**
 * VideoFrontend — getUserMedia(video) → VideoCortex feature → SensoryGateway.
 *
 * Uses requestVideoFrameCallback when available so we tick on real frame
 * delivery (no setTimeout jitter). Falls back to setTimeout(~89 Hz) on
 * browsers that don't expose rVFC. Downsamples to 32×32 via the existing
 * 2D context — createImageBitmap with resize would be GPU-side, but it
 * doesn't compose with getImageData. We keep this CPU path simple and
 * fast; the heavy lifting is in VideoCortex.
 *
 * Per frame we also compute mean Cb / Cr from the RGB → YCbCr conversion
 * so VideoCortex can run its skin-band classifier.
 */

import type { SensoryGateway } from './SensoryGateway';
import { VideoCortex } from './VideoCortex';

const W = 32, H = 32;
const FEATURE_HZ = 89;

type VideoFrameRequestCallback = (now: DOMHighResTimeStamp, metadata: unknown) => void;
type VideoElementWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: VideoFrameRequestCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export class VideoFrontend {
  private stream: MediaStream | null = null;
  private video: VideoElementWithRvfc | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private lum = new Float32Array(W * H);
  private cortex = new VideoCortex();
  private worker: Worker | null = null;
  private workerBusy = false;
  private timer: number | null = null;
  private rvfcHandle: number | null = null;
  private running = false;
  private tickRef = { v: 0 };
  private lastFeatures = { motion: 0, salience: 0, flowU: 0, flowV: 0, sceneCut: 0, skin: 0 };
  private lastLum: Float32Array | null = null;
  private gateway: SensoryGateway | null = null;
  private periodMs = 1000 / FEATURE_HZ;
  private lastEmit = 0;
  private previewVideo: HTMLVideoElement | null = null;
  private previewCanvas: HTMLCanvasElement | null = null;
  private previewCtx: CanvasRenderingContext2D | null = null;
  private previewImage: ImageData | null = null;

  isRunning(): boolean { return this.running; }
  setTickRef(ref: { v: number }): void { this.tickRef = ref; }
  recentFeatures() { return this.lastFeatures; }
  recentLum(): Float32Array | null { return this.lastLum; }
  videoElement(): HTMLVideoElement | null { return this.video; }

  /** Attach caller-owned preview <video> + 32×32-luma <canvas>. */
  attachPreview(videoEl: HTMLVideoElement | null, lumCanvas: HTMLCanvasElement | null): void {
    this.previewVideo = videoEl;
    if (videoEl && this.stream) {
      videoEl.srcObject = this.stream;
      videoEl.muted = true;
      void videoEl.play().catch(() => { /* ignore */ });
    }
    this.previewCanvas = lumCanvas;
    if (lumCanvas) {
      // Keep the backing store at cortex resolution; CSS scales it. This avoids
      // allocating a temporary upscale canvas on every video frame.
      lumCanvas.width = W;
      lumCanvas.height = H;
      this.previewImage = null;
    }
    this.previewCtx = lumCanvas ? lumCanvas.getContext('2d') : null;
  }

  async enable(gateway: SensoryGateway): Promise<void> {
    if (this.running) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      throw new Error('video: getUserMedia unavailable');
    }
    // Ask for 640×480 (VGA) so downstream consumers — VideoCortex (which
    // downsamples to 32×32 for motion features) and VisionEmbedFrontend
    // (which centre-crops to 224×224 for ViT) — both get real detail
    // instead of a 160×120 upscale. Browser negotiates down if the device
    // can't deliver; the `ideal` constraint never fails the request.
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } } });
    this.video = document.createElement('video') as VideoElementWithRvfc;
    this.video.srcObject = this.stream;
    this.video.muted = true;
    await this.video.play();
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.ctx2d = this.canvas.getContext('2d', { willReadFrequently: true });
    this.gateway = gateway;
    this.running = true;
    this.lastEmit = 0;
    if (this.previewVideo) {
      this.previewVideo.srcObject = this.stream;
      this.previewVideo.muted = true;
      void this.previewVideo.play().catch(() => { /* ignore */ });
    }
    this.spawnWorker();

    if (typeof this.video.requestVideoFrameCallback === 'function') {
      const onFrame: VideoFrameRequestCallback = (now) => {
        if (!this.running || !this.video?.requestVideoFrameCallback) return;
        if (now - this.lastEmit >= this.periodMs - 0.5) {
          this.lastEmit = now;
          void this.processFrame();
        }
        this.rvfcHandle = this.video.requestVideoFrameCallback(onFrame);
      };
      this.rvfcHandle = this.video.requestVideoFrameCallback(onFrame);
    } else {
      const loop = () => {
        if (!this.running) return;
        void this.processFrame();
        this.timer = window.setTimeout(loop, this.periodMs);
      };
      this.timer = window.setTimeout(loop, this.periodMs);
    }
  }

  private spawnWorker(): void {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return;
    try {
      this.worker = new Worker(new URL('./sensoryFrame.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{
        type: string; feature?: ArrayBuffer; lum?: ArrayBuffer;
        motion?: number; salience?: number; flowU?: number; flowV?: number; sceneCut?: number; skin?: number;
      }>) => {
        const d = e.data;
        if (d.type !== 'features' || !d.feature) { this.workerBusy = false; return; }
        const feat = new Float32Array(d.feature);
        if (d.lum) { this.lastLum = new Float32Array(d.lum); this.paintPreview(); }
        this.lastFeatures = {
          motion: d.motion ?? 0, salience: d.salience ?? 0,
          flowU: d.flowU ?? 0, flowV: d.flowV ?? 0,
          sceneCut: d.sceneCut ?? 0, skin: d.skin ?? 0,
        };
        this.gateway?.ingest(feat, 'video', this.tickRef.v);
        this.workerBusy = false;
      };
      this.worker.onerror = () => { try { this.worker?.terminate(); } catch { /* ignore */ } this.worker = null; };
      this.worker.postMessage({ type: 'init', id: 0 });
    } catch { this.worker = null; }
  }

  private async processFrame(): Promise<void> {
    if (!this.video || !this.gateway) return;
    // Worker path — zero-copy ImageBitmap transfer, off-main-thread decode + cortex.
    if (this.worker && !this.workerBusy && typeof createImageBitmap === 'function') {
      try {
        this.workerBusy = true;
        const bm = await createImageBitmap(this.video, { resizeWidth: W, resizeHeight: H, resizeQuality: 'low' } as ImageBitmapOptions);
        this.worker.postMessage({ type: 'frame', id: 0, bitmap: bm, tick: this.tickRef.v }, [bm]);
        return;
      } catch { this.workerBusy = false; /* fall through */ }
    }
    if (!this.ctx2d || !this.canvas) return;
    this.ctx2d.drawImage(this.video, 0, 0, W, H);
    const img = this.ctx2d.getImageData(0, 0, W, H).data;
    let rSum = 0, gSum = 0, bSum = 0, cbSum = 0, crSum = 0;
    for (let i = 0, j = 0; i < img.length; i += 4, j++) {
      const r = img[i], g = img[i + 1], b = img[i + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      this.lum[j] = y / 255 - 0.5;
      const cb = (-0.169 * r - 0.331 * g + 0.500 * b) / 255;
      const cr = (0.500 * r - 0.419 * g - 0.081 * b) / 255;
      rSum += r; gSum += g; bSum += b;
      cbSum += cb; crSum += cr;
    }
    const nRGB = W * H * 255;
    const n = W * H;
    const feat = this.cortex.process(this.lum, rSum / nRGB, gSum / nRGB, bSum / nRGB, cbSum / n, crSum / n);
    this.lastLum = this.lum;
    this.paintPreview();
    this.lastFeatures = {
      motion: feat.motion, salience: feat.salience,
      flowU: feat.flowU, flowV: feat.flowV,
      sceneCut: feat.sceneCut, skin: feat.skin,
    };
    this.gateway.ingest(feat.feature, 'video', this.tickRef.v);
  }

  private paintPreview(): void {
    const ctx = this.previewCtx, cv = this.previewCanvas, lum = this.lastLum;
    if (!ctx || !cv || !lum) return;
    const img = this.previewImage ?? (this.previewImage = ctx.createImageData(W, H));
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) {
      const v = Math.max(0, Math.min(255, Math.round((lum[i] + 0.5) * 255)));
      img.data[j] = v; img.data[j + 1] = v; img.data[j + 2] = v; img.data[j + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.rvfcHandle != null && this.video?.cancelVideoFrameCallback) {
      try { this.video.cancelVideoFrameCallback(this.rvfcHandle); } catch { /* ignore */ }
      this.rvfcHandle = null;
    }
    if (this.video) { this.video.pause(); this.video.srcObject = null; this.video = null; }
    if (this.previewVideo) { try { this.previewVideo.pause(); } catch { /* ignore */ } this.previewVideo.srcObject = null; }
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    if (this.worker) { try { this.worker.terminate(); } catch { /* ignore */ } this.worker = null; }
    this.canvas = null; this.ctx2d = null; this.stream = null; this.gateway = null;
    this.workerBusy = false; this.lastLum = null;
  }
}
